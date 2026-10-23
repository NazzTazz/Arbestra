import { defineConfig } from 'vitest/config';

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
    fileParallelism: false,
  },
});
