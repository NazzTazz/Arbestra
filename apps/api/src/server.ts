import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database/connection.js';
import { startScheduledTaskWorker } from './jobs/scheduled-tasks.js';
import { scheduledTaskHandlers } from './jobs/task-handlers.js';
import { startSyncJournalRetention } from './modules/villages/sync-v2-retention.js';
import { operationsFor } from './modules/operations/telemetry.js';
import { observeScheduler } from './modules/operations/scheduler-observer.js';

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const app = await buildApp(config, db);
const operations = operationsFor(app);
const stopWorker = startScheduledTaskWorker(
  db,
  scheduledTaskHandlers,
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
