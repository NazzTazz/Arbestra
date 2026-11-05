/**
 * Counter-review of 4 November (docs/VERROUS-2026-11-04.md §10): a trip to a
 * deposit recognized by science leaves the village region. Its zones must be
 * held before the deposits and before the path is computed; a path computed
 * without them is never recorded. Every interleaving is forced with bounded
 * barriers, waits are observed in PostgreSQL, and every transaction is
 * released and awaited, even on failure.
 */
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { TravelCell } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import type { Database } from '../../database/schema.js';
import { stoneExtractionTestHooks } from '../deposits/stone-extractions.js';
import { placeBuilding } from './construction.js';
import { beginVillageEconomy } from './reconcile-economy.js';
import { startVillageExploitation } from './service.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\w+)?_test$/.test(target.pathname))
  throw Error('Unexpected spatial lock test database');
const db = createDatabase(url),
  worldId = randomUUID(),
  slug = 'spatial-remote-' + worldId;
/** Astra's scenario: A at (10,10), its recognized deposit at (120,10), B builds at (100,10). */
const A = { account: randomUUID(), village: randomUUID(), hall: { cellX: 10, cellY: 10 } },
  B = { account: randomUUID(), village: randomUUID(), hall: { cellX: 100, cellY: 16 } },
  deposit = randomUUID(),
  depositCell = { cellX: 120, cellY: 10 },
  onPath = { cellX: 100, cellY: 10 };

beforeAll(async () => {
  await migrateToLatest(url);
  for (const who of [A, B])
    await db
      .insertInto('accounts')
      .values({ id: who.account, email: who.account + '@spatial-remote.test', passwordHash: 'fixture' })
      .execute();
  await db
    .insertInto('worlds')
    .values({
      id: worldId,
      slug,
      name: 'Accès distants',
      topology: 'torus',
      widthCells: 512,
      heightCells: 256,
      chunkSize: 32,
      seed: 4110,
      generationVersion: 1,
      generationStatus: 'ready',
      isOpen: false,
      generatedAt: new Date(),
    })
    .execute();
  await db
    .insertInto('worldChunks')
    .values(
      Array.from({ length: 128 }, (_, i) => ({
        worldId,
        chunkX: i % 16,
        chunkY: Math.floor(i / 16),
        generationVersion: 1,
        terrainCodes: Array(1024).fill(1),
        elevations: Array(1024).fill(0),
      })),
    )
    .execute();
  const now = new Date();
  for (const [key, who] of [
    ['a', A],
    ['b', B],
  ] as const) {
    await db.insertInto('worldMemberships').values({ worldId, accountId: who.account, playerName: key }).execute();
    await db
      .insertInto('villages')
      .values({
        id: who.village,
        worldId,
        ownerAccountId: who.account,
        name: 'Village ' + key,
        anchorCellX: who.hall.cellX,
        anchorCellY: who.hall.cellY,
        economyActivatedAt: now,
      })
      .execute();
    const hallId = randomUUID();
    await db
      .insertInto('buildings')
      .values({
        id: hallId,
        worldId,
        villageId: who.village,
        buildingType: 'town-hall',
        level: 2,
        status: 'completed',
        completedAt: now,
        constructionStartedAt: null,
        constructionCompletesAt: null,
      })
      .execute();
    await db
      .insertInto('worldCellOccupancies')
      .values({ worldId, ...who.hall, buildingId: hallId, featureId: null, pendingExpansionId: null, role: 'anchor' })
      .execute();
    await db
      .insertInto('villageResources')
      .values(
        ['wood', 'stone', 'timber', 'cut-stone', 'carrot'].map((resourceCode) => ({
          worldId,
          villageId: who.village,
          resourceCode,
          amount: 100000,
        })),
      )
      .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: 100000 }))
      .execute();
    await db
      .insertInto('villageResourceFlows')
      .values({
        worldId,
        villageId: who.village,
        resourceCode: 'wood',
        baseRatePerHour: 0,
        remainder: 0,
        productionUpdatedAt: now,
      })
      .execute();
    await db
      .insertInto('populationCohorts')
      .values({
        worldId,
        villageId: who.village,
        originVillageId: who.village,
        memberCount: 10,
        activity: 'idle',
        energy: 10,
        energyProgress: 0,
        energyUpdatedAt: now,
        restingSince: null,
        foodUsedSinceRest: 0,
        harvestId: null,
        extractionId: null,
      })
      .execute();
  }
  await db
    .insertInto('worldFeatures')
    .values({ id: deposit, worldId, featureTypeCode: 'stone_outcrop', state: 'available', variantSeed: 7 })
    .execute();
  await db
    .insertInto('worldCellOccupancies')
    .values({ worldId, ...depositCell, featureId: deposit, buildingId: null, pendingExpansionId: null, role: 'body' })
    .execute();
  await db
    .insertInto('stoneDeposits')
    .values({
      worldId,
      featureId: deposit,
      ...depositCell,
      initialAmount: 1000,
      remainingAmount: 1000,
      reservedAmount: 0,
      revision: 1,
      updatedAt: now,
    })
    .execute();
  // A's geography recognizes the deposit, surveyed by a journey of A along y=10.
  await db
    .insertInto('playerScience')
    .values({ worldId, accountId: A.account, observationsSince: null, solarReport: null })
    .execute();
  await db
    .insertInto('sciencePrograms')
    .values({
      worldId,
      accountId: A.account,
      code: 'geography-1',
      discipline: 'geography',
      level: 1,
      workDoneMs: 9999999,
      paused: false,
      acquiredAt: now,
      createdAt: now,
      workerCap: 1,
    })
    .execute();
  const journey: TravelCell[] = Array.from({ length: 111 }, (_, i) => ({ cellX: 10 + i, cellY: 10 }));
  const survey = await db
    .insertInto('scienceActivities')
    .values({
      worldId,
      villageId: A.village,
      accountId: A.account,
      buildingId: null,
      programCode: null,
      kind: 'survey',
      status: 'completed',
      workerCount: 1,
      workMs: 0,
      startedAt: now,
      completesAt: now,
      completedAt: now,
      pathCells: sql`${JSON.stringify(journey)}::jsonb` as never,
      surveyCells: sql`'[]'::jsonb` as never,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('sciencePlaces')
    .values({
      worldId,
      accountId: A.account,
      ...depositCell,
      terrainCode: 1,
      elevation: 0,
      observedAt: now,
      surveyed: true,
      sourceActivityId: survey.id,
    })
    .execute();
}, 180000);

