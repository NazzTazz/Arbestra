import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';

test.setTimeout(240_000);
test.skip(process.env.TERRAIN_PERF !== '1', 'Opt-in measured navigation on a single test database');
test.use({ launchOptions: { args: process.env.TERRAIN_GPU === '1' && process.platform === 'win32' ? ['--use-angle=d3d11'] : [] } });
test('twenty cosmology transitions retain one overview and bounded presentation resources', async ({ page }) => {
  await resetE2eState();
  const errors: string[] = [], overview: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.url().endsWith('/terrain/overview') && r.ok()) overview.push(r.url()); });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  const canvas = page.getByTestId('village-canvas');
  await expect(canvas).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: 'Monde torique' }).click();
  await expect(canvas).toHaveAttribute('data-view-mode', 'world', { timeout: 60_000 });
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const measure = async (cycle: number) => {
    await session.send('HeapProfiler.collectGarbage');
    const metrics = (await session.send('Performance.getMetrics')).metrics as Array<{ name: string; value: number }>;
    const stats = JSON.parse(await canvas.getAttribute('data-cosmology') ?? '{}') as Record<string, number>;
    return { cycle, heap: metrics.find(m => m.name === 'JSHeapUsedSize')!.value, ...stats };
  };
  const rows = [await measure(0)];
  for (let i = 1; i <= 20; i++) {
    await page.getByRole('button', { name: 'Voir cette région' }).click();
    const target = { cellX: (1024 + i * 37) % 2048, cellY: (512 + i * 23) % 1024, radius: 260 };
    await canvas.evaluate((el, target) => el.dispatchEvent(new CustomEvent('terrain-camera', { detail: target })), target);
    await expect.poll(() => canvas.getAttribute('data-view-target')).toBe(`${target.cellX},${target.cellY}`);
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Monde torique' }).click();
    await expect(canvas).toHaveAttribute('data-view-mode', 'world');
    await page.waitForTimeout(250);
    if (i % 5 === 0) rows.push(await measure(i));
  }
  const timings = await page.evaluate(async () => {
    const frames: number[] = [], updates: number[] = [], renders: number[] = [];
    let prior = performance.now();
    for (let i = 0; i < 180; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const now = performance.now(); frames.push(now - prior); prior = now;
      const stats = JSON.parse(document.querySelector<HTMLCanvasElement>('[data-testid="village-canvas"]')!.dataset.cosmology ?? '{}');
      updates.push(stats.updateMs); renders.push(stats.worldRenderMs);
    }
    const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length * .95)];
    return { frameP95: p95(frames), updateP95: p95(updates), renderP95: p95(renders) };
  });
  await writeFile('test-results/cosmology-performance.json', JSON.stringify({ rows, timings, errors, overviewDownloads: overview.length }, null, 2));
  expect(overview).toHaveLength(1); expect(errors).toEqual([]);
  expect(rows.at(-1)!.heap - rows[1]!.heap).toBeLessThan(8 * 1024 * 1024);
  expect(rows.at(-1)!.heap / rows[1]!.heap).toBeLessThan(1.2);
  expect(new Set(rows.slice(1).map(row => row.worldMeshes)).size).toBe(1);
  await page.reload();
  await expect(canvas).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: 'Monde torique' }).click();
  await expect(canvas).toHaveAttribute('data-view-mode', 'world', { timeout: 60_000 });
  await page.waitForTimeout(250);
  const reloaded = await measure(21);
  expect(reloaded.worldMeshes).toBe(rows.at(-1)!.worldMeshes);
});
