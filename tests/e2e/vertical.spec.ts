import { expect, test, type Page } from '@playwright/test';

import { resetE2eState } from '../../apps/api/src/database/reset-e2e';

test.setTimeout(90_000);
test.beforeEach(() => resetE2eState());

async function clickAvailableCell(page: Page, isMobile: boolean): Promise<void> {
  const canvas = page.getByTestId('village-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not laid out');
  await expect(canvas).toHaveAttribute('data-available-site-x', /\d/);
  const position = await canvas.evaluate((element) => ({
    x: Number(element.dataset.availableSiteX), y: Number(element.dataset.availableSiteY),
  }));
  const target = { x: box.x + box.width * position.x, y: box.y + box.height * position.y };
  if (isMobile) await page.touchscreen.tap(target.x, target.y);
  else await page.mouse.click(target.x, target.y);
}

async function expectContextMenuInViewport(page: Page): Promise<void> {
  const menu = page.getByTestId('world-context-menu');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('Context menu was not laid out');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(40);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('boucle économie : scierie verticale, jardin spatial et rechargements', async ({ page, isMobile }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();

  const canvas = page.getByTestId('village-canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  browserErrors.length = 0;
  await expect(page.getByText(/\+60\/h/)).toBeVisible();
  await expect(page.getByLabel(/2.*bois/)).toBeVisible();
  await expect(page.getByLabel(/50.*carottes/)).toBeVisible();

  await clickAvailableCell(page, isMobile);
  await expectContextMenuInViewport(page);
  await page.getByRole('button', { name: 'Construire Scierie — 50 bois' }).click();
  await expect(page.getByTestId('active-notification')).toContainText('Scierie en chantier');
  await expect(page.getByText(/Chantier/)).toBeVisible();
  await expect(canvas).toHaveAttribute('data-completed-building-count', '2', { timeout: 15_000 });
  await expect(page.getByTestId('world-context-menu').getByText('Scierie', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Améliorer — 75 bois' }).click();
  await expect(page.getByText(/Niveau 1 → 2/)).toBeVisible();
  await page.reload();
  await expect(canvas).toHaveAttribute('data-building-count', '2', { timeout: 15_000 });
  await expect(canvas).toHaveAttribute('data-completed-building-count', '2', { timeout: 15_000 });
  await expect(page.getByText(/\+168\/h/)).toBeVisible();

  await clickAvailableCell(page, isMobile);
  await expectContextMenuInViewport(page);
  await page.getByRole('button', { name: 'Construire Jardin — 50 bois' }).click();
  await expect(canvas).toHaveAttribute('data-completed-building-count', '3', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Améliorer — 100 bois' }).click();
  await expect(page.getByText('Choisissez une case adjacente.')).toBeVisible();
  await clickAvailableCell(page, isMobile);
  await expect(page.getByText(/Niveau 1 → 2/)).toBeVisible();
  await expect(canvas).toHaveAttribute('data-completed-building-count', '3', { timeout: 15_000 });
  await expect(page.getByTestId('world-context-menu').getByText('Niveau 2', { exact: true })).toBeVisible();
  await expect(page.getByText(/\/ 1200 carottes/)).toBeVisible();
  await page.screenshot({
    path: isMobile ? 'art-sol/10-world-foundation-mobile.png' : 'art-sol/09-world-foundation-desktop.png',
    fullPage: true,
  });
  expect(browserErrors).toEqual([]);
});