afterAll(async () => {
  await reset();
  await db.deleteFrom('stoneDeposits').where('worldId', '=', worldId).execute();
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', 'in', [A.account, B.account]).execute();
  await db.destroy();
}, 60000);

// The spatial guard as in production: no test-only strictness for these commands.
const vitest = process.env.VITEST;
beforeEach(() => {
  delete process.env.VITEST;
});
afterEach(async () => {
  process.env.VITEST = vitest;
  delete stoneExtractionTestHooks.beforeCoverage;
  await reset();
});

/** A bounded barrier: the holder waits until released, at most 20 s. */
function barrier() {
  let release!: () => void, arrive!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  return {
    arrived: Promise.race([
      arrived,
      new Promise<never>((_, reject) => setTimeout(() => reject(Error('barrier not reached')), 30000)),
    ]),
    release,
    wait: async () => {
      arrive();
      await Promise.race([gate, new Promise((_, reject) => setTimeout(() => reject(Error('barrier timeout')), 20000))]);
    },
  };
}
/** Bounded wait until a session of this database waits on one of the given lock kinds. */
async function waiting(events: string[]) {
  for (let i = 0; i < 150; i++) {
    const row = await sql<{ n: number }>`select count(*)::int as n from pg_stat_activity
      where datname=current_database() and wait_event_type='Lock' and wait_event = any(${events}::text[])`.execute(db);
    if (row.rows[0]!.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('No session waited for ' + events.join('/'));
}
async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'blocked'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<'blocked'>((resolve) => (timer = setTimeout(() => resolve('blocked'), ms))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** Whether this transaction holds the zone of a cell (any mode). */
async function holdsZoneOf(tx: Transaction<Database>, cell: TravelCell) {
  const key = `infrastructure:${worldId}:${Math.floor(cell.cellX / 32)}:${Math.floor(cell.cellY / 32)}`;
  const row = await sql<{ held: boolean }>`select exists(select 1 from pg_locks l where l.pid=pg_backend_pid()
      and l.locktype='advisory' and l.granted and l.objsubid=1
      and l.objid::bigint=(hashtextextended(${key},0) & 4294967295)
      and l.classid::bigint=((hashtextextended(${key},0) >> 32) & 4294967295)) as held`.execute(tx);
  return row.rows[0]!.held;
}
const exploit = () =>
  startVillageExploitation(db, A.account, slug, A.village, {
    commandId: randomUUID(),
    workerCap: 5,
    durationMs: null,
    cohortId: null,
    woodMode: 'cut',
    gardens: [],
    wood: [],
    stone: [deposit],
  }).catch((error: unknown) => error);
const buildOnPath = () =>
  placeBuilding(
    db,
    B.account,
    slug,
    B.village,
    { buildingType: 'garden', anchor: onPath, cells: [onPath], commandId: randomUUID() },
    60000,
  ).catch((error: { code?: string }) => error.code ?? error);
const extractions = () =>
  db
    .selectFrom('depositExtractions')
    .select(['pathCells', 'reservedAmount', 'status'])
    .where('worldId', '=', worldId)
    .where('villageId', '=', A.village)
    .execute();
const reserved = async () =>
  Number(
    (
      await db
        .selectFrom('stoneDeposits')
        .select('reservedAmount')
        .where('worldId', '=', worldId)
        .where('featureId', '=', deposit)
        .executeTakeFirstOrThrow()
    ).reservedAmount,
  );
const crosses = (path: TravelCell[], cell: TravelCell) =>
  path.some((p) => Math.floor(p.cellX) === cell.cellX && Math.floor(p.cellY) === cell.cellY);
/** Back to the initial state: no building of B on the path, no work of A. */
async function reset() {
  const ids = (
    await db
      .selectFrom('buildings')
      .select('id')
      .where('worldId', '=', worldId)
      .where('buildingType', '<>', 'town-hall')
      .execute()
  ).map((b) => b.id);
  await db.deleteFrom('scheduledTasks').where('worldId', '=', worldId).execute();
  if (ids.length) {
    await db.deleteFrom('gardenPlots').where('worldId', '=', worldId).where('buildingId', 'in', ids).execute();
    await db.deleteFrom('buildings').where('worldId', '=', worldId).where('id', 'in', ids).execute();
  }
  await db
    .updateTable('populationCohorts')
    .set({ extractionId: null, activity: 'idle' })
    .where('worldId', '=', worldId)
    .execute();
  await db.deleteFrom('depositExtractions').where('worldId', '=', worldId).execute();
  await db.deleteFrom('extractionWorksites').where('worldId', '=', worldId).execute();
  await db.deleteFrom('exploitationOrders').where('worldId', '=', worldId).execute();
  await db
    .updateTable('stoneDeposits')
    .set({ reservedAmount: 0 })
    .where('worldId', '=', worldId)
    .where('featureId', '=', deposit)
    .execute();
}

it('a remote trip computed before a neighbour builds on it is never recorded through the building', async () => {
  // Control: the recognized route really runs along y=10, through (100,10).
  const gate = barrier();
  let seen: TravelCell[] | undefined;
  stoneExtractionTestHooks.beforeCoverage = async (_tx, path) => {
    if (seen) return;
    seen = path;
    await gate.wait();
  };
  const a = exploit();
  let b: Promise<unknown> | undefined;
  try {
    await gate.arrived;
    expect(crosses(seen!, onPath), 'the computed trip crosses the cell B is about to build').toBe(true);
    // A does not hold the zone of (100,10) yet: B builds and commits at once.
    b = buildOnPath();
    expect(await within(b, 10000), 'construction of B').toMatchObject({ kind: 'construction' });
  } finally {
    gate.release();
    await a;
    await b;
  }
  const works = await extractions();
  for (const work of works)
    expect(crosses(work.pathCells ?? [], onPath), 'a recorded trip never crosses the new building').toBe(false);
  // The route through the building was the only recognized one: the replay,
  // computed under its zones, finds no access and refuses the command.
  expect(await a).toMatchObject({ statusCode: 409, code: 'EXPLOITATION_SELECTION_CHANGED' });
  expect(works).toEqual([]);
  expect(await reserved()).toBe(0);
}, 90000);

it('the trip is computed while its zones are held: a neighbour building on it waits, then is refused', async () => {
  // Hold A only once it computes its trip while holding the zone of (100,10).
  const gate = barrier();
  let held = false;
  stoneExtractionTestHooks.beforeCoverage = async (tx) => {
    if (held || !(await holdsZoneOf(tx, onPath))) return;
    held = true;
    await gate.wait();
  };
  const a = exploit();
  let b: Promise<unknown> | undefined;
  try {
    await gate.arrived;
    b = buildOnPath();
    await waiting(['advisory']);
    expect(await within(b, 300)).toBe('blocked');
  } finally {
    gate.release();
    await a;
    await b;
  }
  expect(await a).toMatchObject({ worldId, villageId: A.village });
  expect(await b).toBe('ENGAGED_PASSAGE');
  const works = await extractions();
  expect(works).toHaveLength(1);
  expect(crosses(works[0]!.pathCells ?? [], onPath)).toBe(true);
  expect(await reserved()).toBe(100);
  // The trip is now known: the next transaction of A that may relaunch this
  // deposit declares its zones with the region, before the deposit, no replay.
  expect(
    await db.transaction().execute(async (tx) => {
      await beginVillageEconomy(tx, worldId, A.village, deposit);
      return holdsZoneOf(tx, onPath);
    }),
  ).toBe(true);
}, 90000);

it('no deadlock between a remote trip and a writer that prelocks the same deposit', async () => {
  // A holds its deposit (by UUID, after its village) and has computed its trip;
  // B holds the zone of (100,10) exclusive and then waits for that deposit.
  const gate = barrier();
  let once = false;
  stoneExtractionTestHooks.beforeCoverage = async () => {
    if (once) return;
    once = true;
    await gate.wait();
  };
  const a = exploit();
  let b: Promise<unknown> | undefined;
  try {
    await gate.arrived;
    b = db
      .transaction()
      .execute(async (tx) => {
        await beginVillageEconomy(tx, worldId, B.village, deposit, [], [], { write: [onPath] });
        return 'b-applied';
      })
      .catch((error: unknown) => error);
    await waiting(['transactionid', 'tuple']);
  } finally {
    gate.release();
    await a;
    await b;
  }
  const deadlocked = (r: unknown) => (r as { code?: string } | undefined)?.code === '40P01';
  expect(deadlocked(await a), 'A was not chosen as a deadlock victim').toBe(false);
  expect(deadlocked(await b), 'B was not chosen as a deadlock victim').toBe(false);
  expect(await b).toBe('b-applied');
  expect(await a).toMatchObject({ worldId, villageId: A.village });
}, 90000);
