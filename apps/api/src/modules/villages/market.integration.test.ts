import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { MarketCommand } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import type { Database } from '../../database/schema.js';
import { commandMarket, previewMarket, marketSnapshot, COMPLETE_MARKET_TASK } from './market.js';
import { reconcileVillageEconomy } from './reconcile-economy.js';
import { getVillageState, upgradeBuilding, commandVillageMarket } from './service.js';
import { processNextScheduledTask } from '../../jobs/scheduled-tasks.js';
import { deliverMarket } from './complete-construction.js';

const url = testDatabaseUrl(), db = createDatabase(url), t0 = new Date('2026-10-01T10:00:00Z');
const ctx = (ms = 0) => ({ worldId: ids.world, villageId: ids.village, through: new Date(t0.getTime() + ms) });
beforeAll(() => migrateToLatest(url));
beforeEach(() => resetE2eState(url));
afterAll(() => db.destroy());
async function locked<T>(action: (tx: Transaction<Database>) => Promise<T>) {
  return db.transaction().execute(async tx => {
    await tx.selectFrom('villages').select('id').where('worldId', '=', ids.world).where('id', '=', ids.village).forUpdate().executeTakeFirstOrThrow();
    return action(tx);
  });
}
async function open() { await db.updateTable('buildings').set({ level: 2 }).where('worldId', '=', ids.world).where('id', '=', ids.townHall).execute(); }
async function amount(code: string) { return Number((await db.selectFrom('villageResources').select('amount').where('worldId', '=', ids.world).where('villageId', '=', ids.village).where('resourceCode', '=', code).executeTakeFirstOrThrow()).amount); }
const request = () => ({ commandId: randomUUID(), offeredResource: 'wood', requestedResource: 'stone', amount: 100, expectedReceivedAmount: 70 });
it('preserves town-hall housing throughout its paid ten-minute upgrade', async () => {
  const availableBefore=(await getVillageState(db,ids.account,'aube')).cells.filter(c=>c.canBuild).map(c=>c.id).sort();
  expect(availableBefore.length).toBeGreaterThan(0);
  await db.updateTable('villageResources').set({ amount: 500 }).where('villageId', '=', ids.village).where('resourceCode', '=', 'timber').execute();
  await db.updateTable('villageResources').set({ amount: 120 }).where('villageId', '=', ids.village).where('resourceCode', '=', 'cut-stone').execute();
  const state = await upgradeBuilding(db, ids.account, 'aube', ids.village, ids.townHall, undefined, undefined, null, randomUUID(),
    [{ resourceCode: 'timber', amount: 500 }, { resourceCode: 'cut-stone', amount: 120 }], 2);
  expect(state.village.population.housingCapacity).toBe(30);
  expect(state.cells.filter(c=>c.canBuild).map(c=>c.id).sort()).toEqual(availableBefore);
  expect(state.village.market?.unlocked).toBe(false);
  expect(await amount('timber')).toBe(0); expect(await amount('cut-stone')).toBe(0);
  const hall = await db.selectFrom('buildings').selectAll().where('id', '=', ids.townHall).executeTakeFirstOrThrow();
  expect(hall.level).toBe(1); expect(hall.targetLevel).toBe(2);
  expect(hall.constructionCompletesAt!.getTime() - hall.constructionStartedAt!.getTime()).toBe(600000);
  await locked(tx => reconcileVillageEconomy(tx, { ...ctx(), through: hall.constructionCompletesAt! }));
  expect((await getVillageState(db, ids.account, 'aube')).village.market?.unlocked).toBe(true);
});
it('rejects locked market, same or unknown resources, zero results and insufficient stock', async () => {
  expect((await locked(tx => previewMarket(tx, ctx(), request()))).valid).toBe(false);
  await expect(locked(tx => commandMarket(tx, ctx(), request()))).rejects.toMatchObject({ code: 'MARKET_UNAVAILABLE' });
  await open();
  for (const overrides of [{ requestedResource: 'wood' }, { requestedResource: 'rings' }, { offeredResource: 'unknown' }, { amount: 1 }, { amount: 2001 }])
    expect((await locked(tx => previewMarket(tx, ctx(), { ...request(), ...overrides }))).valid).toBe(false);
  expect(await amount('wood')).toBe(2000);
  expect(await db.selectFrom('marketExchanges').selectAll().execute()).toHaveLength(0);
});
it('debits once, delivers only at ten minutes and replays without touching notifications', async () => {
  await open(); const command = request(); await locked(tx => commandMarket(tx, ctx(), command));
  expect(await amount('wood')).toBe(1900); expect(await amount('stone')).toBe(0);
  await locked(tx => reconcileVillageEconomy(tx, ctx(599999))); expect(await amount('stone')).toBe(0);
  await locked(tx => reconcileVillageEconomy(tx, ctx(600000))); expect(await amount('stone')).toBe(70);
  await locked(tx => reconcileVillageEconomy(tx, ctx(600000))); await locked(tx => commandMarket(tx, ctx(600000), command));
  expect(await amount('wood')).toBe(1900); expect(await amount('stone')).toBe(70);
  const tasks = await db.selectFrom('scheduledTasks').selectAll().where('taskType', '=', COMPLETE_MARKET_TASK).execute();
  expect(tasks).toHaveLength(1); expect(tasks[0]!.completedAt).toBeNull();
  await expect(locked(tx => commandMarket(tx, ctx(), { ...command, amount: 200 }))).rejects.toMatchObject({ code: 'COMMAND_REUSED' });
});
it('exchanges carrots both ways and credits a newly catalogued resource without bespoke code', async () => {
  await open(); const carrot: MarketCommand = { ...request(), offeredResource: 'carrot', amount: 40, expectedReceivedAmount: 7 };
  await locked(tx => commandMarket(tx, ctx(), carrot));
  expect(await amount('carrot')).toBe(10);
  await locked(tx => commandMarket(tx, ctx(), { ...request(), requestedResource: 'carrot', amount: 10, expectedReceivedAmount: 28 }));
  await db.insertInto('resourceTypes').values({ code: 'test-fruit', displayName: 'Fruit test', iconKey: 'test-fruit' }).execute();
  try {
    await db.insertInto('oracleMarketResources').values({ resourceCode: 'test-fruit', valueUnits: 2 }).execute();
    await locked(tx => commandMarket(tx, ctx(), { ...request(), requestedResource: 'test-fruit', amount: 10, expectedReceivedAmount: 14 }));
    await locked(tx => reconcileVillageEconomy(tx, ctx(600000)));
    expect(await amount('carrot')).toBe(38); expect(await amount('stone')).toBe(7); expect(await amount('test-fruit')).toBe(14);
    expect((await locked(tx => marketSnapshot(tx, ctx()))).resources.some(r => r.code === 'test-fruit')).toBe(true);
  } finally {
    await db.deleteFrom('marketExchanges').where('requestedResource', '=', 'test-fruit').execute();
    await db.deleteFrom('villageResources').where('resourceCode', '=', 'test-fruit').execute();
    await db.deleteFrom('oracleMarketResources').where('resourceCode', '=', 'test-fruit').execute();
    await db.deleteFrom('resourceTypes').where('code', '=', 'test-fruit').execute();
  }
});
it('rejects changed quotes and rolls back demonstrated debit, exchange and notification', async () => {
  await open();
  await expect(locked(tx => commandMarket(tx, ctx(), { ...request(), expectedReceivedAmount: 71 }))).rejects.toMatchObject({ code: 'MARKET_QUOTE_CHANGED' });
  const injected = new Error('injected-after-market-admission');
  await expect(locked(async tx => {
    await commandMarket(tx, ctx(), request());
    expect(Number((await tx.selectFrom('villageResources').select('amount').where('villageId', '=', ids.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow()).amount)).toBe(1900);
    expect(await tx.selectFrom('marketExchanges').selectAll().execute()).toHaveLength(1);
    expect(await tx.selectFrom('scheduledTasks').selectAll().where('taskType', '=', COMPLETE_MARKET_TASK).execute()).toHaveLength(1);
    throw injected;
  })).rejects.toBe(injected);
  expect(await amount('wood')).toBe(2000);
  expect(await db.selectFrom('marketExchanges').selectAll().execute()).toHaveLength(0);
  expect(await db.selectFrom('scheduledTasks').selectAll().where('taskType', '=', COMPLETE_MARKET_TASK).execute()).toHaveLength(0);
});
it('worker delivery is authoritative even for an old notification and only acknowledges its own task', async () => {
  await open(); await locked(tx => commandMarket(tx, ctx(), request()));
  await locked(tx => commandMarket(tx, ctx(), request()));
  expect(await processNextScheduledTask(db, { [COMPLETE_MARKET_TASK]: deliverMarket })).toMatchObject({outcome:'completed'});
  expect(await amount('stone')).toBe(140);
  const tasks = await db.selectFrom('scheduledTasks').selectAll().where('taskType', '=', COMPLETE_MARKET_TASK).execute();
  expect(tasks.filter(t => t.completedAt)).toHaveLength(1);
  await processNextScheduledTask(db, { [COMPLETE_MARKET_TASK]: deliverMarket });
  expect(await amount('stone')).toBe(140);
});
it('checks ownership and world before admitting trades', async () => {
  await open();
  await expect(commandVillageMarket(db, randomUUID(), 'aube', ids.village, request())).rejects.toMatchObject({ statusCode: 404 });
  await expect(commandVillageMarket(db, ids.account, 'missing-world', ids.village, request())).rejects.toMatchObject({ statusCode: 404 });
  expect(await db.selectFrom('marketExchanges').selectAll().execute()).toHaveLength(0);
});
it('serializes two competing debits while a village lock is held', async () => {
  await open(); await db.updateTable('villageResources').set({ amount: 100 }).where('villageId', '=', ids.village).where('resourceCode', '=', 'wood').execute();
  let release!: () => void, acquired!: () => void;
  const barrier = new Promise<void>(resolve => { acquired = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const holder = locked(async () => { acquired(); await gate; }); await barrier;
  const a = commandVillageMarket(db, ids.account, 'aube', ids.village, request());
  const b = commandVillageMarket(db, ids.account, 'aube', ids.village, request());
  const results = Promise.allSettled([a, b]);
  const timeout=setTimeout(release,8000);
  try {
    let waiting = false;
    for (let n = 0; n < 100; n++) {
      const locks = await sql<{ count: string }>`select count(*)::text as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%"villages"%'`.execute(db);
      if (Number(locks.rows[0]!.count) >= 2) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
  } finally { release(); clearTimeout(timeout); await holder; await results; }
  const settled = await results;
  expect(settled.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(settled.filter(r => r.status === 'rejected')).toHaveLength(1);
  const rejected=settled.find(r=>r.status==='rejected');
  if(rejected?.status==='rejected')expect(rejected.reason).toMatchObject({code:'MARKET_UNAVAILABLE'});
  expect(await amount('wood')).toBe(0);
  expect(await db.selectFrom('marketExchanges').selectAll().execute()).toHaveLength(1);
});
