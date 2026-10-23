import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { marketWorkers, oracleCost, type TradeCommand } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { DEVELOPMENT_IDS as seedIds } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import type { Database } from '../../database/schema.js';
import { publishTrade, TRADE_WAKE_TASK } from './trade-economy.js';
import { acceptTrade, beginTradePair, commandPlayerMarket, browsePlayerMarket } from './trade-service.js';
import { reconcileVillageEconomy } from './reconcile-economy.js';
import { navigationRevision } from '../navigation/context.js';
import { NavigationCompute } from '../navigation/compute.js';
import { prepareTrade } from './trade-service.js';
import { processNextScheduledTask } from '../../jobs/scheduled-tasks.js';
import { wakeTrade } from './complete-construction.js';
import { assertNoInfrastructure } from './infrastructure.js';
import { beginVillageEconomy } from './reconcile-economy.js';
import { spawnSpatialState } from '../onboarding/spawn-state.js';

const url = testDatabaseUrl(),
  db = createDatabase(url);
const ids = { account: seedIds.account, world: '', village: '', townHall: '' };
let visitor = '',
  account = '',
  hall = '',
  slug = '';
beforeAll(() => migrateToLatest(url), 60000);
beforeEach(async () => {
  Object.assign(ids, { world: randomUUID(), village: randomUUID(), townHall: randomUUID() });
  slug = `trade-test-${ids.world}`;
  await db
    .insertInto('worlds')
    .values({
      id: ids.world,
      slug,
      name: 'Recette marché',
      topology: 'torus',
      widthCells: 64,
      heightCells: 64,
      chunkSize: 32,
      seed: 1,
      generationVersion: 1,
      generationStatus: 'ready',
      generatedAt: new Date(),
      isOpen: false,
    })
    .execute();
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++)
      await db
        .insertInto('worldChunks')
        .values({
          worldId: ids.world,
          chunkX: x,
          chunkY: y,
          generationVersion: 1,
          terrainCodes: Array(1024).fill(1),
          elevations: Array(1024).fill(1),
        })
        .execute();
  await db
    .insertInto('worldMemberships')
    .values({ worldId: ids.world, accountId: ids.account, playerName: 'Auteur' })
    .execute();
  await db
    .insertInto('villages')
    .values({
      id: ids.village,
      worldId: ids.world,
      ownerAccountId: ids.account,
      name: 'Comptoir',
      anchorCellX: 32,
      anchorCellY: 32,
    })
    .execute();
  await db
    .insertInto('buildings')
    .values({
      id: ids.townHall,
      worldId: ids.world,
      villageId: ids.village,
      buildingType: 'town-hall',
      level: 2,
      status: 'completed',
      completedAt: new Date(),
      constructionStartedAt: null,
      constructionCompletesAt: null,
    })
    .execute();
  await db
    .insertInto('worldCellOccupancies')
    .values({ worldId: ids.world, cellX: 31, cellY: 32, buildingId: ids.townHall, featureId: null, role: 'anchor' })
    .execute();
  await db
    .insertInto('villageResources')
    .values([
      { worldId: ids.world, villageId: ids.village, resourceCode: 'wood', amount: 2000 },
      { worldId: ids.world, villageId: ids.village, resourceCode: 'stone', amount: 0 },
      { worldId: ids.world, villageId: ids.village, resourceCode: 'carrot', amount: 50 },
    ])
    .execute();
  await db
    .insertInto('villageResourceFlows')
    .values({
      worldId: ids.world,
      villageId: ids.village,
      resourceCode: 'wood',
      baseRatePerHour: 0,
      remainder: 0,
      productionUpdatedAt: new Date(),
    })
    .execute();
  await db
    .insertInto('populationCohorts')
    .values({
      worldId: ids.world,
      villageId: ids.village,
      originVillageId: ids.village,
      memberCount: 15,
      activity: 'idle',
      energy: 10,
      energyProgress: 0,
      energyUpdatedAt: new Date(),
      restingSince: null,
      foodUsedSinceRest: 0,
      harvestId: null,
      extractionId: null,
    })
    .execute();
  visitor = randomUUID();
  account = randomUUID();
  hall = randomUUID();
  await db
    .insertInto('accounts')
    .values({ id: account, email: `${account}@market.test`, passwordHash: 'fixture' })
    .execute();
  await db
    .insertInto('worldMemberships')
    .values({ worldId: ids.world, accountId: account, playerName: 'Marchand' })
    .execute();
  await db
    .insertInto('villages')
    .values({
      id: visitor,
      worldId: ids.world,
      ownerAccountId: account,
      name: 'Marchands',
      anchorCellX: 40,
      anchorCellY: 32,
    })
    .execute();
  await db
    .insertInto('buildings')
    .values({
      id: hall,
      worldId: ids.world,
      villageId: visitor,
      buildingType: 'town-hall',
      level: 2,
      status: 'completed',
      completedAt: new Date(),
      constructionStartedAt: null,
      constructionCompletesAt: null,
    })
    .execute();
  await db
    .insertInto('worldCellOccupancies')
    .values({ worldId: ids.world, cellX: 40, cellY: 32, buildingId: hall, featureId: null, role: 'anchor' })
    .execute();
  await db
    .insertInto('villageResources')
    .values(
      ['wood', 'stone', 'carrot'].map((resourceCode) => ({
        worldId: ids.world,
        villageId: visitor,
        resourceCode,
        amount: 2000,
      })),
    )
    .execute();
  await db
    .insertInto('villageResourceFlows')
    .values({
      worldId: ids.world,
      villageId: visitor,
      resourceCode: 'wood',
      baseRatePerHour: 0,
      remainder: 0,
      productionUpdatedAt: new Date(),
    })
    .execute();
  await db
    .insertInto('populationCohorts')
    .values({
      worldId: ids.world,
      villageId: visitor,
      originVillageId: visitor,
      memberCount: 8,
      activity: 'idle',
      energy: 10,
      energyProgress: 0,
      energyUpdatedAt: new Date(),
      restingSince: null,
      foodUsedSinceRest: 0,
      harvestId: null,
      extractionId: null,
    })
    .execute();
  await db.updateTable('buildings').set({ level: 2 }).where('id', '=', ids.townHall).execute();
}, 60000);
afterEach(async () => {
  await db.deleteFrom('populationCohorts').where('worldId', '=', ids.world).execute();
  await db.deleteFrom('tradeOffers').where('worldId', '=', ids.world).execute();
  await db.deleteFrom('tradeReceipts').where('worldId', '=', ids.world).execute();
  await db.deleteFrom('villages').where('worldId', '=', ids.world).where('id', '=', visitor).execute();
  await db.deleteFrom('worldMemberships').where('worldId', '=', ids.world).where('accountId', '=', account).execute();
  await db.deleteFrom('accounts').where('id', '=', account).execute();
  await db.deleteFrom('worlds').where('id', '=', ids.world).execute();
}, 60000);
afterAll(() => db.destroy());
const publication = (overrides: object = {}): Extract<TradeCommand, { action: 'publish' }> => ({
  action: 'publish',
  commandId: randomUUID(),
  requestedResource: 'stone',
  requestedAmount: 250,
  offeredResource: 'wood',
  offeredAmount: 500,
  maxTravelSeconds: 600,
  ...overrides,
});
async function amount(villageId: string, code: string) {
  return Number(
    (
      await db
        .selectFrom('villageResources')
        .select('amount')
        .where('worldId', '=', ids.world)
        .where('villageId', '=', villageId)
        .where('resourceCode', '=', code)
        .executeTakeFirstOrThrow()
    ).amount,
  );
}
async function offer() {
  return db
    .selectFrom('tradeOffers')
    .selectAll()
    .where('worldId', '=', ids.world)
    .where('villageId', '=', ids.village)
    .executeTakeFirstOrThrow();
}
async function lock<T>(villages: string[], run: (tx: Transaction<Database>, at: Date) => Promise<T>) {
  return db.transaction().execute(async (tx) => run(tx, await beginTradePair(tx, ids.world, villages)));
}
async function prepared() {
  return {
    worldId: ids.world,
    villageId: visitor,
    destinationVillageId: ids.village,
    revision: await navigationRevision(db, ids.world),
    travelMs: 10000,
    path: [
      { cellX: 40, cellY: 32 },
      { cellX: 31, cellY: 32 },
    ],
  };
}
async function processOwnTask() {
  // Exercise the real SKIP LOCKED scheduler without processing notifications
  // belonging to other fixtures in the shared test database.
  return db.transaction().execute(async (guard) => {
    await guard
      .selectFrom('scheduledTasks')
      .select('id')
      .where('worldId', '!=', ids.world)
      .where('completedAt', 'is', null)
      .forUpdate()
      .execute();
    return processNextScheduledTask(db, { [TRADE_WAKE_TASK]: wakeTrade });
  });
}

