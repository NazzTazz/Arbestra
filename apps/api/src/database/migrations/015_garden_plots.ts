import { sql, type Kysely } from 'kysely';

/** Moves Garden production authority from one building buffer to individual active plots. */
export async function up(db: Kysely<unknown>): Promise<void> {
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
