import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'corepack pnpm --filter @arbestra/api serve:e2e',
      url: 'http://127.0.0.1:3100/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'corepack pnpm --filter @arbestra/play-web dev:e2e --host localhost',
      url: 'http://localhost:5273',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'corepack pnpm --filter @arbestra/world-web dev:e2e --host localhost',
      url: 'http://localhost:5274',
      reuseExistingServer: false,
      timeout: 60_000,
    }
  ],
});
