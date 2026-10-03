import { expect, test, type Page } from '@playwright/test';
import type { VillageState } from '@arbestra/contracts';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';

test.setTimeout(180_000);
async function stats(page: Page) {
  return page.getByTestId('village-canvas').evaluate(el => JSON.parse(el.dataset.terrainStreaming ?? '{}') as {
    origin: { cellX: number; cellY: number }; resident: number; cached: number; network: number; focusGround: boolean; queued: number;
  });
}
async function center(page: Page, cellX: number, cellY: number) {
  await page.getByTestId('village-canvas').evaluate((el, cell) => el.dispatchEvent(new CustomEvent('terrain-camera', { detail: cell })), { cellX, cellY });
  await expect.poll(async () => (await stats(page)).origin, { timeout: 15000 }).toEqual({ cellX: Math.floor(cellX / 32) * 32, cellY: Math.floor(cellY / 32) * 32 });
  await expect.poll(async () => (await stats(page)).focusGround, { timeout: 15000 }).toBe(true);
  const s = await stats(page); expect(s.resident).toBeLessThanOrEqual(16); expect(s.cached).toBeLessThanOrEqual(64); expect(s.network).toBeLessThanOrEqual(2);
}
test('streaming au-delà du village, coins du tore, retour et conservation hors ligne', async ({ page, isMobile }) => {
  await resetE2eState();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|Babylon|GLSL/i.test(message.text())) errors.push(message.text()); });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local'); await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click(); await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  const canvas = page.getByTestId('village-canvas'); await expect(canvas).toBeVisible({ timeout: 40000 });
  const state = await (await page.request.get('http://localhost:5274/api/worlds/aube/village')).json() as VillageState;
  const { anchorCellX: x, anchorCellY: y } = state.village;
  await center(page, x, y);
  for (const step of [1, 2, 3, 4]) await center(page, (x + step * state.world.widthCells / 4) % state.world.widthCells, y);
  for (const step of [1, 2, 3, 4]) await center(page, x, (y + step * state.world.heightCells / 4) % state.world.heightCells);
  await center(page, (x + 96) % 2048, (y + 96) % 1024);
  await expect.poll(async () => (await stats(page)).queued, { timeout: 60000 }).toBe(0);
  await page.screenshot({ path: `test-results/terrain-streaming-${isMobile ? 'mobile' : 'desktop'}.png` });
  for (const [cx, cy] of [[2047, 1023], [0, 1023], [0, 0], [2047, 0]]) await center(page, cx!, cy!);
  await center(page, x, y);
  // Prove picking of the original building after a full toroidal circuit,
  // before opening Construire can rebuild the static village meshes.
  const hall = state.cells.find(c => c.building?.type === 'town-hall')!;
  const point = await canvas.evaluate((el, id) => {
    const cell = (JSON.parse(el.dataset.cellScreens!) as Array<{ id: string; x: number; y: number }>).find(c => c.id === id)!;
    const bounds = el.getBoundingClientRect(); return { x: bounds.x + cell.x * bounds.width, y: bounds.y + cell.y * bounds.height };
  }, hall.id);
  if (isMobile) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
  await expect(page.locator('.building-details').getByText(state.buildingTypes.find(t => t.code === 'town-hall')!.displayName, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  // Actual pointer pan still changes the camera after several origin changes.
  const before = await canvas.getAttribute('data-camera');
  const box = (await canvas.boundingBox())!;
  if (!isMobile) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' }); await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 50, { steps: 8 }); await page.mouse.up({ button: 'right' });
    await expect.poll(() => canvas.getAttribute('data-camera')).not.toBe(before);
  }
  await center(page, x, y);
  await page.context().setOffline(true);
  try {
    for (let step = 1; step <= 5; step++) {
      await canvas.evaluate((el, cell) => el.dispatchEvent(new CustomEvent('terrain-camera', { detail: cell })), { cellX: (x + 128 * step) % 2048, cellY: y });
      await page.waitForTimeout(450);
      expect((await stats(page)).resident).toBeLessThanOrEqual(16);
    }
  } finally { await page.context().setOffline(false); }
  await center(page, x, y);
  await page.getByRole('button', { name: 'Chemins · debug' }).click();
  await expect.poll(() => canvas.getAttribute('data-debug-travel-paths')).not.toBe('0');
  await page.getByRole('button', { name: /Construire/ }).click();
  await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-buildable-grid'))!).construction).toBe(true);
  expect(errors).toEqual([]);
});