it('reserves at publication, replays exactly and returns the reserve only once on cancellation', async () => {
  const command = publication();
  await commandPlayerMarket(db, ids.account, slug, ids.village, command);
  expect(await amount(ids.village, 'wood')).toBe(1500);
  await commandPlayerMarket(db, ids.account, slug, ids.village, command);
  expect(await amount(ids.village, 'wood')).toBe(1500);
  await expect(
    commandPlayerMarket(db, ids.account, slug, ids.village, { ...command, offeredAmount: 501 }),
  ).rejects.toMatchObject({ code: 'COMMAND_REUSED' });
  const cancellation = { action: 'cancel' as const, commandId: randomUUID(), offerId: (await offer()).id };
  await commandPlayerMarket(db, ids.account, slug, ids.village, cancellation);
  await commandPlayerMarket(db, ids.account, slug, ids.village, cancellation);
  expect(await amount(ids.village, 'wood')).toBe(2000);
  expect((await offer()).status).toBe('cancelled');
});
it('takes the entire lot, delivers at arrival and return, and releases exactly the porters at return', async () => {
  await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
  const o = await offer(),
    plan = await prepared();
  await lock([visitor, ids.village], (tx, at) =>
    acceptTrade(tx, { worldId: ids.world, villageId: visitor, through: at }, o.id, plan),
  );
  const journey = await db
    .selectFrom('tradeJourneys')
    .selectAll()
    .where('offerId', '=', o.id)
    .executeTakeFirstOrThrow();
  expect(journey.workerCount).toBe(2);
  expect(await amount(visitor, 'stone')).toBe(1750);
  expect(await amount(visitor, 'wood')).toBe(2000);
  const assigned = () =>
    db.selectFrom('populationCohorts').selectAll().where('tradeJourneyId', '=', journey.id).execute();
  expect((await assigned()).reduce((n, c) => n + c.memberCount, 0)).toBe(2);
  await lock([ids.village], async (tx) => {
    await reconcileVillageEconomy(tx, {
      worldId: ids.world,
      villageId: ids.village,
      through: new Date(journey.arrivesAt.getTime() - 1),
    });
  });
  expect(await amount(ids.village, 'stone')).toBe(0);
  await lock([ids.village], (tx) =>
    reconcileVillageEconomy(tx, { worldId: ids.world, villageId: ids.village, through: journey.arrivesAt }),
  );
  expect(await amount(ids.village, 'stone')).toBe(250);
  expect(await amount(visitor, 'wood')).toBe(2000);
  expect(await assigned()).toHaveLength(1);
  await lock([visitor], (tx) =>
    reconcileVillageEconomy(tx, { worldId: ids.world, villageId: visitor, through: journey.returnsAt }),
  );
  expect(await amount(visitor, 'wood')).toBe(2500);
  expect(await assigned()).toHaveLength(0);
  await lock([visitor], (tx) =>
    reconcileVillageEconomy(tx, { worldId: ids.world, villageId: visitor, through: journey.returnsAt }),
  );
  expect(await amount(visitor, 'wood')).toBe(2500);
  expect(
    (await db.selectFrom('populationCohorts').selectAll().where('villageId', '=', visitor).execute()).reduce(
      (n, c) => n + c.memberCount,
      0,
    ),
  ).toBe(8);
  expect(
    (
      await db
        .selectFrom('scheduledTasks')
        .selectAll()
        .where('worldId', '=', ids.world)
        .where('taskType', '=', TRADE_WAKE_TASK)
        .execute()
    ).every((t) => !t.completedAt),
  ).toBe(true);
});
it('honours all capacity boundaries, refuses missing workers and rejects stale geography without debiting', async () => {
  expect(marketWorkers(500, 250)).toBe(2);
  expect(marketWorkers(250, 251)).toBe(2);
  expect(marketWorkers(1, 250)).toBe(1);
  await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
  const o = await offer(),
    plan = await prepared();
  await expect(
    lock([visitor, ids.village], (tx, at) =>
      acceptTrade(tx, { worldId: ids.world, villageId: visitor, through: at }, o.id, { ...plan, revision: 'stale' }),
    ),
  ).rejects.toMatchObject({ code: 'TRADE_ROUTE_CHANGED' });
  await db
    .updateTable('populationCohorts')
    .set({ activity: 'resting', energy: 0, energyProgress: 0, restingSince: new Date() })
    .where('villageId', '=', visitor)
    .execute();
  await expect(
    lock([visitor, ids.village], (tx, at) =>
      acceptTrade(tx, { worldId: ids.world, villageId: visitor, through: at }, o.id, plan),
    ),
  ).rejects.toMatchObject({ code: 'TRADE_WORKERS' });
  expect(await amount(visitor, 'stone')).toBe(2000);
  expect((await offer()).status).toBe('open');
  expect(await db.selectFrom('tradeJourneys').selectAll().where('worldId', '=', ids.world).execute()).toHaveLength(0);
});
it('keeps player priority until ten minutes then credits Oracle instantly once; ineligible offers remain open', async () => {
  await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
  const o = await offer();
  expect(o.oracleAt.getTime() - o.createdAt.getTime()).toBe(600000);
  await lock([ids.village], (tx) =>
    reconcileVillageEconomy(tx, {
      worldId: ids.world,
      villageId: ids.village,
      through: new Date(o.oracleAt.getTime() - 1),
    }),
  );
  expect(await amount(ids.village, 'stone')).toBe(0);
  await lock([ids.village], (tx) =>
    reconcileVillageEconomy(tx, { worldId: ids.world, villageId: ids.village, through: o.oracleAt }),
  );
  await lock([ids.village], (tx) =>
    reconcileVillageEconomy(tx, { worldId: ids.world, villageId: ids.village, through: o.oracleAt }),
  );
  expect(await amount(ids.village, 'stone')).toBe(250);
  expect((await offer()).status).toBe('oracle');
  await commandPlayerMarket(db, ids.account, slug, ids.village, publication({ offeredAmount: 50 }));
  await lock([ids.village], (tx) =>
    reconcileVillageEconomy(tx, {
      worldId: ids.world,
      villageId: ids.village,
      through: new Date(o.oracleAt.getTime() + 600000),
    }),
  );
  expect(
    (await browsePlayerMarket(db, ids.account, slug, ids.village, false)).offers.filter((r) => r.status === 'open'),
  ).toHaveLength(1);
});
it('quotes permanent Oracle lots by exact ceiling and replays immediate delivery', async () => {
  const cost = oracleCost(50, 4, 4);
  expect(cost).toBe(72);
  const command = {
    action: 'oracle' as const,
    commandId: randomUUID(),
    requestedResource: 'stone',
    requestedAmount: 50,
    offeredResource: 'wood',
    expectedCost: cost,
  };
  await commandPlayerMarket(db, ids.account, slug, ids.village, command);
  await commandPlayerMarket(db, ids.account, slug, ids.village, command);
  expect(await amount(ids.village, 'wood')).toBe(1928);
  expect(await amount(ids.village, 'stone')).toBe(50);
});
it('checks ownership and world for publication, cancellation and browsing', async () => {
  await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
  await expect(commandPlayerMarket(db, account, slug, ids.village, publication())).rejects.toMatchObject({
    statusCode: 404,
  });
  await expect(browsePlayerMarket(db, account, 'missing', visitor, false)).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    commandPlayerMarket(db, account, slug, visitor, {
      action: 'cancel',
      commandId: randomUUID(),
      offerId: (await offer()).id,
    }),
  ).rejects.toMatchObject({ code: 'TRADE_CLOSED' });
});

