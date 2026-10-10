import {HARVEST_SUBMISSION_TASK,processHarvestSubmission} from './modules/villages/harvest-submissions.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database/connection.js';
import { startScheduledTaskWorker } from './jobs/scheduled-tasks.js';
import { SCIENCE_WAKE_TASK } from './modules/science/service.js';
import { wakeScience } from './modules/science/worker.js';
import { COMPLETE_PROCESSING_TASK } from './modules/villages/processing.js';
import { completeProcessing } from './modules/villages/complete-construction.js';
import { COMPLETE_MARKET_TASK } from './modules/villages/market.js';
import { deliverMarket } from './modules/villages/complete-construction.js';
import { COMPLETE_CONSTRUCTION_TASK, COMPLETE_EXPANSION_TASK, COMPLETE_GARDEN_HARVEST_TASK, COMPLETE_STONE_EXTRACTION_TASK, WAKE_EXTRACTION_WORKSITE_TASK, completeConstruction, completeExpansion, completeGardenHarvest, completeStoneExtraction, wakeExtractionWorksite } from './modules/villages/complete-construction.js';

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const app = await buildApp(config, db);
const stopWorker = startScheduledTaskWorker(
  db,
  { [HARVEST_SUBMISSION_TASK]:processHarvestSubmission, [COMPLETE_MARKET_TASK]: deliverMarket, [COMPLETE_PROCESSING_TASK]: completeProcessing, [SCIENCE_WAKE_TASK]: wakeScience, [COMPLETE_CONSTRUCTION_TASK]: completeConstruction, [COMPLETE_EXPANSION_TASK]: completeExpansion, [COMPLETE_GARDEN_HARVEST_TASK]: completeGardenHarvest, [COMPLETE_STONE_EXTRACTION_TASK]: completeStoneExtraction, [WAKE_EXTRACTION_WORKSITE_TASK]: wakeExtractionWorksite },
  config.scheduledTaskPollIntervalMs,
  (error) => app.log.error(error, 'Scheduled task worker failed'),
);

const shutdown = async () => {
  await stopWorker();
  await app.close();
  await db.destroy();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exitCode = 1;
}
