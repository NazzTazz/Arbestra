import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import { randomUUID } from 'node:crypto';
import { up as migrateGardenPlots } from '../../database/migrations/015_garden_plots.js';
import { createLegacyGardenSchema } from '../../database/garden-migration.fixture.js';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { constructBuildingArea, expandGarden, getVillageState, harvestGarden } from './service.js';
import { reconcileVillageEconomy } from './reconcile-economy.js';
import { projectGardenPlot } from './economy.js';


const databaseUrl = testDatabaseUrl();
const db = createDatabase(databaseUrl);
beforeAll(() => resetE2eState(databaseUrl));
beforeEach(() => resetE2eState(databaseUrl));
afterAll(() => db.destroy());

async function gardenRows(source: Kysely<Database> = db) {
  const tables = ['buildings', 'buildingExpansions', 'worldCellOccupancies', 'gardenPlots', 'gardenHarvests',
    'populationCohorts', 'villageResources', 'villageResourceFlows', 'buildingResourceBuffers', 'scheduledTasks'] as const;
  return Promise.all(tables.map((table) => source.selectFrom(table).selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).execute()
    .then((rows) => rows.map((row) => JSON.stringify(row)).sort())));
}
function inside(tx: Transaction<Database>): Kysely<Database> {
  return { transaction: () => ({ execute: <T>(run: (tx: Transaction<Database>) => Promise<T>) => run(tx) }) } as unknown as Kysely<Database>;
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('garden barrier timeout')), 7_000); })]); }
  finally { clearTimeout(timer); }
}

it('review: rejects overlap with an unfinished initial garden', async () => {
  const state = await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
    'garden', DEVELOPMENT_CELLS.garden, [DEVELOPMENT_CELLS.garden], 0);
  const id = state.cells.find((cell) => cell.building?.type === 'garden')!.building!.id;
  await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
    'garden', DEVELOPMENT_CELLS.gardenNorth, [DEVELOPMENT_CELLS.gardenNorth], 600_000);
  const before = await gardenRows();
  const outcome = await expandGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id,
    [DEVELOPMENT_CELLS.garden, DEVELOPMENT_CELLS.gardenNorth], 600_000)
    .then(() => 'accepted', (error: { code: string }) => error.code);
  expect(outcome).toBe('CELL_OCCUPIED');
  expect(await gardenRows()).toEqual(before);
});

