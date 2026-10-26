import { expect, test } from '@playwright/test';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_CELLS } from '../../apps/api/src/database/seed';
import { clickCell, openVillage, selectRectangle } from './world-interactions';

test.setTimeout(90_000);
test.beforeEach(() => resetE2eState());

// Written for the early October interface: the « Construire » button, hourly
// rates in the HUD and the garden manager are gone (2e0f94b). Rewrite on the
// mode bar (Constructions) and the garden's own panel.
test.fixme(
  'boucle économie : scierie verticale, jardin spatial et rechargements',
  async ({ page, isMobile }, testInfo) => {
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    const canvas = await openVillage(page);
    await expect(page.getByText(/\+60\/h/)).toBeVisible();
    await page.getByRole('button', { name: /Construire/ }).click();
    await page.getByRole('button', { name: 'Scierie', exact: true }).click();
    await clickCell(page, DEVELOPMENT_CELLS.sawmill, isMobile);
    await page.getByRole('button', { name: 'Confirmer' }).click();
    await expect(canvas).toHaveAttribute('data-completed-building-count', '2', { timeout: 15_000 });
    await clickCell(page, DEVELOPMENT_CELLS.sawmill, isMobile);
    await page.getByRole('button', { name: 'Améliorer — 75 bois' }).click();
    await page.reload();
    await expect(canvas).toHaveAttribute('data-completed-building-count', '2', { timeout: 15_000 });
    await expect(page.getByText(/\+168\/h/)).toBeVisible();
    await page.getByRole('button', { name: /Construire/ }).click();
    await page.getByRole('button', { name: 'Jardin', exact: true }).click();
    await selectRectangle(page, DEVELOPMENT_CELLS.garden, DEVELOPMENT_CELLS.gardenNorth, isMobile);
    await expect(page.getByText('2 cases · 100 wood')).toBeVisible();
    await page.getByRole('button', { name: 'Confirmer' }).click();
    await expect(canvas).toHaveAttribute('data-completed-building-count', '3', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Gérer les Jardins' }).click();
    await expect(page.getByText('2 parcelles actives')).toBeVisible();
    await expect(page.getByText(/\/ 1200 carottes/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('vertical-garden.png') });
    expect(browserErrors).toEqual([]);
  },
);
