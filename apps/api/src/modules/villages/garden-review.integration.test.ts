import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { up as migrateGardenPlots } from '../../database/migrations/015_garden_plots.js';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { constructBuildingArea, expandGarden } from './service.js';


const databaseUrl = testDatabaseUrl();
const db = createDatabase(databaseUrl);
beforeAll(() => resetE2eState(databaseUrl));
beforeEach(() => resetE2eState(databaseUrl));
afterAll(() => db.destroy());

it('review: rejects overlap with an unfinished initial garden', async () => {
  const state = await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
    'garden', DEVELOPMENT_CELLS.garden, [DEVELOPMENT_CELLS.garden], 0);
  const id = state.cells.find((cell) => cell.building?.type === 'garden')!.building!.id;
  await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
    'garden', DEVELOPMENT_CELLS.gardenNorth, [DEVELOPMENT_CELLS.gardenNorth], 600_000);
  const outcome = await expandGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id,
    [DEVELOPMENT_CELLS.garden, DEVELOPMENT_CELLS.gardenNorth], 600_000)
    .then(() => 'accepted', (error: { code: string }) => error.code);
  expect(outcome).toBe('CELL_OCCUPIED');
});


it('review: preserves due production near saturation at the migration boundary', async () => {
  const cleanup = new Error('review cleanup');
  await db.transaction().execute(async (tx) => {
      await sql`create schema garden_plot_migration_proof`.execute(tx);
      await sql`set local search_path to garden_plot_migration_proof, public`.execute(tx);
      await sql`create table buildings (
        world_id uuid not null, village_id uuid not null, id uuid not null, building_type text not null, status text not null,
        primary key (world_id, village_id, id)
      )`.execute(tx);
      await sql`create table world_cell_occupancies (
        world_id uuid not null, building_id uuid, cell_x integer not null, cell_y integer not null, pending_expansion_id uuid
      )`.execute(tx);
      await sql`create table building_resource_buffers (
        world_id uuid not null, building_id uuid not null, resource_code text not null,
        stored_amount bigint not null, remainder numeric not null, production_updated_at timestamptz not null
      )`.execute(tx);
      await sql`create table garden_harvests (
        id uuid primary key, world_id uuid not null, building_id uuid not null, status text not null
      )`.execute(tx);
      await sql`create unique index garden_harvests_one_active_building
        on garden_harvests(world_id, building_id) where status = 'in-progress'`.execute(tx);
      const buildingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      await sql`insert into buildings values (${DEVELOPMENT_IDS.world}::uuid, ${DEVELOPMENT_IDS.village}::uuid,
        ${buildingId}::uuid, 'garden', 'completed')`.execute(tx);
      await sql`insert into world_cell_occupancies values
        (${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 8, 9, null),
        (${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 9, 9, null),
        (${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 11, 9, ${randomUUID()}::uuid)`.execute(tx);
      await sql`insert into building_resource_buffers values
        (${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 'carrot', 1199, 0, '2026-09-07T00:00:00Z')`.execute(tx);
      await sql`insert into garden_harvests values
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 'in-progress')`.execute(tx);
      await migrateGardenPlots(tx as unknown as Kysely<unknown>);
    // At T0 + 15s, the old 2-plot buffer has 1199 + 120*15/3600 = 1199.5.
    // Apply the actual new per-plot cap to stock + fraction + 60*15/3600.
    const result = await sql<{ amount: string }>`select sum(least(600, stored_amount + remainder + 0.25))::text as amount from garden_plots`.execute(tx);
    expect(Number(result.rows[0]!.amount)).toBe(1199.5);
    throw cleanup;
  }).catch((error: unknown) => { if (error !== cleanup) throw error; });
});