it('migrates overdue capacity changes chronologically while preserving legacy work and notifications', async () => {
  const cleanup = new Error('rollback chronological migration proof');
  await expect(db.transaction().execute(async (tx) => {
    await createLegacyGardenSchema(tx);
    const expanded = randomUUID(), constructed = randomUUID(), future = randomUUID(), expansion = randomUUID();
    await sql`insert into buildings (world_id, village_id, id, building_type, status, construction_completes_at) values
      (${DEVELOPMENT_IDS.world}::uuid, ${DEVELOPMENT_IDS.village}::uuid, ${expanded}::uuid, 'garden', 'completed', null),
      (${DEVELOPMENT_IDS.world}::uuid, ${DEVELOPMENT_IDS.village}::uuid, ${constructed}::uuid, 'garden', 'under-construction', statement_timestamp() - interval '30 minutes'),
      (${DEVELOPMENT_IDS.world}::uuid, ${DEVELOPMENT_IDS.village}::uuid, ${future}::uuid, 'garden', 'under-construction', statement_timestamp() + interval '1 hour')`.execute(tx);
    await sql`insert into world_cell_occupancies values
      (${DEVELOPMENT_IDS.world}::uuid, ${expanded}::uuid, 0, 0, null),
      (${DEVELOPMENT_IDS.world}::uuid, ${expanded}::uuid, 1, 0, ${expansion}::uuid),
      (${DEVELOPMENT_IDS.world}::uuid, ${constructed}::uuid, 2, 0, null),
      (${DEVELOPMENT_IDS.world}::uuid, ${future}::uuid, 3, 0, null)`.execute(tx);
    await sql`insert into building_expansions values (${expansion}::uuid, ${DEVELOPMENT_IDS.world}::uuid,
      ${expanded}::uuid, 'under-construction', statement_timestamp() - interval '1 hour', null)`.execute(tx);
    await sql`insert into building_resource_buffers values
      (${DEVELOPMENT_IDS.world}::uuid, ${expanded}::uuid, 'carrot', 600, 0.75, statement_timestamp() - interval '3 hours'),
      (${DEVELOPMENT_IDS.world}::uuid, ${constructed}::uuid, 'carrot', 0, 0, statement_timestamp() - interval '3 hours'),
      (${DEVELOPMENT_IDS.world}::uuid, ${future}::uuid, 'carrot', 0, 0, statement_timestamp())`.execute(tx);
    await sql`insert into garden_harvests (id, world_id, building_id, status) values
      (${randomUUID()}::uuid, ${DEVELOPMENT_IDS.world}::uuid, ${expanded}::uuid, 'in-progress')`.execute(tx);
    await sql`insert into scheduled_tasks (id, world_id, task_type, subject_id, due_at, available_at, payload)
      values (${randomUUID()}::uuid, ${DEVELOPMENT_IDS.world}::uuid, 'building.complete', ${constructed}::uuid,
        statement_timestamp() - interval '30 minutes', statement_timestamp() - interval '30 minutes', '{}'::jsonb)`.execute(tx);
    const beforeWork = await sql`select * from garden_harvests`.execute(tx);
    const beforeTasks = await sql`select * from scheduled_tasks order by id`.execute(tx);
    const beforeResources = await sql`select * from village_resources order by world_id, village_id, resource_code`.execute(tx);
    await migrateGardenPlots(tx as unknown as Kysely<unknown>);
    const totals = await sql<{ buildingId: string; exact: boolean; amount: string }>`select p.building_id,
      sum(p.stored_amount + p.remainder)::text as amount,
      sum(p.stored_amount + p.remainder) = case when p.building_id = ${expanded}::uuid
        then 600 + 120 * extract(epoch from (max(p.production_updated_at) - (select completes_at from building_expansions where id = ${expansion}::uuid))) / 3600
        else 60 * extract(epoch from (max(p.production_updated_at) - b.completed_at)) / 3600 end as exact
      from garden_plots p join buildings b on b.world_id = p.world_id and b.id = p.building_id
      group by p.building_id, b.completed_at`.execute(tx);
    expect(totals.rows).toHaveLength(2);
    expect(totals.rows.every((row) => row.exact)).toBe(true);
    expect(Number(totals.rows.find((row) => row.buildingId === expanded)!.amount)).toBeGreaterThanOrEqual(720);
    expect((await sql<{ status: string }>`select status from buildings where id = ${future}::uuid`.execute(tx)).rows[0]!.status).toBe('under-construction');
    const afterWork = await sql`select id, world_id, building_id, status, reserved_carrots, worker_count, completes_at from garden_harvests`.execute(tx);
    expect(afterWork.rows).toEqual(beforeWork.rows);
    expect((await sql`select * from scheduled_tasks order by id`.execute(tx)).rows).toEqual(beforeTasks.rows);
    expect((await sql`select * from village_resources order by world_id, village_id, resource_code`.execute(tx)).rows).toEqual(beforeResources.rows);
    throw cleanup;
  })).rejects.toBe(cleanup);
});

