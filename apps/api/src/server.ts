import { COMPLETE_LEVELING_TASK } from './modules/villages/leveling.js';
import { completeLeveling } from './modules/villages/complete-construction.js';
import { POPULATION_ARRIVAL_TASK } from './modules/population/growth.js';
import { arrivePopulation } from './modules/villages/complete-construction.js';
import { HARVEST_SUBMISSION_TASK, processHarvestSubmission } from './modules/villages/harvest-submissions.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database/connection.js';
import { startScheduledTaskWorker } from './jobs/scheduled-tasks.js';
import { startSyncJournalRetention } from './modules/villages/sync-v2-retention.js';
import { operationsFor } from './modules/operations/telemetry.js';
import { observeScheduler } from './modules/operations/scheduler-observer.js';
import { SCIENCE_WAKE_TASK } from './modules/science/service.js';
import { wakeScience } from './modules/science/worker.js';
import { ECONOMY_CATCHUP_TASK, advanceEconomyCatchup } from './modules/villages/economy-catchup.js';
import { COMPLETE_PROCESSING_TASK } from './modules/villages/processing.js';
import { completeProcessing } from './modules/villages/complete-construction.js';
import { COMPLETE_MARKET_TASK } from './modules/villages/market.js';
import { deliverMarket } from './modules/villages/complete-construction.js';
import { wakeTrade } from './modules/villages/complete-construction.js';
import { TRADE_WAKE_TASK } from './modules/villages/trade-economy.js';
import {
  COMPLETE_CONSTRUCTION_TASK,
  COMPLETE_EXPANSION_TASK,
  COMPLETE_GARDEN_HARVEST_TASK,
  COMPLETE_STONE_EXTRACTION_TASK,
  WAKE_EXTRACTION_WORKSITE_TASK,
  completeConstruction,
  completeExpansion,
  completeGardenHarvest,
  completeStoneExtraction,
  wakeExtractionWorksite,
} from './modules/villages/complete-construction.js';

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const app = await buildApp(config, db);
const operations = operationsFor(app);
const stopWorker = startScheduledTaskWorker(
  db,
  {
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
  },
  config.scheduledTaskPollIntervalMs,
  () => app.log.error({ code: 'SCHEDULER_FAILED' }, 'Scheduled task worker failed'),
  operations ? observeScheduler(operations) : undefined,
);

// The V2 journal keeps 7 days or 10,000 entries per stream (bounded passes).
const stopRetention = startSyncJournalRetention(db, 5 * 60000, () =>
  app.log.error({ code: 'SYNC_RETENTION_FAILED' }, 'Synchronization journal retention failed'),
);

const shutdown = async () => {
  await stopRetention();
  await stopWorker();
  await app.close();
  await db.destroy();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ host: config.host, port: config.port });
} catch {
  app.log.error({ code: 'SERVER_LISTEN_FAILED' }, 'Server listen failed');
  await shutdown();
  process.exitCode = 1;
}
