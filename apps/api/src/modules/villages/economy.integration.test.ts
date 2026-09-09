import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from 'kysely';

import type { VillageState } from '@arbestra/contracts';

import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { up as migrateGardenPlots } from '../../database/migrations/015_garden_plots.js';
import type { Database } from '../../database/schema.js';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { processNextScheduledTask } from '../../jobs/scheduled-tasks.js';
import { COMPLETE_CONSTRUCTION_TASK, COMPLETE_EXPANSION_TASK, completeConstruction, completeExpansion } from './complete-construction.js';
import { reconcileVillageEconomy } from './reconcile-economy.js';
import { materializeVillageResource } from './economy.js';
import { constructBuilding, constructBuildingArea, expandGarden, getVillageState, harvestGarden, upgradeBuilding } from './service.js';

const databaseUrl = testDatabaseUrl();
const handlers = { [COMPLETE_CONSTRUCTION_TASK]: completeConstruction, [COMPLETE_EXPANSION_TASK]: completeExpansion };
let db: Kysely<Database>;

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('economic test barrier timed out')), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

// Real services and SQL, with only the transaction boundary supplied by the test.
function inside(transaction: Transaction<Database>): Kysely<Database> {
  return { transaction: () => ({ execute: <T>(run: (tx: Transaction<Database>) => Promise<T>) => run(transaction) }) } as unknown as Kysely<Database>;
}

