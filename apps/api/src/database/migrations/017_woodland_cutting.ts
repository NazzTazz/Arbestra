import { sql, type Kysely } from 'kysely';

/** Persist renewable woodland stock; existing extraction/cohort identities remain intact. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table woodland_deposits (
      world_id uuid not null, feature_id uuid not null,
      cell_x integer not null, cell_y integer not null,
      initial_amount bigint not null default 300 check (initial_amount > 0),
      remaining_amount numeric not null default 300 check (remaining_amount >= 0),
      reserved_amount bigint not null default 0 check (reserved_amount >= 0),
      regrowth_period_ms bigint not null default 1209600000 check (regrowth_period_ms > 0),
      regrowth_updated_at timestamptz not null default statement_timestamp(),
      cleared boolean not null default false,
      revision bigint not null default 1, updated_at timestamptz not null default statement_timestamp(),
      primary key (world_id, feature_id), unique (world_id, cell_x, cell_y),
      foreign key (world_id, feature_id) references world_features(world_id, id),
      check (reserved_amount <= remaining_amount and remaining_amount <= initial_amount)
    );
    create index woodland_deposits_cells on woodland_deposits(world_id, cell_x, cell_y);
    insert into woodland_deposits(world_id, feature_id, cell_x, cell_y)
      select f.world_id, f.id, o.cell_x, o.cell_y from world_features f
      join world_cell_occupancies o on o.world_id=f.world_id and o.feature_id=f.id
      where f.feature_type_code='woodland';
    alter table deposit_extractions add column resource_code text not null default 'stone'
      check (resource_code in ('stone','wood'));
    alter table deposit_extractions add column wood_debited_at timestamptz;
    alter table deposit_extractions drop constraint deposit_extractions_world_id_feature_id_fkey;
    alter table deposit_extractions add foreign key(world_id, feature_id)
      references world_features(world_id, id);
    create unique index woodland_one_mission_per_village
      on deposit_extractions(world_id, village_id, feature_id)
      where resource_code='wood' and status='in-progress';
    create index woodland_pending_cuts on deposit_extractions(world_id,feature_id,completes_at,id)
      where resource_code='wood' and wood_debited_at is null;
    create function validate_extraction_resource() returns trigger language plpgsql as $$
    begin
      if new.resource_code='stone' then
        if not exists(select 1 from stone_deposits where world_id=new.world_id and feature_id=new.feature_id)
          then raise exception 'Stone deposit missing'; end if;
      else
        if not exists(select 1 from woodland_deposits where world_id=new.world_id and feature_id=new.feature_id)
          then raise exception 'Woodland deposit missing'; end if;
      end if;
      return new;
    end $$;
    create trigger extraction_resource before insert or update of resource_code, feature_id
      on deposit_extractions for each row execute function validate_extraction_resource();

    -- Read-only projection folds every physical cut in deadline order, without
    -- crediting or releasing another village's workers. Fractional stock survives.
    create function woodland_stock_at(w woodland_deposits, horizon timestamptz)
      returns numeric stable language plpgsql as $$
    declare amount numeric := w.remaining_amount; cursor_at timestamptz := w.regrowth_updated_at; cut record;
    begin
      for cut in select completes_at, reserved_amount from deposit_extractions
        where world_id=w.world_id and feature_id=w.feature_id and resource_code='wood'
          and wood_debited_at is null and completes_at<=horizon
        order by completes_at,id
      loop
        if not w.cleared then
          amount := least(w.initial_amount, amount + greatest(0,extract(epoch from (cut.completes_at-cursor_at))*1000)
            * w.initial_amount/w.regrowth_period_ms);
        end if;
        amount := amount-cut.reserved_amount;
        cursor_at := greatest(cursor_at,cut.completes_at);
      end loop;
      if not w.cleared then
        amount := least(w.initial_amount, amount + greatest(0,extract(epoch from (horizon-cursor_at))*1000)
          * w.initial_amount/w.regrowth_period_ms);
      end if;
      return amount;
    end $$;
    create view resource_deposits as
      select world_id,feature_id,cell_x,cell_y,initial_amount,remaining_amount,reserved_amount,revision,updated_at,
        'stone'::text as resource_code, false as cleared, remaining_amount>0 as blocks_cell from stone_deposits
      union all
      select w.world_id,w.feature_id,w.cell_x,w.cell_y,w.initial_amount,
        floor(woodland_stock_at(w,coalesce(nullif(current_setting('arbestra.economy_through',true),'')::timestamptz,statement_timestamp())))::bigint,
        w.reserved_amount-coalesce((select sum(e.reserved_amount) from deposit_extractions e
          where e.world_id=w.world_id and e.feature_id=w.feature_id and e.resource_code='wood'
            and e.wood_debited_at is null and e.completes_at<=coalesce(nullif(current_setting('arbestra.economy_through',true),'')::timestamptz,statement_timestamp())),0)::bigint,
        w.revision,w.updated_at,'wood'::text,w.cleared,
        not w.cleared and woodland_stock_at(w,coalesce(nullif(current_setting('arbestra.economy_through',true),'')::timestamptz,statement_timestamp()))>w.initial_amount::numeric/10
        from woodland_deposits w;
  `.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('Woodland migration is forward-only.');
}
