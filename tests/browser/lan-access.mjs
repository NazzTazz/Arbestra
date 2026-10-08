// Read-only LAN smoke test after normal login. No gameplay commands are sent.
/* global window, process, fetch, console, navigator */
import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const host = process.argv[2] ?? '192.168.1.4';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`http://${host}:5173`);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  const link = page.locator('.world-card').first();
  await expect(link).toHaveAttribute('href', `http://${host}:5174?world=aube`, { timeout: 120000 });
  await page.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort());
  await link.click();
  await page.getByTestId('village-canvas').waitFor({ timeout: 120000 });
  await page.locator('.terrain-loading').waitFor({ state: 'hidden', timeout: 120000 });
  const capabilities = await page.evaluate(async () => {
    const { randomUUID } = await import('/src/random-uuid.ts');
    return { url: window.location.href, secureContext: window.isSecureContext,
      nativeUUID: typeof window.crypto.randomUUID, commandId: randomUUID(),
      sessionStatus: (await fetch('/api/auth/session')).status };
  });
  expect(capabilities.secureContext).toBe(false);
  expect(capabilities.nativeUUID).toBe('undefined');
  expect(capabilities.commandId).toMatch(/^[0-9a-f-]{36}$/);
  expect(capabilities.sessionStatus).toBe(200);
  await page.waitForFunction(() => {
    const canvas = window.document.querySelector('[data-testid="village-canvas"]');
    return canvas?.width > 0 && canvas?.height > 0;
  });
  await page.screenshot({ path: 'test-results/lan-village.png' });
  // Unauthenticated world client returns to the lobby on the same LAN host.
  await page.context().clearCookies();
  await page.reload();
  await page.getByRole('link', { name: 'Se connecter pour entrer dans ce monde' }).click({ timeout: 120000 });
  await page.waitForURL(`http://${host}:5173/`, { timeout: 120000 });
  expect(errors).toEqual([]);
  await writeFile('test-results/lan-access.json', JSON.stringify({ capabilities, lobbyReturn: page.url(), errors }, null, 2));
  console.log(JSON.stringify(capabilities));
} finally { await browser.close(); }