async function backend(transaction: Transaction<Database>) {
  await sql`set local lock_timeout = '4s'`.execute(transaction);
  return (await transaction.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
}

async function waitUntilBlocked(waiter: number, blocker: number) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const row = await db.selectNoFrom(sql<boolean>`${blocker} = any(pg_blocking_pids(${waiter}))`.as('blocked'))
      .executeTakeFirstOrThrow();
    if (row.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected PostgreSQL village lock wait was not observed');
}

describe.sequential('economy with PostgreSQL', () => {
  beforeAll(async () => {
    await migrateToLatest(databaseUrl);
    await resetE2eState(databaseUrl);
    db = createDatabase(databaseUrl);
  });
  beforeEach(() => resetE2eState(databaseUrl));
  afterAll(async () => { await db?.destroy(); });

  async function build(type: 'sawmill' | 'garden' | 'dwelling', cell: { cellX: number; cellY: number }): Promise<VillageState> {
    return constructBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, cell.cellX, cell.cellY, type, 10_000);
  }

  async function makeDue(buildingId: string): Promise<void> {
    await db.updateTable('buildings').set({
      constructionStartedAt: sql`transaction_timestamp() - interval '2 seconds'`,
      constructionCompletesAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where('id', '=', buildingId).execute();
    await db.updateTable('buildingExpansions').set({
      startedAt: sql`transaction_timestamp() - interval '2 seconds'`,
      completesAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where('buildingId', '=', buildingId).where('status', '=', 'under-construction').execute();
    const task = await db.selectFrom('scheduledTasks').leftJoin('buildingExpansions', (join) => join
      .onRef('buildingExpansions.id', '=', 'scheduledTasks.subjectId'))
      .select('scheduledTasks.id').where((eb) => eb.or([
        eb('scheduledTasks.subjectId', '=', buildingId),
        eb('buildingExpansions.buildingId', '=', buildingId),
      ])).where('scheduledTasks.completedAt', 'is', null).executeTakeFirstOrThrow();
    await db.updateTable('scheduledTasks').set({
      dueAt: sql`transaction_timestamp() - interval '1 second'`,
      availableAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where('id', '=', task.id).execute();
    expect((await processNextScheduledTask(db, handlers))?.outcome).toBe('completed');
  }

  async function completeAt(cell: { cellX: number; cellY: number }): Promise<string> {
    const building = await db.selectFrom('worldCellOccupancies').innerJoin('buildings', 'buildings.id', 'worldCellOccupancies.buildingId')
      .select('buildings.id').where('worldCellOccupancies.cellX', '=', cell.cellX).where('worldCellOccupancies.cellY', '=', cell.cellY)
      .where('worldCellOccupancies.role', '=', 'anchor').executeTakeFirstOrThrow();
    await makeDue(building.id);
    return building.id;
  }

  async function prepareOutOfOrderDueTransitions(laterFirst = true) {
    await build('sawmill', DEVELOPMENT_CELLS.sawmill);
    await build('garden', DEVELOPMENT_CELLS.garden);
    const buildings = await db.selectFrom('buildings').select(['id', 'buildingType'])
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('status', '=', 'under-construction').execute();
    const sawmill = buildings.find((building) => building.buildingType === 'sawmill');
    const garden = buildings.find((building) => building.buildingType === 'garden');
    if (!sawmill || !garden) throw new Error('Expected pending sawmill and garden');
    const t0 = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 3 * 60 * 60 * 1_000);
    const t1 = new Date(t0.getTime() + 60 * 60 * 1_000);
    const t2 = new Date(t1.getTime() + 60 * 60 * 1_000);
    await db.updateTable('buildings').set({ completedAt: t0 })
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('buildingType', '=', 'town-hall').execute();
    await db.updateTable('villageResources').set({ amount: 1000 })
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood').execute();
    await db.updateTable('villageResourceFlows').set({ remainder: 0, productionUpdatedAt: t0 })
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood').execute();
    await db.updateTable('buildings').set({ constructionStartedAt: t0, constructionCompletesAt: t1 })
      .where('id', '=', sawmill.id).execute();
    await db.updateTable('buildings').set({ constructionStartedAt: t0, constructionCompletesAt: t2 })
      .where('id', '=', garden.id).execute();
    await db.updateTable('buildingResourceBuffers').set({ productionUpdatedAt: t2 }).where('buildingId', '=', garden.id).execute();
    // Deliberately make the later transition the scheduler's first discovery.
    await db.updateTable('scheduledTasks').set({ dueAt: t1, availableAt: laterFirst ? t1 : t0 })
      .where('subjectId', '=', sawmill.id).execute();
    await db.updateTable('scheduledTasks').set({ dueAt: t2, availableAt: laterFirst ? t0 : t1 })
      .where('subjectId', '=', garden.id).execute();
    return { sawmill, garden, t0, t1, t2 };
  }

  async function economicRows(source: Kysely<Database> = db) {
    const resources = await source.selectFrom('villageResources').selectAll().where('villageId', '=', DEVELOPMENT_IDS.village).orderBy('resourceCode').execute();
    const flows = await source.selectFrom('villageResourceFlows').selectAll().where('villageId', '=', DEVELOPMENT_IDS.village).orderBy('resourceCode').execute();
    const buffers = await source.selectFrom('buildingResourceBuffers').selectAll().where('villageId', '=', DEVELOPMENT_IDS.village).orderBy('buildingId').orderBy('resourceCode').execute();
    const buildings = await source.selectFrom('buildings').selectAll().where('villageId', '=', DEVELOPMENT_IDS.village).orderBy('id').execute();
    const expansions = await source.selectFrom('buildingExpansions').selectAll().where('villageId', '=', DEVELOPMENT_IDS.village).orderBy('id').execute();
    const occupations = await source.selectFrom('worldCellOccupancies').selectAll().where('buildingId', 'in', buildings.map((building) => building.id))
      .orderBy('cellX').orderBy('cellY').execute();
    return { resources, flows, buffers, buildings, expansions, occupations };
  }

  async function finishHarvest(buildingId: string): Promise<VillageState> {
    await db.updateTable('gardenHarvests').set({ completesAt: new Date(Date.now() - 1) })
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('buildingId', '=', buildingId)
      .where('status', '=', 'in-progress').execute();
    return getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
  }

  it('starts with whole resources and natural wood production', async () => {
    const state = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(state.village.wood).toBe(2000);
    expect(state.village.carrots).toBe(50);
    expect(state.village.woodProductionPerHour).toBe(60);
    expect(Number.isInteger(state.village.wood)).toBe(true);
  });

  it('uses catalog production for sawmill levels 1, 2 and 3', async () => {
    await build('sawmill', DEVELOPMENT_CELLS.sawmill);
    const id = await completeAt(DEVELOPMENT_CELLS.sawmill);
    expect((await getVillageState(db, DEVELOPMENT_IDS.account, 'aube')).village.woodProductionPerHour).toBe(120);
    await upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, undefined, undefined, 10_000);
    await makeDue(id);
    expect((await getVillageState(db, DEVELOPMENT_IDS.account, 'aube')).village.woodProductionPerHour).toBe(168);
    await upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, undefined, undefined, 10_000);
    await makeDue(id);
    expect((await getVillageState(db, DEVELOPMENT_IDS.account, 'aube')).village.woodProductionPerHour).toBe(254.4);
  });

  it('upgrades a dwelling for 300 wood and increases housing only at completion', async () => {
    await db.updateTable('villageResourceFlows').set({ baseRatePerHour: 0, remainder: 0,
      productionUpdatedAt: sql`statement_timestamp()` }).where('worldId', '=', DEVELOPMENT_IDS.world)
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').execute();
    await build('dwelling', DEVELOPMENT_CELLS.dwelling);
    const id = await completeAt(DEVELOPMENT_CELLS.dwelling);
    const before = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(before.village.population.housingCapacity).toBe(35);
    const pending = await upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id,
      undefined, undefined, 10_000);
    expect(pending.village.population.housingCapacity).toBe(30);
    expect(pending.cells.find((cell) => cell.building?.id === id)?.building)
      .toMatchObject({ level: 1, targetLevel: 2, status: 'under-construction' });
    expect(before.village.wood - pending.village.wood).toBe(300);
    await makeDue(id);
    const completed = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(completed.village.population.housingCapacity).toBe(55);
    expect(completed.cells.find((cell) => cell.building?.id === id)?.building)
      .toMatchObject({ level: 2, targetLevel: null, status: 'completed' });
  });

  it('settles due transitions chronologically when the scheduler discovers T2 before T1', async () => {
    const { sawmill, garden, t0 } = await prepareOutOfOrderDueTransitions();
    const outcome = async (start: Date) => {
      const rows = await economicRows();
      const elapsed = (date: Date | null) => date === null ? null : date.getTime() - start.getTime();
      return {
        resources: rows.resources.map(({ resourceCode, amount }) => ({ resourceCode, amount })),
        flows: rows.flows.map(({ resourceCode, remainder, productionUpdatedAt }) => ({ resourceCode, remainder, cursor: elapsed(productionUpdatedAt) })),
        buildings: rows.buildings.map(({ buildingType, level, targetLevel, status, completedAt }) => ({ buildingType, level, targetLevel, status, completedAt: elapsed(completedAt) }))
          .sort((a, b) => a.buildingType.localeCompare(b.buildingType)),
        buffers: rows.buffers.map(({ resourceCode, storedAmount, remainder, productionUpdatedAt }) => ({ resourceCode, storedAmount, remainder, cursor: elapsed(productionUpdatedAt) })),
        occupations: rows.occupations.map(({ cellX, cellY, role, pendingExpansionId }) => ({ cellX, cellY, role, pendingExpansionId })),
      };
    };
    const first = await processNextScheduledTask(db, handlers);
    expect(first).toMatchObject({ taskId: expect.any(String), outcome: 'completed' });
    const firstTask = await db.selectFrom('scheduledTasks').select('subjectId')
      .where('id', '=', first!.taskId).executeTakeFirstOrThrow();
    expect(firstTask.subjectId).toBe(garden.id);
    const afterLaterNotification = await db.selectFrom('villageResources').select('amount')
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(Number(afterLaterNotification.amount)).toBe(1180);
    expect((await db.selectFrom('buildings').select('status').where('id', '=', sawmill.id).executeTakeFirstOrThrow()).status)
      .toBe('completed');
    expect((await processNextScheduledTask(db, handlers))?.outcome).toBe('completed');
    const afterRetry = await db.selectFrom('villageResources').select('amount')
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(Number(afterRetry.amount)).toBe(1180);
    const reversed = await outcome(t0);

    await resetE2eState(databaseUrl);
    const reference = await prepareOutOfOrderDueTransitions(false);
    for (const through of [reference.t1, reference.t2]) {
      await db.transaction().execute(async (tx) => {
        await tx.selectFrom('villages').select('id').where('id', '=', DEVELOPMENT_IDS.village).forUpdate().executeTakeFirstOrThrow();
        await reconcileVillageEconomy(tx, { worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village, through });
      });
    }
    expect(await outcome(reference.t0)).toEqual(reversed);
  });

  it('serializes two workers that acquired distinct notifications for one village', async () => {
    await prepareOutOfOrderDueTransitions();
    let entered = 0;
    let release!: () => void;
    let bothEntered!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const both = new Promise<void>((resolve) => { bothEntered = resolve; });
    const concurrentHandlers = {
      [COMPLETE_CONSTRUCTION_TASK]: async (transaction: Parameters<typeof completeConstruction>[0], task: Parameters<typeof completeConstruction>[1]) => {
        entered += 1;
        if (entered === 2) bothEntered();
        await backend(transaction);
        await bounded(released);
        await completeConstruction(transaction, task);
      },
      [COMPLETE_EXPANSION_TASK]: completeExpansion,
    };
    const workers = [processNextScheduledTask(db, concurrentHandlers), processNextScheduledTask(db, concurrentHandlers)];
    for (const worker of workers) void worker.catch(() => undefined);
    try {
      await bounded(both);
      release();
      const results = await bounded(Promise.all(workers));
      expect(results.every((result) => result?.outcome === 'completed')).toBe(true);
      expect(new Set(results.map((result) => result?.taskId)).size).toBe(2);
    } finally {
      release();
      await Promise.allSettled(workers);
    }
    const wood = await db.selectFrom('villageResources').select('amount')
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(Number(wood.amount)).toBe(1180);
  });

  it('keeps an old construction notification harmless after read reconciliation starts a new upgrade', async () => {
    await build('sawmill', DEVELOPMENT_CELLS.sawmill);
    const sawmill = await db.selectFrom('buildings').select('id')
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('buildingType', '=', 'sawmill').executeTakeFirstOrThrow();
    const dueAt = new Date(Date.now() - 60_000);
    await db.updateTable('buildings').set({
      constructionStartedAt: new Date(dueAt.getTime() - 60_000), constructionCompletesAt: dueAt,
    }).where('id', '=', sawmill.id).execute();
    await db.updateTable('scheduledTasks').set({ dueAt, availableAt: dueAt })
      .where('subjectId', '=', sawmill.id).execute();
    await db.updateTable('villageResources').set({ amount: 1000 })
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').execute();
    await db.updateTable('villageResourceFlows').set({ remainder: 0, productionUpdatedAt: new Date(dueAt.getTime() - 3_600_000) })
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').execute();

    await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    await upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, sawmill.id, undefined, undefined, 10_000);
    const pending = await db.selectFrom('scheduledTasks').select(['id', 'dueAt'])
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('taskType', '=', COMPLETE_CONSTRUCTION_TASK)
      .where('subjectId', '=', sawmill.id).where('completedAt', 'is', null).execute();
    expect(pending).toHaveLength(2);
    expect((await processNextScheduledTask(db, handlers))?.outcome).toBe('completed');
    const afterOldNotification = await db.selectFrom('buildings').select(['status', 'targetLevel'])
      .where('id', '=', sawmill.id).executeTakeFirstOrThrow();
    expect(afterOldNotification).toMatchObject({ status: 'under-construction', targetLevel: 2 });
  });

  it('starts an upgrade while another worker holds the old notification lock', async () => {
    await build('sawmill', DEVELOPMENT_CELLS.sawmill);
    const sawmill = await db.selectFrom('buildings').select('id')
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('buildingType', '=', 'sawmill').executeTakeFirstOrThrow();
    const dueAt = new Date(Date.now() - 60_000);
    await db.updateTable('buildings').set({
      constructionStartedAt: new Date(dueAt.getTime() - 60_000), constructionCompletesAt: dueAt,
    }).where('id', '=', sawmill.id).execute();
    await db.updateTable('scheduledTasks').set({ dueAt, availableAt: dueAt })
      .where('subjectId', '=', sawmill.id).execute();
    await db.updateTable('villageResources').set({ amount: 1000 })
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').execute();
    await db.updateTable('villageResourceFlows').set({ remainder: 0, productionUpdatedAt: new Date(dueAt.getTime() - 3_600_000) })
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').execute();
    const locked = gate();
    const proceed = gate();
    const claimed = gate();
    let commandPid = 0;
    let workerPid = 0;
    const command = db.transaction().execute(async (tx) => {
      commandPid = await backend(tx);
      await tx.selectFrom('villages').select('id').where('id', '=', DEVELOPMENT_IDS.village).forUpdate().executeTakeFirstOrThrow();
      locked.resolve();
      await bounded(proceed.promise);
      return upgradeBuilding(inside(tx), DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
        sawmill.id, undefined, undefined, 60_000);
    });
    // Observe failures immediately, but always drain both transactions in finally.
    void command.catch(() => undefined);
    let worker: ReturnType<typeof processNextScheduledTask> | undefined;
    try {
      await bounded(locked.promise);
      worker = processNextScheduledTask(db, { ...handlers,
        [COMPLETE_CONSTRUCTION_TASK]: async (tx, task) => {
          workerPid = await backend(tx);
          claimed.resolve();
          await completeConstruction(tx, task);
        },
      });
      void worker.catch(() => undefined);
      await bounded(claimed.promise);
      await waitUntilBlocked(workerPid, commandPid);
      proceed.resolve();
      const result = await bounded(command);
      expect(result.cells.find((cell) => cell.building?.id === sawmill.id)?.building)
        .toMatchObject({ level: 1, targetLevel: 2, status: 'under-construction' });
      const cost = await db.selectFrom('buildingLevelCosts').select('amount')
        .where('buildingTypeCode', '=', 'sawmill').where('level', '=', 2).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
      const started = new Date(result.serverTime);
      const tasks = await db.selectFrom('scheduledTasks').selectAll().where('subjectId', '=', sawmill.id).execute();
      expect(tasks).toHaveLength(2);
      expect(tasks.find((task) => task.dueAt > dueAt)?.dueAt.getTime()).toBe(started.getTime() + 60_000);
      expect(result.village.wood)
        .toBe(1060 + Math.floor(120 * (started.getTime() - dueAt.getTime()) / 3_600_000) - Number(cost.amount));
      expect((await bounded(worker))?.outcome).toBe('completed');
      expect((await db.selectFrom('buildings').select(['level', 'targetLevel', 'status'])
        .where('id', '=', sawmill.id).executeTakeFirstOrThrow()))
        .toMatchObject({ level: 1, targetLevel: 2, status: 'under-construction' });
      expect(await db.selectFrom('scheduledTasks').select('id').where('subjectId', '=', sawmill.id)
        .where('completedAt', 'is', null).execute()).toHaveLength(1);
    } finally {
      proceed.resolve();
      await Promise.allSettled([command, ...(worker ? [worker] : [])]);
    }
  });

  it('does not double-count when an older task retries after a later reconciliation', async () => {
    const { sawmill } = await prepareOutOfOrderDueTransitions(false);
    const retryingHandlers = {
      [COMPLETE_CONSTRUCTION_TASK]: async (_transaction: Parameters<typeof completeConstruction>[0], task: Parameters<typeof completeConstruction>[1]) => {
        if (task.subjectId === sawmill.id) throw new Error('transient failure before reconciliation');
        await completeConstruction(_transaction, task);
      },
      [COMPLETE_EXPANSION_TASK]: completeExpansion,
    };
    const failed = await processNextScheduledTask(db, retryingHandlers, 60_000);
    expect(failed?.outcome).toBe('retry-scheduled');
    const retry = await db.selectFrom('scheduledTasks').selectAll().where('id', '=', failed!.taskId).executeTakeFirstOrThrow();
    expect(retry.subjectId).toBe(sawmill.id);
    expect(retry.lastError).toBe('transient failure before reconciliation');
    expect(retry.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect((await processNextScheduledTask(db, handlers))?.outcome).toBe('completed');
    const afterLaterTask = await db.selectFrom('villageResources').select('amount')
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(Number(afterLaterTask.amount)).toBe(1180);
    expect(await processNextScheduledTask(db, handlers)).toBeNull();
    // Advance only retry eligibility; its original economic deadline stays unchanged.
    await db.updateTable('scheduledTasks').set({ availableAt: retry.dueAt }).where('id', '=', retry.id).execute();
    expect(await processNextScheduledTask(db, handlers)).toEqual({ taskId: retry.id, outcome: 'completed' });
    const afterRetry = await db.selectFrom('villageResources').select('amount')
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(Number(afterRetry.amount)).toBe(1180);
  });

  it('rolls back every due transition when a handler fails after reconciliation', async () => {
    const { garden, sawmill, t0 } = await prepareOutOfOrderDueTransitions();
    const before = await economicRows();
    const failingHandlers = {
      [COMPLETE_CONSTRUCTION_TASK]: async (transaction: Parameters<typeof completeConstruction>[0], task: Parameters<typeof completeConstruction>[1]) => {
        await completeConstruction(transaction, task);
        const applied = await economicRows(transaction);
        expect(applied.buildings.filter((building) => [garden.id, sawmill.id].includes(building.id))
          .every((building) => building.status === 'completed')).toBe(true);
        expect(Number(applied.resources.find((resource) => resource.resourceCode === 'wood')?.amount)).toBe(1180);
        throw new Error('crash after reconciliation');
      },
      [COMPLETE_EXPANSION_TASK]: completeExpansion,
    };
    const failed = await processNextScheduledTask(db, failingHandlers, 0);
    expect(failed?.outcome).toBe('retry-scheduled');
    expect((await db.selectFrom('scheduledTasks').select('lastError').where('id', '=', failed!.taskId).executeTakeFirstOrThrow()).lastError)
      .toBe('crash after reconciliation');
    expect(await economicRows()).toEqual(before);
    const wood = await db.selectFrom('villageResources').select('amount')
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    const flow = await db.selectFrom('villageResourceFlows').select(['remainder', 'productionUpdatedAt'])
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(Number(wood.amount)).toBe(1000);
    expect(Number(flow.remainder)).toBe(0);
    expect(flow.productionUpdatedAt.getTime()).toBe(t0.getTime());
    expect((await db.selectFrom('buildings').select('status').where('id', '=', sawmill.id).executeTakeFirstOrThrow()).status)
      .toBe('under-construction');
    expect((await db.selectFrom('buildings').select('status').where('id', '=', garden.id).executeTakeFirstOrThrow()).status)
      .toBe('under-construction');
    expect((await processNextScheduledTask(db, handlers))?.outcome).toBe('completed');
    const recovered = await db.selectFrom('villageResources').select('amount')
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(Number(recovered.amount)).toBe(1180);
  });

  it('preserves fractional production for transitions with the same deadline', async () => {
    for (const laterFirst of [true, false]) {
      if (!laterFirst) await resetE2eState(databaseUrl);
      const { sawmill, garden, t0 } = await prepareOutOfOrderDueTransitions(laterFirst);
      const deadline = new Date(t0.getTime() + 10_000);
      const horizon = new Date(deadline.getTime() + 10_000);
      await db.updateTable('buildings').set({ level: 2, targetLevel: 3, constructionCompletesAt: deadline })
        .where('id', '=', sawmill.id).execute();
      await db.updateTable('buildings').set({ constructionCompletesAt: deadline }).where('id', '=', garden.id).execute();
      await db.updateTable('buildingResourceBuffers').set({ productionUpdatedAt: deadline }).where('buildingId', '=', garden.id).execute();
      await db.updateTable('villageResourceFlows').set({ remainder: 0.5 })
        .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').execute();
      await db.updateTable('scheduledTasks').set({ dueAt: deadline }).where('subjectId', 'in', [sawmill.id, garden.id]).execute();
      const first = await processNextScheduledTask(db, handlers);
      expect(first?.outcome).toBe('completed');
      expect((await db.selectFrom('scheduledTasks').select('subjectId').where('id', '=', first!.taskId).executeTakeFirstOrThrow()).subjectId)
        .toBe(laterFirst ? garden.id : sawmill.id);
      await db.transaction().execute(async (tx) => {
        await tx.selectFrom('villages').select('id').where('id', '=', DEVELOPMENT_IDS.village).forUpdate().executeTakeFirstOrThrow();
        expect(await materializeVillageResource(tx, DEVELOPMENT_IDS.world, DEVELOPMENT_IDS.village, 'wood', horizon)).toBe(1001);
        const flow = await tx.selectFrom('villageResourceFlows').select(['remainder', 'productionUpdatedAt'])
          .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
        // Persisted remainders have a fixed numeric scale; allow its rounding.
        expect(Number(flow.remainder)).toBeCloseTo(0.5 + 168 * 10 / 3600 + 254.4 * 10 / 3600 - 1, 10);
        expect(flow.productionUpdatedAt).toEqual(horizon);
      });
    }
  });

  it('includes deadlines at the bound and excludes the following millisecond', async () => {
    const { sawmill, garden, t1 } = await prepareOutOfOrderDueTransitions();
    await db.updateTable('buildings').set({ constructionCompletesAt: new Date(t1.getTime() + 1) }).where('id', '=', garden.id).execute();
    await db.transaction().execute(async (tx) => {
      await tx.selectFrom('villages').select('id').where('id', '=', DEVELOPMENT_IDS.village).forUpdate().executeTakeFirstOrThrow();
      await reconcileVillageEconomy(tx, { worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village, through: t1 });
      expect((await tx.selectFrom('buildings').select('status').where('id', '=', sawmill.id).executeTakeFirstOrThrow()).status).toBe('completed');
      expect((await tx.selectFrom('buildings').select('status').where('id', '=', garden.id).executeTakeFirstOrThrow()).status).toBe('under-construction');
    });
  });

  it('uses a post-lock statement timestamp for a transaction that started before waiting', async () => {
    await build('garden', DEVELOPMENT_CELLS.garden);
    const id = await completeAt(DEVELOPMENT_CELLS.garden);
    const t0 = new Date(Date.now() - 3_600_000);
    await db.updateTable('gardenPlots').set({ storedAmount: 0, remainder: 0.25, productionUpdatedAt: t0 })
      .where('buildingId', '=', id).execute();
    const opened = gate();
    const locked = gate();
    let waiterPid = 0;
    let lockerPid = 0;
    const waitingHarvest = db.transaction().execute(async (tx) => {
      waiterPid = await backend(tx);
      opened.resolve();
      await bounded(locked.promise);
      return harvestGarden(inside(tx), DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id);
    });
    void waitingHarvest.catch(() => undefined);
    let firstHarvest: Promise<VillageState> | undefined;
    try {
      await bounded(opened.promise);
      firstHarvest = db.transaction().execute(async (tx) => {
        lockerPid = await backend(tx);
        await tx.selectFrom('villages').select('id').where('id', '=', DEVELOPMENT_IDS.village).forUpdate().executeTakeFirstOrThrow();
        locked.resolve();
        await waitUntilBlocked(waiterPid, lockerPid);
        // The other request is now inside its lock SELECT. An incorrectly
        // captured pre-lock timestamp is necessarily earlier than this harvest.
        await sql`select pg_sleep(0.02)`.execute(tx);
        return harvestGarden(inside(tx), DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id);
      });
      const first = await bounded(firstHarvest);
      await expect(bounded(waitingHarvest)).rejects.toMatchObject({ code: 'GARDEN_HARVEST_IN_PROGRESS' });
      const production = 0.25 + 60 * (Date.parse(first.serverTime) - t0.getTime()) / 3_600_000;
      expect(first.village.carrots).toBe(50);
      const buffer = await db.selectFrom('gardenPlots').selectAll().where('buildingId', '=', id).executeTakeFirstOrThrow();
      expect(buffer.productionUpdatedAt.toISOString()).toBe(first.serverTime);
      expect(Number(buffer.storedAmount)).toBe(0);
      expect(Number(buffer.remainder)).toBeCloseTo(production % 1, 10);
      expect(first.cells.find((cell) => cell.building?.id === id)?.building?.garden?.storedCarrots).toBe(0);
    } finally {
      locked.resolve();
      await Promise.allSettled([waitingHarvest, ...(firstHarvest ? [firstHarvest] : [])]);
    }
  });

  it('returns a completed building for a zero-duration command', async () => {
    const state = await constructBuilding(
      db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
      DEVELOPMENT_CELLS.sawmill.cellX, DEVELOPMENT_CELLS.sawmill.cellY, 'sawmill', 0,
    );
    expect(state.cells.find((cell) => cell.cellX === DEVELOPMENT_CELLS.sawmill.cellX
      && cell.cellY === DEVELOPMENT_CELLS.sawmill.cellY)?.building?.status).toBe('completed');
    const building = state.cells.find((cell) => cell.building?.type === 'sawmill')?.building;
    expect(building?.constructionStartedAt).toBe(state.serverTime);
    expect(building?.constructionCompletesAt).toBe(state.serverTime);
  });

  it('projects long offline production without writing on ordinary reads', async () => {
    await db.updateTable('villageResourceFlows').set({
      remainder: 0, productionUpdatedAt: sql`transaction_timestamp() - interval '10 hours'`,
    }).where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').execute();
    expect((await getVillageState(db, DEVELOPMENT_IDS.account, 'aube')).village.wood).toBe(2600);
    const before = await db.selectFrom('villageResourceFlows').selectAll()
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    const after = await db.selectFrom('villageResourceFlows').selectAll()
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(after.productionUpdatedAt.getTime()).toBe(before.productionUpdatedAt.getTime());
    expect(after.remainder).toBe(before.remainder);
  });

  it('debits a concurrent duplicate construction exactly once', async () => {
    const results = await Promise.allSettled([
      build('sawmill', DEVELOPMENT_CELLS.sawmill), build('sawmill', DEVELOPMENT_CELLS.sawmill),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const wood = await db.selectFrom('villageResources').select('amount')
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(Number(wood.amount)).toBe(1950);
  });

  it('treats a generated feature occupation as authoritative', async () => {
    const featureId = '60000000-0000-4000-8000-000000000001';
    try {
      await db.insertInto('worldFeatures').values({
        id: featureId, worldId: DEVELOPMENT_IDS.world, featureTypeCode: 'woodland',
        state: 'available', variantSeed: 1,
      }).execute();
      await db.insertInto('worldCellOccupancies').values({
        worldId: DEVELOPMENT_IDS.world, ...DEVELOPMENT_CELLS.sawmill,
        buildingId: null, featureId, role: 'body',
      }).execute();

      await expect(build('sawmill', DEVELOPMENT_CELLS.sawmill))
        .rejects.toMatchObject({ code: 'CELL_OCCUPIED' });
      const wood = await db.selectFrom('villageResources').select('amount')
        .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
      expect(Number(wood.amount)).toBe(2000);
    } finally {
      await db.deleteFrom('worldFeatures').where('id', '=', featureId).execute();
    }
  });

  it('caps buffered production and prevents double harvest', async () => {
    await build('garden', DEVELOPMENT_CELLS.garden);
    const id = await completeAt(DEVELOPMENT_CELLS.garden);
    await db.updateTable('gardenPlots').set({
      storedAmount: 0, remainder: 0, productionUpdatedAt: sql`transaction_timestamp() - interval '20 hours'`,
    }).where('buildingId', '=', id).execute();
    const capped = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(capped.cells.find((cell) => cell.building?.id === id)?.building?.garden?.storedCarrots).toBe(600);
    await db.updateTable('gardenPlots').set({ storedAmount: 347, remainder: 0, productionUpdatedAt: sql`transaction_timestamp()` })
      .where('buildingId', '=', id).execute();
    const commandId = '33333333-3333-4333-8333-333333333333';
    const started = await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, commandId);
    expect(started.village.carrots).toBe(50);
    const retried = await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, commandId);
    expect(retried.cells.find((cell) => cell.building?.id === id)?.building?.garden?.plots[0]?.harvest?.id)
      .toBe(started.cells.find((cell) => cell.building?.id === id)?.building?.garden?.plots[0]?.harvest?.id);
    await expect(harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id))
      .rejects.toMatchObject({ code: 'GARDEN_HARVEST_IN_PROGRESS' });
    await finishHarvest(id);
    const carrots = await db.selectFrom('villageResources').select('amount')
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'carrot').executeTakeFirstOrThrow();
    expect(Number(carrots.amount)).toBe(397);
    const inhabitants = await db.selectFrom('populationCohorts').select(sql<number>`sum(member_count)::integer`.as('count'))
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village).executeTakeFirstOrThrow();
    expect(inhabitants.count).toBe(15);
  });

  it('persists one chosen garden extension and rejects occupied cells', async () => {
    await build('dwelling', DEVELOPMENT_CELLS.dwelling);
    await completeAt(DEVELOPMENT_CELLS.dwelling);
    await build('garden', DEVELOPMENT_CELLS.garden);
    const id = await completeAt(DEVELOPMENT_CELLS.garden);
    await expect(upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, DEVELOPMENT_CELLS.dwelling.cellX, DEVELOPMENT_CELLS.dwelling.cellY, 10_000))
      .rejects.toMatchObject({ code: 'CELL_OCCUPIED' });
    const pending = await upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, DEVELOPMENT_CELLS.gardenNorth.cellX, DEVELOPMENT_CELLS.gardenNorth.cellY, 10_000);
    expect(pending.cells.find((cell) => cell.cellX === DEVELOPMENT_CELLS.gardenNorth.cellX && cell.cellY === DEVELOPMENT_CELLS.gardenNorth.cellY)?.footprint?.state).toBe('reserved');
    await makeDue(id);
    const completed = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(completed.cells.find((cell) => cell.cellX === DEVELOPMENT_CELLS.gardenNorth.cellX && cell.cellY === DEVELOPMENT_CELLS.gardenNorth.cellY)?.footprint?.state).toBe('active');
    expect(completed.cells.find((cell) => cell.building?.id === id)?.building?.garden?.activeCellCount).toBe(2);
  });

  it('harvests one plot without changing its neighbour and assigns one inhabitant', async () => {
    await build('garden', DEVELOPMENT_CELLS.garden);
    const id = await completeAt(DEVELOPMENT_CELLS.garden);
    await expandGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, [DEVELOPMENT_CELLS.gardenNorth], 0);
    await db.updateTable('gardenPlots').set({ storedAmount: 11, remainder: 0, productionUpdatedAt: sql`statement_timestamp()` })
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('cellX', '=', DEVELOPMENT_CELLS.garden.cellX)
      .where('cellY', '=', DEVELOPMENT_CELLS.garden.cellY).execute();
    await db.updateTable('gardenPlots').set({ storedAmount: 29, remainder: 0, productionUpdatedAt: sql`statement_timestamp()` })
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('cellX', '=', DEVELOPMENT_CELLS.gardenNorth.cellX)
      .where('cellY', '=', DEVELOPMENT_CELLS.gardenNorth.cellY).execute();
    const started = await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id,
      DEVELOPMENT_CELLS.garden.cellX, DEVELOPMENT_CELLS.garden.cellY);
    const garden = started.cells.find((cell) => cell.building?.id === id)?.building?.garden;
    expect(garden?.plots.find((plot) => plot.cellY === DEVELOPMENT_CELLS.garden.cellY)).toMatchObject({ storedCarrots: 0, harvest: { reservedCarrots: 11 } });
    expect(garden?.plots.find((plot) => plot.cellY === DEVELOPMENT_CELLS.gardenNorth.cellY)).toMatchObject({ storedCarrots: 29, harvest: null });
    const assigned = await db.selectFrom('populationCohorts').select(sql<number>`sum(member_count)::integer`.as('count'))
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('harvestId', 'is not', null).executeTakeFirstOrThrow();
    expect(assigned.count).toBe(1);
  });

  it('charges only five new cells for a 3 by 2 rectangle overlapping one active plot', async () => {
    const anchor = { cellX: 1024, cellY: 514 };
    const built = await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
      'garden', anchor, [anchor], 0);
    const id = built.cells.find((cell) => cell.cellX === anchor.cellX && cell.cellY === anchor.cellY)?.building?.id;
    expect(id).toBeDefined();
    const rectangle = [0, 1].flatMap((dy) => [0, 1, 2].map((dx) => ({ cellX: anchor.cellX + dx, cellY: anchor.cellY - dy })));
    const pending = await expandGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id!, rectangle, 10_000);
    expect(pending.village.wood).toBe(1700);
    expect(pending.cells.find((cell) => cell.building?.id === id)?.building?.garden?.pendingCellCount).toBe(5);
    await makeDue(id!);
    const beforeNoop = await db.selectFrom('villageResources').select('amount').where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    const completed = await expandGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id!, rectangle, 10_000);
    expect(completed.cells.find((cell) => cell.building?.id === id)?.building?.garden?.activeCellCount).toBe(6);
    expect(Number(beforeNoop.amount)).toBe(1700);
    expect(completed.village.wood).toBe(1700);
  });

  it('keeps diagonal Gardens separate then fuses the chain when a cardinal bridge completes', async () => {
    await constructBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 1024, 512, 'garden', 0);
    const diagonal = await constructBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 1025, 513, 'garden', 0);
    expect(diagonal.cells.filter((cell) => cell.building?.type === 'garden')).toHaveLength(2);
    const bridged = await constructBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 1024, 513, 'garden', 0);
    const logical = bridged.cells.filter((cell) => cell.building?.type === 'garden');
    expect(logical).toHaveLength(1);
    expect(logical[0]?.building?.garden?.plots).toHaveLength(3);
    expect(new Set(bridged.cells.filter((cell) => cell.footprint?.buildingType === 'garden')
      .map((cell) => cell.footprint?.buildingId)).size).toBe(1);
  });

  it('backfills plot stocks deterministically without duplicating an active legacy harvest', async () => {
    const rollback = new Error('rollback isolated garden plot migration');
    await expect(db.transaction().execute(async (tx) => {
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
        (${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 10, 9, null),
        (${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 11, 9, ${randomUUID()}::uuid)`.execute(tx);
      await sql`insert into building_resource_buffers values
        (${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 'carrot', 10, 0.25, '2026-09-07T00:00:00Z')`.execute(tx);
      await sql`insert into garden_harvests values
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ${DEVELOPMENT_IDS.world}::uuid, ${buildingId}::uuid, 'in-progress')`.execute(tx);
      await migrateGardenPlots(tx as unknown as Kysely<unknown>);
      const plots = await sql<{ stored: string; remainder: string }>`select stored_amount as stored, remainder
        from garden_plots order by cell_x, cell_y`.execute(tx);
      expect(plots.rows.map((row) => Number(row.stored))).toEqual([4, 3, 3]);
      expect(plots.rows.reduce((sum, row) => sum + Number(row.stored), 0)).toBe(10);
      expect(plots.rows.map((row) => Number(row.remainder))).toEqual([0, 0, 0.25]);
      const legacy = await sql<{ x: number | null; y: number | null }>`select plot_cell_x as x, plot_cell_y as y from garden_harvests`.execute(tx);
      expect(legacy.rows).toEqual([{ x: null, y: null }]);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it('lets only one concurrent upgrade reserve a cell', async () => {
    await build('garden', DEVELOPMENT_CELLS.garden);
    await build('garden', DEVELOPMENT_CELLS.sawmill);
    const first = await completeAt(DEVELOPMENT_CELLS.garden);
    const second = await completeAt(DEVELOPMENT_CELLS.sawmill);
    const results = await Promise.allSettled([
      upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, first, DEVELOPMENT_CELLS.gardenNorth.cellX, DEVELOPMENT_CELLS.gardenNorth.cellY, 10_000),
      upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, second, DEVELOPMENT_CELLS.gardenNorth.cellX, DEVELOPMENT_CELLS.gardenNorth.cellY, 10_000),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('harvests both production rates when an expansion is overdue and the worker has not run', async () => {
    await build('garden', DEVELOPMENT_CELLS.garden);
    const id = await completeAt(DEVELOPMENT_CELLS.garden);
    await expandGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
      id, [DEVELOPMENT_CELLS.gardenNorth], 10_000);
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('gardenPlots').set({
        storedAmount: 0, remainder: 0,
        productionUpdatedAt: sql`transaction_timestamp() - interval '2 hours'`,
      }).where('buildingId', '=', id).execute();
      await tx.updateTable('buildingExpansions').set({
        startedAt: sql`transaction_timestamp() - interval '90 minutes'`,
        completesAt: sql`transaction_timestamp() - interval '1 hour'`,
      }).where('buildingId', '=', id).execute();
    });

    // No snapshot or worker before the command: 1h at 60 + 1h at 120.
    const started = await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id,
      DEVELOPMENT_CELLS.garden.cellX, DEVELOPMENT_CELLS.garden.cellY);
    await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id,
      DEVELOPMENT_CELLS.gardenNorth.cellX, DEVELOPMENT_CELLS.gardenNorth.cellY);
    expect(started.village.carrots).toBe(50);
    const harvested = await finishHarvest(id);
    expect(harvested.village.carrots).toBe(50 + 60 + 120);
    expect(harvested.cells.find((cell) => cell.building?.id === id)?.building?.garden)
      .toMatchObject({ activeCellCount: 2, pendingCellCount: 0, expansion: null, storedCarrots: 0, capacity: 1200 });
    await expect(harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id))
      .rejects.toMatchObject({ code: 'GARDEN_EMPTY' });
  });

  it('does not recover production capped before an overdue expansion', async () => {
    await build('garden', DEVELOPMENT_CELLS.garden);
    const id = await completeAt(DEVELOPMENT_CELLS.garden);
    await expandGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
      id, [DEVELOPMENT_CELLS.gardenNorth], 10_000);
    const t0 = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    const t1 = new Date(t0.getTime() + 60 * 60 * 1_000);
    await db.updateTable('gardenPlots').set({
      storedAmount: 600, remainder: 0, productionUpdatedAt: t0,
    }).where('buildingId', '=', id).execute();
    await db.updateTable('buildingExpansions').set({ startedAt: t0, completesAt: t1 })
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('buildingId', '=', id)
      .where('status', '=', 'under-construction').execute();
    await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id,
      DEVELOPMENT_CELLS.garden.cellX, DEVELOPMENT_CELLS.garden.cellY);
    await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id,
      DEVELOPMENT_CELLS.gardenNorth.cellX, DEVELOPMENT_CELLS.gardenNorth.cellY);
    const harvested = await finishHarvest(id);
    expect(harvested.village.carrots).toBe(50 + 600 + 60);
  });

  it('rolls back a due expansion without activating its reserved cells when its handler fails', async () => {
    await build('garden', DEVELOPMENT_CELLS.garden);
    const id = await completeAt(DEVELOPMENT_CELLS.garden);
    await expandGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
      id, [DEVELOPMENT_CELLS.gardenNorth], 10_000);
    const expansion = await db.selectFrom('buildingExpansions').select(['id', 'completesAt'])
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('buildingId', '=', id)
      .where('status', '=', 'under-construction').executeTakeFirstOrThrow();
    const dueAt = new Date(Date.now() - 60_000);
    await db.updateTable('buildingExpansions').set({
      startedAt: new Date(dueAt.getTime() - 60_000), completesAt: dueAt,
    })
      .where('id', '=', expansion.id).execute();
    await db.updateTable('scheduledTasks').set({ dueAt, availableAt: dueAt })
      .where('subjectId', '=', expansion.id).execute();
    await db.updateTable('buildingResourceBuffers').set({ storedAmount: 10, remainder: 0.25,
      productionUpdatedAt: new Date(dueAt.getTime() - 3_600_000) }).where('buildingId', '=', id).execute();
    const before = await economicRows();
    const failingHandlers = {
      [COMPLETE_CONSTRUCTION_TASK]: completeConstruction,
      [COMPLETE_EXPANSION_TASK]: async (transaction: Parameters<typeof completeExpansion>[0], task: Parameters<typeof completeExpansion>[1]) => {
        await completeExpansion(transaction, task);
        const applied = await economicRows(transaction);
        expect(applied.expansions.find((row) => row.id === expansion.id)?.status).toBe('completed');
        expect(applied.occupations.filter((row) => row.pendingExpansionId === expansion.id)).toHaveLength(0);
        expect(Number(applied.buffers.find((row) => row.buildingId === id)?.storedAmount)).toBe(70);
        throw new Error('crash after expansion reconciliation');
      },
    };
    const failed = await processNextScheduledTask(db, failingHandlers, 0);
    expect(failed?.outcome).toBe('retry-scheduled');
    expect((await db.selectFrom('scheduledTasks').select('lastError').where('id', '=', failed!.taskId).executeTakeFirstOrThrow()).lastError)
      .toBe('crash after expansion reconciliation');
    expect(await economicRows()).toEqual(before);
    expect((await db.selectFrom('worldCellOccupancies').select('pendingExpansionId')
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('cellX', '=', DEVELOPMENT_CELLS.gardenNorth.cellX)
      .where('cellY', '=', DEVELOPMENT_CELLS.gardenNorth.cellY).executeTakeFirstOrThrow()).pendingExpansionId).toBe(expansion.id);
    expect((await db.selectFrom('buildingExpansions').select('status').where('id', '=', expansion.id).executeTakeFirstOrThrow()).status)
      .toBe('under-construction');
    expect((await processNextScheduledTask(db, handlers))?.outcome).toBe('completed');
    expect((await db.selectFrom('buildingExpansions').select('status').where('id', '=', expansion.id).executeTakeFirstOrThrow()).status)
      .toBe('completed');
  });
});
