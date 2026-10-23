// Inspection uses public landscape knowledge; no persistent command is allowed.
/* global window,console,process,EventTarget,URL */
import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const url = new URL(process.env.RC1_BROWSER_URL ?? 'http://localhost:5278/');
if (url.hostname !== 'localhost') throw Error('Local inspection fixture only');
const state = JSON.parse(readFileSync('tests/fixtures/village-sync-state.json', 'utf8'));
state.serverTime = new Date().toISOString();
const unknown = {
  id: 'aaaa1111-1111-4111-8111-111111111111',
  type: 'stone_outcrop',
  cellX: 63,
  cellY: 62,
  variantSeed: 2000,
  deposit: null,
  rc1: { trees: [], rocks: [{ x: 63, y: 62, elevation: 0.25, width: 1.5, depth: 1.5, height: 0.8, rotation: 0 }] },
};
const known = {
  ...unknown,
  id: 'aaaa2222-2222-4222-8222-222222222222',
  cellX: 60,
  rc1: { trees: [], rocks: [{ ...unknown.rc1.rocks[0], x: 60 }] },
  deposit: {
    featureId: 'aaaa2222-2222-4222-8222-222222222222',
    resourceCode: 'stone',
    initialAmount: 2000,
    remainingAmount: 2000,
    availableAmount: 2000,
    reservedAmount: 0,
    revision: 1,
    state: 'available',
    blocksCell: true,
    cleared: false,
    cellX: 60,
    cellY: 62,
    updatedAt: state.serverTime,
  },
};
const browser = await chromium.launch({ channel: 'chrome' }),
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let unknownReads = 0,
  knownReads = 0;
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.addInitScript(() => {
    window.EventSource = class extends EventTarget {
      close() {}
      constructor(url) {
        super();
        this.url = url;
      }
    };
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      parsed = new URL(request.url()),
      path = parsed.pathname;
    if (request.method() !== 'GET') throw Error('Unexpected persistent command ' + path);
    if (path.endsWith('/village')) return route.fulfill({ json: state });
    if (path.endsWith('/features/' + unknown.id)) {
      unknownReads++;
      return route.fulfill({ status: 404, json: { code: 'DEPOSIT_NOT_FOUND', message: 'Gisement inconnu.' } });
    }
    if (path.endsWith('/features/' + known.id)) {
      knownReads++;
      return route.fulfill({
        json: {
          deposit: known.deposit,
          eligibility: { inRange: true, protected: false, onBoundary: true, workerOptions: [] },
        },
      });
    }
    if (path.endsWith('/terrain') || path.endsWith('/terrain/updates')) {
      const chunks = (parsed.searchParams.get('chunks') ?? '')
        .split(';')
        .filter(Boolean)
        .map((item) => {
          const [chunkX, chunkY] = item.split(',').map(Number);
          return {
            chunkX,
            chunkY,
            originCellX: chunkX * 32,
            originCellY: chunkY * 32,
            terrainCodes: Array(34 ** 2).fill(1),
            elevations: Array(34 ** 2).fill(25),
            rc1: { stride: 65, heights: Array(65 ** 2).fill(0.25), water: Array(65 ** 2).fill(0), terraces: [] },
            features: [unknown, known].filter(
              (f) => Math.floor(f.cellX / 32) === chunkX && Math.floor(f.cellY / 32) === chunkY,
            ),
            occupiedCells: [],
          };
        });
      return route.fulfill({ json: { world: state.world, chunks } });
    }
    return route.fulfill({ json: {} });
  });
  url.pathname = '/';
  url.searchParams.set('world', state.world.slug);
  await page.goto(url.href);
  const canvas = page.locator('canvas[data-building-count]');
  await expect(canvas).toHaveAttribute('data-building-count', '2', { timeout: 60000 });
  if (!(await page.getByRole('button', { name: 'Exploitation', exact: true }).isVisible()))
    await page.locator('nav[aria-label="Modes du monde"] button').first().click();
  await page.getByRole('button', { name: 'Exploitation', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-world-interaction-ready', 'true', { timeout: 60000 });
  const inspect = async (id) => {
    if (await page.locator('.world-context-menu').count()) {
      await page.keyboard.press('Escape');
      await expect(page.locator('.world-context-menu')).toHaveCount(0);
      const button = page.getByRole('button', { name: 'Exploitation', exact: true });
      if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    }
    await expect
      .poll(
        () => canvas.evaluate((c, id) => JSON.parse(c.dataset.featureScreens || '[]').some((f) => f.id === id), id),
        { timeout: 60000 },
      )
      .toBe(true);
    const screen = await canvas.evaluate((c, id) => JSON.parse(c.dataset.featureScreens).find((f) => f.id === id), id),
      box = await canvas.boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + screen.x * box.width, box.y + screen.y * box.height - 50);
    await page.keyboard.up('Shift');
  };
  await inspect(unknown.id);
  await expect(page.getByText('Ressource non relevée', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Relevé géographique nécessaire.', { exact: true })).toBeVisible();
  expect(unknownReads).toBe(0);
  await expect(page.getByText('Gisement inconnu.', { exact: true })).toHaveCount(0);
  await inspect(known.id);
  await expect(page.getByText('Gisement de pierre', { exact: true })).toBeVisible();
  expect(knownReads).toBe(1);
  await expect(page.getByText('Ressource non relevée', { exact: true })).toHaveCount(0);
  await inspect(unknown.id);
  await expect(page.getByText('Ressource non relevée', { exact: true })).toBeVisible();
  await expect(page.locator('.world-context-menu').getByText(/disponibles/)).toHaveCount(0);
  expect(unknownReads).toBe(0);
  await page.screenshot({ path: 'test-results/rc1-deposit-inspection.png' });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ result: 'passed', unknownReads, knownReads, errors }));
} catch (error) {
  await page.screenshot({ path: 'test-results/rc1-deposit-failure.png' });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