it.each([false, true])('serializes forced concurrent harvests (distinct plots: %s)', async (distinct) => {
  const state = await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 'garden',
    DEVELOPMENT_CELLS.garden, [DEVELOPMENT_CELLS.garden, DEVELOPMENT_CELLS.gardenNorth], 0);
  const id = state.cells.find((cell) => cell.building?.garden)!.building!.id;
  await db.updateTable('gardenPlots').set({ storedAmount: 10, remainder: 0, productionUpdatedAt: new Date() }).where('worldId', '=', DEVELOPMENT_IDS.world).execute();
  const held = gate(), entered = gate(), release = gate();
  let pidA = 0, pidB = 0;
  const a = db.transaction().execute(async (tx) => {
    await sql`set local lock_timeout = '6s'`.execute(tx);
    pidA = (await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
    await harvestGarden(inside(tx), DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id,
      DEVELOPMENT_CELLS.garden.cellX, DEVELOPMENT_CELLS.garden.cellY, randomUUID());
    held.resolve(); await bounded(release.promise);
  });
  // Attach a handler immediately, including failures before the first barrier.
  void a.catch(() => held.resolve());
  let b: Promise<string> | undefined;
  try {
    await bounded(held.promise);
    const target = distinct ? DEVELOPMENT_CELLS.gardenNorth : DEVELOPMENT_CELLS.garden;
    b = db.transaction().execute(async (tx) => {
      await sql`set local lock_timeout = '6s'`.execute(tx);
      pidB = (await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
      entered.resolve();
      await harvestGarden(inside(tx), DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, target.cellX, target.cellY, randomUUID());
      return 'accepted';
    }).catch((error: { code: string }) => error.code);
    await bounded(entered.promise);
    await bounded((async () => {
      const deadline = Date.now() + 5_000;
      while (!(await db.selectNoFrom(sql<boolean>`${pidA} = any(pg_blocking_pids(${pidB}))`.as('blocked')).executeTakeFirstOrThrow()).blocked) {
        if (Date.now() >= deadline) throw new Error('Expected PostgreSQL harvest lock wait was not observed');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    })());
  } finally { release.resolve(); await Promise.allSettled([a, ...(b ? [b] : [])]); }
  await a;
  expect(await b).toBe(distinct ? 'accepted' : 'GARDEN_HARVEST_IN_PROGRESS');
  const after = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
  expect(after.village.population.working).toBe(distinct ? 2 : 1);
  expect(await db.selectFrom('gardenHarvests').select('id').where('worldId', '=', DEVELOPMENT_IDS.world).execute()).toHaveLength(distinct ? 2 : 1);
  const neighbour = await db.selectFrom('gardenPlots').select('storedAmount').where('worldId', '=', DEVELOPMENT_IDS.world)
    .where('cellX', '=', DEVELOPMENT_CELLS.gardenNorth.cellX).where('cellY', '=', DEVELOPMENT_CELLS.gardenNorth.cellY).executeTakeFirstOrThrow();
  expect(Number(neighbour.storedAmount)).toBe(distinct ? 0 : 10);
});

it('rolls back an accepted plot departure after an identified injected failure', async () => {
  const state = await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 'garden',
    DEVELOPMENT_CELLS.garden, [DEVELOPMENT_CELLS.garden], 0);
  const id = state.cells.find((cell) => cell.building?.garden)!.building!.id;
  await db.updateTable('gardenPlots').set({ storedAmount: 13, remainder: 0.25, productionUpdatedAt: new Date() }).where('worldId', '=', DEVELOPMENT_IDS.world).execute();
  const before = await gardenRows(), failure = new Error('injected after plot departure');
  await expect(db.transaction().execute(async (tx) => {
    await harvestGarden(inside(tx), DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id,
      DEVELOPMENT_CELLS.garden.cellX, DEVELOPMENT_CELLS.garden.cellY, randomUUID());
    const plot = await tx.selectFrom('gardenPlots').select('storedAmount').where('worldId', '=', DEVELOPMENT_IDS.world).executeTakeFirstOrThrow();
    const harvest = await tx.selectFrom('gardenHarvests').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).executeTakeFirstOrThrow();
    expect(Number(plot.storedAmount)).toBe(0); expect(Number(harvest.reservedCarrots)).toBe(13);
    expect(await tx.selectFrom('populationCohorts').select('id').where('harvestId', '=', harvest.id).execute()).toHaveLength(1);
    expect(await tx.selectFrom('scheduledTasks').select('id').where('subjectId', '=', harvest.id).execute()).toHaveLength(1);
    throw failure;
  })).rejects.toBe(failure);
  expect(await gardenRows()).toEqual(before);
});

