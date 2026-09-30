import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from './schema.js';
import { up as migrateGardenPlots } from './migrations/015_garden_plots.js';

/** Test-only reconstruction of pre-015 tables; caller holds the village lock. */
export async function replayGardenPlotMigrationForTest(tx: Transaction<Database>): Promise<void> {
  const target = await tx.selectNoFrom(sql<string>`current_database()`.as('name')).executeTakeFirstOrThrow();
  if (!target.name.endsWith('_test')) throw new Error('Garden migration fixture requires the configured test database');
  await sql`drop table garden_plots;
    drop index garden_harvests_one_active_plot;
    alter table garden_harvests drop constraint garden_harvests_plot_pair;
    alter table garden_harvests drop column plot_cell_x, drop column plot_cell_y;
    create unique index garden_harvests_one_active_building on garden_harvests(world_id, building_id)
      where status = 'in-progress'`.execute(tx);
  await migrateGardenPlots(tx as unknown as Kysely<unknown>);
}

/** Transaction-local legacy tables, with the real Garden catalog. */
export async function createLegacyGardenSchema(tx: Transaction<Database>): Promise<void> {
  await sql`
    create schema garden_plot_migration_proof;
    set local search_path to garden_plot_migration_proof, public;
    create table villages (world_id uuid not null, id uuid not null, primary key (world_id, id));
    insert into villages select world_id, id from public.villages;
    create table buildings (
      world_id uuid not null, village_id uuid not null, id uuid not null, building_type text not null, status text not null,
      level integer not null default 1, target_level integer, construction_completes_at timestamptz, completed_at timestamptz,
      primary key (world_id, village_id, id)
    );
    create table world_cell_occupancies (
      world_id uuid not null, building_id uuid, cell_x integer not null, cell_y integer not null, pending_expansion_id uuid
    );
    create table building_resource_buffers (
      world_id uuid not null, building_id uuid not null, resource_code text not null,
      stored_amount bigint not null, remainder numeric not null, production_updated_at timestamptz not null
    );
    create table building_level_production as select * from public.building_level_production;
    create table building_expansions (
      id uuid primary key, world_id uuid not null, building_id uuid not null, status text not null,
      completes_at timestamptz not null, completed_at timestamptz
    );
    create table garden_harvests (
      id uuid primary key, world_id uuid not null, building_id uuid not null, status text not null,
      reserved_carrots bigint not null default 37, worker_count integer not null default 2,
      completes_at timestamptz not null default statement_timestamp() + interval '1 minute'
    );
    create unique index garden_harvests_one_active_building
      on garden_harvests(world_id, building_id) where status = 'in-progress';
    create table scheduled_tasks as select * from public.scheduled_tasks;
    create table village_resources as select * from public.village_resources;
  `.execute(tx);
}
