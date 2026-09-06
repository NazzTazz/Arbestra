import { fileURLToPath } from 'node:url';

import { sql } from 'kysely';

import { createDatabase } from './connection.js';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS, seedDevelopmentData } from './seed.js';
import { testDatabaseUrl } from './test-environment.js';

export async function resetE2eState(databaseUrl = testDatabaseUrl()): Promise<void> {
  testDatabaseUrl({ TEST_DATABASE_URL: databaseUrl });
  const db = createDatabase(databaseUrl);
  try {
    const generatedWorld = await db.selectFrom('worlds').select('id')
      .where('id', '=', DEVELOPMENT_IDS.world)
      .where('generationStatus', '=', 'ready')
      .executeTakeFirst();
    if (!generatedWorld) {
      await db.transaction().execute(async (transaction) => {
        await transaction.deleteFrom('sessions').execute();
        await transaction.deleteFrom('scheduledTasks').execute();
        await transaction.deleteFrom('worlds').execute();
      });
      await seedDevelopmentData(databaseUrl);
      return;
    }

    // Terrain, clearings and generated features are immutable fixtures. Keeping
    // them makes each integration-test reset cheap instead of regenerating the
    // full 2048 × 1024 world.
    await db.transaction().execute(async (transaction) => {
      await transaction.deleteFrom('sessions').execute();
      await transaction.deleteFrom('scheduledTasks').execute();
      await transaction.deleteFrom('populationCommandReceipts').where('worldId', '=', DEVELOPMENT_IDS.world).execute();
      await transaction.deleteFrom('villageAccomplishments').where('worldId', '=', DEVELOPMENT_IDS.world).execute();
      await transaction.deleteFrom('populationCohorts').where('worldId', '=', DEVELOPMENT_IDS.world).execute();
      await transaction.deleteFrom('gardenHarvests').where('worldId', '=', DEVELOPMENT_IDS.world).execute();
      await transaction.deleteFrom('depositExtractions').where('worldId', '=', DEVELOPMENT_IDS.world).execute();
      await transaction.deleteFrom('buildingHiddenSupplies').where('worldId', '=', DEVELOPMENT_IDS.world).execute();
      await transaction.deleteFrom('buildings')
        .where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('id', '!=', DEVELOPMENT_IDS.townHall)
        .execute();
      await transaction.updateTable('buildings').set({
        level: 1, targetLevel: null, status: 'completed', constructionStartedAt: null,
        constructionCompletesAt: null, completedAt: sql`transaction_timestamp()`,
      }).where('id', '=', DEVELOPMENT_IDS.townHall).execute();
      await transaction.deleteFrom('worldCellOccupancies')
        .where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('buildingId', '=', DEVELOPMENT_IDS.townHall)
        .execute();
      await transaction.insertInto('worldCellOccupancies').values({
        worldId: DEVELOPMENT_IDS.world, ...DEVELOPMENT_CELLS.townHall,
        buildingId: DEVELOPMENT_IDS.townHall, featureId: null, role: 'anchor',
      }).execute();
      await transaction.updateTable('villageResources').set({ amount: 2000 })
        .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
        .where('resourceCode', '=', 'wood').execute();
      await transaction.updateTable('villageResources').set({ amount: 50 })
        .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
        .where('resourceCode', '=', 'carrot').execute();
      await transaction.insertInto('villageResources').values({ worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village,
        resourceCode: 'stone', amount: 0 }).onConflict((conflict) => conflict.columns(['worldId','villageId','resourceCode']).doUpdateSet({ amount:0 })).execute();
      await transaction.updateTable('stoneDeposits').set({
        remainingAmount: sql.ref('initialAmount'), reservedAmount: 0, revision: 1, updatedAt: sql`transaction_timestamp()`,
      }).where('worldId', '=', DEVELOPMENT_IDS.world).execute();
      await transaction.updateTable('worldFeatures').set({ state: 'available', updatedAt: sql`transaction_timestamp()` })
        .where('worldId', '=', DEVELOPMENT_IDS.world).where('featureTypeCode', '=', 'stone_outcrop').execute();
      const deposits = await transaction.selectFrom('stoneDeposits').select(['featureId', 'cellX', 'cellY'])
        .where('worldId', '=', DEVELOPMENT_IDS.world).execute();
      if (deposits.length > 0) await transaction.insertInto('worldCellOccupancies').values(deposits.map((deposit) => ({
        worldId: DEVELOPMENT_IDS.world, cellX: deposit.cellX, cellY: deposit.cellY,
        buildingId: null, featureId: deposit.featureId, role: 'body', pendingExpansionId: null,
      }))).onConflict((conflict) => conflict.columns(['worldId', 'cellX', 'cellY']).doNothing()).execute();
      await transaction.updateTable('villageResourceFlows').set({
        baseRatePerHour: 60, remainder: 0, productionUpdatedAt: sql`transaction_timestamp()`,
      }).where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
        .where('resourceCode', '=', 'wood').execute();
      await transaction.insertInto('populationCohorts').values({
        worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village,
        originVillageId: DEVELOPMENT_IDS.village, memberCount: 15, activity: 'idle', energy: 10,
        energyProgress: 0, energyUpdatedAt: sql`transaction_timestamp()`, restingSince: null,
        foodUsedSinceRest: 0, harvestId: null, extractionId: null,
      }).execute();
      await transaction.insertInto('buildingHiddenSupplies').values({
        worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village, buildingId: DEVELOPMENT_IDS.townHall,
        resourceCode: 'carrot', amount: 2000, claimedAt: null,
      }).execute();
    });
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await resetE2eState();
  console.info('E2E state reset.');
}
