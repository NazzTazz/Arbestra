import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { createDatabase } from '../../apps/api/src/database/connection';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { constructBuildingArea, reconcileVillageForRead } from '../../apps/api/src/modules/villages/service';
import { harvestGarden } from '../../apps/api/src/modules/villages/legacy-commands.fixture';
import { devOption, openVillage } from './world-interactions';

test.setTimeout(90_000);
test('la carte affiche les habitants low-poly et les chemins de débogage', async ({ page, isMobile }) => {
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  try {
    const state = await constructBuildingArea(
      db,
      DEVELOPMENT_IDS.account,
      'aube',
      DEVELOPMENT_IDS.village,
      'garden',
      DEVELOPMENT_CELLS.garden,
      [DEVELOPMENT_CELLS.garden, DEVELOPMENT_CELLS.gardenNorth],
      0,
    );
    // Plots appear when the reconciliation completes the zero-length worksite.
    await reconcileVillageForRead(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village);
    const gardenId = state.cells.find((cell) => cell.building?.type === 'garden')!.building!.id;
    await db
      .updateTable('gardenPlots')
      .set({ storedAmount: 13 })
      .where('worldId', '=', DEVELOPMENT_IDS.world)
      .execute();
    await harvestGarden(
      db,
      DEVELOPMENT_IDS.account,
      'aube',
      DEVELOPMENT_IDS.village,
      gardenId,
      DEVELOPMENT_CELLS.gardenNorth.cellX,
      DEVELOPMENT_CELLS.gardenNorth.cellY,
      randomUUID(),
    );
  } finally {
    await db.destroy();
  }

  const canvas = await openVillage(page);
  await expect(canvas).toHaveAttribute('data-worker-model', 'low-poly');
  await expect(canvas).toHaveAttribute('data-worker-figures', '1');
  await expect.poll(async () => Number(await canvas.getAttribute('data-worker-vertices'))).toBeGreaterThan(0);
  // Eleven boxes since the face (18 October): body, head, hair, face, limbs, hidden tool and basket.
  await expect.poll(async () => Number(await canvas.getAttribute('data-worker-vertices'))).toBeLessThan(300);
  if (!isMobile) await page.screenshot({ path: 'test-results/worker-low-poly.png' });
  await devOption(page, 'Chemins et transports');
  await expect(page.getByRole('complementary', { name: 'Outils développeur' }).getByRole('combobox')).toContainText(
    'garden',
  );
  await expect.poll(() => canvas.getAttribute('data-debug-travel-paths')).not.toBe('0');
  await page.screenshot({ path: 'test-results/travel-paths.png' });
  if (!isMobile) {
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, -550);
    await page.screenshot({ path: 'test-results/worker-low-poly-closeup.png' });
  }
  await devOption(page, 'Chemins et transports', false);
  await expect.poll(() => canvas.getAttribute('data-debug-travel-paths')).toBe('0');
});
