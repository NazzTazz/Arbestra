import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

try {
  loadEnvFile(fileURLToPath(new URL('../../../../.env.test', import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export function testDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = environment.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for database tests. Copy .env.test.example to .env.test.');
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Refusing to use a non-test database for tests: ${databaseName || '(missing database name)'}`);
  }
  return databaseUrl;
}

export function configureE2eEnvironment(): void {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.HOST = '127.0.0.1';
  process.env.PORT = '3100';
  process.env.NODE_ENV = 'test';
  process.env.CONSTRUCTION_DURATION_MS = '3000';
  process.env.SCHEDULED_TASK_POLL_INTERVAL_MS = '250';
}
