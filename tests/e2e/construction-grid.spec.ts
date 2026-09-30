import { expect, test } from '@playwright/test';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';

test.setTimeout(60_000);
test.beforeEach(() => resetE2eState());

test('la grille Construire reste au-dessus du terrain texturé et se retire après annulation', async ({ page }, testInfo) => {
  const errors: string[] = [];
  let expectedVertices = 0;
  let expectedAreaVertices = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('BJS')) errors.push(message.text());
  });
  page.on('request', (request) => {
    if (/\/(?:color|default)\.(?:vertex|fragment)\.fx(?:\?|$)/.test(request.url())) {
      errors.push(`Missing bundled Babylon shader: ${request.url()}`);
    }
  });
  // Render-only elevated terrain fixture; eligibility remains the real server's.
  await page.route('**/api/worlds/aube/village', async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    // Count the edges of server-authorized cells, excluding occupied footprints
    // and terrain outside the derived construction radius.
    const edges = new Set<string>();
    for (const cell of snapshot.cells.filter((cell: { canBuild: boolean }) => cell.canBuild)) {
      const { cellX: x, cellY: y } = cell;
      edges.add(`h:${x}:${y}`); edges.add(`h:${x}:${y + 1}`);
      edges.add(`v:${x}:${y}`); edges.add(`v:${x + 1}:${y}`);
    }
    expectedVertices = edges.size * 2;
    expectedAreaVertices = snapshot.cells.filter((cell: { canBuild: boolean }) => cell.canBuild).length * 4;
    snapshot.region.elevations = snapshot.region.elevations.map(() => 40);
    await route.fulfill({ response, json: snapshot });
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  const canvas = page.getByTestId('village-canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => canvas.evaluate((element) => JSON.parse(element.dataset.buildableGrid ?? '{}').construction)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('grid-normal.png') });
  await page.getByRole('button', { name: /Construire/ }).click();
  await expect.poll(() => canvas.evaluate((element) => JSON.parse(element.dataset.buildableGrid ?? '{}').construction)).toBe(true);
  await expect.poll(() => canvas.evaluate((element) => JSON.parse(element.dataset.buildableGrid ?? '{}').ready)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('grid-construction.png') });
  const grid = await canvas.evaluate((element) => JSON.parse(element.dataset.buildableGrid!));
  expect(expectedVertices).toBeGreaterThan(0);
  expect(grid.vertices).toBe(expectedVertices);
  expect(grid.blending).toBe(true);
  expect(grid.minY).toBeGreaterThan(1);
  expect(grid.areaVertices).toBe(expectedAreaVertices);
  expect(grid.areaMinY).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect.poll(() => canvas.evaluate((element) => JSON.parse(element.dataset.buildableGrid ?? '{}').construction)).toBe(false);
  await expect.poll(() => canvas.evaluate((element) => JSON.parse(element.dataset.buildableGrid ?? '{}').areaVertices)).toBe(0);
  expect(errors).toEqual([]);
});
