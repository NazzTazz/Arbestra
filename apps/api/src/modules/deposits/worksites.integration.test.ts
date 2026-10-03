import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Database } from '../../database/schema.js';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS } from '../../database/seed.js';
import { completeStoneExtractionAt } from './stone-extractions.js';
import { materializeWoodland } from './woodland.js';
import { admitWorksites, changeWorksite, createWorksite } from './worksites.js';
import { previewVillageWorksite, startVillageWorksite } from '../villages/service.js';
import { wakeExtractionWorksite } from '../villages/complete-construction.js';
import { buildApp } from '../../app.js';

const url = testDatabaseUrl(), db = createDatabase(url);
const worldId = DEVELOPMENT_IDS.world, villageId = DEVELOPMENT_IDS.village;
const abort = new Error('worksite fixture rollback');
beforeAll(async () => { await migrateToLatest(url); await resetE2eState(url); });
afterAll(() => db.destroy());

async function fixture(run: (tx: Transaction<Database>, featureId: string, t: Date) => Promise<void>) {
  try {
    await db.transaction().execute(async tx => {
      await tx.selectFrom('villages').select('id').where('worldId', '=', worldId).where('id', '=', villageId)
        .forUpdate().executeTakeFirstOrThrow();
      const t = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
      const featureId = randomUUID();
      await tx.insertInto('worldFeatures').values({ id: featureId, worldId, featureTypeCode: 'woodland',
        state: 'available', variantSeed: 1 }).execute();
      await tx.insertInto('woodlandDeposits').values({ worldId, featureId, cellX: 1023, cellY: 514,
        initialAmount: 300, remainingAmount: 300, reservedAmount: 0, revision: 1,
        updatedAt: t, regrowthUpdatedAt: t }).execute();
      await tx.insertInto('worldCellOccupancies').values({ worldId, featureId, cellX: 1023, cellY: 514,
        buildingId: null, role: 'body' }).execute();
      await tx.insertInto('populationCohorts').values({ worldId, villageId, originVillageId: villageId,
        memberCount: 10, activity: 'idle', energy: 10, energyProgress: 0, energyUpdatedAt: t,
        restingSince: null, foodUsedSinceRest: 0, harvestId: null, extractionId: null }).execute();
      await run(tx, featureId, t);
      throw abort;
    });
  } catch (error) { if (error !== abort) throw error; }
}

const village = { widthCells: 2048, heightCells: 1024 };
const path = async () => [{ cellX: 1024, cellY: 512 }, { cellX: 1024, cellY: 513 }, { cellX: 1023, cellY: 514 }];
const current = (tx: Transaction<Database>, worksiteId: string) => tx.selectFrom('depositExtractions').selectAll()
  .where('worksiteId', '=', worksiteId).where('status', '=', 'in-progress').executeTakeFirst();

it('keeps sending proportional lots and delivers until the renewable cutting threshold', async () => {
  await fixture(async (tx, featureId, t) => {
    const economy = { worldId, villageId, through: t };
    const worksiteId = await createWorksite(tx, economy, { commandId: randomUUID(), mode: 'cut',
      workerCap: 2, featureIds: [featureId] });
    await admitWorksites(tx, economy, village, path);
    for (let i = 0; i < 3; i++) {
      const lot = await current(tx, worksiteId);
      expect(lot).toBeDefined();
      await completeStoneExtractionAt(tx, worldId, villageId, lot!.id, lot!.completesAt);
      await admitWorksites(tx, { ...economy, through: lot!.completesAt }, village, path);
    }
    expect(await current(tx, worksiteId)).toBeUndefined();
    const site = await tx.selectFrom('extractionWorksites').selectAll().where('id', '=', worksiteId).executeTakeFirstOrThrow();
    expect(site.status).toBe('completed');
    expect(Number(site.deliveredAmount)).toBe(300);
    const wood = await tx.selectFrom('woodlandDeposits').selectAll().where('featureId', '=', featureId).executeTakeFirstOrThrow();
    expect(wood.cleared).toBe(false);
    expect(Number(wood.remainingAmount)).toBeLessThanOrEqual(30);
  });
});

