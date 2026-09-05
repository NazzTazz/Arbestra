import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database/connection.js';
import { startScheduledTaskWorker } from './jobs/scheduled-tasks.js';
import { COMPLETE_CONSTRUCTION_TASK, COMPLETE_EXPANSION_TASK, completeConstruction, completeExpansion } from './modules/villages/complete-construction.js';

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const app = await buildApp(config, db);
const stopWorker = startScheduledTaskWorker(
  db,
  { [COMPLETE_CONSTRUCTION_TASK]: completeConstruction, [COMPLETE_EXPANSION_TASK]: completeExpansion },
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
