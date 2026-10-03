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
import * as economicTaskNotificationsMigration from './migrations/009_economic_task_notifications.js';
import * as populationAndGardenHarvestsMigration from './migrations/010_population_and_garden_harvests.js';
import * as populationCommandReceiptsMigration from './migrations/011_population_command_receipts.js';
import * as stoneDepositExtractionsMigration from './migrations/012_stone_deposit_extractions.js';
import * as dwellingLevelTwoMigration from './migrations/013_dwelling_level_two.js';
import * as villageAccomplishmentsMigration from './migrations/014_village_accomplishments.js';
import * as gardenPlotsMigration from './migrations/015_garden_plots.js';
import * as travelPathsMigration from './migrations/016_travel_paths.js';
import * as woodlandCuttingMigration from './migrations/017_woodland_cutting.js';
import * as extractionWorksitesMigration from './migrations/018_extraction_worksites.js';
import * as worksiteSelectionReceiptsMigration from './migrations/019_worksite_selection_receipts.js';
import * as worksiteInitialCapMigration from './migrations/020_worksite_initial_cap.js';
import * as gardenHarvestToursMigration from './migrations/021_garden_harvest_tours.js';
import * as restHousingMigration from './migrations/022_rest_housing.js';
import * as buildingVisualLayoutMigration from './migrations/023_building_visual_layout.js';
import * as barracksCatalogMigration from './migrations/024_barracks_catalog.js';
import * as universityScienceMigration from './migrations/025_university_science.js';

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
      '009_economic_task_notifications': economicTaskNotificationsMigration,
      '010_population_and_garden_harvests': populationAndGardenHarvestsMigration,
      '011_population_command_receipts': populationCommandReceiptsMigration,
      '012_stone_deposit_extractions': stoneDepositExtractionsMigration,
      '013_dwelling_level_two': dwellingLevelTwoMigration,
      '014_village_accomplishments': villageAccomplishmentsMigration,
      '015_garden_plots': gardenPlotsMigration,
      '016_travel_paths': travelPathsMigration,
      '017_woodland_cutting': woodlandCuttingMigration,
      '018_extraction_worksites': extractionWorksitesMigration,
      '019_worksite_selection_receipts': worksiteSelectionReceiptsMigration,
      '020_worksite_initial_cap': worksiteInitialCapMigration,
      '021_garden_harvest_tours': gardenHarvestToursMigration,
      '022_rest_housing': restHousingMigration,
      '023_building_visual_layout': buildingVisualLayoutMigration,
      '024_barracks_catalog': barracksCatalogMigration,
      '025_university_science': universityScienceMigration,
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