it('paginates history from newest to oldest without hiding the latest announcement or duplicating a boundary', async () => {
  const epoch = Date.now();
  await db
    .insertInto('tradeOffers')
    .values(
      Array.from({ length: 51 }, (_, i) => ({
        worldId: ids.world,
        villageId: ids.village,
        requestedResource: 'stone',
        requestedAmount: 50,
        offeredResource: 'wood',
        offeredAmount: 50,
        maxTravelSeconds: 600,
        status: 'cancelled' as const,
        createdAt: new Date(epoch - i * 1000),
        oracleAt: new Date(epoch + 600000 - i * 1000),
        oracleEligible: false,
      })),
    )
    .execute();
  const first = await browsePlayerMarket(db, ids.account, slug, ids.village, true);
  expect(first.offers).toHaveLength(50);
  expect(first.nextCursor).not.toBeNull();
  expect(first.offers[0]!.createdAt).toBe(new Date(epoch).toISOString());
  const second = await browsePlayerMarket(db, ids.account, slug, ids.village, true, first.nextCursor!);
  expect(second.offers).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect(second.offers[0]!.createdAt).toBe(new Date(epoch - 50000).toISOString());
  expect(first.offers.some((o) => o.id === second.offers[0]!.id)).toBe(false);
});
it('rolls back proven reservation, announcement and notification writes on the exact injected error', async () => {
  const fault = new Error('after-trade-publication');
  await db
    .updateTable('villageResourceFlows')
    .set({ productionUpdatedAt: new Date(0) })
    .where('worldId', '=', ids.world)
    .where('villageId', '=', ids.village)
    .execute();
  const beforeFlows = await db
    .selectFrom('villageResourceFlows')
    .selectAll()
    .where('worldId', '=', ids.world)
    .orderBy('villageId')
    .orderBy('resourceCode')
    .execute();
  const beforeMarkers = await db
    .selectFrom('villageSyncChanges')
    .selectAll()
    .where('worldId', '=', ids.world)
    .orderBy('transactionId')
    .execute();
  await expect(
    lock([ids.village], async (tx, at) => {
      await publishTrade(tx, { worldId: ids.world, villageId: ids.village, through: at }, publication());
      expect(
        Number(
          (
            await tx
              .selectFrom('villageResources')
              .select('amount')
              .where('villageId', '=', ids.village)
              .where('resourceCode', '=', 'wood')
              .executeTakeFirstOrThrow()
          ).amount,
        ),
      ).toBe(1500);
      expect(await tx.selectFrom('tradeOffers').selectAll().where('worldId', '=', ids.world).execute()).toHaveLength(1);
      expect(
        await tx
          .selectFrom('scheduledTasks')
          .selectAll()
          .where('worldId', '=', ids.world)
          .where('taskType', '=', TRADE_WAKE_TASK)
          .execute(),
      ).toHaveLength(1);
      expect(
        (
          await tx
            .selectFrom('villageResourceFlows')
            .select('productionUpdatedAt')
            .where('worldId', '=', ids.world)
            .where('villageId', '=', ids.village)
            .executeTakeFirstOrThrow()
        ).productionUpdatedAt,
      ).toEqual(at);
      throw fault;
    }),
  ).rejects.toBe(fault);
  expect(await amount(ids.village, 'wood')).toBe(2000);
  expect(await db.selectFrom('tradeOffers').selectAll().where('worldId', '=', ids.world).execute()).toHaveLength(0);
  expect(
    await db
      .selectFrom('scheduledTasks')
      .selectAll()
      .where('worldId', '=', ids.world)
      .where('taskType', '=', TRADE_WAKE_TASK)
      .execute(),
  ).toHaveLength(0);
  expect(
    await db
      .selectFrom('villageResourceFlows')
      .selectAll()
      .where('worldId', '=', ids.world)
      .orderBy('villageId')
      .orderBy('resourceCode')
      .execute(),
  ).toEqual(beforeFlows);
  expect(
    await db
      .selectFrom('villageSyncChanges')
      .selectAll()
      .where('worldId', '=', ids.world)
      .orderBy('transactionId')
      .execute(),
  ).toEqual(beforeMarkers);
});
it('serializes two entire acceptances behind an observed village lock', async () => {
  await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
  const o = await offer(),
    plan = await prepared();
  let release!: () => void, acquired!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      acquired = r;
    });
  const holder = db.transaction().execute(async (tx) => {
    await tx.selectFrom('villages').select('id').where('id', '=', ids.village).forUpdate().execute();
    acquired();
    await gate;
  });
  await ready;
  const take = () =>
    lock([ids.village, visitor], (tx, at) =>
      acceptTrade(tx, { worldId: ids.world, villageId: visitor, through: at }, o.id, plan),
    );
  const results = Promise.allSettled([take(), take()]);
  const timer = setTimeout(release, 8000);
  try {
    let observed = false;
    for (let n = 0; n < 100; n++) {
      const r = await sql<{
        n: string;
      }>`select count(*)::text n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%"villages"%'`.execute(
        db,
      );
      if (Number(r.rows[0]!.n) >= 2) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(observed).toBe(true);
  } finally {
    release();
    clearTimeout(timer);
    await holder;
    await results;
  }
  const settled = await results;
  expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = settled.find((r) => r.status === 'rejected');
  expect(rejected?.status === 'rejected' ? rejected.reason.code : null).toBe('TRADE_CLOSED');
  expect(await amount(visitor, 'stone')).toBe(1750);
  expect(await db.selectFrom('tradeJourneys').selectAll().where('offerId', '=', o.id).execute()).toHaveLength(1);
});

