import { expect, test } from '@playwright/test';
import type { TerrainResponse, VillageState } from '@arbestra/contracts';
import { writeFile } from 'node:fs/promises';

test.setTimeout(90000);
test.use({ launchOptions: { args: process.env.TERRAIN_GPU === '1' && process.platform === 'win32' ? ['--use-angle=d3d11'] : [] } });

test('les arbres proches apparaissent rapidement après zoom, déplacement, rotation et dézoom sans recharger le sol en cache', async ({ page, isMobile }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const loads = new Map<string, number>();
  let updates = 0;
  page.on('response', async response => {
    if (response.url().includes('/terrain/updates?')) {
      if (!response.ok()) { errors.push(`refresh HTTP ${response.status()}`); return; }
      const body = await response.json().catch(() => null) as TerrainResponse | null;
      if (!body || body.chunks.some(c => 'terrainCodes' in c || 'elevations' in c)) errors.push('refresh must contain only mutable data');
      updates++; return;
    }
    if (!response.url().includes('/terrain?') || !response.ok()) return;
    const body = await response.json().catch(() => null) as TerrainResponse | null;
    for (const c of body?.chunks ?? []) { const key = `${c.chunkX}:${c.chunkY}`; loads.set(key, (loads.get(key) ?? 0) + 1); }
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local'); await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click(); await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  await page.goto('http://localhost:5274/?world=aube&terrainPerf=1');
  const canvas = page.getByTestId('village-canvas'); await expect(canvas).toBeVisible({ timeout: 40000 });
  const state = await (await page.request.get('/api/worlds/aube/village')).json() as VillageState;
  const cx = Math.floor((state.village.anchorCellX + 96) / state.world.chunkSize), cy = Math.floor((state.village.anchorCellY + 96) / state.world.chunkSize);
  const terrain = await (await page.request.get(`/api/worlds/aube/terrain?chunks=${cx},${cy}`)).json() as TerrainResponse;
  const tree = terrain.chunks[0]!.features.find(f => f.type === 'woodland'); expect(tree).toBeDefined();
  const move = (cellX: number, cellY: number, radius: number, alpha: number) => canvas.evaluate((el, target) =>
    el.dispatchEvent(new CustomEvent('terrain-camera', { detail: target })), { cellX, cellY, radius, alpha, beta: 0.84 });
  const shown = () => canvas.evaluate((el, id) => (JSON.parse(el.dataset.woodlandScreens ?? '[]') as Array<{ id: string; x: number; y: number }>).some(
    p => p.id === id && p.x > 0.05 && p.x < 0.95 && p.y > 0.1 && p.y < 0.9), tree!.id);
  await move(state.village.anchorCellX, state.village.anchorCellY, 12, 0);
  const begin = Date.now(); await move(tree!.cellX, tree!.cellY, 12, 0);
  await expect.poll(shown, { timeout: 5000, intervals: [100] }).toBe(true);
  const firstTreeMs = Date.now() - begin;
  await move(tree!.cellX, tree!.cellY, 12, Math.PI);
  await expect.poll(shown, { timeout: 3000, intervals: [100] }).toBe(true);
  await move(tree!.cellX, tree!.cellY, 100, Math.PI);
  await expect.poll(shown, { timeout: 3000, intervals: [100] }).toBe(true);
  const key = `${Math.floor(tree!.cellX / state.world.chunkSize)}:${Math.floor(tree!.cellY / state.world.chunkSize)}`;
  await expect.poll(() => loads.get(key)).toBe(1);
  await page.waitForTimeout(15000);
  await move(tree!.cellX, tree!.cellY, 12, 0);
  await expect.poll(shown, { timeout: 3000, intervals: [100] }).toBe(true);
  expect(loads.get(key)).toBe(1); expect(updates).toBeGreaterThan(0);
  await expect(page.getByText('Terrain : connexion interrompue', { exact: true })).not.toBeVisible();
  expect(errors).toEqual([]);
  const stats = await canvas.getAttribute('data-terrain-streaming');
  const result = { project: info.project.name, firstTreeMs, geometryDownloads: loads.get(key), updateRequests: updates, stats: JSON.parse(stats!) };
  console.log('terrain tree latency', result);
  await writeFile(`test-results/terrain-latency-${isMobile ? 'mobile' : 'desktop'}.json`, JSON.stringify(result, null, 2));
  await page.screenshot({ path: `test-results/terrain-latency-${isMobile ? 'mobile' : 'desktop'}.png` });
});
