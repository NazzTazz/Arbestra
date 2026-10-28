import { randomUUID } from 'node:crypto';
import { sql, type Transaction, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as villageService from './service.js';
import * as worksiteService from '../deposits/worksites.js';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS } from '../../database/seed.js';
import { HttpError } from '../../errors.js';
import type { Database } from '../../database/schema.js';
import { appendPoolTargets, changeExtractionPool, readExtractionPools } from '../deposits/extraction-pools.js';
import { admitWorksites, changeWorksite } from '../deposits/worksites.js';
import { completeStoneExtractionAt } from '../deposits/stone-extractions.js';
import { populationGesture } from '../population/gestures.js';
import { commandHudWorkforce } from './hud-workforce.js';
import { commandProcessing, completeProcessingAt } from './processing.js';
import { admitScience, scienceCommand } from '../science/service.js';
import { reconcileVillageEconomy } from './reconcile-economy.js';
import { up as migrateHud } from '../../database/migrations/050_hud_workforce.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected HUD test database');
const db = createDatabase(url),
  worldId = DEVELOPMENT_IDS.world,
  villageId = DEVELOPMENT_IDS.village;
beforeAll(() => migrateToLatest(url), 60000);
beforeEach(() => resetE2eState(url), 60000);
afterAll(async () => {
  await resetE2eState(url);
  const features = await db
    .selectFrom('worldFeatures')
    .select('id')
    .where('worldId', '=', worldId)
    .where('variantSeed', '=', 20261020)
    .execute();
  const ids = features.map((f) => f.id);
  if (ids.length)
    await db.transaction().execute(async (tx) => {
      await tx
        .deleteFrom('worldCellOccupancies')
        .where('worldId', '=', worldId)
        .where('featureId', 'in', ids)
        .execute();
      await tx.deleteFrom('woodlandDeposits').where('worldId', '=', worldId).where('featureId', 'in', ids).execute();
      await tx.deleteFrom('stoneDeposits').where('worldId', '=', worldId).where('featureId', 'in', ids).execute();
      await tx.deleteFrom('worldFeatures').where('worldId', '=', worldId).where('id', 'in', ids).execute();
    });
  await db.destroy();
}, 60000);
const dimensions = { widthCells: 2048, heightCells: 1024 };
const route = async () => [
  { cellX: 1024, cellY: 512 },
  { cellX: 1024, cellY: 513 },
  { cellX: 1023, cellY: 514 },
];
async function seed(tx: Transaction<Database>, count = 30) {
  await tx
    .selectFrom('villages')
    .select('id')
    .where('worldId', '=', worldId)
    .where('id', '=', villageId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const through = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow()).at;
  await tx.deleteFrom('populationCohorts').where('worldId', '=', worldId).where('villageId', '=', villageId).execute();
  await tx
    .insertInto('populationCohorts')
    .values({
      worldId,
      villageId,
      originVillageId: villageId,
      memberCount: count,
      activity: 'idle',
      energy: 8,
      energyProgress: 0,
      energyUpdatedAt: through,
      restingSince: null,
      foodUsedSinceRest: 0,
      harvestId: null,
      extractionId: null,
    })
    .execute();
  const targets: string[] = [];
  for (let i = 0; i < 4; i++) {
    const existing = await tx
      .selectFrom('woodlandDeposits')
      .select('featureId')
      .where('worldId', '=', worldId)
      .where('cellX', '=', 1015 - i)
      .where('cellY', '=', 520)
      .executeTakeFirst();
    const id = existing?.featureId ?? randomUUID();
    targets.push(id);
    if (!existing)
      await tx
        .insertInto('worldFeatures')
        .values({ id, worldId, featureTypeCode: 'woodland', state: 'available', variantSeed: 20261020 })
        .execute();
    await tx
      .insertInto('woodlandDeposits')
      .values({
        worldId,
        featureId: id,
        cellX: 1015 - i,
        cellY: 520,
        initialAmount: 500,
        remainingAmount: 500,
        reservedAmount: 0,
        revision: 1,
        updatedAt: through,
        regrowthUpdatedAt: through,
      })
      .onConflict((c) =>
        c.columns(['worldId', 'featureId']).doUpdateSet({
          remainingAmount: 500,
          reservedAmount: 0,
          revision: 1,
          updatedAt: through,
          regrowthUpdatedAt: through,
          cleared: false,
        }),
      )
      .execute();
    await tx
      .insertInto('worldCellOccupancies')
      .values({ worldId, featureId: id, cellX: 1015 - i, cellY: 520, buildingId: null, role: 'body' })
      .onConflict((c) => c.columns(['worldId', 'cellX', 'cellY']).doNothing())
      .execute();
  }
  return { ctx: { worldId, villageId, through }, targets };
}
const active = (tx: Transaction<Database>) =>
  tx
    .selectFrom('depositExtractions')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .where('status', '=', 'in-progress')
    .orderBy('id')
    .execute();