it('credits only the reserved plot at exactly 60 seconds and never credits it twice', async () => {
  const state = await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 'garden',
    DEVELOPMENT_CELLS.garden, [DEVELOPMENT_CELLS.garden, DEVELOPMENT_CELLS.gardenNorth], 0);
  const id = state.cells.find((cell) => cell.building?.garden)!.building!.id;
  await db.updateTable('gardenPlots').set({ storedAmount: 13, remainder: 0.25, productionUpdatedAt: new Date() })
    .where('worldId', '=', DEVELOPMENT_IDS.world).execute();
  await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id,
    DEVELOPMENT_CELLS.garden.cellX, DEVELOPMENT_CELLS.garden.cellY, randomUUID());
  const work = await db.selectFrom('gardenHarvests').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).executeTakeFirstOrThrow();
  expect(work.completesAt.getTime() - work.startedAt.getTime()).toBe(60_000);
  const carrots = async () => Number((await db.selectFrom('villageResources').select('amount')
    .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'carrot').executeTakeFirstOrThrow()).amount);
  const initial = await carrots();
  const through = async (date: Date) => db.transaction().execute(async (tx) => {
    await tx.selectFrom('villages').select('id').where('id', '=', DEVELOPMENT_IDS.village).forUpdate().executeTakeFirstOrThrow();
    await reconcileVillageEconomy(tx, { worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village, through: date });
  });
  await through(new Date(work.completesAt.getTime() - 1));
  expect(await carrots()).toBe(initial);
  await through(work.completesAt);
  expect(await carrots()).toBe(initial + 13);
  await through(work.completesAt);
  expect(await carrots()).toBe(initial + 13);
  const after = await db.transaction().execute(async (tx) => {
    await tx.selectFrom('villages').select('id').where('id', '=', DEVELOPMENT_IDS.village).forUpdate().executeTakeFirstOrThrow();
    return Promise.all([DEVELOPMENT_CELLS.garden, DEVELOPMENT_CELLS.gardenNorth].map((cell) =>
      projectGardenPlot(tx, DEVELOPMENT_IDS.world, cell.cellX, cell.cellY, work.completesAt)));
  });
  expect(after.map((plot) => plot.amount)).toEqual([1, 14]);
  expect((await db.selectFrom('populationCohorts').select('id').where('harvestId', '=', work.id).execute())).toHaveLength(0);
});

it('adds the recorded outward and return travel to a plot harvest without shortening work', async () => {
  const state = await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 'garden',
    DEVELOPMENT_CELLS.garden, [DEVELOPMENT_CELLS.garden, DEVELOPMENT_CELLS.gardenNorth], 0);
  const garden = state.cells.find((cell) => cell.building?.garden)!.building!;
  await db.updateTable('gardenPlots').set({ storedAmount: 13, productionUpdatedAt: new Date() })
    .where('worldId', '=', DEVELOPMENT_IDS.world).execute();
  const result = await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, garden.id,
    DEVELOPMENT_CELLS.gardenNorth.cellX, DEVELOPMENT_CELLS.gardenNorth.cellY, randomUUID());
  const harvest = result.cells.flatMap((cell) => cell.building?.garden?.plots ?? [])
    .find((plot) => plot.cellX === DEVELOPMENT_CELLS.gardenNorth.cellX && plot.cellY === DEVELOPMENT_CELLS.gardenNorth.cellY)!.harvest!;
  expect(harvest.path.length).toBeGreaterThan(1);
  expect(harvest.transportMs).toBe((harvest.path.length - 1) * 1_000);
  expect(Date.parse(harvest.completesAt) - Date.parse(harvest.startedAt)).toBe(60_000 + harvest.transportMs * 2);
  expect((await db.selectFrom('gardenHarvests').select('pathCells').where('id', '=', harvest.id).executeTakeFirstOrThrow()).pathCells)
    .toEqual(harvest.path);
});

