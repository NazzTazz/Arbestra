import { expect, test } from '@playwright/test';
import type { VillageState } from '@arbestra/contracts';

test.setTimeout(90000);
let closing = false;
test.beforeEach(() => { closing = false; });
test.afterEach(async ({ page }) => { closing = true; await page.unrouteAll({ behavior: 'ignoreErrors' }); });
test('une projection de mission attend le sol puis reprend à sa phase courante sans recréer le figurant', async ({ page }) => {
  // Visual-only fixture: no invented economic operation is persisted or credited.
  let startedAt = '';
  let anchor = { cellX: 0, cellY: 0 };
  await page.route('**/api/worlds/aube/village', async route => {
    try {
    const response = await route.fetch(), state = await response.json() as VillageState;
    // Other browser scenarios can leave real garden missions in the shared fixture.
    // This projection test observes only its synthetic extraction.
    for (const cell of state.cells) if (cell.building?.garden) {
      cell.building.garden.harvest = null;
      for (const plot of cell.building.garden.plots) plot.harvest = null;
    }
    anchor = { cellX: state.village.anchorCellX, cellY: state.village.anchorCellY };
    if (!startedAt) startedAt = new Date(Date.parse(state.serverTime) - 40000).toISOString();
    const path = Array.from({ length: 81 }, (_, i) => ({ cellX: (anchor.cellX + i) % state.world.widthCells, cellY: anchor.cellY }));
    state.village.extractions = [{ id: '11111111-1111-4111-8111-111111111111', featureId: '22222222-2222-4222-8222-222222222222',
      ...path[80]!, workerCount: 1, reservedAmount: 100, status: 'in-progress', startedAt,
      completesAt: new Date(Date.parse(startedAt) + 760000).toISOString(), completedAt: null, transportMs: 80000, path }];
    state.travelRoutes.push({ id: 'visual-fixture', kind: 'stone', destination: path[80]!, cells: path });
    await route.fulfill({ response, json: state });
    } catch (error) {
      if (closing && error instanceof Error && /Route is already handled|Target .*closed|Test ended/.test(error.message)) return;
      throw error;
    }
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local'); await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click(); await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  const canvas = page.getByTestId('village-canvas'); await expect(canvas).toBeVisible({ timeout: 40000 });
  const workers = () => canvas.evaluate(el => JSON.parse(el.dataset.workerPositions ?? '[]') as Array<{ id: string; enabled: boolean; cellX: number; cellY: number }>);
  const observation = () => canvas.evaluate(el => ({ now: Number(el.dataset.workerServerNow),
    worker: (JSON.parse(el.dataset.workerPositions!) as Array<{ id: string; cellX: number }>)[0]! }));
  const expectPhase = async () => {
    const { now, worker } = await observation();
    const expected = Math.min(80, Math.max(0, (now - Date.parse(startedAt)) / 1000));
    expect(worker.id).toBe(id); expect(Math.abs(worker.cellX - anchor.cellX - expected)).toBeLessThan(0.25);
    return now;
  };
  await expect.poll(async () => (await workers()).length).toBe(1);
  const id = (await workers())[0]!.id;
  await expect.poll(async () => (await workers())[0]!.enabled).toBe(false);
  const elapsed = (Date.now() - Date.parse(startedAt)) / 1000;
  const move = (x: number) => canvas.evaluate((el, cell) => el.dispatchEvent(new CustomEvent('terrain-camera', { detail: cell })), { cellX: x, cellY: anchor.cellY });
  await move(anchor.cellX + elapsed);
  await expect.poll(async () => (await workers())[0]!.enabled, { timeout: 20000 }).toBe(true);
  const firstShownAt = await expectPhase();
  await page.getByRole('button', { name: 'Chemins · debug' }).click();
  await expect.poll(() => canvas.getAttribute('data-debug-travel-paths')).not.toBe('0');
  await move(anchor.cellX + 180);
  await expect.poll(async () => (await workers())[0]!.enabled).toBe(false);
  await move(anchor.cellX + (Date.now() - Date.parse(startedAt)) / 1000);
  await expect.poll(async () => (await workers())[0]!.enabled, { timeout: 20000 }).toBe(true);
  expect(await expectPhase()).toBeGreaterThan(firstShownAt);
});