it('rolls back an admitted convoy after proving its debit, assignment, deliveries and announcement changes', async () => {
  await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
  const o = await offer(),
    plan = await prepared(),
    fault = new Error('after-trade-convoy');
  const beforeWorkers = await db
    .selectFrom('populationCohorts')
    .selectAll()
    .where('worldId', '=', ids.world)
    .orderBy('id')
    .execute();
  const beforeMarkers = await db
    .selectFrom('villageSyncChanges')
    .selectAll()
    .where('worldId', '=', ids.world)
    .orderBy('transactionId')
    .execute();
  const beforeTasks = await db
    .selectFrom('scheduledTasks')
    .selectAll()
    .where('worldId', '=', ids.world)
    .orderBy('id')
    .execute();
  await expect(
    lock([visitor, ids.village], async (tx, at) => {
      await acceptTrade(tx, { worldId: ids.world, villageId: visitor, through: at }, o.id, plan);
      expect(
        Number(
          (
            await tx
              .selectFrom('villageResources')
              .select('amount')
              .where('villageId', '=', visitor)
              .where('resourceCode', '=', 'stone')
              .executeTakeFirstOrThrow()
          ).amount,
        ),
      ).toBe(1750);
      expect(
        (await tx.selectFrom('tradeOffers').select('status').where('id', '=', o.id).executeTakeFirstOrThrow()).status,
      ).toBe('accepted');
      expect(await tx.selectFrom('tradeJourneys').selectAll().where('offerId', '=', o.id).execute()).toHaveLength(1);
      expect(
        await tx.selectFrom('tradeDeliveries').selectAll().where('worldId', '=', ids.world).execute(),
      ).toHaveLength(2);
      expect(
        (
          await tx
            .selectFrom('populationCohorts')
            .selectAll()
            .where('villageId', '=', visitor)
            .where('tradeJourneyId', 'is not', null)
            .execute()
        ).reduce((n, c) => n + c.memberCount, 0),
      ).toBe(2);
      expect(
        await tx
          .selectFrom('scheduledTasks')
          .selectAll()
          .where('worldId', '=', ids.world)
          .where('taskType', '=', TRADE_WAKE_TASK)
          .execute(),
      ).toHaveLength(3);
      throw fault;
    }),
  ).rejects.toBe(fault);
  expect(await amount(visitor, 'stone')).toBe(2000);
  expect(await offer()).toEqual(o);
  expect(await db.selectFrom('tradeJourneys').selectAll().where('offerId', '=', o.id).execute()).toHaveLength(0);
  expect(await db.selectFrom('tradeDeliveries').selectAll().where('worldId', '=', ids.world).execute()).toHaveLength(0);
  expect(
    await db.selectFrom('populationCohorts').selectAll().where('worldId', '=', ids.world).orderBy('id').execute(),
  ).toEqual(beforeWorkers);
  expect(
    await db
      .selectFrom('villageSyncChanges')
      .selectAll()
      .where('worldId', '=', ids.world)
      .orderBy('transactionId')
      .execute(),
  ).toEqual(beforeMarkers);
  expect(
    await db.selectFrom('scheduledTasks').selectAll().where('worldId', '=', ids.world).orderBy('id').execute(),
  ).toEqual(beforeTasks);
});
it('an obsolete scheduler notification cannot override a cancellation or acknowledge another task', async () => {
  await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
  const o = await offer();
  await commandPlayerMarket(db, ids.account, slug, ids.village, {
    action: 'cancel',
    commandId: randomUUID(),
    offerId: o.id,
  });
  await db
    .updateTable('scheduledTasks')
    .set({ dueAt: new Date(0), availableAt: new Date(0) })
    .where('worldId', '=', ids.world)
    .where('taskType', '=', TRADE_WAKE_TASK)
    .execute();
  expect(await processOwnTask()).toMatchObject({ outcome: 'completed' });
  expect(await amount(ids.village, 'wood')).toBe(2000);
  expect(await amount(ids.village, 'stone')).toBe(0);
});