it.each([false, true])(
  'loads a shared queue with local target history (existing target: %s)',
  async (existingTarget) => {
    await db.transaction().execute(async (tx) => {
      const { ctx, targets } = await seed(tx);
      await appendPoolTargets(tx, ctx, 'wood', targets);
      await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action: 'people-up' });
      await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action: 'sites-up' });
      const sites = await tx
        .selectFrom('extractionWorksites')
        .select('id')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('poolResource', '=', 'wood')
        .orderBy('createdAt')
        .orderBy('id')
        .execute();
      const consumer = sites[1]!.id;
      const history = {
        worldId,
        villageId,
        worksiteId: consumer,
        status: 'external' as const,
        admittedAt: null,
        thresholdReachedAt: null,
        completedAt: ctx.through,
        reason: 'reassigned' as const,
      };
      await tx
        .insertInto('extractionWorksiteTargets')
        .values({ ...history, featureId: targets[3]!, ordinal: 1 })
        .execute();
      if (existingTarget)
        await tx
          .insertInto('extractionWorksiteTargets')
          .values({ ...history, featureId: targets[1]!, ordinal: 0 })
          .execute();
      await admitWorksites(tx, ctx, dimensions, route);
      const jobs = await active(tx);
      expect(jobs).toHaveLength(2);
      expect(jobs.find((j) => j.worksiteId === consumer)?.featureId).toBe(targets[1]);
      const rows = await tx
        .selectFrom('extractionWorksiteTargets')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('worksiteId', '=', consumer)
        .execute();
      expect(rows.find((t) => t.featureId === targets[3])).toMatchObject({ ordinal: 1, status: 'external' });
      expect(rows.find((t) => t.featureId === targets[1])).toMatchObject({
        ordinal: existingTarget ? 0 : 2,
        status: 'pending',
      });
      expect(new Set(rows.map((t) => t.ordinal)).size).toBe(rows.length);
    });
  },
);

it('shares one wood queue between two consumers, excludes occupied targets and keeps engaged teams on a lower budget', async () => {
  await db.transaction().execute(async (tx) => {
    const { ctx, targets } = await seed(tx);
    await appendPoolTargets(tx, ctx, 'wood', targets);
    await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action: 'people-up' });
    await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action: 'sites-up' });
    await admitWorksites(tx, ctx, dimensions, route);
    const jobs = await active(tx);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((j) => j.featureId)).size).toBe(2);
    expect(jobs.map((j) => j.workerCount).sort()).toEqual([5, 5]);
    await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action: 'people-down' });
    expect(await active(tx)).toEqual(jobs);
    const summary = (await readExtractionPools(tx, worldId, villageId))[0]!;
    expect(summary).toMatchObject({ resource: 'wood', siteCount: 2, workerCap: 5, mobilized: 10, pendingTargets: 4 });
    const queued = await tx
      .selectFrom('extractionWorksiteTargets')
      .select(['featureId', 'worksiteId'])
      .where('worldId', '=', worldId)
      .where('status', '=', 'pending')
      .execute();
    expect(new Set(queued.map((t) => t.featureId)).size).toBe(4);
    for (const job of jobs) await completeStoneExtractionAt(tx, worldId, villageId, job.id, job.completesAt);
    const through = new Date(Math.max(...jobs.map((j) => j.completesAt.getTime())));
    await admitWorksites(tx, { ...ctx, through }, dimensions, route);
    expect((await active(tx)).reduce((n, j) => n + j.workerCount, 0)).toBeLessThanOrEqual(5);
  });
});