it('preserves both departures and both extensions when Gardens fuse and old receipts retry', async () => {
  const left = DEVELOPMENT_CELLS.garden, right = { cellX: left.cellX + 2, cellY: left.cellY };
  const ids: string[] = [];
  for (const cell of [left, right]) {
    const state = await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 'garden', cell, [cell], 0);
    ids.push(state.cells.find((item) => item.cellX === cell.cellX && item.cellY === cell.cellY)!.building!.id);
  }
  await db.updateTable('gardenPlots').set({ storedAmount: 10, remainder: 0, productionUpdatedAt: new Date() }).where('worldId', '=', DEVELOPMENT_IDS.world).execute();
  const receipts = [randomUUID(), randomUUID()];
  for (const [index, cell] of [left, right].entries()) {
    await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, ids[index]!, cell.cellX, cell.cellY, receipts[index]!);
    await expandGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, ids[index]!,
      [{ cellX: cell.cellX, cellY: cell.cellY - 1 }], 600_000 + index * 60_000);
  }
  const beforeHarvests = await db.selectFrom('gardenHarvests').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).orderBy('id').execute();
  const beforeExpansions = await db.selectFrom('buildingExpansions').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).orderBy('id').execute();
  const beforeNotifications = await db.selectFrom('scheduledTasks').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).orderBy('id').execute();
  const bridge = { cellX: left.cellX + 1, cellY: left.cellY };
  const fused = await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 'garden', bridge, [bridge], 0);
  const garden = fused.cells.find((cell) => cell.building?.garden)!.building!.garden!;
  expect(fused.cells.filter((cell) => cell.building?.garden)).toHaveLength(1);
  expect(garden.expansions).toHaveLength(2);
  expect(garden.expansions!.map((expansion) => expansion.cells.length)).toEqual([1, 1]);
  expect(await db.selectFrom('gardenHarvests').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).orderBy('id').execute()).toEqual(beforeHarvests);
  expect(await db.selectFrom('buildingExpansions').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).orderBy('id').execute()).toEqual(beforeExpansions);
  for (const [index, cell] of [left, right].entries()) await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
    ids[index]!, cell.cellX, cell.cellY, receipts[index]!);
  expect(await db.selectFrom('gardenHarvests').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).orderBy('id').execute()).toEqual(beforeHarvests);
  const originalNotifications = await db.selectFrom('scheduledTasks').selectAll().where('id', 'in', beforeNotifications.map((task) => task.id)).orderBy('id').execute();
  expect(originalNotifications).toEqual(beforeNotifications);
  const bound = new Date(Math.max(...beforeExpansions.map((expansion) => expansion.completesAt.getTime())) + 1);
  await db.transaction().execute(async (tx) => {
    await tx.selectFrom('villages').select('id').where('id', '=', DEVELOPMENT_IDS.village).forUpdate().executeTakeFirstOrThrow();
    await reconcileVillageEconomy(tx, { worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village, through: bound });
    await reconcileVillageEconomy(tx, { worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village, through: bound });
  });
  expect(Number((await db.selectFrom('villageResources').select('amount').where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'carrot').executeTakeFirstOrThrow()).amount)).toBe(70);
  expect((await db.selectFrom('gardenHarvests').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).execute()).every((row) => row.status === 'completed')).toBe(true);
  expect((await db.selectFrom('buildingExpansions').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).execute()).every((row) => row.status === 'completed')).toBe(true);
  expect(await db.selectFrom('gardenPlots').select('cellX').where('worldId', '=', DEVELOPMENT_IDS.world).execute()).toHaveLength(5);
});


it('review: preserves due production near saturation at the migration boundary', async () => {
  const cleanup = new Error('review cleanup');
  await db.transaction().execute(async (tx) => {
      await createLegacyGardenSchema(tx);
      const buildingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      await sql`insert into buildings (world_id, village_id, id, building_type, status) values (${DEVELOPMENT_IDS.world}::uuid, ${DEVELOPMENT_IDS.village}::uuid,
        ${buildingId}::uuid, 'garden', 'completed')`.execute(tx);
      await sql`insert into world_cell_occupancies values
        (${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 8, 9, null),
        (${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 9, 9, null),
        (${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 11, 9, ${randomUUID()}::uuid)`.execute(tx);
      await sql`insert into building_resource_buffers values
        (${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 'carrot', 1199, 0, statement_timestamp() - interval '15 seconds')`.execute(tx);
      await sql`insert into garden_harvests (id, world_id, building_id, status) values
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 'in-progress')`.execute(tx);
      const before = await sql<{ cursor: string }>`select production_updated_at::text as cursor from building_resource_buffers`.execute(tx);
      await migrateGardenPlots(tx as unknown as Kysely<unknown>);
    const result = await sql<{ exact: boolean; amount: string; bounds: number }>`select
      sum(stored_amount + remainder)::text as amount, count(distinct production_updated_at)::integer as bounds,
      sum(stored_amount + remainder) = least(1200, 1199 + 120 * extract(epoch from (max(production_updated_at) - ${before.rows[0]!.cursor}::timestamptz)) / 3600) as exact
      from garden_plots`.execute(tx);
    expect(Number(result.rows[0]!.amount)).toBeGreaterThanOrEqual(1199.5);
    expect(Number(result.rows[0]!.amount)).toBeLessThan(1200);
    expect(result.rows[0]!.exact).toBe(true);
    expect(result.rows[0]!.bounds).toBe(1);
    throw cleanup;
  }).catch((error: unknown) => { if (error !== cleanup) throw error; });
});