it('protects an active commercial passage from construction and spawn placement', async () => {
  await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
  const o = await offer(),
    plan = await prepared();
  const before = await spawnSpatialState(db, ids.world);
  await lock([visitor, ids.village], (tx, at) =>
    acceptTrade(tx, { worldId: ids.world, villageId: visitor, through: at }, o.id, plan),
  );
  await expect(
    db.transaction().execute(async (tx) => {
      await beginVillageEconomy(tx, ids.world, ids.village, undefined, [], [], true);
      await assertNoInfrastructure(tx, ids.world, [{ cellX: 36, cellY: 32 }], { widthCells: 64, heightCells: 64 });
    }),
  ).rejects.toMatchObject({ code: 'ENGAGED_PASSAGE' });
  const surfaces = await spawnSpatialState(db, ids.world);
  expect(surfaces.protectedSurfaces.length).toBeGreaterThan(before.protectedSurfaces.length);
  expect(surfaces.walkBlockedSurfaces).toEqual(before.walkBlockedSurfaces);
});

it('prepares a real hall-to-hall path and replays an accepted command without a second convoi', async () => {
  const compute = new NavigationCompute();
  try {
    await compute.start();
    await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
    const command = { action: 'accept' as const, commandId: randomUUID(), offerId: (await offer()).id };
    const initial = await prepareTrade(db, account, slug, visitor, command.offerId, compute);
    await compute.close();
    const restarted = createDatabase(testDatabaseUrl());
    try {
      const noSearch = {
        available: 0,
        run: async () => {
          throw Error('A durable hit must not boot or search a worker');
        },
        close: async () => {},
      };
      const restored = await prepareTrade(restarted, account, slug, visitor, command.offerId, noSearch);
      expect(restored.path).toEqual(initial.path);
      expect(restored.travelMs).toBe(initial.travelMs);
    } finally {
      await restarted.destroy();
    }
    const result = await commandPlayerMarket(db, account, slug, visitor.toUpperCase(), command, compute);
    expect(result.village.market?.journeys).toHaveLength(1);
    expect(
      result.village.population
        .cohorts!.filter((c) => c.assignmentKind === 'trade')
        .reduce((n, c) => n + c.memberCount, 0),
    ).toBe(2);
    await commandPlayerMarket(db, account, slug, visitor, command, compute);
    const journey = await db
      .selectFrom('tradeJourneys')
      .selectAll()
      .where('offerId', '=', command.offerId)
      .executeTakeFirstOrThrow();
    expect(journey.path.length).toBeGreaterThan(2);
    expect(journey.arrivesAt.getTime() - journey.startedAt.getTime()).toBe(
      journey.returnsAt.getTime() - journey.arrivesAt.getTime(),
    );
    expect(await amount(visitor, 'stone')).toBe(1750);
    expect(
      await db.selectFrom('tradeJourneys').selectAll().where('offerId', '=', command.offerId).execute(),
    ).toHaveLength(1);
  } finally {
    await compute.close();
  }
});