it('does not search or transfer a target when engaged teams already consume the whole pool budget', async () => {
  await db.transaction().execute(async (tx) => {
    const { ctx, targets } = await seed(tx);
    await appendPoolTargets(tx, ctx, 'wood', targets.slice(0, 2));
    for (const action of ['people-up', 'sites-up', 'people-up', 'sites-up'] as const)
      await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action });
    await admitWorksites(tx, ctx, dimensions, route);
    const engaged = await active(tx);
    expect(engaged).toHaveLength(2);
    expect(engaged.reduce((n, e) => n + e.workerCount, 0)).toBe(10);
    await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action: 'people-down' });
    await appendPoolTargets(tx, ctx, 'wood', [targets[2]!]);
    const rows = () =>
      tx
        .selectFrom('extractionWorksiteTargets')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('featureId', '=', targets[2]!)
        .orderBy('worksiteId')
        .execute();
    const before = await rows(),
      search = vi.fn(route);
    await admitWorksites(tx, ctx, dimensions, search);
    expect(search).not.toHaveBeenCalled();
    expect(await active(tx)).toEqual(engaged);
    expect(await rows()).toEqual(before);
  });
});

it.each(['NAVIGATION_BUSY', 'NAVIGATION_UNAVAILABLE'])(
  'defers an automatic pool departure on %s without losing its target or blocking the village',
  async (code) => {
    await db.transaction().execute(async (tx) => {
      const { ctx, targets } = await seed(tx);
      await appendPoolTargets(tx, ctx, 'wood', [targets[0]!]);
      const tasks = () =>
        tx
          .selectFrom('scheduledTasks')
          .selectAll()
          .where('worldId', '=', worldId)
          .where('taskType', '=', 'deposit.worksite.wake')
          .orderBy('id')
          .execute();
      const existingTasks = await tasks();
      const rows = () =>
        tx
          .selectFrom('extractionWorksiteTargets')
          .selectAll()
          .where('worldId', '=', worldId)
          .where('villageId', '=', villageId)
          .orderBy('worksiteId')
          .orderBy('ordinal')
          .execute();
      const before = await rows(),
        search = vi.fn(async () => {
          throw new HttpError(503, code, 'Navigation temporarily busy');
        });
      await admitWorksites(tx, ctx, dimensions, search);
      expect(search).toHaveBeenCalledTimes(1);
      expect(await active(tx)).toHaveLength(0);
      expect(await rows()).toEqual(before);
      const deposit = await tx
        .selectFrom('woodlandDeposits')
        .select('reservedAmount')
        .where('worldId', '=', worldId)
        .where('featureId', '=', targets[0]!)
        .executeTakeFirstOrThrow();
      expect(Number(deposit.reservedAmount)).toBe(0);
      const site = await tx
        .selectFrom('extractionWorksites')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('poolResource', '=', 'wood')
        .executeTakeFirstOrThrow();
      expect(site.waitReason).toBe('navigation-busy');
      expect(site.nextWakeAt!.getTime()).toBeGreaterThan(ctx.through.getTime());
      const scheduled = await tasks();
      expect(scheduled).toHaveLength(existingTasks.length + 1);
      expect(scheduled.filter((t) => existingTasks.some((old) => old.id === t.id))).toEqual(existingTasks);
      await admitWorksites(tx, ctx, dimensions, search);
      expect(search).toHaveBeenCalledTimes(1);
      expect(await tasks()).toEqual(scheduled);
      await admitWorksites(tx, { ...ctx, through: site.nextWakeAt! }, dimensions, route);
      expect(await active(tx)).toHaveLength(1);
      expect((await active(tx))[0]).toMatchObject({ featureId: targets[0], workerCount: 5 });
      expect(await tasks()).toEqual(scheduled);
    });
  },
);

