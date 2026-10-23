import { sql, type Kysely } from 'kysely';

const tables = ['world_cell_occupancies', 'world_features', 'woodland_deposits', 'stone_deposits'] as const;

/** RC1 installation inserts ~14k occupancies, ~2k features and deposits in a
 * few statements; four row triggers (V2 shared/indirect 053/054, navigation
 * 042/046, V1 marker 041) ran per row, each re-reading the world. Plain
 * inserts are now collected once per statement with the same references:
 * V2 pending entries, navigation chunk versions and the V1 marker. Rows with
 * per-row rules (an occupancy of a building or of a pending expansion) keep
 * their row triggers; updates and deletes are unchanged. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- Set-based game_sync_spatial_touch: same wrap, chunk key and @cell key.
    create function game_sync_spatial_touch_set(wid uuid, refs jsonb) returns void language plpgsql as $$
    declare d record;
    begin
      if current_setting('arbestra.sync_published', true) = 'yes' then
        raise exception 'Business change after synchronization publication';
      end if;
      select width_cells as w,height_cells as h,chunk_size as s into d from worlds where id=wid;
      if not found then return; end if;
      insert into game_sync_pending
        select distinct txid_current(),wid,'spatial',(c.cx/d.s)::text||','||(c.cy/d.s)::text,r.component,
          case when r.entity='@cell' then c.cx::text||','||c.cy::text else r.entity end
        from jsonb_to_recordset(refs) r(x integer,y integer,component text,entity text)
        cross join lateral (select ((r.x%d.w)+d.w)%d.w as cx,((r.y%d.h)+d.h)%d.h as cy) c
        order by 4,5,6
      on conflict do nothing;
    end $$;
    -- Set-based navigation_touch_box for boxes (x, y, radius).
    create function navigation_touch_boxes(wid uuid, boxes jsonb) returns void language plpgsql as $$
    declare d record;
    begin
      select width_cells as w,height_cells as h,chunk_size as s into d from worlds where id=wid;
      if not found then return; end if;
      insert into navigation_chunk_versions(world_id,chunk_x,chunk_y,transaction_id)
        select distinct wid,floor(((gx.v%d.w+d.w)%d.w)::numeric/d.s)::integer,floor(((gy.v%d.h+d.h)%d.h)::numeric/d.s)::integer,txid_current()
        from jsonb_to_recordset(boxes) b(x float8,y float8,r float8)
        cross join lateral generate_series(floor(b.x-b.r)::integer,ceil(b.x+b.r)::integer) gx(v)
        cross join lateral generate_series(floor(b.y-b.r)::integer,ceil(b.y+b.r)::integer) gy(v)
        order by 2,3
      on conflict(world_id,chunk_x,chunk_y,transaction_id) do nothing;
    end $$;
    create function bulk_insert_collect() returns trigger language plpgsql as $$
    declare wid uuid; spatial jsonb; boxes jsonb; navigation boolean;
    begin
      for wid in select distinct world_id from added order by 1 loop
        if not exists(select 1 from worlds where id=wid) then continue; end if;
        navigation := TG_TABLE_NAME <> 'stone_deposits';
        if TG_TABLE_NAME='world_cell_occupancies' then
          -- Building occupancies run game_sync_shared per row (coverage).
          select jsonb_agg(ref) into spatial from (
            select jsonb_build_object('x',cell_x,'y',cell_y,'component','spatialCells','entity','@cell') as ref
              from added where world_id=wid and building_id is null
            union all select jsonb_build_object('x',cell_x,'y',cell_y,'component','spatialFeatures','entity',feature_id::text)
              from added where world_id=wid and building_id is null and feature_id is not null) refs;
          select jsonb_agg(jsonb_build_object('x',cell_x,'y',cell_y,'r',1)) into boxes from added where world_id=wid;
        elsif TG_TABLE_NAME='world_features' then
          select jsonb_agg(ref) into spatial from (
            select jsonb_build_object('x',p.cell_x,'y',p.cell_y,'component',component,'entity',
                case when component='spatialCells' then '@cell' else f.id::text end) as ref
            from added f cross join lateral (
              select cell_x,cell_y from world_cell_occupancies where world_id=wid and feature_id=f.id
              union select cell_x,cell_y from stone_deposits where world_id=wid and feature_id=f.id
              union select cell_x,cell_y from woodland_deposits where world_id=wid and feature_id=f.id) p
            cross join unnest(array['spatialFeatures','spatialCells']) component
            where f.world_id=wid) refs;
          select jsonb_agg(jsonb_build_object('x',p.cell_x,'y',p.cell_y,'r',1)) into boxes from added f cross join lateral (
            select cell_x,cell_y from world_cell_occupancies where world_id=wid and (building_id=f.id or feature_id=f.id)
            union all select cell_x,cell_y from woodland_deposits where world_id=wid and feature_id=f.id) p
          where f.world_id=wid;
        else
          select jsonb_agg(ref) into spatial from (
            select jsonb_build_object('x',cell_x,'y',cell_y,'component','spatialFeatures','entity',feature_id::text) as ref
              from added where world_id=wid
            union all select jsonb_build_object('x',cell_x,'y',cell_y,'component','spatialCells','entity','@cell')
              from added where world_id=wid) refs;
          -- Indirect private projections embedding deposit coordinates.
          insert into game_sync_pending
            select distinct txid_current(),wid,'village',x.village_id::text,'extractions',x.id::text
              from added d join deposit_extractions x on x.world_id=wid and x.feature_id=d.feature_id and x.status='in-progress'
              where d.world_id=wid
            union select txid_current(),wid,'village',t.village_id::text,'worksites',t.worksite_id::text
              from added d join extraction_worksite_targets t on t.world_id=wid and t.feature_id=d.feature_id
              where d.world_id=wid
          on conflict do nothing;
          if TG_TABLE_NAME='woodland_deposits' then
            select jsonb_agg(box) into boxes from (
              select jsonb_build_object('x',cell_x,'y',cell_y,'r',1) as box from added where world_id=wid
              -- A grove inserted already cleared changes its trunks.
              union all select jsonb_build_object('x',(t->>'x')::float8,'y',(t->>'y')::float8,
                  'r',.19/2.5*(t->>'crown')::float8*(t->>'size')::float8+1.0/8)
                from added d join world_rc1_resources resource on resource.world_id=wid and resource.feature_id=d.feature_id
                join world_generation_candidates candidate on candidate.world_id=resource.world_id
                cross join lateral jsonb_array_elements_text(resource.tree_indices) idx
                cross join lateral (select candidate.artifact->'forest'->'trees'->(idx.value::integer) as t) tree
                where d.world_id=wid and coalesce(d.cleared,false)) b;
          end if;
        end if;
        if spatial is not null then perform game_sync_spatial_touch_set(wid,spatial); end if;
        if navigation then
          if boxes is not null then perform navigation_touch_boxes(wid,boxes); end if;
          insert into village_sync_changes(world_id,transaction_id,navigation_changed) values(wid,txid_current(),true)
            on conflict(world_id,transaction_id) do update set navigation_changed=true;
        else
          insert into village_sync_changes(world_id,transaction_id) values(wid,txid_current()) on conflict do nothing;
        end if;
      end loop;
      if exists(select 1 from added) then perform set_config('arbestra.sync_auto_publish','yes',true); end if;
      return null;
    end $$;
  `.execute(db);
  for (const table of tables) {
    // Identifiers come from this frozen list, never from user input.
    const id = sql.id(table);
    await sql`drop trigger game_sync_shared on ${id};
      create trigger game_sync_shared after update or delete on ${id} for each row execute function game_sync_shared_change();
      drop trigger village_sync_change on ${id};
      create trigger village_sync_change after update or delete on ${id} for each row execute function mark_village_sync_change();
      create trigger bulk_insert_collect after insert on ${id} referencing new table as added
        for each statement execute function bulk_insert_collect();`.execute(db);
    if (table !== 'stone_deposits')
      await sql`drop trigger navigation_change on ${id};
      create trigger navigation_change after update or delete on ${id} for each row execute function mark_navigation_change();`.execute(
        db,
      );
    if (table !== 'world_features')
      await sql`drop trigger game_sync_private_indirect on ${id};
      create trigger game_sync_private_indirect after update or delete on ${id} for each row execute function game_sync_private_indirect_change();`.execute(
        db,
      );
  }
  await sql`
    create trigger game_sync_shared_building after insert on world_cell_occupancies
      for each row when (new.building_id is not null) execute function game_sync_shared_change();
    create trigger game_sync_private_indirect_expansion after insert on world_cell_occupancies
      for each row when (new.pending_expansion_id is not null) execute function game_sync_private_indirect_change();
  `.execute(db);
}
