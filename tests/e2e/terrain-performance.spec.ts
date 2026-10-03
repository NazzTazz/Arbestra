import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { VillageState } from '@arbestra/contracts';

test.setTimeout(480_000);
test.use({ trace: 'off', launchOptions: {
  args: process.env.TERRAIN_GPU === '1' && process.platform === 'win32' ? ['--use-angle=d3d11'] : [],
} });
test('budget terrain à cadence normale : pan 60 s, repos 60 s et parcours préchargé', async ({ page }, testInfo) => {
  test.skip(process.env.TERRAIN_PERF !== '1' || testInfo.project.name !== 'chromium', 'Mesure dédiée, sans suites CPU concurrentes.');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('crash', () => errors.push('renderer crash'));
  let terrainRequests = 0, terrainBytes = 0, updateRequests = 0, updateBytes = 0;
  page.on('response', response => {
    if (response.url().includes('/terrain?')) {
      terrainRequests++;
      terrainBytes += Number(response.headers()['content-length'] ?? 0);
    } else if (response.url().includes('/terrain/updates?')) {
      updateRequests++;
      updateBytes += Number(response.headers()['content-length'] ?? 0);
    }
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local'); await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click(); await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  await page.goto('http://localhost:5274/?world=aube&terrainPerf=1');
  const canvas = page.getByTestId('village-canvas'); await expect(canvas).toBeVisible({ timeout: 40000 });
  const state = await (await page.request.get('/api/worlds/aube/village')).json() as VillageState;
  const x = state.village.anchorCellX, y = state.village.anchorCellY;
  const move = (cellX: number) => canvas.evaluate((el, cell) => el.dispatchEvent(new CustomEvent('terrain-camera', { detail: cell })), { cellX, cellY: y });
  const metrics = () => canvas.evaluate(el => JSON.parse(el.dataset.terrainStreaming!) as {
    queued: number; integrationP95: number; integrationMax: number; streamP95: number; streamMax: number; frameP95: number; resident: number; cached: number;
  });
  await move(x); await expect.poll(async () => (await metrics()).queued, { timeout: 60000 }).toBe(0);
  const reset = () => canvas.evaluate(el => el.dispatchEvent(new Event('terrain-metrics-reset')));
  const pan = async (page: Page) => {
    const begin = Date.now();
    while (Date.now() - begin < 60000) {
      const fraction = Math.min(1, (Date.now() - begin) / 60000);
      await move(x + 96 * fraction); await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1100); return metrics();
  };
  await reset(); const streaming = await pan(page);
  await reset();
  for (let i = 0; i < 60; i++) await page.waitForTimeout(1000);
  const stationary = await metrics();
  // Every chunk and recipe of the same route is warmed before the comparison.
  for (const point of [x + 96, x + 64, x + 32, x]) {
    await move(point); await page.waitForTimeout(1200);
    await expect.poll(async () => (await metrics()).queued, { timeout: 30000 }).toBe(0);
  }
  await reset(); const preloaded = await pan(page);
  const renderer = await canvas.evaluate(el => {
    const gl = el.getContext('webgl2') ?? el.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) as string : 'unknown';
  });
  const result = { streaming, stationary, preloaded, terrainRequests, terrainBytes, updateRequests, updateBytes, renderer, normalCadence: true, physicalMobile: false };
  await writeFile('test-results/terrain-performance.json', JSON.stringify(result, null, 2));
  await testInfo.attach('terrain-performance', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(Math.max(streaming.integrationP95, stationary.integrationP95, preloaded.integrationP95)).toBeLessThanOrEqual(4);
  expect(Math.max(streaming.integrationMax, stationary.integrationMax, preloaded.integrationMax)).toBeLessThanOrEqual(50);
  expect(Math.max(streaming.streamMax, stationary.streamMax, preloaded.streamMax)).toBeLessThanOrEqual(50);
  expect(streaming.frameP95).toBeLessThanOrEqual(preloaded.frameP95 * 1.2);
  expect(Math.max(streaming.resident, stationary.resident, preloaded.resident)).toBeLessThanOrEqual(16);
  expect(Math.max(streaming.cached, stationary.cached, preloaded.cached)).toBeLessThanOrEqual(64);
  expect(errors).toEqual([]);
});
