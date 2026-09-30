import { sql, type Kysely } from 'kysely';

/** Moves Garden production authority from one building buffer to individual active plots. */
export async function up(db: Kysely<unknown>): Promise<void> {
  // This correction applies to databases that have not run 015 yet. Never
  // replay the backfill over existing plot stocks or credit a guessed loss.
  await sql`select id from villages order by world_id, id for update`.execute(db);
  await sql`
    do $$
    declare
      bound timestamptz := statement_timestamp();
      transition record;
    begin
      -- Materialize the legacy producer at each capacity/rate change, then at
      -- the common post-lock bound. Existing harvests and notifications stay
      -- untouched; their normal handlers retain their dates and receipts.
      for transition in
        select b.world_id, b.id as building_id, b.id as id,
          b.construction_completes_at as due_at, 'construction' as kind
        from buildings b
        where b.building_type = 'garden' and b.status = 'under-construction'
          and b.construction_completes_at <= bound
        union all
        select e.world_id, e.building_id, e.id, e.completes_at, 'expansion'
        from building_expansions e join buildings b
          on b.world_id = e.world_id and b.id = e.building_id
        where b.building_type = 'garden' and e.status = 'under-construction' and e.completes_at <= bound
        union all
        select b.world_id, b.id, b.id, bound, 'boundary'
        from buildings b where b.building_type = 'garden'
        order by due_at, id, kind
      loop
        with production as (
          select buf.world_id, buf.building_id, buf.resource_code,
            greatest(buf.production_updated_at, transition.due_at) as through,
            b.status, p.capacity * count(o.cell_x) as capacity,
            buf.stored_amount + buf.remainder
              + case when b.status = 'completed' then p.rate_per_hour * count(o.cell_x)
                * greatest(0, extract(epoch from (transition.due_at - buf.production_updated_at))) / 3600
                else 0 end as amount
          from building_resource_buffers buf
          join buildings b on b.world_id = buf.world_id and b.id = buf.building_id
          join building_level_production p on p.building_type_code = b.building_type
            and p.level = b.level and p.resource_code = buf.resource_code
          left join world_cell_occupancies o on o.world_id = b.world_id and o.building_id = b.id
            and o.pending_expansion_id is null
          where b.world_id = transition.world_id and b.id = transition.building_id and buf.resource_code = 'carrot'
          group by buf.world_id, buf.building_id, buf.resource_code, buf.production_updated_at,
            buf.stored_amount, buf.remainder, b.status, p.capacity, p.rate_per_hour
        ), capped as (
          select *, case when status = 'completed' then least(capacity, amount) else amount end as total
          from production
        )
        update building_resource_buffers buf
        set stored_amount = floor(c.total)::bigint,
          remainder = mod(c.total, 1), production_updated_at = c.through
        from capped c where buf.world_id = c.world_id and buf.building_id = c.building_id
          and buf.resource_code = c.resource_code;

        if transition.kind = 'construction' then
          update buildings set status = 'completed', completed_at = transition.due_at,
            level = coalesce(target_level, level), target_level = null
          where world_id = transition.world_id and id = transition.building_id;
        elsif transition.kind = 'expansion' then
          update world_cell_occupancies set pending_expansion_id = null
          where world_id = transition.world_id and pending_expansion_id = transition.id;
          update building_expansions set status = 'completed', completed_at = transition.due_at
          where world_id = transition.world_id and id = transition.id;
        end if;
      end loop;
    end $$;
  `.execute(db);
  await sql`
    create table garden_plots (
      world_id uuid not null,
      village_id uuid not null,
      building_id uuid not null,
      cell_x integer not null,
      cell_y integer not null,
      stored_amount bigint not null check (stored_amount >= 0),
      remainder numeric not null default 0 check (remainder >= 0 and remainder < 1),
      production_updated_at timestamptz not null,
      primary key (world_id, cell_x, cell_y),
      foreign key (world_id, village_id, building_id) references buildings(world_id, village_id, id) on delete cascade
    );
    create index garden_plots_village_idx on garden_plots(world_id, village_id);
    create index garden_plots_building_idx on garden_plots(world_id, building_id);

    with active as (
      select o.world_id, b.village_id, o.building_id, o.cell_x, o.cell_y,
        row_number() over (partition by o.world_id, o.building_id order by o.cell_x, o.cell_y) as position,
        count(*) over (partition by o.world_id, o.building_id) as surface
      from world_cell_occupancies o
      join buildings b on b.world_id = o.world_id and b.id = o.building_id
      where b.building_type = 'garden' and b.status = 'completed' and o.pending_expansion_id is null
    )
    insert into garden_plots (world_id, village_id, building_id, cell_x, cell_y, stored_amount, remainder, production_updated_at)
      select a.world_id, a.village_id, a.building_id, a.cell_x, a.cell_y,
        floor(buf.stored_amount / a.surface)::bigint
          + case when a.position <= mod(buf.stored_amount, a.surface) then 1 else 0 end,
        case when a.position = a.surface then buf.remainder else 0 end,
        buf.production_updated_at
      from active a
      join building_resource_buffers buf on buf.world_id = a.world_id and buf.building_id = a.building_id
      where buf.resource_code = 'carrot';

    alter table garden_harvests add column plot_cell_x integer;
    alter table garden_harvests add column plot_cell_y integer;
    alter table garden_harvests add constraint garden_harvests_plot_pair
      check ((plot_cell_x is null) = (plot_cell_y is null));
    drop index garden_harvests_one_active_building;
    create unique index garden_harvests_one_active_plot
      on garden_harvests(world_id, plot_cell_x, plot_cell_y)
      where status = 'in-progress' and plot_cell_x is not null;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error('Garden plot migration is intentionally forward-only.');
}
