import { sql, type Kysely } from 'kysely';

/** The tree becomes the wood harvest unit (docs/SPEC-BOIS-ARBRE-UNITE.md, slice
 * 2b of docs/PLAN-BOIS-ARBRE-TRANCHE-2.md). No regrowth and no 10 % threshold:
 * a case holds 500 per tree, keeps on woodland_deposits the sum of its trees
 * (remaining, reserved, cut), stays occupied until its last stump is removed,
 * and only then is cleared. Lots name their tree; removing a stump is a lot
 * without wood.
 *
 * The conversion (woodland_convert_to_trees, one world or all) is idempotent
 * and kept in the schema so it can be run again, world by world. It touches player data: a case half cut keeps
 * half its trees standing, the cut counter is recounted in trees of 500, lots
 * under way keep their reservation on one tree each, former regrowth is
 * abandoned. RC1 worlds gain no tree. A world without RC1 forest goes from 300
 * per case to 500 per tree (2 to 5), except beside a building, road or terrace
 * where a case never gains a tree. An RC1 case left without any tree loses its
 * wood once no lot is running on it. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- A stump removal carries no wood but names its tree.
    do $$ declare c record; begin
      for c in select conname from pg_constraint where conrelid='deposit_extractions'::regclass and contype='c'
        and conname<>'deposit_extractions_lot_amount_check' and pg_get_constraintdef(oid) like '%reserved_amount >= 1%'
      loop execute format('alter table deposit_extractions drop constraint %I',c.conname); end loop;
    end $$;
    alter table deposit_extractions drop constraint if exists deposit_extractions_lot_amount_check;
    alter table deposit_extractions add constraint deposit_extractions_lot_amount_check check (
      reserved_amount between 0 and 100 and (reserved_amount >= 1 or (resource_code='wood' and tree_index is not null)));

    -- Stocks no longer move the navigation: only a clearing removes trunks.
    do $$ declare definition text; begin
      select pg_get_functiondef('mark_navigation_change()'::regprocedure) into definition;
      definition:=replace(definition,',(a->>''remaining_amount'')::numeric<=(a->>''initial_amount'')::numeric*.1','');
      definition:=replace(definition,',(b->>''remaining_amount'')::numeric<=(b->>''initial_amount'')::numeric*.1','');
      if position('remaining_amount' in definition)>0 then raise exception 'Woodland threshold still in navigation trigger'; end if;
      execute definition;
    end $$;

    -- The case is the sum of its trees, minus the lots due and not yet debited
    -- by their village. A case blocks its cell until cleared.
    create or replace view resource_deposits as
      select world_id,feature_id,cell_x,cell_y,initial_amount,remaining_amount,reserved_amount,revision,updated_at,
        'stone'::text as resource_code, false as cleared, remaining_amount>0 as blocks_cell, 0::bigint as cut_amount
        from stone_deposits
      union all
      select w.world_id,w.feature_id,w.cell_x,w.cell_y,w.initial_amount,
        (floor(w.remaining_amount)-due.amount)::bigint,
        (w.reserved_amount-due.amount)::bigint,
        w.revision,w.updated_at,'wood'::text,w.cleared,
        not w.cleared,
        (floor(w.cut_amount)+due.amount)::bigint
        from woodland_deposits w cross join lateral (
          select coalesce(sum(e.reserved_amount),0) as amount from deposit_extractions e
          where e.world_id=w.world_id and e.feature_id=w.feature_id and e.resource_code='wood'
            and e.wood_debited_at is null
            and e.completes_at<=coalesce(nullif(current_setting('arbestra.economy_through',true),'')::timestamptz,statement_timestamp())
        ) due;

    -- One world at a time, or all of them (null); returns the cases changed.
    drop function if exists woodland_convert_to_trees();
    create or replace function woodland_convert_to_trees(only_world uuid default null) returns integer
    language plpgsql as $fn$
    declare
      -- ADDED_TREE_MARGIN_CELLS (2), plus a tree's offset from its cell centre and half a footprint.
      margin constant integer := 3;
      w record; lot record; trees integer[]; n integer; n_old integer; share numeric; stumps integer;
      entamed numeric; rem integer[]; res integer[]; i integer; placed integer; total integer; reserved integer;
      cut integer; converted integer := 0; at_now timestamptz := statement_timestamp();
    begin
      -- Cells near a building, road or terrace of a world without RC1 forest.
      create temporary table if not exists woodland_margin_cells(world_id uuid, cell_x integer, cell_y integer) on commit drop;
      truncate woodland_margin_cells;
      insert into woodland_margin_cells
      select distinct p.world_id,
        (((floor(p.x+.5)::integer+dx)%v.width_cells)+v.width_cells)%v.width_cells,
        (((floor(p.y+.5)::integer+dy)%v.height_cells)+v.height_cells)%v.height_cells
      from (
        select o.world_id,o.cell_x::float8 as x,o.cell_y::float8 as y from world_cell_occupancies o where o.building_id is not null
        union all select t.world_id,t.cell_x,t.cell_y from world_spawn_terraces t
        union all
        select s.world_id,s.x-s.dx+s.dx*k/s.steps,s.y-s.dy+s.dy*k/s.steps
        from (
          select q.world_id,q.x,q.y,q.dx,q.dy,greatest(1,ceil(abs(q.dx)+abs(q.dy))::integer) as steps
          from (
            select r.world_id,r.x,r.y,
              coalesce((r.x-r.px)-floor(((r.x-r.px)+r.width_cells/2.0)/r.width_cells)*r.width_cells,0) as dx,
              coalesce((r.y-r.py)-floor(((r.y-r.py)+r.height_cells/2.0)/r.height_cells)*r.height_cells,0) as dy
            from (
              select vi.world_id,ww.width_cells,ww.height_cells,(pt->>'x')::float8/8 as x,(pt->>'y')::float8/8 as y,
                lag((pt->>'x')::float8/8) over road as px,lag((pt->>'y')::float8/8) over road as py
              from village_infrastructure vi join worlds ww on ww.id=vi.world_id,
                lateral jsonb_array_elements(coalesce(vi.plan->'roads','[]')||coalesce(vi.plan->'inheritedRoads','[]'))
                  with ordinality item(value,item_ord),
                lateral jsonb_array_elements(item.value->'points') with ordinality q(pt,ord)
              window road as (partition by vi.world_id,vi.village_id,item.item_ord order by q.ord)
            ) r
          ) q
        ) s cross join lateral generate_series(0,s.steps) k
      ) p join worlds v on v.id=p.world_id
      cross join generate_series(-margin,margin) dx cross join generate_series(-margin,margin) dy
      where (only_world is null or p.world_id=only_world)
        and exists(select 1 from woodland_deposits d where d.world_id=p.world_id
        and not exists(select 1 from world_rc1_resources r where r.world_id=d.world_id and r.feature_id=d.feature_id));
      create index if not exists woodland_margin_cells_key on woodland_margin_cells(world_id,cell_x,cell_y);

      for w in
        select d.world_id,d.feature_id,d.cell_x,d.cell_y,d.initial_amount,d.remaining_amount,d.reserved_amount,
          d.cut_amount,d.cleared,f.variant_seed,r.source_key,r.tree_indices,r.removed_indices
        from woodland_deposits d
        join world_features f on f.world_id=d.world_id and f.id=d.feature_id
        left join world_rc1_resources r on r.world_id=d.world_id and r.feature_id=d.feature_id
        where not d.cleared and (only_world is null or d.world_id=only_world)
          -- A case with a tree row is already converted.
          and not exists(select 1 from woodland_trees t where t.world_id=d.world_id and t.feature_id=d.feature_id)
        order by d.world_id,d.feature_id
        for update of d
      loop
        -- Every tree of the case, in the default designation order (woodlandTreeIndices).
        if w.source_key is null then
          if w.initial_amount % 500 = 0 then
            n := (w.initial_amount/500)::integer;
          else
            n := 2+(abs(w.variant_seed::bigint)%4)::integer;
            n_old := 2+(abs(w.variant_seed::bigint)%3)::integer;
            if n>n_old and exists(select 1 from woodland_margin_cells m
                where m.world_id=w.world_id and m.cell_x=w.cell_x and m.cell_y=w.cell_y) then
              n := n_old;
            end if;
          end if;
          trees := array(select generate_series(0,n-1));
        elsif w.source_key like 'starter:%' and jsonb_array_length(w.tree_indices)=0 then
          trees := array[0,1,2];
        else
          trees := array(select e.value::integer from jsonb_array_elements_text(w.tree_indices) with ordinality e(value,ord)
            where not exists(select 1 from jsonb_array_elements_text(w.removed_indices) x where x.value::integer=e.value::integer)
            order by e.ord);
        end if;
        n := coalesce(array_length(trees,1),0);
        if n=0 then
          -- An RC1 case without any tree loses its wood, after its running lots.
          if exists(select 1 from deposit_extractions e where e.world_id=w.world_id and e.feature_id=w.feature_id
              and e.status='in-progress') then continue; end if;
          update woodland_deposits set cleared=true,remaining_amount=0,reserved_amount=0,revision=revision+1,updated_at=at_now
            where world_id=w.world_id and feature_id=w.feature_id;
          delete from world_cell_occupancies where world_id=w.world_id and feature_id=w.feature_id and building_id is null;
          update world_features set state='depleted',updated_at=at_now where world_id=w.world_id and id=w.feature_id;
          converted := converted+1;
          continue;
        end if;
        -- The share already cut becomes stumps and one trunk on the ground (convertCutGrove).
        rem := array_fill(500,array[n]); res := array_fill(0,array[n]);
        share := least(1,greatest(0,w.cut_amount/w.initial_amount))*n;
        stumps := least(n,floor(share+1e-9)::integer);
        entamed := share-stumps;
        for i in 1..stumps loop rem[i] := 0; end loop;
        if stumps<n and entamed>1e-9 then rem[stumps+1] := round(500*(1-entamed))::integer; end if;
        -- Lots under way keep their reservation, on one tree each, in tree order.
        for lot in select e.id,e.reserved_amount::integer as amount from deposit_extractions e
          where e.world_id=w.world_id and e.feature_id=w.feature_id and e.resource_code='wood'
            and e.status='in-progress' and e.wood_debited_at is null
          order by e.started_at,e.id
        loop
          placed := null;
          for i in 1..n loop
            if rem[i]-res[i]>=lot.amount then placed := i; exit; end if;
          end loop;
          if placed is null then
            -- The former stock still held this lot: its wood goes back to a tree.
            for i in 1..n loop
              if 500-res[i]>=lot.amount then rem[i] := res[i]+lot.amount; placed := i; exit; end if;
            end loop;
          end if;
          if placed is null then raise exception 'Woodland conversion cannot place lot %',lot.id; end if;
          res[placed] := res[placed]+lot.amount;
          update deposit_extractions set tree_index=trees[placed] where id=lot.id;
        end loop;
        total := 0; reserved := 0; cut := 0;
        for i in 1..n loop
          total := total+rem[i]; reserved := reserved+res[i];
          if rem[i]<500 or res[i]>0 then
            insert into woodland_trees(world_id,feature_id,tree_index,remaining_amount,reserved_amount,felled_at,updated_at)
              values(w.world_id,w.feature_id,trees[i],rem[i],res[i],at_now,at_now);
            cut := cut+500-rem[i];
          end if;
        end loop;
        if w.initial_amount<>500*n or w.remaining_amount<>total or w.reserved_amount<>reserved or w.cut_amount<>cut then
          update woodland_deposits set initial_amount=500*n,remaining_amount=total,reserved_amount=reserved,cut_amount=cut,
            regrowth_updated_at=at_now,revision=revision+1,updated_at=at_now
            where world_id=w.world_id and feature_id=w.feature_id;
          converted := converted+1;
        end if;
      end loop;
      -- A case stays occupied, so not buildable, until it is cleared: cells freed
      -- under the former threshold are taken back when still free.
      insert into world_cell_occupancies(world_id,cell_x,cell_y,feature_id,building_id,role)
        select d.world_id,d.cell_x,d.cell_y,d.feature_id,null,'body' from woodland_deposits d
        where not d.cleared and (only_world is null or d.world_id=only_world)
          and not exists(select 1 from world_cell_occupancies o
          where o.world_id=d.world_id and o.cell_x=d.cell_x and o.cell_y=d.cell_y)
        on conflict(world_id,cell_x,cell_y) do nothing;
      return converted;
    end $fn$;
    select woodland_convert_to_trees();
  `.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('The tree as wood harvest unit is forward-only.');
}