it('rejects a changed local certificate before debiting a prepared real route', async () => {
  const compute = new NavigationCompute();
  try {
    await compute.start();
    await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
    const o = await offer(),
      plan = await prepareTrade(db, account, slug, visitor, o.id, compute);
    expect(plan.certificate).toBeDefined();
    await db.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${'infrastructure:' + ids.world},0))`.execute(tx);
      await tx
        .updateTable('worldChunks')
        .set({ elevations: Array(1024).fill(2) })
        .where('worldId', '=', ids.world)
        .where('chunkX', '=', 1)
        .where('chunkY', '=', 1)
        .execute();
    });
    await expect(
      lock([ids.village, visitor], (tx, at) =>
        acceptTrade(tx, { worldId: ids.world, villageId: visitor, through: at }, o.id, plan),
      ),
    ).rejects.toMatchObject({ code: 'TRADE_ROUTE_CHANGED' });
    expect(await amount(visitor, 'stone')).toBe(2000);
    expect(await db.selectFrom('tradeJourneys').select('id').where('worldId', '=', ids.world).execute()).toHaveLength(
      0,
    );
  } finally {
    await compute.close();
  }
});

it('waits for a busy projection lane, then prepares and accepts the trade without a manual retry', async () => {
  const compute = new NavigationCompute();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      entered = r;
    });
  const jobs: Promise<unknown>[] = [];
  try {
    await compute.start();
    await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
    const o = await offer();
    // Hold the SQL loader rather than relying on two coincident promises.
    const projection = compute.network(async () => {
      entered();
      await held;
      throw Error('Released test projection');
    });
    jobs.push(projection);
    void projection.catch(() => {});
    await ready;
    const preparation = prepareTrade(db, account, slug, visitor, o.id, compute);
    jobs.push(preparation);
    void preparation.catch(() => {});
    await expect.poll(() => compute.observation.waiting, { timeout: 2000 }).toBe(1);
    expect(await amount(visitor, 'stone')).toBe(2000);
    release();
    const plan = await preparation;
    expect(plan.path.length).toBeGreaterThan(2);
    await lock([visitor, ids.village], (tx, through) =>
      acceptTrade(tx, { worldId: ids.world, villageId: visitor, through }, o.id, plan),
    );
    expect(await amount(visitor, 'stone')).toBe(1750);
    expect(
      await db
        .selectFrom('tradeJourneys')
        .select('id')
        .where('worldId', '=', ids.world)
        .where('offerId', '=', o.id)
        .execute(),
    ).toHaveLength(1);
  } finally {
    release();
    await Promise.allSettled(jobs);
    await compute.close();
  }
});

it('returns a retryable preparation error without admitting or debiting when navigation is interrupted', async () => {
  await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
  const o = await offer();
  const compute = {
    available: 1,
    run: async () => {
      throw new Error('injected-context-connection-interrupted');
    },
    close: async () => {},
  };
  await expect(prepareTrade(db, account, slug, visitor, o.id, compute)).rejects.toMatchObject({
    statusCode: 503,
    code: 'TRADE_PREPARATION_BUSY',
  });
  expect(await amount(visitor, 'stone')).toBe(2000);
  expect((await offer()).status).toBe('open');
  expect(await db.selectFrom('tradeJourneys').selectAll().where('offerId', '=', o.id).execute()).toHaveLength(0);
});

it('resolves a player/Oracle race at the deadline through the same owner lock and never pays twice', async () => {
  await commandPlayerMarket(db, ids.account, slug, ids.village, publication());
  const o = await offer(),
    plan = await prepared();
  const deadline = new Date(Date.now() - 1000);
  await db.updateTable('tradeOffers').set({ oracleAt: deadline }).where('id', '=', o.id).execute();
  await db
    .updateTable('scheduledTasks')
    .set({ dueAt: deadline, availableAt: deadline })
    .where('subjectId', '=', o.id)
    .execute();
  let release!: () => void, acquired!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      acquired = r;
    });
  const holder = db.transaction().execute(async (tx) => {
    await tx.selectFrom('villages').select('id').where('id', '=', ids.village).forUpdate().execute();
    acquired();
    await gate;
  });
  await ready;
  const race = Promise.allSettled([
    lock([ids.village, visitor], (tx, at) =>
      acceptTrade(tx, { worldId: ids.world, villageId: visitor, through: at }, o.id, plan),
    ),
    processOwnTask(),
  ]);
  const timer = setTimeout(release, 8000);
  try {
    let observed = false;
    for (let n = 0; n < 100; n++) {
      const r = await sql<{
        n: string;
      }>`select count(*)::text n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%"villages"%'`.execute(
        db,
      );
      if (Number(r.rows[0]!.n) >= 2) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(observed).toBe(true);
  } finally {
    release();
    clearTimeout(timer);
    await holder;
    await race;
  }
  const results = await race;
  expect(results[0]?.status === 'rejected' ? results[0].reason.code : null).toBe('TRADE_CLOSED');
  expect(results[1]).toMatchObject({ status: 'fulfilled', value: { outcome: 'completed' } });
  expect(await amount(ids.village, 'stone')).toBe(250);
  expect(await amount(visitor, 'stone')).toBe(2000);
  expect(await db.selectFrom('tradeJourneys').selectAll().where('offerId', '=', o.id).execute()).toHaveLength(0);
});
