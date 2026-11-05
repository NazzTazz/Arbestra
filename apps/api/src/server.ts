import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database/connection.js';
import { SCHEDULER_PASSES, startScheduledTaskWorker } from './jobs/scheduled-tasks.js';
import { scheduledTaskHandlers } from './jobs/task-handlers.js';
import { startSyncJournalRetention } from './modules/villages/sync-v2-retention.js';
import { startJourneyRetention } from './modules/admin/journey-journal.js';
import { operationsFor } from './modules/operations/telemetry.js';
import { observeScheduler } from './modules/operations/scheduler-observer.js';

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
// The scheduler's own connections (R1, docs/VERROUS-2026-11-04.md §11.2): one
// per pass, so that requests waiting for a village never starve it, nor it
// them. Per environment on the VPS: 8 + 3 + 2 (observation) for the API, 8
// for the generator, under max_connections = 60 for alpha and staging.
const schedulerDb = createDatabase(config.databaseUrl, undefined, { max: SCHEDULER_PASSES });
const app = await buildApp(config, db, { schedulerDb });
const operations = operationsFor(app);
const stopWorker = startScheduledTaskWorker(
  schedulerDb,
  scheduledTaskHandlers,
  config.scheduledTaskPollIntervalMs,
  () => app.log.error({ code: 'SCHEDULER_FAILED' }, 'Scheduled task worker failed'),
  operations ? observeScheduler(operations) : undefined,
);

// The V2 journal keeps 7 days or 10,000 entries per stream (bounded passes).
const stopRetention = startSyncJournalRetention(db, 5 * 60000, () =>
  app.log.error({ code: 'SYNC_RETENTION_FAILED' }, 'Synchronization journal retention failed'),
);

// Player journey rows are kept 90 days (bounded pass at start, then every 6 h),
// whether or not collection is enabled.
const stopJourneyRetention = startJourneyRetention(db, 6 * 3600000, () =>
  app.log.error({ code: 'JOURNEY_RETENTION_FAILED' }, 'Player journey retention failed'),
);

const shutdown = async () => {
  await stopJourneyRetention();
  await stopRetention();
  await stopWorker();
  await app.close();
  await schedulerDb.destroy();
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
