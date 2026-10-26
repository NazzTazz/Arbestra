import { expect, test } from '@playwright/test';
import type { VillageState } from '@arbestra/contracts';
import { devOption, openVillage } from './world-interactions';

test.setTimeout(90000);
let closing = false;
test.beforeEach(() => {
  closing = false;
});
test.afterEach(async ({ page }) => {
  closing = true;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
test('une projection de mission attend le sol puis reprend à la même position sans recréer le figurant', async ({
  page,
}) => {
  // Visual-only fixture: no invented economic operation is persisted or credited.
  let startedAt = '';
  let anchor = { cellX: 0, cellY: 0 };
  let width = 0;
  // The synthetic extraction rewrites the historical village read; V2 would
  // need it in the change stream. To rewrite on a seeded extraction when V1 goes.
  await page.addInitScript(() => localStorage.setItem('arbestra:sync-v2', '0'));
  await page.route('**/api/worlds/aube/village', async (route) => {
    try {
      const response = await route.fetch(),
        state = (await response.json()) as VillageState;
      // Other browser scenarios can leave real garden missions in the shared fixture.
      // This projection test observes only its synthetic extraction.
      for (const cell of state.cells)
        if (cell.building?.garden) {
          cell.building.garden.harvest = null;
          for (const plot of cell.building.garden.plots) plot.harvest = null;
        }
      anchor = { cellX: state.village.anchorCellX, cellY: state.village.anchorCellY };
      width = state.world.widthCells;
      if (!startedAt) startedAt = new Date(Date.parse(state.serverTime) - 40000).toISOString();
      const path = Array.from({ length: 241 }, (_, i) => ({
        cellX: (anchor.cellX + i) % state.world.widthCells,
        cellY: anchor.cellY,
      }));
      state.village.extractions = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          featureId: '22222222-2222-4222-8222-222222222222',
          ...path[240]!,
          workerCount: 1,
          reservedAmount: 100,
          status: 'in-progress',
          startedAt,
          completesAt: new Date(Date.parse(startedAt) + 1_000_000).toISOString(),
          completedAt: null,
          transportMs: 240000,
          path,
        },
      ];
      state.travelRoutes.push({ id: 'visual-fixture', kind: 'stone', destination: path[240]!, cells: path });
      await route.fulfill({ response, json: state });
    } catch (error) {
      if (
        closing &&
        error instanceof Error &&
        /Route is already handled|Target .*closed|Test ended/.test(error.message)
      )
        return;
      throw error;
    }
  });
  const canvas = await openVillage(page);
  const workers = () =>
    canvas.evaluate(
      (el) =>
        JSON.parse(el.dataset.workerPositions ?? '[]') as Array<{
          id: string;
          enabled: boolean;
          cellX: number;
          cellY: number;
        }>,
    );
  const observation = () =>
    canvas.evaluate((el) => ({
      now: Number(el.dataset.workerServerNow),
      worker: (JSON.parse(el.dataset.workerPositions!) as Array<{ id: string; cellX: number }>)[0]!,
    }));
  const move = (x: number) =>
    canvas.evaluate((el, cell) => el.dispatchEvent(new CustomEvent('terrain-camera', { detail: cell })), {
      cellX: x,
      cellY: anchor.cellY,
    });
  await expect.poll(async () => (await workers()).length).toBe(1);
  const id = (await workers())[0]!.id;
  await expect.poll(async () => (await workers())[0]!.enabled).toBe(false);
  // Since October 12 a figure waits where it stands while its ground is
  // missing (SPEC-DEPLACEMENTS-ET-ANIMATION-CHANTIERS): look there, not at
  // where the absolute clock would put it.
  await move((await workers())[0]!.cellX);
  await expect.poll(async () => (await workers())[0]!.enabled, { timeout: 20000 }).toBe(true);
  const shown = await observation();
  expect(shown.worker.id).toBe(id);
  // A long walk (1 cell/s), so the figure is still under way whether or not
  // a slow load made the scene place it at its current phase.
  expect(shown.worker.cellX - anchor.cellX).toBeLessThan(200);
  await devOption(page, 'Chemins et transports');
  await expect.poll(() => canvas.getAttribute('data-debug-travel-paths')).not.toBe('0');
  // The ground cache keeps 64 chunks, least recently used first: stream
  // distant regions until the figure's own chunk is evicted.
  for (const turn of [0.5, 0.25, 0.75, 0.375, 0.625]) {
    await move((shown.worker.cellX + width * turn) % width);
    await page.waitForTimeout(4000);
    if (!(await workers())[0]!.enabled) break;
  }
  await expect.poll(async () => (await workers())[0]!.enabled).toBe(false);
  const hidden = (await workers())[0]!;
  // Long enough to tell a frozen walk from an advancing one (1 cell/s).
  await page.waitForTimeout(6000);
  await move(hidden.cellX);
  await expect.poll(async () => (await workers())[0]!.enabled, { timeout: 20000 }).toBe(true);
  const back = await observation();
  expect(back.worker.id).toBe(id);
  expect(back.now).toBeGreaterThan(shown.now);
  expect(back.worker.cellX).toBeGreaterThanOrEqual(hidden.cellX - 0.01);
  expect(back.worker.cellX - hidden.cellX).toBeLessThan(3);
});
