import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    passWithNoTests: false,
    // Multi-command PostgreSQL scenarios must finish their cleanup before the
    // next shared-fixture test starts, including on a busy development machine.
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
