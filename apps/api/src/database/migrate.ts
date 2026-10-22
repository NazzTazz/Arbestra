import * as terrainVerticesMigration from './migrations/048_terrain_vertices.js';
import * as freeTerraformingMigration from './migrations/049_free_terraforming.js';
import * as hudWorkforceMigration from './migrations/050_hud_workforce.js';
import * as gameSyncFoundationMigration from './migrations/051_game_sync_foundation.js';
import * as processingReceiptResultMigration from './migrations/052_processing_receipt_result.js';
import * as gameSyncPrivateWritersMigration from './migrations/053_game_sync_private_writers.js';
import * as gameSyncSharedWritersMigration from './migrations/054_game_sync_shared_writers.js';
import * as gameSyncScopeBackfillMigration from './migrations/055_game_sync_scope_backfill.js';
import * as villageEconomyCatchupsMigration from './migrations/056_village_economy_catchups.js';
import * as levelingMigration from './migrations/047_leveling.js';
import * as populationGrowthMigration from './migrations/043_population_growth.js';
import * as asyncExpeditionsMigration from './migrations/042_async_expeditions.js';
import * as harvestSubmissionsMigration from './migrations/040_harvest_submissions.js';
import * as villageSyncMigration from './migrations/041_village_sync.js';
import * as harvestIntentsMigration from './migrations/039_harvest_intents.js';
import * as spawnInstallationMigration from './migrations/038_spawn_installation.js';
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
import * as exploitationOrdersMigration from './migrations/026_exploitation_orders.js';
import * as buildingCommandReceiptsMigration from './migrations/027_building_command_receipts.js';
import * as infrastructureMigration from './migrations/028_infrastructure.js';
import * as timberHouseRecipesMigration from './migrations/029_timber_house_recipes.js';

import * as stonemasonCatalogMigration from './migrations/030_stonemason_catalog.js';
import * as materialProcessingMigration from './migrations/031_material_processing.js';
import * as stoneHouseCostsMigration from './migrations/032_stone_house_costs.js';
import * as logHouseRawWoodMigration from './migrations/033_log_house_raw_wood.js';
import * as oracleMarketMigration from './migrations/034_oracle_market.js';
import * as playerMarketMigration from './migrations/044_player_market.js';
import * as processingDurationMigration from './migrations/045_processing_duration.js';
import * as navigationCacheMigration from './migrations/046_navigation_cache.js';

import * as worldGeneratorMigration from './migrations/035_world_generator.js';
import * as worldGeneratorRecipeMigration from './migrations/036_world_generator_recipe.js';
import * as spawnAtlasMigration from './migrations/037_spawn_atlas.js';

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
      '026_exploitation_orders': exploitationOrdersMigration,
      '027_building_command_receipts': buildingCommandReceiptsMigration,
      '028_infrastructure': infrastructureMigration,
      '029_timber_house_recipes': timberHouseRecipesMigration,
      '030_stonemason_catalog': stonemasonCatalogMigration,
      '031_material_processing': materialProcessingMigration,
      '032_stone_house_costs': stoneHouseCostsMigration,
      '033_log_house_raw_wood': logHouseRawWoodMigration,
      '034_oracle_market': oracleMarketMigration,
      '035_world_generator': worldGeneratorMigration,
      '036_world_generator_recipe': worldGeneratorRecipeMigration,
      '037_spawn_atlas': spawnAtlasMigration,
      '038_spawn_installation': spawnInstallationMigration,
      '039_harvest_intents': harvestIntentsMigration,
      '040_harvest_submissions': harvestSubmissionsMigration,
      '041_village_sync': villageSyncMigration,
      '042_async_expeditions': asyncExpeditionsMigration,
      '043_population_growth': populationGrowthMigration,
      '044_player_market': playerMarketMigration,
      '045_processing_duration': processingDurationMigration,
      '046_navigation_cache': navigationCacheMigration,
      '047_leveling': levelingMigration,
      '048_terrain_vertices': terrainVerticesMigration,
      '049_free_terraforming': freeTerraformingMigration,
      '050_hud_workforce': hudWorkforceMigration,
      '051_game_sync_foundation': gameSyncFoundationMigration,
      '052_processing_receipt_result': processingReceiptResultMigration,
      '053_game_sync_private_writers': gameSyncPrivateWritersMigration,
      '054_game_sync_shared_writers': gameSyncSharedWritersMigration,
      '055_game_sync_scope_backfill': gameSyncScopeBackfillMigration,
      '056_village_economy_catchups': villageEconomyCatchupsMigration,
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
