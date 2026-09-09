import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '../../apps/api/src/database/connection';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { constructBuildingArea } from '../../apps/api/src/modules/villages/service';

test.setTimeout(60_000);
test.beforeEach(async () => {
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  try {
    await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 'garden',
      DEVELOPMENT_CELLS.garden, [DEVELOPMENT_CELLS.garden, DEVELOPMENT_CELLS.gardenNorth], 0);
    await db.updateTable('gardenPlots').set({ storedAmount: 12, remainder: 0, productionUpdatedAt: new Date() })
      .where('worldId', '=', DEVELOPMENT_IDS.world).execute();
    await db.updateTable('gardenPlots').set({ storedAmount: 600 })
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('cellX', '=', DEVELOPMENT_CELLS.garden.cellX)
      .where('cellY', '=', DEVELOPMENT_CELLS.garden.cellY).execute();
  } finally { await db.destroy(); }
});

async function enterWorld(page: Page) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  await expect(page.getByTestId('village-canvas')).toBeVisible({ timeout: 15_000 });
}

test('chaque parcelle se récolte au clavier sans vider sa voisine', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await enterWorld(page);
  browserErrors.length = 0;
  await page.screenshot({ path: testInfo.outputPath('garden-world.png') });
  await page.getByRole('button', { name: 'Gérer les Jardins' }).click();
  const full = page.getByRole('button', { name: /Parcelle 1024, 512/ });
  const neighbour = page.getByRole('button', { name: /Parcelle 1024, 513/ });
  await expect(full).toContainText('600 carottes');
  await expect(neighbour).toContainText('12 carottes');
  await page.screenshot({ path: testInfo.outputPath('garden-panel.png') });
  await full.focus();
  await expect(full).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Parcelle 1024, 512 · en cours/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Parcelle 1024, 513 · 12 carottes/ })).toBeVisible();
  await page.getByRole('button', { name: 'Gérer les habitants' }).click();
  await expect(page.getByText('14 disponibles · 1 au travail · 0 au repos')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('garden-harvest.png') });
  expect(browserErrors).toEqual([]);
});
