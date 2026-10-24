import pg from 'pg';
import { migrateToLatest } from './migrate.js';
import { testDatabaseUrl } from './test-environment.js';

/** Number of Vitest workers running database test files in parallel. Each
 * worker owns a clone of the migrated test database; 1 (default) keeps the
 * serial run on the template itself. On the 24 October laptop, 3 workers
 * took 28 min instead of 30 and timed out CPU-bound concurrency tests: the
 * suite is split across CI machines instead (.github/workflows/test.yml). */
export function testWorkerCount(environment: NodeJS.ProcessEnv = process.env): number {
  const value = Number(environment.ARBESTRA_TEST_WORKERS ?? '1');
  if (!Number.isSafeInteger(value) || value < 1 || value > 8)
    throw new Error('ARBESTRA_TEST_WORKERS must be an integer from 1 to 8.');
  return value;
}

/** arbestra_test → arbestra_2_test: the _test suffix guard still applies. */
export function workerDatabaseUrl(template: string, worker: number): string {
  const url = new URL(template);
  url.pathname = `/${url.pathname.slice(1).replace(/_test$/, '')}_${worker}_test`;
  return url.toString();
}

/** Global setup: migrate the template once, then clone it for every worker.
 * The template is never used by a test file while workers run. */
export async function cloneTestDatabases(): Promise<void> {
  const workers = testWorkerCount();
  if (workers < 2) return;
  let template: string;
  try {
    template = testDatabaseUrl();
  } catch {
    return; // No database configured: unit tests only.
  }
  await migrateToLatest(template);
  const target = new URL(template),
    name = target.pathname.slice(1);
  const admin = new URL(template);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const role = await client.query<{ rolcreatedb: boolean }>(
      'select rolcreatedb from pg_roles where rolname = current_user',
    );
    if (!role.rows[0]?.rolcreatedb)
      throw new Error(
        `Parallel database tests clone ${name}: grant once "ALTER ROLE ${target.username} CREATEDB" ` +
          'as the PostgreSQL superuser, or run serially with ARBESTRA_TEST_WORKERS=1.',
      );
    // A template must have no other session (Playwright server, another run).
    const busy = await client.query<{ n: number }>(
      'select count(*)::int as n from pg_stat_activity where datname = $1',
      [name],
    );
    if (busy.rows[0]!.n > 0)
      throw new Error(`${name} has open sessions: stop the e2e server or the other test run first.`);
    for (let worker = 1; worker <= workers; worker++) {
      const copy = new URL(workerDatabaseUrl(template, worker)).pathname.slice(1);
      await client.query(
        'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
        [copy],
      );
      // Fixed names derived from a checked *_test database, never user input.
      await client.query(`drop database if exists "${copy}"`);
      await client.query(`create database "${copy}" template "${name}" strategy file_copy`);
    }
  } finally {
    await client.end();
  }
}

/** Per-file setup in a worker: point every database test at its own clone. */
export function useWorkerDatabase(environment: NodeJS.ProcessEnv = process.env): void {
  if (testWorkerCount(environment) < 2) return;
  // Setup runs for every file of the worker: always derive from the template.
  const template = (environment.ARBESTRA_TEST_TEMPLATE_URL ??= environment.TEST_DATABASE_URL);
  if (!template) return;
  const worker = Number(environment.VITEST_POOL_ID ?? '1');
  environment.TEST_DATABASE_URL = workerDatabaseUrl(template, worker);
}
