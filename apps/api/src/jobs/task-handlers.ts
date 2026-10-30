import type { ScheduledTaskHandlers } from './scheduled-tasks.js';
import { COMPLETE_LEVELING_TASK } from '../modules/villages/leveling.js';
import { POPULATION_ARRIVAL_TASK } from '../modules/population/growth.js';
import { HARVEST_SUBMISSION_TASK, processHarvestSubmission } from '../modules/villages/harvest-submissions.js';
import { SCIENCE_WAKE_TASK } from '../modules/science/service.js';
import { wakeScience } from '../modules/science/worker.js';
import { ECONOMY_CATCHUP_TASK, advanceEconomyCatchup } from '../modules/villages/economy-catchup.js';
import { COMPLETE_PROCESSING_TASK } from '../modules/villages/processing.js';
import { COMPLETE_MARKET_TASK } from '../modules/villages/market.js';
import { TRADE_WAKE_TASK } from '../modules/villages/trade-economy.js';
import {
  COMPLETE_CONSTRUCTION_TASK,
  COMPLETE_EXPANSION_TASK,
  COMPLETE_GARDEN_HARVEST_TASK,
  COMPLETE_STONE_EXTRACTION_TASK,
  POPULATION_ENERGY_TASK,
  WAKE_EXTRACTION_WORKSITE_TASK,
  arrivePopulation,
  completeConstruction,
  completeExpansion,
  completeGardenHarvest,
  completeLeveling,
  completeProcessing,
  completeStoneExtraction,
  deliverMarket,
  wakeExtractionWorksite,
  wakePopulationEnergy,
  wakeTrade,
} from '../modules/villages/complete-construction.js';

/** Every economic notification the API process handles; tests drive the
 * scheduler through this same registry. */
export const scheduledTaskHandlers: ScheduledTaskHandlers = {
  [ECONOMY_CATCHUP_TASK]: advanceEconomyCatchup,
  [COMPLETE_LEVELING_TASK]: completeLeveling,
  [TRADE_WAKE_TASK]: wakeTrade,
  [POPULATION_ARRIVAL_TASK]: arrivePopulation,
  [HARVEST_SUBMISSION_TASK]: processHarvestSubmission,
  [COMPLETE_MARKET_TASK]: deliverMarket,
  [COMPLETE_PROCESSING_TASK]: completeProcessing,
  [SCIENCE_WAKE_TASK]: wakeScience,
  [COMPLETE_CONSTRUCTION_TASK]: completeConstruction,
  [COMPLETE_EXPANSION_TASK]: completeExpansion,
  [COMPLETE_GARDEN_HARVEST_TASK]: completeGardenHarvest,
  [COMPLETE_STONE_EXTRACTION_TASK]: completeStoneExtraction,
  [WAKE_EXTRACTION_WORKSITE_TASK]: wakeExtractionWorksite,
  [POPULATION_ENERGY_TASK]: wakePopulationEnergy,
};
