import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import {
  getStoneDepositDetails,
  previewVillageExploitation,
  previewVillageMarket,
  previewVillageProcessing,
  previewVillageWorksite,
} from './service.js';
import { browsePlayerMarket } from './trade-service.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test')
  throw Error('Unexpected preview test database');
const db = createDatabase(url);
let workshopId: string, dueId: string;
let featureId: string | undefined;
beforeAll(() => migrateToLatest(url), 60000);
beforeEach(async () => {
  await resetE2eState(url);
  const now = new Date();
  await db
    .updateTable('buildings')
    .set({ level: 2 })
    .where('worldId', '=', ids.world)
    .where('id', '=', ids.townHall)
    .execute();
  workshopId = (
    await db
      .insertInto('buildings')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        buildingType: 'sawmill',
        level: 1,
        status: 'completed',
        completedAt: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  dueId = randomUUID();
  await db
    .insertInto('buildings')
    .values({
      id: dueId,
      worldId: ids.world,
      villageId: ids.village,
      buildingType: 'dwelling',
      level: 1,
      status: 'under-construction',
      constructionStartedAt: new Date(now.getTime() - 2000),
      constructionCompletesAt: new Date(now.getTime() - 1000),
    })
    .execute();
  // Preview eligibility must advance energy without persisting the clock.
  await db
    .updateTable('populationCohorts')
    .set({
      activity: 'resting',
      energy: 9,
      energyProgress: 0,
      energyUpdatedAt: new Date(now.getTime() - 3600000),
      restingSince: new Date(now.getTime() - 3600000),
    })
    .where('worldId', '=', ids.world)
    .where('villageId', '=', ids.village)
    .execute();
}, 60000);
afterAll(() => db.destroy());
afterEach(async () => {
  if (!featureId) return;
  await db
    .deleteFrom('worldCellOccupancies')
    .where('worldId', '=', ids.world)
    .where('featureId', '=', featureId)
    .execute();
  await db.deleteFrom('stoneDeposits').where('worldId', '=', ids.world).where('featureId', '=', featureId).execute();
  await db.deleteFrom('worldFeatures').where('worldId', '=', ids.world).where('id', '=', featureId).execute();
  featureId = undefined;
});
const tables = [
  'buildings',
  'villageResources',
  'villageResourceFlows',
  'populationCohorts',
  'villagePopulations',
  'scheduledTasks',
  'processingOrders',
  'processingLots',
  'tradeOffers',
  'marketExchanges',
  'villageSyncChanges',
] as const;
async function stored() {
  return Promise.all(
    tables.map(async (table) =>
      (await db.selectFrom(table).selectAll().where('worldId', '=', ids.world).execute())
        .map((row) => JSON.stringify(row))
        .sort(),
    ),
  );
}
it.each(['market', 'processing', 'offers', 'deposit', 'worksite', 'exploitation'] as const)(
  '%s preview does not settle unrelated work, stocks, energy or notifications',
  async (kind) => {
    if (['deposit', 'worksite', 'exploitation'].includes(kind)) {
      const occupied = new Set(
        (
          await db
            .selectFrom('worldCellOccupancies')
            .select(['cellX', 'cellY'])
            .where('worldId', '=', ids.world)
            .execute()
        ).map((c) => `${c.cellX}:${c.cellY}`),
      );
      const cell = [
        { cellX: 1024, cellY: 514 },
        { cellX: 1025, cellY: 514 },
        { cellX: 1022, cellY: 514 },
      ].find((c) => !occupied.has(`${c.cellX}:${c.cellY}`));
      expect(cell).toBeDefined();
      featureId = randomUUID();
      await db
        .insertInto('worldFeatures')
        .values({
          id: featureId,
          worldId: ids.world,
          featureTypeCode: 'stone_outcrop',
          state: 'available',
          variantSeed: 42,
        })
        .execute();
      await db
        .insertInto('stoneDeposits')
        .values({
          worldId: ids.world,
          featureId,
          ...cell!,
          initialAmount: 1000,
          remainingAmount: 1000,
          reservedAmount: 0,
          revision: 1,
          updatedAt: new Date(),
        })
        .execute();
      await db
        .insertInto('worldCellOccupancies')
        .values({ worldId: ids.world, featureId, ...cell!, buildingId: null, role: 'body' })
        .execute();
    }
    const before = await stored();
    if (kind === 'market')
      expect(
        await previewVillageMarket(db, ids.account, 'aube', ids.village, {
          offeredResource: 'wood',
          requestedResource: 'stone',
          amount: 100,
        }),
      ).toMatchObject({ valid: true, receivedAmount: 70 });
    else if (kind === 'processing')
      expect(await previewVillageProcessing(db, ids.account, 'aube', ids.village, workshopId, 1)).toMatchObject({
        valid: true,
      });
    else if (kind === 'offers')
      expect(await browsePlayerMarket(db, ids.account, 'aube', ids.village, false)).toMatchObject({ offers: [] });
    else if (kind === 'deposit')
      expect(
        (await getStoneDepositDetails(db, ids.account, 'aube', ids.village, featureId!)).eligibility.workerOptions[0],
      ).toMatchObject({ canStart: true, availableWorkers: 15 });
    else if (kind === 'worksite')
      expect(
        (
          await previewVillageWorksite(db, ids.account, 'aube', ids.village, {
            commandId: randomUUID(),
            featureIds: [featureId!],
            mode: 'extract',
            workerCap: 2,
          })
        ).included.map((f) => f.featureId),
      ).toEqual([featureId]);
    else
      expect(
        (
          await previewVillageExploitation(db, ids.account, 'aube', ids.village, {
            commandId: randomUUID(),
            workerCap: 2,
            durationMs: null,
            cohortId: null,
            woodMode: 'cut',
            gardens: [],
            wood: [],
            stone: [featureId!],
          })
        ).stone,
      ).toEqual([featureId]);
    expect(await db.selectFrom('buildings').select('status').where('id', '=', dueId).executeTakeFirstOrThrow()).toEqual(
      { status: 'under-construction' },
    );
    expect(await stored()).toEqual(before);
  },
);