it('honors a pause before relaunch while delivering its committed lot', async () => {
  await fixture(async (tx, featureId, t) => {
    const economy = { worldId, villageId, through: t };
    const id = await createWorksite(tx, economy, { commandId: randomUUID(), mode: 'cut', workerCap: 2, featureIds: [featureId] });
    await admitWorksites(tx, economy, village, path);
    const first = await current(tx, id);
    expect(first).toBeDefined();
    await changeWorksite(tx, economy, id, { commandId: randomUUID(), action: 'pause' });
    await completeStoneExtractionAt(tx, worldId, villageId, first!.id, first!.completesAt);
    await admitWorksites(tx, { ...economy, through: first!.completesAt }, village, path);
    expect(await current(tx, id)).toBeUndefined();
    expect((await tx.selectFrom('extractionWorksites').select(['status', 'deliveredAmount']).where('id', '=', id).executeTakeFirstOrThrow()))
      .toMatchObject({ status: 'paused', deliveredAmount: '100' });
  });
});

it('finishes the clearing committed by the final returning lot, even after stop', async () => {
  await fixture(async (tx, featureId, t) => {
    await tx.updateTable('woodlandDeposits').set({ remainingAmount: 120 }).where('featureId', '=', featureId).execute();
    const economy = { worldId, villageId, through: t };
    const id = await createWorksite(tx, economy, { commandId: randomUUID(), mode: 'clear', workerCap: 2, featureIds: [featureId] });
    await admitWorksites(tx, economy, village, path);
    const lot = await current(tx, id);
    await changeWorksite(tx, economy, id, { commandId: randomUUID(), action: 'stop' });
    await completeStoneExtractionAt(tx, worldId, villageId, lot!.id, lot!.completesAt);
    await admitWorksites(tx, { ...economy, through: lot!.completesAt }, village, path);
    const wood = await tx.selectFrom('woodlandDeposits').select('cleared').where('featureId', '=', featureId).executeTakeFirstOrThrow();
    expect(wood.cleared).toBe(true);
    expect((await tx.selectFrom('extractionWorksites').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status)
      .toBe('stopped');
  });
});

it('remembers a cutting threshold crossed at return even after regrowth before a late worker', async () => {
  await fixture(async (tx, featureId, t) => {
    await tx.updateTable('woodlandDeposits').set({ remainingAmount: 120 }).where('featureId', '=', featureId).execute();
    const economy = { worldId, villageId, through: t };
    const id = await createWorksite(tx, economy, { commandId: randomUUID(), mode: 'cut', workerCap: 2, featureIds: [featureId] });
    await admitWorksites(tx, economy, village, path);
    const lot = (await current(tx, id))!;
    const late = new Date(lot.completesAt.getTime() + 15 * 86400_000);
    await materializeWoodland(tx, worldId, featureId, late);
    const stock = await tx.selectFrom('woodlandDeposits').select('remainingAmount').where('featureId', '=', featureId).executeTakeFirstOrThrow();
    expect(Number(stock.remainingAmount)).toBeGreaterThan(30);
    const target = await tx.selectFrom('extractionWorksiteTargets').select('thresholdReachedAt')
      .where('worksiteId', '=', id).where('featureId', '=', featureId).executeTakeFirstOrThrow();
    expect(target.thresholdReachedAt).toEqual(lot.completesAt);
    await completeStoneExtractionAt(tx, worldId, villageId, lot.id, lot.completesAt);
    await admitWorksites(tx, { ...economy, through: late }, village, path);
    expect((await tx.selectFrom('extractionWorksites').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status)
      .toBe('completed');
    expect(await current(tx, id)).toBeUndefined();
  });
});

it('previews exclusions and starts only valid targets with an idempotent command', async () => {
  await fixture(async (tx, featureId, t) => {
    const source = { transaction: () => ({ execute: <T>(run: (transaction: Transaction<Database>) => Promise<T>) => run(tx) }) } as unknown as typeof db;
    const missing = randomUUID();
    const order = { commandId: randomUUID(), mode: 'cut' as const, workerCap: 2, featureIds: [featureId, missing] };
    const preview = await previewVillageWorksite(source, DEVELOPMENT_IDS.account, 'aube', villageId, order);
    expect(preview.included.map(item => item.featureId)).toEqual([featureId]);
    expect(preview.excluded).toEqual([{ featureId: missing, reason: 'not-found' }]);
    const first = await startVillageWorksite(source, DEVELOPMENT_IDS.account, 'aube', villageId, order);
    expect(first.worksite.targets.map(target => target.featureId)).toEqual([featureId]);
    expect(first.worksite.activeExtraction?.workerCount).toBe(2);
    await changeWorksite(tx, { worldId, villageId, through: t }, first.worksite.id,
      { commandId: randomUUID(), action: 'set-cap', workerCap: 3 });
    const repeat = await startVillageWorksite(source, DEVELOPMENT_IDS.account, 'aube', villageId, order);
    expect(repeat.worksite.id).toBe(first.worksite.id);
    expect(repeat.worksite.workerCap).toBe(3);
  });
});

it('finishes a stone deposit with a shorter final lot and no extra reservation', async () => {
  await fixture(async (tx, _woodId, t) => {
    const featureId = randomUUID();
    await tx.insertInto('worldFeatures').values({ id: featureId, worldId, featureTypeCode: 'stone_outcrop',
      state: 'available', variantSeed: 2 }).execute();
    await tx.insertInto('stoneDeposits').values({ worldId, featureId, cellX: 1025, cellY: 514,
      initialAmount: 150, remainingAmount: 150, reservedAmount: 0, revision: 1, updatedAt: t }).execute();
    await tx.insertInto('worldCellOccupancies').values({ worldId, featureId, cellX: 1025, cellY: 514,
      buildingId: null, role: 'body' }).execute();
    const economy = { worldId, villageId, through: t };
    const id = await createWorksite(tx, economy, { commandId: randomUUID(), mode: 'extract', workerCap: 2,
      featureIds: [featureId] });
    await admitWorksites(tx, economy, village, path);
    const first = (await current(tx, id))!;
    expect(Number(first.reservedAmount)).toBe(100);
    await completeStoneExtractionAt(tx, worldId, villageId, first.id, first.completesAt);
    await admitWorksites(tx, { ...economy, through: first.completesAt }, village, path);
    const second = (await current(tx, id))!;
    expect(Number(second.reservedAmount)).toBe(50);
    expect(second.completesAt.getTime() - second.startedAt.getTime()).toBe(150_000 + 2 * second.transportMs);
    await completeStoneExtractionAt(tx, worldId, villageId, second.id, second.completesAt);
    await admitWorksites(tx, { ...economy, through: second.completesAt }, village, path);
    expect(await current(tx, id)).toBeUndefined();
    expect((await tx.selectFrom('extractionWorksites').select(['status', 'deliveredAmount'])
      .where('id', '=', id).executeTakeFirstOrThrow())).toMatchObject({ status: 'completed', deliveredAmount: '150' });
  });
});

it('wakes a waiting site on a durable task without a browser and ignores an obsolete wake', async () => {
  await fixture(async (tx, featureId, t) => {
    await tx.updateTable('populationCohorts').set({ activity: 'resting', energy: 0,
      energyProgress: 0, restingSince: t }).where('worldId', '=', worldId).where('villageId', '=', villageId).execute();
    const economy = { worldId, villageId, through: t };
    const id = await createWorksite(tx, economy, { commandId: randomUUID(), mode: 'cut', workerCap: 2,
      featureIds: [featureId] });
    await admitWorksites(tx, economy, village, path);
    const obsolete = await tx.selectFrom('scheduledTasks').selectAll().where('taskType', '=', 'deposit.worksite.wake')
      .orderBy('createdAt', 'desc').executeTakeFirstOrThrow();
    expect((await tx.selectFrom('extractionWorksites').select('waitReason').where('id', '=', id).executeTakeFirstOrThrow()).waitReason)
      .toBe('workers-resting');
    await changeWorksite(tx, economy, id, { commandId: randomUUID(), action: 'pause' });
    await wakeExtractionWorksite(tx, obsolete);
    expect(await current(tx, id)).toBeUndefined();
    await changeWorksite(tx, economy, id, { commandId: randomUUID(), action: 'resume' });
    await admitWorksites(tx, economy, village, path);
    const wake = await tx.selectFrom('scheduledTasks').selectAll().where('taskType', '=', 'deposit.worksite.wake')
      .where('id', '!=', obsolete.id).orderBy('createdAt', 'desc').executeTakeFirstOrThrow();
    await tx.updateTable('populationCohorts').set({ activity: 'idle', energy: 10,
      energyProgress: 0, restingSince: null,restBuildingId:null }).where('worldId', '=', worldId).where('villageId', '=', villageId).execute();
    await wakeExtractionWorksite(tx, wake);
    expect(await current(tx, id)).toBeDefined();
  });
});

it('rests only the returning exhausted team and sends an available relief team', async () => {
  await fixture(async (tx, featureId, t) => {
    const firstCohort = await tx.selectFrom('populationCohorts').select('id').where('worldId', '=', worldId)
      .where('villageId', '=', villageId).orderBy('id').executeTakeFirstOrThrow();
    await tx.updateTable('populationCohorts').set({ memberCount: 1, energy: 0, energyProgress: 20_000_000 })
      .where('id', '=', firstCohort.id).execute();
    const reliefId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await tx.insertInto('populationCohorts').values({ id: reliefId, worldId, villageId, originVillageId: villageId,
      memberCount: 1, activity: 'idle', energy: 10, energyProgress: 0, energyUpdatedAt: t,
      restingSince: null, foodUsedSinceRest: 0, harvestId: null, extractionId: null }).execute();
    const economy = { worldId, villageId, through: t };
    const id = await createWorksite(tx, economy, { commandId: randomUUID(), mode: 'cut', workerCap: 1,
      featureIds: [featureId] });
    await admitWorksites(tx, economy, village, path);
    const first = (await current(tx, id))!;
    expect((await tx.selectFrom('populationCohorts').select('extractionId').where('id', '=', firstCohort.id).executeTakeFirstOrThrow()).extractionId)
      .toBe(first.id);
    await completeStoneExtractionAt(tx, worldId, villageId, first.id, first.completesAt);
    expect((await tx.selectFrom('populationCohorts').select('activity').where('id', '=', firstCohort.id).executeTakeFirstOrThrow()).activity)
      .toBe('resting');
    expect((await tx.selectFrom('populationCohorts').select('activity').where('id', '=', reliefId).executeTakeFirstOrThrow()).activity)
      .toBe('idle');
    await admitWorksites(tx, { ...economy, through: first.completesAt }, village, path);
    const second = (await current(tx, id))!;
    const relief = await tx.selectFrom('populationCohorts').select('id').where('worldId', '=', worldId)
      .where('villageId', '=', villageId).where('extractionId', '=', second.id).execute();
    expect(relief.length).toBeGreaterThan(0);
    expect(relief.every(cohort => cohort.id !== firstCohort.id)).toBe(true);
  });
});

it('concentrates a woodland crew on the nearest bosquet before starting the next', async () => {
  await fixture(async (tx, nearId, t) => {
    const farId = randomUUID();
    await tx.insertInto('worldFeatures').values({ id: farId, worldId, featureTypeCode: 'woodland',
      state: 'available', variantSeed: 3 }).execute();
    await tx.insertInto('woodlandDeposits').values({ worldId, featureId: farId, cellX: 1026, cellY: 514,
      initialAmount: 300, remainingAmount: 300, reservedAmount: 0, revision: 1,
      updatedAt: t, regrowthUpdatedAt: t }).execute();
    await tx.insertInto('worldCellOccupancies').values({ worldId, featureId: farId, cellX: 1026, cellY: 514,
      buildingId: null, role: 'body' }).execute();
    const economy = { worldId, villageId, through: t };
    const id = await createWorksite(tx, economy, { commandId: randomUUID(), mode: 'cut', workerCap: 2,
      featureIds: [farId, nearId] });
    const route = async (featureId: string) => featureId === nearId ? path()
      : [...await path(), { cellX: 1025, cellY: 514 }, { cellX: 1026, cellY: 514 }];
    await admitWorksites(tx, economy, village, route);
    for (let i = 0; i < 3; i++) {
      const lot = (await current(tx, id))!;
      expect(lot.featureId).toBe(nearId);
      await completeStoneExtractionAt(tx, worldId, villageId, lot.id, lot.completesAt);
      await admitWorksites(tx, { ...economy, through: lot.completesAt }, village, route);
    }
    expect((await current(tx, id))?.featureId).toBe(farId);
  });
});

it('serves the authenticated preview and worksite commands through the JSON contract', async () => {
  const featureId = randomUUID();
  const t = new Date();
  await db.insertInto('worldFeatures').values({ id: featureId, worldId, featureTypeCode: 'woodland',
    state: 'available', variantSeed: 4 }).execute();
  await db.insertInto('woodlandDeposits').values({ worldId, featureId, cellX: 1023, cellY: 514,
    initialAmount: 300, remainingAmount: 300, reservedAmount: 0, revision: 1,
    updatedAt: t, regrowthUpdatedAt: t }).execute();
  await db.insertInto('worldCellOccupancies').values({ worldId, featureId, cellX: 1023, cellY: 514,
    buildingId: null, role: 'body' }).execute();
  const app = await buildApp({ databaseUrl: url, host: '127.0.0.1', port: 0, isProduction: false,
    cookieName: 'test_session', sessionTtlDays: 1, constructionDurationOverrideMs: 0,
    scheduledTaskPollIntervalMs: 250 }, db);
  try {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login',
      payload: { email: 'player@arbestra.local', password: 'arbestra' } });
    expect(login.statusCode).toBe(200);
    const cookies = { test_session: login.cookies[0]!.value };
    const base = `/api/worlds/aube/villages/${villageId}/worksites`;
    const order = { commandId: randomUUID(), mode: 'cut', workerCap: 2, featureIds: [featureId] };
    const preview = await app.inject({ method: 'POST', url: `${base}/preview`, cookies, payload: order });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().included.map((target: { featureId: string }) => target.featureId)).toEqual([featureId]);
    const started = await app.inject({ method: 'POST', url: base, cookies, payload: order });
    expect(started.statusCode, started.body).toBe(200);
    const siteId = started.json().worksite.id as string;
    expect(started.json().villageState.village.worksites[0].id).toBe(siteId);
    const paused = await app.inject({ method: 'POST', url: `${base}/${siteId}`, cookies,
      payload: { commandId: randomUUID(), action: 'pause' } });
    expect(paused.statusCode, paused.body).toBe(200);
    expect(paused.json().worksite.status).toBe('paused');
  } finally {
    await app.close();
    await resetE2eState(url);
    await db.transaction().execute(async tx => {
      await tx.deleteFrom('worldCellOccupancies').where('worldId', '=', worldId).where('featureId', '=', featureId).execute();
      await tx.deleteFrom('woodlandDeposits').where('worldId', '=', worldId).where('featureId', '=', featureId).execute();
      await tx.deleteFrom('worldFeatures').where('worldId', '=', worldId).where('id', '=', featureId).execute();
    });
  }
}, 40000);
