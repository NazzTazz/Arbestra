import { fileURLToPath } from 'node:url';

import { Migrator, type MigrationProvider } from 'kysely';

import { loadConfig } from '../config.js';
import { createDatabase } from './connection.js';
import * as initialMigration from './migrations/001_initial.js';
import * as deferredActionsMigration from './migrations/002_deferred_actions.js';
import * as economyMigration from './migrations/003_economy.js';
import * as worldEconomyFoundationMigration from './migrations/004_world_economy_foundation.js';
import * as foundationIndexesMigration from './migrations/005_foundation_indexes.js';
import * as worldSpaceAndGenerationMigration from './migrations/006_world_space_and_generation.js';
import * as clearingDepositsMigration from './migrations/007_clearing_deposits.js';
import * as spatialGardensMigration from './migrations/008_spatial_gardens.js';

const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return {
      '001_initial': initialMigration,
      '002_deferred_actions': deferredActionsMigration,
      '003_economy': economyMigration,
      '004_world_economy_foundation': worldEconomyFoundationMigration,
      '005_foundation_indexes': foundationIndexesMigration,
      '006_world_space_and_generation': worldSpaceAndGenerationMigration,
      '007_clearing_deposits': clearingDepositsMigration,
      '008_spatial_gardens': spatialGardensMigration,
    };
  },
};

export async function migrateToLatest(databaseUrl = loadConfig().databaseUrl): Promise<void> {
  const db = createDatabase(databaseUrl);
  const migrator = new Migrator({
    db,
    provider: migrationProvider,
  });

  try {
    const { error, results } = await migrator.migrateToLatest();
    for (const result of results ?? []) {
      console.info(`${result.status}: ${result.migrationName}`);
    }
    if (error) throw error;
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrateToLatest();
}
