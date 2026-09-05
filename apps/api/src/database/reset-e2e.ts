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
      await transaction.updateTable('villageResourceFlows').set({
        baseRatePerHour: 60, remainder: 0, productionUpdatedAt: sql`transaction_timestamp()`,
      }).where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village)
        .where('resourceCode', '=', 'wood').execute();
    });
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await resetE2eState();
  console.info('E2E state reset.');
}
