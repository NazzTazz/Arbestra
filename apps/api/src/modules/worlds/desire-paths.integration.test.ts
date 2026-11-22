import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { planGardenTour, type TravelCell, type TravelRoute } from '@arbestra/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../database/seed.js';
import type { Database } from '../../database/schema.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { processNextScheduledTask } from '../../jobs/scheduled-tasks.js';
import { scheduledTaskHandlers } from '../../jobs/task-handlers.js';
import { startStoneExtraction } from '../deposits/stone-extractions.js';
import { startGardenTour } from '../population/garden-tour.js';
import { SCIENCE_PROGRAMS } from '../science/programs.js';
import { admitScience, scienceCommand } from '../science/service.js';
import { beginVillageEconomy, reconcileVillageEconomy } from '../villages/reconcile-economy.js';
import {
  DESIRE_MARGIN_MS,
  DESIRE_PATHS_CONTINUE_MS,
  DESIRE_PATHS_INTERVAL_MS,
  DESIRE_PATHS_TASK,
  aggregateDesirePaths,
  ensureDesirePathsTask,
} from './desire-paths.js';
import { takeFixtureZones } from './spatial-locks.js';

// This file admits trips directly, in transactions that hold no spatial lock.
takeFixtureZones();

/** Desire lines observed (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §17, T3a):
 * the world task `world.desire-paths` counts the missions admitted in its world,
 * outside every command and without a village or zone lock. */
const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected desire paths test database');
const db = createDatabase(url),
  accountId = randomUUID(),
  WIDTH = 64,
  HEIGHT = 32;
let worldId = '',
  villageId = '',
  buildingId = '',
  stoneId = '',
  woodId = '';

beforeAll(async () => {
  await migrateToLatest(url);
  await resetE2eState(url);
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@desire.test', passwordHash: 'fixture' })
    .execute();
}, 180_000);
afterAll(async () => {
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
});

const bounded = <T>(promise: Promise<T>, ms = 20_000) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(Error('barrier timeout')), ms))]);
const dbNow = async () => (await db.selectNoFrom(sql<Date>`clock_timestamp()`.as('now')).executeTakeFirstOrThrow()).now;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const cell = (cellX: number, cellY: number): TravelCell => ({ cellX, cellY });
/** A path at one eighth of a cell per point, as the planner writes it. */
function eighths(...corners: TravelCell[]): TravelCell[] {
  const points: TravelCell[] = [corners[0]!];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1]!,
      b = corners[i]!,
      steps = Math.max(Math.abs(b.cellX - a.cellX), Math.abs(b.cellY - a.cellY)) * 8;
    for (let k = 1; k <= steps; k++)
      points.push(cell(a.cellX + ((b.cellX - a.cellX) * k) / steps, a.cellY + ((b.cellY - a.cellY) * k) / steps));
  }
  return points;
}

beforeEach(async () => {
  // This file drives the scheduler's real queue: nothing else may be due in it.
  await db.deleteFrom('scheduledTasks').execute();
  worldId = randomUUID();
  villageId = randomUUID();
  buildingId = randomUUID();
  stoneId = randomUUID();
  woodId = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('worlds')
      .values({
        id: worldId,
        slug: 'desire-' + worldId,
        name: 'Desire test',
        topology: 'torus',
        widthCells: WIDTH,
        heightCells: HEIGHT,
        chunkSize: 32,
        seed: 4115,
        generationVersion: 1,
        generationStatus: 'ready',
        isOpen: true,
        generatedAt: new Date(),
      })
      .execute();
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Desire' }).execute();
    await tx
      .insertInto('villages')
      .values({
        id: villageId,
        worldId,
        ownerAccountId: accountId,
        name: 'Desire',
        anchorCellX: 20,
        anchorCellY: 16,
        economyActivatedAt: new Date(),
      })
      .execute();
    await tx
      .insertInto('playerScience')
      .values({ worldId, accountId, observationsSince: null, solarReport: null })
      .execute();
    await tx
      .insertInto('buildings')
      .values({
        id: buildingId,
        worldId,
        villageId,
        buildingType: 'garden',
        level: 1,
        targetLevel: null,
        status: 'completed',
        constructionStartedAt: null,
        constructionCompletesAt: null,
        completedAt: new Date(),
      })
      .execute();
    await tx
      .insertInto('worldFeatures')
      .values([
        { id: stoneId, worldId, featureTypeCode: 'stone_outcrop', state: 'available', variantSeed: 1 },
        { id: woodId, worldId, featureTypeCode: 'woodland', state: 'available', variantSeed: 2 },
      ])
      .execute();
    await tx
      .insertInto('stoneDeposits')
      .values({
        worldId,
        featureId: stoneId,
        cellX: 12,
        cellY: 20,
        initialAmount: 800,
        remainingAmount: 800,
        reservedAmount: 0,
        revision: 1,
        updatedAt: new Date(),
      })
      .execute();
    await tx
      .insertInto('woodlandDeposits')
      .values({
        worldId,
        featureId: woodId,
        cellX: 14,
        cellY: 20,
        initialAmount: 1000,
        remainingAmount: 1000,
        reservedAmount: 0,
        revision: 1,
        updatedAt: new Date(),
        regrowthUpdatedAt: new Date(),
      })
      .execute();
    await ensureDesirePathsTask(tx, worldId);
  });
  // Counting began an hour ago: missions of the last minutes are in its window.
  await shiftCounting(3_600_000);
});
afterEach(async () => {
  await db.deleteFrom('scheduledTasks').where('worldId', '=', worldId).execute();
  await db.deleteFrom('depositExtractions').where('worldId', '=', worldId).execute();
  await db.deleteFrom('stoneDeposits').where('worldId', '=', worldId).execute();
  await db.deleteFrom('woodlandDeposits').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
});

