import { fileURLToPath } from 'node:url';

import { sql } from 'kysely';

import { loadConfig } from '../config.js';
import { hashPassword } from '../security/passwords.js';
import { createDatabase } from './connection.js';
import { generateWorld } from '../modules/worlds/generation.js';

export const DEVELOPMENT_IDS = {
  account: '10000000-0000-4000-8000-000000000001',
  world: '20000000-0000-4000-8000-000000000001',
  village: '30000000-0000-4000-8000-000000000001',
  townHall: '50000000-0000-4000-8000-000000000001',
} as const;

const WORLD_WIDTH = 2048;
const WORLD_HEIGHT = 1024;
const ANCHOR_X = WORLD_WIDTH / 2;
const ANCHOR_Y = WORLD_HEIGHT / 2;

export const DEVELOPMENT_CELLS = {
  townHall: { cellX: ANCHOR_X - 1, cellY: ANCHOR_Y },
  dwelling: { cellX: ANCHOR_X + 1, cellY: ANCHOR_Y },
  sawmill: { cellX: ANCHOR_X - 1, cellY: ANCHOR_Y + 1 },
  garden: { cellX: ANCHOR_X, cellY: ANCHOR_Y },
  gardenNorth: { cellX: ANCHOR_X, cellY: ANCHOR_Y + 1 },
} as const;

export async function seedDevelopmentData(databaseUrl = loadConfig().databaseUrl): Promise<void> {
  const db = createDatabase(databaseUrl);
  const passwordHash = await hashPassword('arbestra');
  try {
    await db.transaction().execute(async (transaction) => {
      await transaction.insertInto('accounts').values({
        id: DEVELOPMENT_IDS.account, email: 'player@arbestra.local', passwordHash,
      }).onConflict((conflict) => conflict.column('id').doUpdateSet({ email: 'player@arbestra.local', passwordHash })).execute();

      await transaction.insertInto('worlds').values({
        id: DEVELOPMENT_IDS.world, slug: 'aube', name: "Monde de l'Aube", topology: 'torus',
        widthCells: WORLD_WIDTH, heightCells: WORLD_HEIGHT, chunkSize: 32, seed: 1,
      }).onConflict((conflict) => conflict.column('id').doUpdateSet({
        slug: 'aube', name: "Monde de l'Aube", topology: 'torus',
        widthCells: WORLD_WIDTH, heightCells: WORLD_HEIGHT, chunkSize: 32, seed: 1,
      })).execute();

      await transaction.insertInto('worldMemberships').values({
        accountId: DEVELOPMENT_IDS.account, worldId: DEVELOPMENT_IDS.world, playerName: 'Pionnier',
      }).onConflict((conflict) => conflict.columns(['accountId', 'worldId']).doUpdateSet({ playerName: 'Pionnier' })).execute();

      await transaction.insertInto('villages').values({
        id: DEVELOPMENT_IDS.village, worldId: DEVELOPMENT_IDS.world, ownerAccountId: DEVELOPMENT_IDS.account,
        name: 'Clairière', anchorCellX: ANCHOR_X, anchorCellY: ANCHOR_Y,
      }).onConflict((conflict) => conflict.column('id').doNothing()).execute();

      await transaction.insertInto('villageResources').values([
        { worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village, resourceCode: 'wood', amount: 2000 },
        { worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village, resourceCode: 'carrot', amount: 50 },
      ]).onConflict((conflict) => conflict.columns(['worldId', 'villageId', 'resourceCode']).doNothing()).execute();
      await transaction.insertInto('villageResourceFlows').values({
        worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village, resourceCode: 'wood',
        baseRatePerHour: 60, remainder: 0, productionUpdatedAt: sql`transaction_timestamp()`,
      }).onConflict((conflict) => conflict.columns(['worldId', 'villageId', 'resourceCode']).doNothing()).execute();

      await transaction.insertInto('buildings').values({
        id: DEVELOPMENT_IDS.townHall, worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village,
        buildingType: 'town-hall', level: 1, targetLevel: null,
        status: 'completed', constructionStartedAt: null, constructionCompletesAt: null,
        completedAt: sql`transaction_timestamp()`,
      }).onConflict((conflict) => conflict.column('id').doNothing()).execute();
      await transaction.insertInto('worldCellOccupancies').values({
        worldId: DEVELOPMENT_IDS.world,
        ...DEVELOPMENT_CELLS.townHall, buildingId: DEVELOPMENT_IDS.townHall, featureId: null, role: 'anchor',
      }).onConflict((conflict) => conflict.columns(['worldId', 'cellX', 'cellY']).doNothing()).execute();
      await generateWorld(transaction, DEVELOPMENT_IDS.world);
    });
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await seedDevelopmentData();
  console.info('Development data seeded.');
}