it('feeds all active workers without losing assignments, respects quotas and rotates distinct batches of ten', async () => {
  await db.transaction().execute(async (tx) => {
    const { ctx, targets } = await seed(tx, 35);
    await tx
      .updateTable('villageResources')
      .set({ amount: 1000 })
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('resourceCode', '=', 'carrot')
      .execute();
    await appendPoolTargets(tx, ctx, 'wood', targets);
    for (const action of ['people-up', 'sites-up', 'people-up', 'sites-up', 'people-up', 'people-up'] as const)
      await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action });
    await admitWorksites(tx, ctx, dimensions, route);
    const jobs = await active(tx);
    expect(jobs.reduce((n, j) => n + j.workerCount, 0)).toBe(25);
    const before = await tx
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('extractionId', 'is not', null)
      .orderBy('id')
      .execute();
    expect(await populationGesture(tx, ctx, { commandId: randomUUID(), action: 'feed', group: 'working' })).toEqual({
      affected: 25,
      carrots: 25,
    });
    const after = await tx
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('extractionId', 'is not', null)
      .orderBy('id')
      .execute();
    expect(after.map((c) => [c.id, c.extractionId, c.memberCount])).toEqual(
      before.map((c) => [c.id, c.extractionId, c.memberCount]),
    );
    expect(after.map((c) => c.energy)).toEqual(before.map((c) => c.energy + 1));
    await populationGesture(tx, ctx, { commandId: randomUUID(), action: 'feed', group: 'working' });
    await expect(
      populationGesture(tx, ctx, { commandId: randomUUID(), action: 'feed', group: 'working' }),
    ).rejects.toMatchObject({ code: 'POPULATION_FOOD_UNAVAILABLE' });
    expect(
      await populationGesture(tx, ctx, { commandId: randomUUID(), action: 'release', destination: 'resting' }),
    ).toMatchObject({ affected: 10 });
    expect(
      await populationGesture(tx, ctx, { commandId: randomUUID(), action: 'release', destination: 'idle' }),
    ).toMatchObject({ affected: 10 });
    expect(
      await populationGesture(tx, ctx, { commandId: randomUUID(), action: 'release', destination: 'resting' }),
    ).toMatchObject({ affected: 5 });
    const workers = await tx
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('extractionId', 'is not', null)
      .execute();
    expect(workers.reduce((n, c) => n + c.memberCount, 0)).toBe(25);
    expect(workers.filter((c) => c.pendingRelease === 'resting').reduce((n, c) => n + c.memberCount, 0)).toBe(15);
    expect(workers.filter((c) => c.pendingRelease === 'idle').reduce((n, c) => n + c.memberCount, 0)).toBe(10);
    expect(await active(tx)).toEqual(jobs);
    for (const j of [...jobs].sort((a, b) => a.completesAt.getTime() - b.completesAt.getTime()))
      await completeStoneExtractionAt(tx, worldId, villageId, j.id, j.completesAt);
    const released = await tx.selectFrom('populationCohorts').selectAll().where('worldId', '=', worldId).execute();
    expect(released.filter((c) => c.activity === 'resting').reduce((n, c) => n + c.memberCount, 0)).toBe(15);
    expect(released.every((c) => c.pendingRelease === null && c.extractionId === null)).toBe(true);
    expect(released.reduce((n, c) => n + c.memberCount, 0)).toBe(35);
  });
});

