import { defineConfig } from 'vitest/config';
import { testWorkerCount } from './apps/api/src/database/test-workers.js';

const workers = testWorkerCount();

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    passWithNoTests: false,
    // Multi-command PostgreSQL scenarios must finish their cleanup before the
    // next shared-fixture test starts, including on a busy development machine.
    testTimeout: 60_000,
    // A shared-fixture reset after a construction test deletes its buildings
    // through the synchronization triggers: allow more than the 10 s default.
    hookTimeout: 30_000,
    // Database test files run in parallel, each worker on its own clone of
    // the migrated test database (apps/api/src/database/test-workers.ts).
    // ARBESTRA_TEST_WORKERS=1 restores the serial run on the template.
    fileParallelism: workers > 1,
    maxWorkers: workers,
    globalSetup: ['apps/api/src/database/test-global-setup.ts'],
    setupFiles: ['apps/api/src/database/test-setup.ts'],
  },
});
