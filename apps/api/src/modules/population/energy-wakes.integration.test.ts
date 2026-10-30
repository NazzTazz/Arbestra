import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { PopulationGesture } from '@arbestra/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import type { Database } from '../../database/schema.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { scheduledTaskHandlers } from '../../jobs/task-handlers.js';
import { beginVillageEconomy } from '../villages/reconcile-economy.js';
import { wakePopulationEnergy } from '../villages/complete-construction.js';
import { populationGesture } from './gestures.js';
import { nextPopulationEnergyAt, reconcileRestHousing } from './work.js';

/** Energy and rest housing advance through the worker alone: no client read,
 * no command (docs/INVENTAIRE-SYNC-V2-2026-10-29.md, « Autonomie des workers »). */
const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected population energy test database');
const db = createDatabase(url),
  accountId = randomUUID();
const UNITS = 79_200_000,
  REST_MS = 18_000_000; // 10 points at +44 units/ms
let worldId = '',
  villageId = '',
  houseId = '';

beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@energy.test', passwordHash: 'fixture' })
    .execute();
}, 120000);
afterAll(async () => {
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
});
beforeEach(async () => {
  worldId = randomUUID();
  villageId = randomUUID();
  houseId = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('worlds')
      .values({
        id: worldId,
        slug: 'energy-' + worldId,
        name: 'Energy test',
        topology: 'torus',
        widthCells: 512,
        heightCells: 256,
        chunkSize: 32,
        seed: 4110,
        generationVersion: 1,
        generationStatus: 'ready',
        isOpen: true,
        generatedAt: new Date(),
      })
      .execute();
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Energy' }).execute();
    await tx
      .insertInto('villages')
      .values({
        id: villageId,
        worldId,
        ownerAccountId: accountId,
        name: 'Energy',
        anchorCellX: 64,
        anchorCellY: 64,
        economyActivatedAt: new Date(),
      })
      .execute();
    await tx
      .insertInto('villageResources')
      .values({ worldId, villageId, resourceCode: 'carrot', amount: 100 })
      .execute();
    // Admissions read the surveyed ground around the village, as for any real one.
    for (const chunkX of [1, 2])
      for (const chunkY of [1, 2])
        await tx
          .insertInto('worldChunks')
          .values({
            worldId,
            chunkX,
            chunkY,
            generationVersion: 1,
            terrainCodes: Array(1024).fill(1),
            elevations: Array(1024).fill(0),
          })
          .execute();
    await tx
      .insertInto('playerScience')
      .values({ worldId, accountId, observationsSince: null, solarReport: null })
      .execute();
    // Five beds: one level-1 house, no town hall.
    await tx
      .insertInto('buildings')
      .values({
        id: houseId,
        worldId,
        villageId,
        buildingType: 'dwelling',
        level: 1,
        targetLevel: null,
        status: 'completed',
        constructionStartedAt: null,
        constructionCompletesAt: null,
        completedAt: new Date(),
      })
      .execute();
  });
});
afterEach(async () => {
  await db.deleteFrom('scheduledTasks').where('worldId', '=', worldId).execute();
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
});

const dbNow = async () =>
  (await db.selectNoFrom(sql<Date>`statement_timestamp()`.as('now')).executeTakeFirstOrThrow()).now;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
async function waitUntil(moment: Date) {
  for (let now = await dbNow(); now < moment; now = await dbNow())
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, moment.getTime() - now.getTime() + 5)));
}

/** The scheduler's own steps (SKIP LOCKED, handler, own acknowledgement),
 * restricted to this fixture's world so other suites' tasks stay untouched. */