it('keeps queued targets at zero sites and resumes without changing another resource', async () => {
  await db.transaction().execute(async (tx) => {
    const { ctx, targets } = await seed(tx);
    await appendPoolTargets(tx, ctx, 'wood', targets);
    await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action: 'sites-down' });
    await admitWorksites(tx, ctx, dimensions, route);
    expect(await active(tx)).toHaveLength(0);
    expect((await readExtractionPools(tx, worldId, villageId))[0]).toMatchObject({ siteCount: 0, pendingTargets: 4 });
    await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action: 'sites-up' });
    await admitWorksites(tx, ctx, dimensions, route);
    expect(await active(tx)).toHaveLength(1);
    expect((await readExtractionPools(tx, worldId, villageId))[1]).toMatchObject({ resource: 'stone', mobilized: 0 });
  });
});

it('can pause an unconfigured resource when all eight open slots belong to the other resource', async () => {
  await db.transaction().execute(async (tx) => {
    const { ctx } = await seed(tx);
    await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action: 'people-up' });
    for (let i = 0; i < 7; i++)
      await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'wood', action: 'sites-up' });
    await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'stone', action: 'sites-down' });
    expect(await readExtractionPools(tx, worldId, villageId)).toMatchObject([
      { resource: 'wood', siteCount: 8 },
      { resource: 'stone', siteCount: 0 },
    ]);
    expect(
      await tx
        .selectFrom('extractionWorksites')
        .select('id')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('status', 'in', ['running', 'paused', 'stopping'])
        .execute(),
    ).toHaveLength(8);
  });
});

it('replays the same population gesture once and rejects a changed payload or another owner', async () => {
  await db.transaction().execute(async (tx) => {
    await seed(tx, 25);
  });
  const request = { kind: 'population' as const, command: { commandId: randomUUID(), action: 'rest' as const } };
  const first = await commandHudWorkforce(db, DEVELOPMENT_IDS.account, 'aube', villageId, request);
  expect(first.affected).toBe(10);
  expect(first.hud.population.resting).toBe(10);
  const again = await commandHudWorkforce(db, DEVELOPMENT_IDS.account, 'aube', villageId, request);
  expect(again.hud.population.resting).toBe(10);
  await expect(
    commandHudWorkforce(db, DEVELOPMENT_IDS.account, 'aube', villageId, {
      kind: 'population',
      command: { ...request.command, action: 'feed', group: 'idle' },
    }),
  ).rejects.toMatchObject({ code: 'COMMAND_ID_CONFLICT' });
  await expect(commandHudWorkforce(db, randomUUID(), 'aube', villageId, request)).rejects.toMatchObject({
    code: 'VILLAGE_NOT_FOUND',
  });
});

it('confirms a gesture and its replay even when the full world projection is unavailable', async () => {
  await db.transaction().execute(async (tx) => {
    await seed(tx, 25);
  });
  const projection = vi
    .spyOn(villageService, 'state')
    .mockRejectedValue(new Error('Full world projection unavailable'));
  const request = { kind: 'population' as const, command: { commandId: randomUUID(), action: 'rest' as const } };
  try {
    const first = await commandHudWorkforce(db, DEVELOPMENT_IDS.account, 'aube', villageId, request);
    expect(first).toMatchObject({
      commandId: request.command.commandId,
      affected: 10,
      hud: {
        worldId,
        villageId,
        population: { resting: 10, available: 15, working: 0 },
      },
    });
    expect(
      await db
        .selectFrom('hudWorkforceReceipts')
        .select('commandId')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('commandId', '=', request.command.commandId)
        .execute(),
    ).toHaveLength(1);
    const replay = await commandHudWorkforce(db, DEVELOPMENT_IDS.account, 'aube', villageId, request);
    expect(replay).toMatchObject({ affected: 10, hud: { population: { resting: 10, available: 15 } } });
    expect(projection).not.toHaveBeenCalled();
  } finally {
    projection.mockRestore();
  }
});

