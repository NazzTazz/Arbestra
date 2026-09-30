import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { createDatabase } from '../../apps/api/src/database/connection';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { constructBuildingArea, harvestGarden } from '../../apps/api/src/modules/villages/service';

test.setTimeout(90_000);
test('la carte affiche les habitants low-poly et les chemins de débogage', async ({ page, isMobile }) => {
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  try {
    const state = await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 'garden',
      DEVELOPMENT_CELLS.garden, [DEVELOPMENT_CELLS.garden, DEVELOPMENT_CELLS.gardenNorth], 0);
    const gardenId = state.cells.find((cell) => cell.building?.type === 'garden')!.building!.id;
    await db.updateTable('gardenPlots').set({ storedAmount: 13 }).where('worldId', '=', DEVELOPMENT_IDS.world).execute();
    await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, gardenId,
      DEVELOPMENT_CELLS.gardenNorth.cellX, DEVELOPMENT_CELLS.gardenNorth.cellY, randomUUID());
  } finally { await db.destroy(); }

  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  const canvas = page.getByTestId('village-canvas');
  await expect(canvas).toBeVisible({ timeout: 40_000 });
  await expect(canvas).toHaveAttribute('data-worker-model', 'low-poly');
  await expect(canvas).toHaveAttribute('data-worker-figures', '1');
  await expect.poll(async () => Number(await canvas.getAttribute('data-worker-vertices'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas.getAttribute('data-worker-vertices'))).toBeLessThan(250);
  if (!isMobile) await page.screenshot({ path: 'test-results/worker-low-poly.png' });
  const toggle = page.getByRole('button', { name: 'Chemins · debug' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Itinéraire')).toContainText('garden');
  await expect.poll(() => canvas.getAttribute('data-debug-travel-paths')).not.toBe('0');
  await page.screenshot({ path: 'test-results/travel-paths.png' });
  if (!isMobile) {
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, -550);
    await page.screenshot({ path: 'test-results/worker-low-poly-closeup.png' });
  }
  await toggle.click();
  await expect.poll(() => canvas.getAttribute('data-debug-travel-paths')).toBe('0');
});