async function drainWorld() {
  const ran: string[] = [];
  for (;;) {
    const type = await db.transaction().execute(async (tx) => {
      const task = await tx
        .selectFrom('scheduledTasks')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('completedAt', 'is', null)
        .where('dueAt', '<=', sql<Date>`transaction_timestamp()`)
        .where('availableAt', '<=', sql<Date>`transaction_timestamp()`)
        .orderBy('availableAt')
        .orderBy('id')
        .limit(1)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!task) return null;
      const handler = scheduledTaskHandlers[task.taskType];
      if (!handler) throw Error(`No handler for ${task.taskType}`);
      await handler(tx, task);
      await tx
        .updateTable('scheduledTasks')
        .set({ completedAt: sql`transaction_timestamp()`, lastError: null })
        .where('id', '=', task.id)
        .where('completedAt', 'is', null)
        .executeTakeFirstOrThrow();
      return task.taskType;
    });
    if (!type) return ran;
    ran.push(type);
    if (ran.length > 50) throw Error('Unbounded task chain');
  }
}

/** Harvester team ending its tour exhausted, a housed sleeper about to wake and
 * an idle group about to tire: every change falls after the last worker task. */
async function restFixture(t0: Date) {
  const harvest = await db
    .insertInto('gardenHarvests')
    .values({
      worldId,
      villageId,
      buildingId: houseId,
      status: 'in-progress',
      commandId: randomUUID(),
      startedAt: at(t0, -60_000),
      completesAt: at(t0, -100),
      completedAt: null,
      workerCount: 2,
      reservedCarrots: 0,
      plotCellX: null,
      plotCellY: null,
      transportMs: 0,
      pathCells: [],
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('scheduledTasks')
    .values({
      worldId,
      taskType: 'garden.harvest.complete',
      subjectId: harvest.id,
      payload: {},
      dueAt: at(t0, -100),
      availableAt: at(t0, -100),
      lastError: null,
      completedAt: null,
    })
    .execute();
  const wakeMs = 3_000,
    tireMs = 1_500;
  const sleeper = 10 * UNITS - 44 * wakeMs;
  const [harvester, sleeping, tiring] = await Promise.all(
    [
      {
        memberCount: 2,
        activity: 'working' as const,
        energy: 0,
        energyProgress: 0,
        energyUpdatedAt: at(t0, -100),
        restingSince: null,
        harvestId: harvest.id,
        restBuildingId: null,
      },
      {
        memberCount: 4,
        activity: 'resting' as const,
        energy: Math.floor(sleeper / UNITS),
        energyProgress: sleeper % UNITS,
        energyUpdatedAt: t0,
        restingSince: at(t0, -REST_MS),
        harvestId: null,
        restBuildingId: houseId,
      },
      {
        memberCount: 3,
        activity: 'idle' as const,
        energy: 0,
        energyProgress: 10 * tireMs,
        energyUpdatedAt: t0,
        restingSince: null,
        harvestId: null,
        restBuildingId: null,
      },
    ].map(
      async (values) =>
        (
          await db
            .insertInto('populationCohorts')
            .values({
              worldId,
              villageId,
              originVillageId: villageId,
              foodUsedSinceRest: 0,
              extractionId: null,
              ...values,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id,
    ),
  );
  return {
    harvester: harvester!,
    sleeping: sleeping!,
    tiring: tiring!,
    wakeAt: at(t0, wakeMs),
    tireAt: at(t0, tireMs),
  };
}

const cohorts = () =>
  db.selectFrom('populationCohorts').selectAll().where('worldId', '=', worldId).orderBy('id').execute();
const pendingEnergy = () =>
  db
    .selectFrom('scheduledTasks')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('taskType', '=', 'population.energy')
    .where('completedAt', 'is', null)
    .orderBy('dueAt')
    .execute();

it('tires, wakes and beds inhabitants through worker tasks alone, without any client read', async () => {
  const t0 = await dbNow();
  const f = await restFixture(t0);
  const unrelated = await db
    .insertInto('scheduledTasks')
    .values({
      worldId,
      taskType: 'fixture.unrelated',
      subjectId: villageId,
      payload: { preserve: true },
      dueAt: new Date('2100-01-01T00:00:00Z'),
      availableAt: new Date('2100-01-01T00:00:00Z'),
      lastError: 'preserved notification',
      completedAt: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  // The harvest completes at once; tiring and waking come later.
  expect(await drainWorld()).toContain('garden.harvest.complete');
  await waitUntil(at(f.wakeAt, 300));
  await drainWorld();

  const rows = await cohorts();
  const of = (id: string) => rows.filter((c) => c.id === id);
  // The idle group tired at its exact instant and took the beds freed by the sleeper.
  expect(of(f.tiring)).toEqual([
    expect.objectContaining({ activity: 'resting', restingSince: f.tireAt, restBuildingId: houseId, memberCount: 3 }),
  ]);
  // The sleeper woke at full energy at its exact instant, released its beds,
  // and has been idle since (-10 units/ms), up to the cursor the worker wrote.
  const [sleeper] = of(f.sleeping);
  expect(sleeper).toMatchObject({ activity: 'idle', restBuildingId: null, restingSince: null, memberCount: 4 });
  expect(sleeper!.energy * UNITS + sleeper!.energyProgress).toBe(
    10 * UNITS - 10 * (sleeper!.energyUpdatedAt.getTime() - f.wakeAt.getTime()),
  );
  // The exhausted harvesters rest from their return, housed first (earliest rest).
  const harvesters = rows.filter((c) => c.restingSince?.getTime() === at(t0, -100).getTime());
  expect(harvesters.reduce((n, c) => n + c.memberCount, 0)).toBe(2);
  expect(harvesters.every((c) => c.activity === 'resting' && c.restBuildingId === houseId && !c.harvestId)).toBe(true);
  expect(rows.reduce((n, c) => n + c.memberCount, 0)).toBe(9);
  expect(rows.filter((c) => c.restBuildingId === houseId).reduce((n, c) => n + c.memberCount, 0)).toBe(5);
  // The chain continues at the next change: the harvesters' wake, five hours after their return.
  expect((await pendingEnergy()).map((task) => task.dueAt)).toEqual([at(t0, -100 + REST_MS)]);
  // An unrelated notification is neither acknowledged nor modified.
  expect(
    await db.selectFrom('scheduledTasks').selectAll().where('id', '=', unrelated.id).executeTakeFirstOrThrow(),
  ).toEqual(unrelated);
}, 30000);

/** An idle group about to tire (3), an idle pair a command sends to rest (2)
 * and a housed pair still asleep for two hours (2): five beds. */
async function contentionFixture(t0: Date) {
  const tireMs = 800;
  const insert = (values: {
    memberCount: number;
    activity: 'idle' | 'resting';
    energy: number;
    energyProgress: number;
    restingSince: Date | null;
    restBuildingId: string | null;
  }) =>
    db
      .insertInto('populationCohorts')
      .values({
        worldId,
        villageId,
        originVillageId: villageId,
        foodUsedSinceRest: 0,
        harvestId: null,
        extractionId: null,
        energyUpdatedAt: t0,
        ...values,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  const asleep = 10 * UNITS - 44 * 2 * 3_600_000;
  const tiring = await insert({
    memberCount: 3,
    activity: 'idle',
    energy: 0,
    energyProgress: 10 * tireMs,
    restingSince: null,
    restBuildingId: null,
  });
  const rester = await insert({
    memberCount: 2,
    activity: 'idle',
    energy: 9,
    energyProgress: Math.floor(0.9 * UNITS),
    restingSince: null,
    restBuildingId: null,
  });
  const sleeper = await insert({
    memberCount: 2,
    activity: 'resting',
    energy: Math.floor(asleep / UNITS),
    energyProgress: asleep % UNITS,
    restingSince: at(t0, -3 * 3_600_000),
    restBuildingId: houseId,
  });
  const tireAt = at(t0, tireMs);
  // The pending notification an earlier transaction left at the next change.
  const notification = await db
    .insertInto('scheduledTasks')
    .values({
      worldId,
      taskType: 'population.energy',
      subjectId: villageId,
      payload: { villageId },
      dueAt: tireAt,
      availableAt: tireAt,
      lastError: null,
      completedAt: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const unrelated = await db
    .insertInto('scheduledTasks')
    .values({
      worldId,
      taskType: 'fixture.unrelated',
      subjectId: villageId,
      payload: { preserve: true },
      dueAt: at(t0, -1000),
      availableAt: new Date('2100-01-01T00:00:00Z'),
      lastError: 'preserved notification',
      completedAt: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { tiring: tiring.id, rester: rester.id, sleeper: sleeper.id, tireAt, notification, unrelated };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, label: string, ms = 10_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), ms))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function observeWait(waiter: number, holder: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { blocked } = await db
      .selectNoFrom(sql<boolean>`${holder}=any(pg_blocking_pids(${waiter}))`.as('blocked'))
      .executeTakeFirstOrThrow();
    if (blocked) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}
const pid = async (tx: Transaction<Database>) =>
  (await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;

/** The command path of a HUD rest gesture (hud-workforce.ts), without its receipt. */
async function restCommand(tx: Transaction<Database>) {
  const economy = await beginVillageEconomy(tx, worldId, villageId);
  const result = await populationGesture(tx, economy, { commandId: randomUUID(), action: 'rest' } as PopulationGesture);
  await reconcileRestHousing(tx, worldId, villageId, economy.through);
  return result;
}
/** The scheduler's own acquisition of one energy notification. */
const acquireEnergyTask = (tx: Transaction<Database>, id: string) =>
  tx
    .selectFrom('scheduledTasks')
    .selectAll()
    .where('id', '=', id)
    .where('completedAt', 'is', null)
    .forUpdate()
    .skipLocked()
    .executeTakeFirstOrThrow();
const acknowledge = (tx: Transaction<Database>, id: string) =>
  tx
    .updateTable('scheduledTasks')
    .set({ completedAt: sql`transaction_timestamp()`, lastError: null })
    .where('id', '=', id)
    .where('completedAt', 'is', null)
    .executeTakeFirstOrThrow();

for (const order of ['worker-first', 'command-first'] as const)
  it(`reaches one outcome when the energy task and a command contend for the village (${order})`, async () => {
    const t0 = await dbNow();
    const f = await contentionFixture(t0);
    await waitUntil(at(f.tireAt, 100));
    const workerHolds = deferred<number>(),
      commandHolds = deferred<number>(),
      releaseWorker = deferred(),
      releaseCommand = deferred(),
      workerStarted = deferred<number>(),
      commandStarted = deferred<number>();
    let worker: Promise<unknown> | undefined, command: Promise<{ affected: number }> | undefined;
    try {
      const runWorker = () =>
        db.transaction().execute(async (tx) => {
          await sql`set local lock_timeout='8s'`.execute(tx);
          workerStarted.resolve(await pid(tx));
          const task = await acquireEnergyTask(tx, f.notification.id);
          await scheduledTaskHandlers[task.taskType]!(tx, task);
          workerHolds.resolve(await pid(tx));
          await releaseWorker.promise;
          await acknowledge(tx, task.id);
        });
      const runCommand = () =>
        db.transaction().execute(async (tx) => {
          await sql`set local lock_timeout='8s'`.execute(tx);
          commandStarted.resolve(await pid(tx));
          const result = await restCommand(tx);
          commandHolds.resolve(await pid(tx));
          await releaseCommand.promise;
          return result;
        });
      if (order === 'worker-first') {
        worker = runWorker();
        const holder = await bounded(workerHolds.promise, 'worker holds the village');
        command = runCommand();
        const waiter = await bounded(commandStarted.promise, 'command started');
        expect(await observeWait(waiter, holder), 'the command must wait for the village held by the worker').toBe(
          true,
        );
      } else {
        command = runCommand();
        const holder = await bounded(commandHolds.promise, 'command holds the village');
        worker = runWorker();
        const waiter = await bounded(workerStarted.promise, 'worker started');
        expect(await observeWait(waiter, holder), 'the worker must wait for the village held by the command').toBe(
          true,
        );
      }
      releaseWorker.resolve();
      releaseCommand.resolve();
      const [, rested] = await bounded(Promise.all([worker, command]), 'both transactions');
      expect(rested.affected).toBe(2);
    } finally {
      releaseWorker.resolve();
      releaseCommand.resolve();
      await Promise.allSettled([worker, command].filter(Boolean));
    }
    const rows = await cohorts();
    const of = (id: string) => rows.filter((c) => c.id === id);
    expect(of(f.tiring)).toEqual([
      expect.objectContaining({ activity: 'resting', restingSince: f.tireAt, restBuildingId: houseId, memberCount: 3 }),
    ]);
    expect(of(f.sleeper)).toEqual([expect.objectContaining({ activity: 'resting', restBuildingId: houseId })]);
    // The command's rest comes last: no bed left, whatever the order.
    expect(of(f.rester)).toEqual([
      expect.objectContaining({ activity: 'resting', restBuildingId: null, memberCount: 2 }),
    ]);
    expect(rows.reduce((n, c) => n + c.memberCount, 0)).toBe(7);
    // The acquired notification alone was acknowledged; the earliest pending
    // one is the village's next change (the pair's short rest).
    expect(
      (await db.selectFrom('scheduledTasks').selectAll().where('id', '=', f.notification.id).executeTakeFirstOrThrow())
        .completedAt,
    ).not.toBeNull();
    const pending = await pendingEnergy();
    expect(pending[0]?.dueAt).toEqual(nextPopulationEnergyAt(rows, await dbNow()));
    expect(pending.length).toBeLessThanOrEqual(2);
    expect(
      await db.selectFrom('scheduledTasks').selectAll().where('id', '=', f.unrelated.id).executeTakeFirstOrThrow(),
    ).toEqual(f.unrelated);
  }, 60000);

it('never waits for, locks or changes a pending energy notification from a command', async () => {
  const t0 = await dbNow();
  const f = await contentionFixture(t0);
  await waitUntil(at(f.tireAt, 100));
  const held = deferred(),
    release = deferred();
  // The scheduler holds the acquired notification for the whole handler.
  const scheduler = db.transaction().execute(async (tx) => {
    await acquireEnergyTask(tx, f.notification.id);
    held.resolve();
    await release.promise;
  });
  try {
    await bounded(held.promise, 'notification held');
    await db.transaction().execute(async (tx) => {
      // Any wait on the held row would fail here rather than pass slowly.
      await sql`set local lock_timeout='500ms'`.execute(tx);
      expect((await restCommand(tx)).affected).toBe(2);
    });
  } finally {
    release.resolve();
    await scheduler;
  }
  // Untouched: still pending, same due time, no attempt, no error.
  expect(
    await db.selectFrom('scheduledTasks').selectAll().where('id', '=', f.notification.id).executeTakeFirstOrThrow(),
  ).toEqual(f.notification);
  // The command wrote the fatigue it found due; the pending notification,
  // already due, stays the earliest one and keeps the chain.
  expect((await cohorts()).find((c) => c.id === f.tiring)).toMatchObject({ activity: 'resting' });
  expect((await pendingEnergy())[0]?.id).toBe(f.notification.id);
}, 30000);

it('rolls back every energy write, bed and successor after an identified handler failure', async () => {
  const t0 = await dbNow();
  const f = await contentionFixture(t0);
  await waitUntil(at(f.tireAt, 100));
  const snapshot = () =>
    Promise.all([
      cohorts(),
      db.selectFrom('scheduledTasks').selectAll().where('worldId', '=', worldId).orderBy('id').execute(),
      db.selectFrom('villages').selectAll().where('id', '=', villageId).execute(),
    ]);
  const before = await snapshot(),
    injected = Error('ENERGY_ROLLBACK_AFTER_WRITES');
  await expect(
    db.transaction().execute(async (tx) => {
      const task = await acquireEnergyTask(tx, f.notification.id);
      await wakePopulationEnergy(tx, task);
      // The writes happened inside the transaction before the failure.
      expect(
        await tx.selectFrom('populationCohorts').selectAll().where('id', '=', f.tiring).executeTakeFirstOrThrow(),
      ).toMatchObject({ activity: 'resting', restingSince: f.tireAt, restBuildingId: houseId });
      expect(
        await tx
          .selectFrom('scheduledTasks')
          .select('id')
          .where('worldId', '=', worldId)
          .where('taskType', '=', 'population.energy')
          .where('id', '<>', task.id)
          .execute(),
      ).toHaveLength(1);
      throw injected;
    }),
  ).rejects.toBe(injected);
  expect(await snapshot()).toEqual(before);
}, 30000);