it('confirms workforce settings before route-dependent departures and persists their wake', async () => {
  await db.transaction().execute(async (tx) => {
    const { ctx, targets } = await seed(tx);
    await appendPoolTargets(tx, ctx, 'wood', targets);
  });
  const admission = vi
    .spyOn(worksiteService, 'admitWorksites')
    .mockRejectedValue(new Error('Route computation unavailable'));
  const request = {
    kind: 'pool' as const,
    command: { commandId: randomUUID(), resource: 'wood' as const, action: 'sites-up' as const },
  };
  try {
    const result = await commandHudWorkforce(db, DEVELOPMENT_IDS.account, 'aube', villageId, request);
    expect(result.hud.extractionPools[0]).toMatchObject({
      siteCount: 2,
      workerCap: 5,
      mobilized: 0,
      pendingTargets: 4,
    });
    expect(admission).not.toHaveBeenCalled();
    const sites = await db
      .selectFrom('extractionWorksites')
      .select(['id', 'wakeVersion'])
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('poolResource', '=', 'wood')
      .where('status', '=', 'running')
      .execute();
    const wakes = await db
      .selectFrom('scheduledTasks')
      .select('payload')
      .where('worldId', '=', worldId)
      .where('taskType', '=', 'deposit.worksite.wake')
      .where('completedAt', 'is', null)
      .execute();
    expect(
      wakes.some((w) => sites.some((s) => w.payload.worksiteId === s.id && w.payload.version === s.wakeVersion)),
    ).toBe(true);
    expect(
      (await commandHudWorkforce(db, DEVELOPMENT_IDS.account, 'aube', villageId, request)).hud.extractionPools[0]!
        .siteCount,
    ).toBe(2);
  } finally {
    admission.mockRestore();
  }
});

it('rolls back an insufficient group meal without carrots, energy, receipts or task changes', async () => {
  await db.transaction().execute(async (tx) => {
    await seed(tx, 25);
    await tx
      .updateTable('villageResources')
      .set({ amount: 24 })
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('resourceCode', '=', 'carrot')
      .execute();
  });
  const rows = () =>
    Promise.all(
      ['population_cohorts', 'village_resources', 'hud_workforce_receipts', 'scheduled_tasks'].map((table) =>
        sql`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as data from ${sql.table(table)} t where world_id=${worldId}`
          .execute(db)
          .then((r) => r.rows),
      ),
    );
  const before = await rows();
  await expect(
    commandHudWorkforce(db, DEVELOPMENT_IDS.account, 'aube', villageId, {
      kind: 'population',
      command: { commandId: randomUUID(), action: 'feed', group: 'idle' },
    }),
  ).rejects.toMatchObject({ code: 'CARROTS_INSUFFICIENT' });
  expect(await rows()).toEqual(before);
});

it('replaces an idle-directed extraction team before its former members can depart again', async () => {
  await db.transaction().execute(async (tx) => {
    const { ctx, targets } = await seed(tx, 15);
    await appendPoolTargets(tx, ctx, 'wood', targets);
    await admitWorksites(tx, ctx, dimensions, route);
    const job = (await active(tx))[0]!;
    const old = await tx
      .selectFrom('populationCohorts')
      .select('id')
      .where('worldId', '=', worldId)
      .where('extractionId', '=', job.id)
      .execute();
    await populationGesture(tx, ctx, { commandId: randomUUID(), action: 'release', destination: 'idle' });
    // A meal must preserve the explicit rotation request.
    await populationGesture(tx, ctx, { commandId: randomUUID(), action: 'feed', group: 'working' });
    await expect(
      changeWorksite(tx, ctx, job.worksiteId!, { commandId: randomUUID(), action: 'stop' }),
    ).rejects.toMatchObject({ code: 'WORKSITE_POOL_MANAGED' });
    await completeStoneExtractionAt(tx, worldId, villageId, job.id, job.completesAt);
    const next = { ...ctx, through: job.completesAt };
    await admitWorksites(tx, next, dimensions, route);
    const replacement = (await active(tx))[0]!;
    expect(replacement.id).not.toBe(job.id);
    expect(replacement.workerCount).toBe(5);
    const former = await tx
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', worldId)
      .where(
        'id',
        'in',
        old.map((c) => c.id),
      )
      .execute();
    expect(former.every((c) => c.extractionId === null && c.activity === 'idle' && c.pendingRelease === null)).toBe(
      true,
    );
  });
});