/** Moves the start of counting, and the window, back in time. */
async function shiftCounting(ms: number) {
  await sql`update world_desire_state set counting_from = counting_from - ${ms} * interval '1 millisecond',
    watermark = watermark - ${ms} * interval '1 millisecond' where world_id = ${worldId}::uuid`.execute(db);
}

type Resource = 'wood' | 'stone';
const json = <T>(value: T) => sql<T>`${JSON.stringify(value)}::jsonb`;
function depositRow(resource: Resource, path: TravelCell[] | null, startedAt: Date) {
  return {
    worldId,
    villageId,
    featureId: resource === 'wood' ? woodId : stoneId,
    resourceCode: resource,
    commandId: randomUUID(),
    status: 'completed' as const,
    startedAt,
    completesAt: at(startedAt, 60_000),
    completedAt: at(startedAt, 60_000),
    workerCount: 1,
    reservedAmount: 100,
    transportMs: 0,
    pathCells: path === null ? null : json(path),
  };
}
const insertDeposit = async (resource: Resource, path: TravelCell[] | null, startedAt: Date) =>
  (
    await db
      .insertInto('depositExtractions')
      .values(depositRow(resource, path, startedAt))
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
async function insertGarden(
  startedAt: Date,
  path: TravelCell[] | null,
  tour?: { stops: TravelCell[][]; returnPath: TravelCell[] | null },
) {
  return (
    await db
      .insertInto('gardenHarvests')
      .values({
        worldId,
        villageId,
        buildingId,
        commandId: randomUUID(),
        status: 'completed',
        startedAt,
        completesAt: at(startedAt, 60_000),
        completedAt: at(startedAt, 60_000),
        workerCount: 1,
        reservedCarrots: 1,
        transportMs: 0,
        pathCells: path === null ? null : json(path),
        ...(tour
          ? {
              stops: json(
                tour.stops.map((p) => ({
                  cellX: p.at(-1)!.cellX,
                  cellY: p.at(-1)!.cellY,
                  path: p,
                  arrivesAfterMs: 1000,
                  workEndsAfterMs: 2000,
                  reservedCarrots: 1,
                })),
              ),
              returnPathCells: tour.returnPath === null ? null : json(tour.returnPath),
            }
          : {}),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
}
async function insertScience(kind: 'survey' | 'exploration' | 'training', path: TravelCell[], startedAt: Date) {
  return (
    await db
      .insertInto('scienceActivities')
      .values({
        worldId,
        villageId,
        accountId,
        // Training belongs to a campus; a survey to nobody (check constraints of 025).
        buildingId: kind === 'training' ? buildingId : null,
        programCode: null,
        kind,
        status: 'completed',
        workerCount: 1,
        workMs: 1000,
        startedAt,
        completesAt: at(startedAt, 60_000),
        completedAt: at(startedAt, 60_000),
        pathCells: json(path),
        surveyCells: json([]),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
}

const key = (cellX: number, cellY: number, direction: 0 | 1) => `${cellX}:${cellY}:${direction}`;
const E = (x: number, y: number) => key(x, y, 0);
const S = (x: number, y: number) => key(x, y, 1);
async function edgeTable(world = worldId) {
  const rows = await db.selectFrom('worldDesireEdges').selectAll().where('worldId', '=', world).execute();
  return new Map(
    rows.map((r) => [key(r.cellX, r.cellY, r.direction), { passages: r.passages, last: r.lastPassageAt }]),
  );
}
const passagesOf = async () => new Map([...(await edgeTable())].map(([k, v]) => [k, v.passages]));
const ledger = async () =>
  (await db.selectFrom('worldDesireMissions').select(['source', 'missionId']).where('worldId', '=', worldId).execute())
    .map((r) => `${r.source}:${r.missionId}`)
    .sort();
const pending = () =>
  db
    .selectFrom('scheduledTasks')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('taskType', '=', DESIRE_PATHS_TASK)
    .where('completedAt', 'is', null)
    .execute();

/** The scheduler's own pass over the queue: the world's notification is made due. */
async function runTask(handlers = scheduledTaskHandlers) {
  await sql`update scheduled_tasks set due_at = statement_timestamp() - interval '1 second',
    available_at = statement_timestamp() - interval '1 second'
    where world_id = ${worldId}::uuid and task_type = ${DESIRE_PATHS_TASK} and completed_at is null`.execute(db);
  return processNextScheduledTask(db, handlers);
}

it('counts exactly the edges of the persisted missions of every source, one passage per mission, and nothing on a second run', async () => {
  const base = await dbNow(),
    t = (n: number) => at(base, -60_000 + n * 1000);
  // Wood and stone, legacy sparse paths and eighth-cell paths; the same wood lot twice.
  const wood = await insertDeposit('wood', [cell(10, 5), cell(13, 5)], t(1));
  const woodAgain = await insertDeposit('wood', eighths(cell(10, 5), cell(13, 5)), t(2));
  const stone = await insertDeposit('stone', [cell(12, 5), cell(12, 8)], t(3));
  await insertDeposit('stone', null, t(4)); // a mission without a path adds no edge
  // A tour: outward leg to a first stop, a second leg, the return over the same ground.
  const tour = await insertGarden(t(5), [cell(8, 5), cell(10, 5)], {
    stops: [
      [cell(8, 5), cell(10, 5)],
      [cell(10, 5), cell(11, 5)],
    ],
    returnPath: [cell(11, 5), cell(8, 5)],
  });
  // A row from before tours: its path alone.
  const legacy = await insertGarden(t(6), [cell(20, 10), cell(22, 10)]);
  // A survey and an exploration walk out and back; the second one across the torus seam.
  const out = eighths(cell(30, 2), cell(31, 2), cell(31, 3));
  const survey = await insertScience('survey', [...out, ...out.slice(0, -1).reverse()], t(7));
  const seam = [cell(62, 10), cell(63, 10), cell(0, 10)];
  const exploration = await insertScience('exploration', [...seam, ...seam.slice(0, -1).reverse()], t(8));
  // Training and research walk nowhere: only surveys and explorations count.
  await insertScience('training', [cell(40, 1), cell(42, 1)], t(9));

  const result = await runTask();
  expect(result).toMatchObject({ outcome: 'completed' });
  expect(await passagesOf()).toEqual(
    new Map([
      [E(10, 5), 3], // two wood lots and the tour
      [E(11, 5), 2],
      [E(12, 5), 2],
      [S(12, 5), 1],
      [S(12, 6), 1],
      [S(12, 7), 1],
      [E(8, 5), 1],
      [E(9, 5), 1],
      [E(20, 10), 1],
      [E(21, 10), 1],
      [E(30, 2), 1],
      [S(31, 2), 1],
      [E(62, 10), 1],
      [E(63, 10), 1], // the seam: the last column eastward
    ]),
  );
  const edges = await edgeTable();
  expect(edges.get(E(10, 5))!.last.getTime()).toBe(t(5).getTime());
  expect(edges.get(E(11, 5))!.last.getTime()).toBe(t(2).getTime());
  const counted = [
    ...[wood, woodAgain, stone].map((id) => 'deposit:' + id),
    ...[tour, legacy].map((id) => 'garden:' + id),
    ...[survey, exploration].map((id) => 'science:' + id),
  ];
  // The mission without a path is recorded too (it is not read again), the training is not.
  expect(await ledger()).toHaveLength(8);
  expect(await ledger()).toEqual(expect.arrayContaining(counted.sort()));

  const before = await passagesOf();
  expect(await runTask()).toMatchObject({ outcome: 'completed' });
  expect(await passagesOf()).toEqual(before);
  expect(await ledger()).toHaveLength(8);
});

it('counts the missions of its own world only', async () => {
  const base = await dbNow();
  await insertDeposit('wood', [cell(1, 1), cell(2, 1)], at(base, -5_000));
  const other = randomUUID();
  await db
    .insertInto('worlds')
    .values({
      id: other,
      slug: 'desire-other-' + other,
      name: 'Other',
      topology: 'torus',
      widthCells: WIDTH,
      heightCells: HEIGHT,
      chunkSize: 32,
      seed: 4116,
      generationVersion: 1,
      generationStatus: 'ready',
      isOpen: true,
      generatedAt: new Date(),
    })
    .execute();
  try {
    expect(await runTask()).toMatchObject({ outcome: 'completed' });
    expect([...(await passagesOf()).keys()]).toEqual([E(1, 1)]);
    expect((await edgeTable(other)).size).toBe(0);
  } finally {
    await db.deleteFrom('worlds').where('id', '=', other).execute();
  }
});

it('does not back-fill missions started before counting began, and reads missions older than the margin that a stopped scheduler left', async () => {
  const base = await dbNow();
  // Counting began 10 minutes ago, as if the scheduler had been stopped since.
  await shiftCounting(-3_600_000 + 600_000);
  await insertDeposit('wood', [cell(3, 3), cell(4, 3)], at(base, -11 * 60_000));
  await insertDeposit('wood', [cell(5, 3), cell(6, 3)], at(base, -9 * 60_000));
  expect(await runTask()).toMatchObject({ outcome: 'completed' });
  // The mission of 9 minutes ago is far older than the margin, yet counted: the
  // window starts at the last watermark, not at now minus the margin.
  expect(DESIRE_MARGIN_MS).toBeLessThan(9 * 60_000);
  expect(await passagesOf()).toEqual(new Map([[E(5, 3), 1]]));
  // Its ledger row is already out of reach (older than the next window): another run adds nothing.
  expect(await runTask()).toMatchObject({ outcome: 'completed' });
  expect(await passagesOf()).toEqual(new Map([[E(5, 3), 1]]));
  const state = await db
    .selectFrom('worldDesireState')
    .selectAll()
    .where('worldId', '=', worldId)
    .executeTakeFirstOrThrow();
  expect(state.watermark.getTime()).toBeGreaterThan(base.getTime() - DESIRE_MARGIN_MS - 2_000);
  expect(state.watermark.getTime()).toBeLessThanOrEqual((await dbNow()).getTime() - DESIRE_MARGIN_MS);
});

it('starts counting at its first run in a world nobody seeded, without back-filling what came before', async () => {
  await db.deleteFrom('worldDesireState').where('worldId', '=', worldId).execute();
  const base = await dbNow();
  await insertDeposit('wood', [cell(3, 3), cell(4, 3)], at(base, -5_000));
  expect(await runTask()).toMatchObject({ outcome: 'completed' });
  const started = await db
    .selectFrom('worldDesireState')
    .selectAll()
    .where('worldId', '=', worldId)
    .executeTakeFirstOrThrow();
  expect(started.countingFrom.getTime()).toBeGreaterThanOrEqual(base.getTime());
  expect(started.watermark).toEqual(started.countingFrom);
  expect(await passagesOf()).toEqual(new Map());
  await insertDeposit('wood', [cell(5, 3), cell(6, 3)], await dbNow());
  expect(await runTask()).toMatchObject({ outcome: 'completed' });
  expect(await passagesOf()).toEqual(new Map([[E(5, 3), 1]]));
});

it('counts a mission committed late with an older started_at than one already counted', async () => {
  const base = await dbNow();
  const older = at(base, -3_000),
    newer = at(base, -1_000);
  let inserted!: () => void, release!: () => void;
  const hasInserted = new Promise<void>((resolve) => (inserted = resolve)),
    released = new Promise<void>((resolve) => (release = resolve));
  let lateId = '';
  // A command whose mission took its started_at first and commits last.
  const late = db.transaction().execute(async (tx) => {
    lateId = (
      await tx
        .insertInto('depositExtractions')
        .values(depositRow('wood', [cell(10, 10), cell(10, 12)], older))
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    inserted();
    await bounded(released);
  });
  void late.catch(() => undefined);
  try {
    await bounded(hasInserted);
    // A later mission commits meanwhile, and the task counts it: the late one is invisible.
    expect(await db.selectFrom('depositExtractions').select('id').where('id', '=', lateId).execute()).toEqual([]);
    const early = await insertDeposit('stone', [cell(20, 20), cell(21, 20)], newer);
    expect(await runTask()).toMatchObject({ outcome: 'completed' });
    expect(await passagesOf()).toEqual(new Map([[E(20, 20), 1]]));
    expect(await ledger()).toEqual(['deposit:' + early]);
  } finally {
    release();
    await Promise.allSettled([late]);
  }
  // Committed now, it is older than everything counted: a (started_at, id) cursor would skip it.
  expect(lateId).not.toBe('');
  expect(await runTask()).toMatchObject({ outcome: 'completed' });
  expect(await passagesOf()).toEqual(
    new Map([
      [E(20, 20), 1],
      [S(10, 10), 1],
      [S(10, 11), 1],
    ]),
  );
  expect(await ledger()).toHaveLength(2);
  // And only once.
  expect(await runTask()).toMatchObject({ outcome: 'completed' });
  expect((await passagesOf()).get(S(10, 10))).toBe(1);
});

/** The backends blocked by `holder`, observed in pg_stat_activity. */
const blockedBy = async (holder: number) =>
  (
    await sql<{ pid: number }>`select pid from pg_stat_activity where ${holder} = any(pg_blocking_pids(pid))`.execute(
      db,
    )
  ).rows;

it('is not held by a village row or a mission row locked by a command', async () => {
  const base = await dbNow();
  const mission = await insertDeposit('wood', [cell(10, 10), cell(12, 10)], at(base, -5_000));
  let ready!: (pid: number) => void, release!: () => void;
  const holding = new Promise<number>((resolve) => (ready = resolve)),
    released = new Promise<void>((resolve) => (release = resolve));
  // A command in the middle of its transaction: its village, and a mission it is changing.
  const command = db.transaction().execute(async (tx) => {
    const { pid } = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!;
    await tx.selectFrom('villages').select('id').where('id', '=', villageId).forUpdate().execute();
    await tx.selectFrom('depositExtractions').select('id').where('id', '=', mission).forUpdate().execute();
    ready(pid);
    await bounded(released);
  });
  void command.catch(() => undefined);
  try {
    const holder = await bounded(holding);
    // The barrier is real: another session cannot take either row.
    for (const held of [
      sql`select id from villages where id = ${villageId}::uuid for update nowait`,
      sql`select id from deposit_extractions where id = ${mission}::uuid for update nowait`,
    ])
      await expect(held.execute(db)).rejects.toMatchObject({ code: '55P03' });
    const run = runTask();
    let waited = 0,
      done = false;
    void run.finally(() => (done = true)).catch(() => undefined);
    while (!done) {
      waited += (await blockedBy(holder)).length;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // Completed while the command still holds its rows, never waiting for them.
    expect(await bounded(run, 5_000)).toMatchObject({ outcome: 'completed' });
    expect(waited).toBe(0);
    expect(await passagesOf()).toEqual(
      new Map([
        [E(10, 10), 1],
        [E(11, 10), 1],
      ]),
    );
  } finally {
    release();
    await Promise.allSettled([command]);
  }
});

it('reschedules itself exactly once and leaves every other notification as it found it', async () => {
  const base = await dbNow();
  await insertDeposit('wood', [cell(1, 1), cell(3, 1)], at(base, -5_000));
  const foreign = [
    { taskType: 'population.energy', attempts: 2, lastError: 'a failure of its own', due: 3_600_000 },
    { taskType: 'building.complete', attempts: 0, lastError: null, due: 7_200_000 },
    { taskType: DESIRE_PATHS_TASK, attempts: 1, lastError: null, due: 1_800_000 },
  ];
  for (const f of foreign)
    await db
      .insertInto('scheduledTasks')
      .values({
        worldId: f.taskType === DESIRE_PATHS_TASK ? await otherWorld() : worldId,
        taskType: f.taskType,
        subjectId: f.taskType === DESIRE_PATHS_TASK ? await otherWorld() : villageId,
        payload: { marker: f.taskType },
        dueAt: at(base, f.due),
        availableAt: at(base, f.due),
        attempts: f.attempts,
        lastError: f.lastError,
        completedAt: null,
      })
      .execute();
  const others = () =>
    db
      .selectFrom('scheduledTasks')
      .selectAll()
      .where((eb) => eb.or([eb('taskType', '<>', DESIRE_PATHS_TASK), eb('worldId', '<>', worldId)]))
      .orderBy('taskType')
      .orderBy('id')
      .execute();
  const untouched = await others();
  expect(untouched).toHaveLength(3);
  const [own] = await pending();
  const result = await runTask();
  const finished = await dbNow();
  expect(result).toEqual({ taskId: own!.id, outcome: 'completed' });
  expect(await others()).toEqual(untouched);
  const mine = await db
    .selectFrom('scheduledTasks')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('taskType', '=', DESIRE_PATHS_TASK)
    .execute();
  expect(mine.filter((task) => task.completedAt !== null).map((task) => task.id)).toEqual([own!.id]);
  const successors = mine.filter((task) => task.completedAt === null);
  expect(successors).toHaveLength(1);
  expect(successors[0]).toMatchObject({ subjectId: worldId, attempts: 0, lastError: null, payload: { worldId } });
  const wait = successors[0]!.dueAt.getTime() - finished.getTime();
  expect(wait).toBeGreaterThan(DESIRE_PATHS_INTERVAL_MS - 5_000);
  expect(wait).toBeLessThanOrEqual(DESIRE_PATHS_INTERVAL_MS);
  expect(successors[0]!.availableAt).toEqual(successors[0]!.dueAt);
  // A second notification of the world is refused by the successor insert, not created.
  await runTask();
  expect(await pending()).toHaveLength(1);
  expect(await others()).toEqual(untouched);
});
let otherWorldId: string | undefined;
async function otherWorld() {
  if (otherWorldId) return otherWorldId;
  otherWorldId = randomUUID();
  await db
    .insertInto('worlds')
    .values({
      id: otherWorldId,
      slug: 'desire-neighbour-' + otherWorldId,
      name: 'Neighbour',
      topology: 'torus',
      widthCells: WIDTH,
      heightCells: HEIGHT,
      chunkSize: 32,
      seed: 4117,
      generationVersion: 1,
      generationStatus: 'ready',
      isOpen: true,
      generatedAt: new Date(),
    })
    .execute();
  return otherWorldId;
}
afterEach(async () => {
  if (otherWorldId) await db.deleteFrom('worlds').where('id', '=', otherWorldId).execute();
  otherWorldId = undefined;
});

it('is cut by its limit without skipping or repeating a mission, and its next run follows quickly', async () => {
  const base = await dbNow();
  // Ten minutes old: older than the margin, so the watermark stops at the last mission read.
  const t = (n: number) => at(base, -600_000 + n * 1000);
  await insertDeposit('wood', [cell(1, 1), cell(2, 1)], t(1));
  await insertDeposit('wood', [cell(3, 1), cell(4, 1)], t(2));
  await insertDeposit('stone', [cell(5, 1), cell(6, 1)], t(2)); // same instant as the second
  await insertGarden(t(3), [cell(7, 1), cell(8, 1)]);
  await insertScience('survey', [cell(9, 1), cell(10, 1), cell(9, 1)], t(4));
  const limited = (limit: number) => {
    const seen: Array<{ counted: number; truncated: boolean }> = [];
    return {
      seen,
      handlers: {
        [DESIRE_PATHS_TASK]: async (tx: Transaction<Database>, task: Parameters<typeof aggregateDesirePaths>[1]) => {
          seen.push(await aggregateDesirePaths(tx, task, { limit }));
        },
      },
    };
  };
  const two = limited(2);
  expect(await runTask(two.handlers)).toMatchObject({ outcome: 'completed' });
  expect(two.seen).toEqual([{ counted: 2, truncated: true }]);
  const [next] = await pending();
  const wait = next!.dueAt.getTime() - (await dbNow()).getTime();
  expect(wait).toBeLessThanOrEqual(DESIRE_PATHS_CONTINUE_MS);
  const midway = await db
    .selectFrom('worldDesireState')
    .select('watermark')
    .where('worldId', '=', worldId)
    .executeTakeFirstOrThrow();
  // The window did not run past what was read: the mission sharing the instant of the last one stays in it.
  expect(midway.watermark.getTime()).toBe(t(2).getTime());
  // The oldest, then one of the two missions of the same instant (the order of their ids).
  const first = await passagesOf();
  expect(first.size).toBe(2);
  expect(first.get(E(1, 1))).toBe(1);
  expect(first.get(E(3, 1)) ?? first.get(E(5, 1))).toBe(1);
  expect(await runTask(two.handlers)).toMatchObject({ outcome: 'completed' });
  expect(two.seen.at(-1)).toEqual({ counted: 2, truncated: true });
  expect(await runTask(two.handlers)).toMatchObject({ outcome: 'completed' });
  expect(two.seen.at(-1)).toEqual({ counted: 1, truncated: false });
  expect(await passagesOf()).toEqual(
    new Map([
      [E(1, 1), 1],
      [E(3, 1), 1],
      [E(5, 1), 1],
      [E(7, 1), 1],
      [E(9, 1), 1],
    ]),
  );
  // Every mission once, whatever the cuts: a run without a limit adds nothing.
  expect(await runTask()).toMatchObject({ outcome: 'completed' });
  expect([...(await passagesOf()).values()]).toEqual([1, 1, 1, 1, 1]);
  const done = await db
    .selectFrom('worldDesireState')
    .select('watermark')
    .where('worldId', '=', worldId)
    .executeTakeFirstOrThrow();
  expect(done.watermark.getTime()).toBeGreaterThan(midway.watermark.getTime());
});

// No write in a command transaction: a trigger that refuses any write to the three tables is
// installed inside the transaction that runs the real command, then rolled back with it.
const rollback = new Error('desire fixture rollback');
async function guardDesireTables(tx: Transaction<Database>) {
  const name = 'forbid_desire_write_' + randomUUID().replaceAll('-', '');
  await sql`create function ${sql.id(name)}() returns trigger language plpgsql as $$
    begin raise exception 'desire table written inside a command'; end $$`.execute(tx);
  for (const table of ['world_desire_edges', 'world_desire_missions', 'world_desire_state'])
    await sql`create trigger ${sql.id(name)} before insert or update or delete or truncate on ${sql.id(table)}
      for each statement execute function ${sql.id(name)}()`.execute(tx);
  // The guard is live: a write attempt is refused (and undone to its savepoint).
  await sql`savepoint desire_guard_probe`.execute(tx);
  await expect(
    sql`insert into world_desire_state(world_id,counting_from,watermark)
      values (${DEVELOPMENT_IDS.world}::uuid, statement_timestamp(), statement_timestamp())`.execute(tx),
  ).rejects.toThrow('desire table written inside a command');
  await sql`rollback to savepoint desire_guard_probe`.execute(tx);
}
const desireRows = async (tx: Transaction<Database>) =>
  Promise.all([
    tx.selectFrom('worldDesireEdges').select('cellX').where('worldId', '=', DEVELOPMENT_IDS.world).execute(),
    tx.selectFrom('worldDesireMissions').select('missionId').where('worldId', '=', DEVELOPMENT_IDS.world).execute(),
    tx.selectFrom('worldDesireState').select('worldId').where('worldId', '=', DEVELOPMENT_IDS.world).execute(),
  ]).then((tables) => tables.map((rows) => rows.length));

it('writes nothing to the desire tables when a garden tour is started', async () => {
  const cells = [DEVELOPMENT_CELLS.garden, DEVELOPMENT_CELLS.gardenNorth];
  await resetE2eState(url);
  await expect(
    db.transaction().execute(async (tx) => {
      await guardDesireTables(tx);
      const villageRow = await tx
        .selectFrom('villages')
        .select('id')
        .where('id', '=', DEVELOPMENT_IDS.village)
        .forUpdate()
        .executeTakeFirstOrThrow();
      expect(villageRow.id).toBe(DEVELOPMENT_IDS.village);
      const through = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
      const garden = await tx
        .insertInto('buildings')
        .values({
          worldId: DEVELOPMENT_IDS.world,
          villageId: DEVELOPMENT_IDS.village,
          buildingType: 'garden',
          level: 1,
          targetLevel: null,
          status: 'completed',
          constructionStartedAt: null,
          constructionCompletesAt: null,
          completedAt: through,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('worldCellOccupancies')
        .values(
          cells.map((c, i) => ({
            ...c,
            worldId: DEVELOPMENT_IDS.world,
            buildingId: garden.id,
            featureId: null,
            role: i === 0 ? ('anchor' as const) : ('body' as const),
          })),
        )
        .execute();
      await tx
        .insertInto('gardenPlots')
        .values(
          cells.map((c, i) => ({
            ...c,
            worldId: DEVELOPMENT_IDS.world,
            villageId: DEVELOPMENT_IDS.village,
            buildingId: garden.id,
            storedAmount: 10 + i * 10,
            remainder: 0.25,
            productionUpdatedAt: through,
          })),
        )
        .execute();
      const route: TravelRoute = {
        id: 'garden',
        kind: 'garden',
        destination: cells[1]!,
        cells: [DEVELOPMENT_CELLS.townHall, ...cells],
      };
      const id = await startGardenTour(
        tx,
        DEVELOPMENT_IDS.world,
        DEVELOPMENT_IDS.village,
        randomUUID(),
        through,
        planGardenTour([route], DEVELOPMENT_CELLS.townHall, cells)!,
      );
      expect(await tx.selectFrom('gardenHarvests').select('id').where('id', '=', id).execute()).toHaveLength(1);
      expect(await desireRows(tx)).toEqual([0, 0, 0]);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}, 60_000);

it('writes nothing to the desire tables when a wood lot is started', async () => {
  await resetE2eState(url);
  const world = DEVELOPMENT_IDS.world,
    village = DEVELOPMENT_IDS.village;
  await expect(
    db.transaction().execute(async (tx) => {
      await guardDesireTables(tx);
      await tx.selectFrom('villages').select('id').where('id', '=', village).forUpdate().executeTakeFirstOrThrow();
      const t = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
      const grove = randomUUID(),
        cellOfGrove = { cellX: 1024, cellY: 514 };
      await tx
        .insertInto('worldFeatures')
        .values({ id: grove, worldId: world, featureTypeCode: 'woodland', state: 'available', variantSeed: 4 })
        .execute();
      await tx
        .insertInto('woodlandDeposits')
        .values({
          worldId: world,
          featureId: grove,
          ...cellOfGrove,
          initialAmount: 1000,
          remainingAmount: 1000,
          reservedAmount: 0,
          revision: 1,
          updatedAt: t,
          regrowthUpdatedAt: t,
        })
        .execute();
      await tx
        .insertInto('worldCellOccupancies')
        .values({ worldId: world, ...cellOfGrove, featureId: grove, buildingId: null, role: 'body' })
        .execute();
      await tx
        .insertInto('populationCohorts')
        .values({
          worldId: world,
          villageId: village,
          originVillageId: village,
          memberCount: 10,
          activity: 'idle',
          energy: 10,
          energyProgress: 0,
          energyUpdatedAt: t,
          restingSince: null,
          foodUsedSinceRest: 0,
          harvestId: null,
          extractionId: null,
        })
        .execute();
      const path = [cell(1025, 512), cell(1024, 512), cell(1024, 514)];
      const lot = await startStoneExtraction(
        tx,
        { worldId: world, villageId: village, widthCells: 2048, heightCells: 1024 },
        { worldId: world, villageId: village, through: t },
        grove,
        randomUUID(),
        1,
        path,
        4_000,
      );
      expect(
        (await tx.selectFrom('depositExtractions').select('pathCells').where('id', '=', lot).executeTakeFirstOrThrow())
          .pathCells,
      ).toEqual(path);
      expect(await desireRows(tx)).toEqual([0, 0, 0]);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}, 60_000);

it('writes nothing to the desire tables when a survey is started', async () => {
  await resetE2eState(url);
  const ids = DEVELOPMENT_IDS;
  await expect(
    db.transaction().execute(async (tx) => {
      await guardDesireTables(tx);
      const economy = await beginVillageEconomy(tx, ids.world, ids.village);
      const campus = await tx
        .insertInto('buildings')
        .values({
          worldId: ids.world,
          villageId: ids.village,
          buildingType: 'university',
          level: 1,
          targetLevel: null,
          status: 'completed',
          constructionStartedAt: null,
          constructionCompletesAt: null,
          completedAt: economy.through,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .updateTable('populationCohorts')
        .set({
          energy: 10,
          energyProgress: 0,
          energyUpdatedAt: economy.through,
          activity: 'idle',
          restingSince: null,
          harvestId: null,
          extractionId: null,
          scienceActivityId: null,
          restBuildingId: null,
        })
        .where('worldId', '=', ids.world)
        .where('villageId', '=', ids.village)
        .execute();
      await admitScience(tx, economy);
      const geography = SCIENCE_PROGRAMS.find((p) => p.code === 'geography-1')!;
      await tx
        .insertInto('sciencePrograms')
        .values({
          worldId: ids.world,
          accountId: ids.account,
          code: geography.code,
          discipline: geography.discipline,
          level: geography.level,
          createdAt: economy.through,
          acquiredAt: economy.through,
          paused: false,
          workDoneMs: geography.workRequiredMs,
          workerCap: 1,
        })
        .execute();
      await scienceCommand(tx, economy, { action: 'train', buildingId: campus.id });
      const batch = await tx
        .selectFrom('scienceActivities')
        .selectAll()
        .where('worldId', '=', ids.world)
        .where('villageId', '=', ids.village)
        .where('status', '=', 'in-progress')
        .orderBy('completesAt')
        .executeTakeFirstOrThrow();
      const trained = { ...economy, through: batch.completesAt };
      await reconcileVillageEconomy(tx, trained);
      const id = await scienceCommand(tx, trained, {
        action: 'survey',
        target: { cellX: 1026, cellY: 512 },
        budgetSeconds: 120,
      });
      expect(id).toBeTruthy();
      const mission = await tx
        .selectFrom('scienceActivities')
        .select(['kind', 'pathCells'])
        .where('worldId', '=', ids.world)
        .where('kind', '=', 'survey')
        .executeTakeFirstOrThrow();
      expect(mission.pathCells.length).toBeGreaterThan(1);
      expect(await desireRows(tx)).toEqual([0, 0, 0]);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}, 60_000);
