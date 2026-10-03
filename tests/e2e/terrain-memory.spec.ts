import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { VillageState } from '@arbestra/contracts';

test.setTimeout(480_000);
test.use({ trace: 'off', launchOptions: {
  args: process.env.TERRAIN_GPU === '1' && process.platform === 'win32' ? ['--use-angle=d3d11'] : [],
} });
test('mémoire bornée après déplacements répétés et rechargement à cadence normale', async ({ page }, info) => {
  test.skip(process.env.TERRAIN_PERF !== '1' || info.project.name !== 'chromium', 'Mesure dédiée CDP, sans suites CPU concurrentes.');
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('crash', () => errors.push('renderer crash'));
  await page.goto('/'); await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra'); await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  await page.goto('http://localhost:5274/?world=aube&terrainPerf=1');
  const canvas = page.getByTestId('village-canvas'); await expect(canvas).toBeVisible({ timeout: 40000 });
  const state = await (await page.request.get('/api/worlds/aube/village')).json() as VillageState;
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const stats = () => canvas.evaluate(el => JSON.parse(el.dataset.terrainStreaming ?? '{}') as {
    origin: { cellX: number; cellY: number };
    queued: number; resident: number; graphicPeak: number; cached: number; meshes: number; geometries: number; materials: number;
  });
  const samples: Array<Awaited<ReturnType<typeof stats>> & { heapMiB: number }> = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const offset of [0, 96, 192, 96, 0, -96]) {
      await canvas.evaluate((el, target) => el.dispatchEvent(new CustomEvent('terrain-camera', { detail: target })),
        { cellX: state.village.anchorCellX + offset, cellY: state.village.anchorCellY });
      await page.waitForTimeout(1200);
      await expect.poll(async () => (await stats()).origin, { timeout: 60000 }).toEqual({
        cellX: Math.floor((state.village.anchorCellX + offset) / 32) * 32,
        cellY: Math.floor(state.village.anchorCellY / 32) * 32,
      });
      try { await expect.poll(async () => (await stats()).queued, { timeout: 60000 }).toBe(0); }
      catch (error) { console.log('terrain memory stalled', { cycle, offset, ...await stats() }); throw error; }
      const s = await stats();
      expect(s.resident).toBeLessThanOrEqual(16); expect(s.graphicPeak).toBeLessThanOrEqual(17); expect(s.cached).toBeLessThanOrEqual(64);
    }
    await cdp.send('HeapProfiler.collectGarbage');
    const metrics = await cdp.send('Performance.getMetrics');
    samples.push({ ...await stats(), heapMiB: metrics.metrics.find(m => m.name === 'JSHeapUsedSize')!.value / 1024 ** 2 });
    console.log('terrain memory cycle', cycle, samples.at(-1));
  }
  // Same route revisited: retained memory must plateau, not follow navigation history.
  expect(samples[2]!.heapMiB).toBeLessThanOrEqual(samples[0]!.heapMiB * 1.2 + 8);
  expect(samples[2]!.meshes).toBeLessThanOrEqual(samples[0]!.meshes);
  expect(samples[2]!.geometries).toBeLessThanOrEqual(samples[0]!.geometries);
  expect(samples[2]!.materials).toBe(samples[0]!.materials);
  await page.reload(); await expect(canvas).toBeVisible({ timeout: 40000 });
  await page.waitForTimeout(1200); await expect.poll(async () => (await stats()).queued, { timeout: 60000 }).toBe(0);
  await cdp.send('HeapProfiler.collectGarbage'); const reloaded = await cdp.send('Performance.getMetrics');
  const renderer = await canvas.evaluate(el => {
    const gl = el.getContext('webgl2') ?? el.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) as string : 'unknown';
  });
  const result = { samples, reloadedHeapMiB: reloaded.metrics.find(m => m.name === 'JSHeapUsedSize')!.value / 1024 ** 2, renderer, ...await stats() };
  await writeFile('test-results/terrain-memory.json', JSON.stringify(result, null, 2));
  await info.attach('terrain-memory', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]); await cdp.detach();
});