it('shares stone targets between distinct consumers and keeps an engaged lot when paused', async () => {
  await db.transaction().execute(async (tx) => {
    const { ctx } = await seed(tx);
    const targets: string[] = [];
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      targets.push(id);
      await tx
        .insertInto('worldFeatures')
        .values({ id, worldId, featureTypeCode: 'stone_outcrop', state: 'available', variantSeed: 20261020 })
        .execute();
      await tx
        .insertInto('stoneDeposits')
        .values({
          worldId,
          featureId: id,
          cellX: 1015 - i,
          cellY: 521,
          initialAmount: 300,
          remainingAmount: 300,
          reservedAmount: 0,
          revision: 1,
          updatedAt: ctx.through,
        })
        .execute();
      await tx
        .insertInto('worldCellOccupancies')
        .values({ worldId, featureId: id, cellX: 1015 - i, cellY: 521, buildingId: null, role: 'body' })
        .execute();
    }
    await appendPoolTargets(tx, ctx, 'stone', targets);
    await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'stone', action: 'sites-up' });
    await admitWorksites(tx, ctx, dimensions, route);
    const jobs = await active(tx);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((j) => j.featureId)).size).toBe(2);
    expect(jobs.reduce((n, j) => n + j.workerCount, 0)).toBe(5);
    await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'stone', action: 'sites-down' });
    await changeExtractionPool(tx, ctx, { commandId: randomUUID(), resource: 'stone', action: 'sites-down' });
    expect(await active(tx)).toEqual(jobs);
    expect((await readExtractionPools(tx, worldId, villageId))[1]).toMatchObject({
      siteCount: 0,
      mobilized: 5,
      pendingTargets: 2,
    });
  });
});

