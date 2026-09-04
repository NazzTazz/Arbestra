import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    passWithNoTests: false,
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