it('rotates a workshop at its next lot while preserving its paid deadline', async () => {
  await db.transaction().execute(async (tx) => {
    const { ctx } = await seed(tx, 15);
    const building = await tx
      .insertInto('buildings')
      .values({
        worldId,
        villageId,
        buildingType: 'sawmill',
        level: 1,
        targetLevel: null,
        status: 'completed',
        constructionStartedAt: null,
        constructionCompletesAt: null,
        completedAt: ctx.through,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await commandProcessing(tx, ctx, {
      commandId: randomUUID(),
      action: 'start',
      buildingId: building.id,
      lots: 2,
      workerCount: 1,
    });
    const lot = await tx
      .selectFrom('processingLots')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .executeTakeFirstOrThrow();
    const old = await tx
      .selectFrom('populationCohorts')
      .select('id')
      .where('worldId', '=', worldId)
      .where('processingLotId', '=', lot.id)
      .executeTakeFirstOrThrow();
    expect(
      await populationGesture(tx, ctx, { commandId: randomUUID(), action: 'release', destination: 'idle' }),
    ).toMatchObject({ affected: 1 });
    expect(
      (await tx.selectFrom('processingLots').selectAll().where('id', '=', lot.id).executeTakeFirstOrThrow())
        .completesAt,
    ).toEqual(lot.completesAt);
    await completeProcessingAt(tx, { ...ctx, through: lot.completesAt }, lot.id, lot.completesAt);
    const former = await tx
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('id', '=', old.id)
      .executeTakeFirstOrThrow();
    expect(former.processingLotId).toBeNull();
    expect(former.activity).toBe('idle');
    const next = await tx
      .selectFrom('processingLots')
      .selectAll()
      .where('orderId', '=', lot.orderId)
      .where('lotNumber', '=', 2)
      .executeTakeFirstOrThrow();
    expect(next.completedAt).toBeNull();
    expect(
      await tx
        .selectFrom('populationCohorts')
        .select('id')
        .where('worldId', '=', worldId)
        .where('processingLotId', '=', next.id)
        .execute(),
    ).toHaveLength(1);
  });
});

it('honors a research release at its boundary and starts a fresh team', async () => {
  await db.transaction().execute(async (tx) => {
    const { ctx } = await seed(tx, 15);
    const campus = await tx
      .insertInto('buildings')
      .values({
        worldId,
        villageId,
        buildingType: 'university',
        level: 1,
        targetLevel: null,
        status: 'completed',
        constructionStartedAt: null,
        constructionCompletesAt: null,
        completedAt: ctx.through,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await scienceCommand(tx, ctx, {
      action: 'research',
      buildingId: campus.id,
      programCode: 'mathematics-1',
      workerCount: 5,
    });
    await admitScience(tx, ctx);
    const batch = await tx
      .selectFrom('scienceActivities')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('status', '=', 'in-progress')
      .executeTakeFirstOrThrow();
    const old = await tx
      .selectFrom('populationCohorts')
      .select('id')
      .where('worldId', '=', worldId)
      .where('scienceActivityId', '=', batch.id)
      .execute();
    await populationGesture(tx, ctx, { commandId: randomUUID(), action: 'release', destination: 'idle' });
    const next = { ...ctx, through: batch.completesAt };
    await reconcileVillageEconomy(tx, next);
    await admitScience(tx, next);
    const former = await tx
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', worldId)
      .where(
        'id',
        'in',
        old.map((c) => c.id),
      )
      .execute();
    expect(former.every((c) => c.scienceActivityId === null && c.activity === 'idle')).toBe(true);
    const replacement = await tx
      .selectFrom('scienceActivities')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('status', '=', 'in-progress')
      .executeTakeFirstOrThrow();
    expect(replacement.id).not.toBe(batch.id);
    expect(replacement.workerCount).toBe(5);
  });
});

it('adopts only running automatic sites and bounds future crews without rewriting engaged work', async () => {
  const rollback = new Error('rollback isolated HUD migration'),
    schema = `hud_migration_${randomUUID().replaceAll('-', '')}`;
  await expect(
    db.transaction().execute(async (tx) => {
      await sql`create schema ${sql.id(schema)}`.execute(tx);
      await sql`set local search_path to ${sql.id(schema)},public`.execute(tx);
      await sql`create table villages(world_id uuid,id uuid,primary key(world_id,id));
      create table population_cohorts(id uuid primary key);
      create table extraction_worksites(id integer,world_id uuid,village_id uuid,resource_code text,mode text,status text,worker_cap integer,exploitation_order_id uuid);
      create table harvest_intents(world_id uuid,village_id uuid,order_id uuid);
      create table deposit_extractions(worker_count integer,completes_at timestamptz,reserved_amount bigint);
      insert into deposit_extractions values(50,'2026-10-21T10:00:00Z',100);
    `.execute(tx);
      await sql`insert into villages values(${worldId},${villageId})`.execute(tx);
      await sql`insert into harvest_intents values(${worldId},${villageId},${villageId})`.execute(tx);
      await sql`insert into extraction_worksites values
        (1,${worldId},${villageId},'wood','cut','running',50,${villageId}),
        (2,${worldId},${villageId},'wood','cut','paused',7,${villageId}),
        (3,${worldId},${villageId},'stone','extract','running',3,null)
    `.execute(tx);
      const engaged = await sql`select * from deposit_extractions`.execute(tx);
      await migrateHud(tx as unknown as Kysely<unknown>);
      expect((await sql`select resource_code,site_count,worker_cap from extraction_pools`.execute(tx)).rows).toEqual([
        { resourceCode: 'wood', siteCount: 1, workerCap: 10 },
      ]);
      expect(
        (await sql`select id,pool_resource,worker_cap from extraction_worksites order by id`.execute(tx)).rows,
      ).toEqual([
        { id: 1, poolResource: 'wood', workerCap: 10 },
        { id: 2, poolResource: null, workerCap: 7 },
        { id: 3, poolResource: null, workerCap: 3 },
      ]);
      expect((await sql`select * from deposit_extractions`.execute(tx)).rows).toEqual(engaged.rows);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
