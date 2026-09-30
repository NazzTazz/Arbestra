import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../apps/api/src/database/connection';
import { replayGardenPlotMigrationForTest } from '../../apps/api/src/database/garden-migration.fixture';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { constructBuildingArea, harvestGarden } from '../../apps/api/src/modules/villages/service';
import { cellPoint, selectRectangle } from './world-interactions';

test.setTimeout(90_000);
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (/\.(png|webp)(\?|$)/.test(response.url()) && response.status() >= 400) errors.push(`Asset ${response.status()}: ${response.url()}`);
  });
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
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

async function prepareSweep(workers: number) {
  const db = createDatabase(testDatabaseUrl());
  const start = DEVELOPMENT_CELLS.garden;
  const path = [start, { cellX: start.cellX + 1, cellY: start.cellY }, { cellX: start.cellX + 1, cellY: start.cellY + 1 },
    { cellX: start.cellX + 2, cellY: start.cellY + 1 }, { cellX: start.cellX + 2, cellY: start.cellY + 2 },
    { cellX: start.cellX + 3, cellY: start.cellY + 2 }];
  try {
    for (const cell of path.slice(1)) await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 'garden', cell, [cell], 0);
    await db.updateTable('gardenPlots').set({ storedAmount: 7, remainder: 0, productionUpdatedAt: new Date() }).where('worldId', '=', DEVELOPMENT_IDS.world).execute();
    await db.updateTable('populationCohorts').set({ memberCount: workers }).where('worldId', '=', DEVELOPMENT_IDS.world).execute();
  } finally { await db.destroy(); }
  return path;
}

async function sweep(page: Page, isMobile: boolean, path: Array<{ cellX: number; cellY: number }>, backtrack: boolean) {
  const a = await cellPoint(page, path[0]!), b = await cellPoint(page, path.at(-1)!);
  const cdp = await page.context().newCDPSession(page);
  try {
    if (isMobile) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...b, id: 1 }] });
      if (backtrack) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...a, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...b, id: 1 }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      if (backtrack) { await page.mouse.move(b.x, b.y); await page.mouse.move(a.x, a.y); }
      // With no final move, pointerup itself must process the last segment.
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...b, button: 'left', clickCount: 1 });
    }
  } finally { await cdp.detach(); }
}

test('balayage rapide et retour sur ses pas récoltent chaque parcelle une seule fois', async ({ page, isMobile }, testInfo) => {
  const path = await prepareSweep(15);
  const requests: Array<{ cellX: number; cellY: number }> = [];
  page.on('request', (request) => { if (request.url().endsWith('/harvest')) requests.push(request.postDataJSON()); });
  await enterWorld(page);
  await sweep(page, isMobile, path, true);
  await expect.poll(() => requests.length, { timeout: 20_000 }).toBe(6);
  expect(requests.map(({ cellX, cellY }) => ({ cellX, cellY }))).toEqual(path);
  const db = createDatabase(testDatabaseUrl());
  try {
    await expect.poll(async () => (await db.selectFrom('gardenHarvests').select('id').where('worldId', '=', DEVELOPMENT_IDS.world).execute()).length, { timeout: 20_000 }).toBe(6);
    await page.getByRole('button', { name: 'Gérer les habitants' }).click();
    await expect(page.getByText('9 disponibles · 6 au travail · 0 au repos')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('garden-sweep.png') });
  } finally { await db.destroy(); }
});

test('le manque d’habitants conserve l’ordre et laisse les parcelles suivantes intactes', async ({ page, isMobile }, testInfo) => {
  const path = await prepareSweep(3);
  const requests: Array<{ cellX: number; cellY: number }> = [];
  page.on('request', (request) => { if (request.url().endsWith('/harvest')) requests.push(request.postDataJSON()); });
  await enterWorld(page);
  await sweep(page, isMobile, path, false);
  await expect(page.getByText('Aucun habitant disponible et reposé.', { exact: true })).toBeVisible();
  expect(requests.map(({ cellX, cellY }) => ({ cellX, cellY }))).toEqual(path.slice(0, 4));
  const db = createDatabase(testDatabaseUrl());
  try {
    const harvested = await db.selectFrom('gardenHarvests').select(['plotCellX', 'plotCellY']).where('worldId', '=', DEVELOPMENT_IDS.world).orderBy('startedAt').execute();
    expect(harvested.map((row) => ({ cellX: row.plotCellX, cellY: row.plotCellY }))).toEqual(path.slice(0, 3));
    for (const cell of path.slice(3)) expect(Number((await db.selectFrom('gardenPlots').select('storedAmount').where('worldId', '=', DEVELOPMENT_IDS.world)
      .where('cellX', '=', cell.cellX).where('cellY', '=', cell.cellY).executeTakeFirstOrThrow()).storedAmount)).toBe(7);
    await page.screenshot({ path: testInfo.outputPath('garden-workers-limit.png') });
  } finally { await db.destroy(); }
});

test('un autre Jardin reste accessible et le rectangle tolérant fusionne après le chantier', async ({ page, isMobile }, testInfo) => {
  const db = createDatabase(testDatabaseUrl());
  const left = DEVELOPMENT_CELLS.garden, right = { cellX: left.cellX + 2, cellY: left.cellY };
  try {
    await constructBuildingArea(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, 'garden', right, [right], 0);
    await db.updateTable('villageResourceFlows').set({ baseRatePerHour: 0 }).where('worldId', '=', DEVELOPMENT_IDS.world).execute();
    const wood = Number((await db.selectFrom('villageResources').select('amount').where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow()).amount);
    await enterWorld(page);
    await page.getByRole('button', { name: 'Gérer les Jardins' }).click();
    await page.getByRole('button', { name: /Jardin 2/ }).click();
    await expect(page.getByRole('button', { name: /Parcelle 1026, 512/ })).toBeVisible();
    await page.getByRole('button', { name: /Étendre/ }).click();
    await selectRectangle(page, left, { ...right, cellY: right.cellY + 1 }, isMobile);
    await expect(page.getByText('3 cases · 150 wood')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('garden-extension-preview.png') });
    await page.getByRole('button', { name: 'Confirmer' }).click();
    await expect(page.getByText('Extension du Jardin lancée')).toBeVisible();
    await expect.poll(async () => (await db.selectFrom('gardenPlots').select('cellX').where('worldId', '=', DEVELOPMENT_IDS.world).execute()).length, { timeout: 15_000 }).toBe(6);
    await page.getByRole('button', { name: 'Gérer les Jardins' }).click();
    await expect(page.getByText('6 parcelles actives')).toBeVisible();
    expect(Number((await db.selectFrom('villageResources').select('amount').where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow()).amount)).toBe(wood - 150);
    await page.screenshot({ path: testInfo.outputPath('garden-fused.png') });
    // Zoom and camera movement must remain available outside harvesting.
    const canvas = page.getByTestId('village-canvas');
    const before = await canvas.getAttribute('data-camera');
    const empty = await cellPoint(page, { cellX: left.cellX - 1, cellY: left.cellY - 1 });
    if (isMobile) {
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...empty, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: empty.x + 35, y: empty.y + 20, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally { await cdp.detach(); }
    } else {
      await page.mouse.move(empty.x, empty.y); await page.mouse.down({ button: 'right' });
      await page.mouse.move(empty.x + 35, empty.y + 20); await page.mouse.up({ button: 'right' });
    }
    await expect.poll(() => canvas.getAttribute('data-camera')).not.toBe(before);
    const afterPan = await canvas.getAttribute('data-camera');
    await page.mouse.wheel(0, 180);
    await expect.poll(() => canvas.getAttribute('data-camera')).not.toBe(afterPan);
    expect(await db.selectFrom('gardenHarvests').select('id').where('worldId', '=', DEVELOPMENT_IDS.world).execute()).toHaveLength(0);
  } finally { await db.destroy(); }
});

test('une réponse perdue est résolue avec le même reçu après une fusion visible', async ({ page }, testInfo) => {
  const db = createDatabase(testDatabaseUrl());
  let release!: () => void;
  const retryGate = new Promise<void>((done) => { release = done; });
  const requests: Array<{ commandId: string }> = [];
  await page.route('**/harvest', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length > 1) { await retryGate; await route.continue(); return; }
    await route.fetch(); // The real server has accepted and reserved the crop.
    await db.transaction().execute(async (tx) => {
      await tx.selectFrom('villages').select('id').where('id', '=', DEVELOPMENT_IDS.village).forUpdate().executeTakeFirstOrThrow();
      const id = '00000000-0000-4000-8000-000000000001';
      await tx.insertInto('buildings').values({ id, worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village,
        buildingType: 'garden', level: 1, targetLevel: null, status: 'completed', constructionStartedAt: null,
        constructionCompletesAt: null, completedAt: new Date() }).execute();
      await tx.insertInto('worldCellOccupancies').values({ worldId: DEVELOPMENT_IDS.world, cellX: 1025, cellY: 512,
        buildingId: id, featureId: null, role: 'anchor', pendingExpansionId: null }).execute();
      await tx.insertInto('gardenPlots').values({ worldId: DEVELOPMENT_IDS.world, villageId: DEVELOPMENT_IDS.village,
        buildingId: id, cellX: 1025, cellY: 512, storedAmount: 0, remainder: 0, productionUpdatedAt: new Date() }).execute();
    });
    await route.abort('failed');
  });
  try {
    await enterWorld(page);
    await page.getByRole('button', { name: 'Gérer les Jardins' }).click();
    await page.getByRole('button', { name: /Parcelle 1024, 512/ }).click();
    await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('3 parcelles actives')).toBeVisible();
    await expect.poll(() => requests.length).toBe(2);
    await expect(page.getByTestId('village-canvas')).toHaveAttribute('data-rendered-pending-harvests', '1');
    await page.screenshot({ path: testInfo.outputPath('garden-uncertain-after-fusion.png') });
    release();
    await expect(page.getByRole('button', { name: /Parcelle 1024, 512 · en cours/ })).toBeVisible();
    expect(requests[1]!.commandId).toBe(requests[0]!.commandId);
    expect(await db.selectFrom('gardenHarvests').select('id').where('worldId', '=', DEVELOPMENT_IDS.world).execute()).toHaveLength(1);
    await page.screenshot({ path: testInfo.outputPath('garden-retry-resolved.png') });
  } finally { release(); await db.destroy(); }
});

async function enterWorld(page: Page) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  await expect(page.getByTestId('village-canvas')).toBeVisible({ timeout: 15_000 });
}

test('un trajet global historique protège les parcelles puis livre une seule fois', async ({ page }, testInfo) => {
  const db = createDatabase(testDatabaseUrl());
  try {
    const plots = await db.selectFrom('gardenPlots').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).orderBy('cellY').execute();
    for (const plot of plots) await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
      plot.buildingId, plot.cellX, plot.cellY, randomUUID());
    const work = await db.selectFrom('gardenHarvests').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).orderBy('startedAt').execute();
    // Reconstitute only the pre-015 Garden tables inside the test transaction,
    // then run the actual migration before opening the browser session.
    await db.transaction().execute(async (tx) => {
      await tx.selectFrom('villages').select('id').where('id', '=', DEVELOPMENT_IDS.village).forUpdate().executeTakeFirstOrThrow();
      await tx.updateTable('populationCohorts').set({ harvestId: work[0]!.id }).where('harvestId', '=', work[1]!.id).execute();
      await tx.deleteFrom('scheduledTasks').where('subjectId', '=', work[1]!.id).execute();
      await tx.deleteFrom('gardenHarvests').where('id', '=', work[1]!.id).execute();
      await tx.updateTable('gardenHarvests').set({ workerCount: 2, reservedCarrots: 612 })
        .where('id', '=', work[0]!.id).execute();
      await tx.updateTable('buildingResourceBuffers').set({ storedAmount: 52, remainder: 0.5,
        productionUpdatedAt: new Date(Date.now() + 3_600_000) }).where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('buildingId', '=', plots[0]!.buildingId).where('resourceCode', '=', 'carrot').execute();
      const before = await tx.selectFrom('gardenHarvests').selectAll().where('id', '=', work[0]!.id).executeTakeFirstOrThrow();
      await replayGardenPlotMigrationForTest(tx);
      const after = await tx.selectFrom('gardenHarvests').selectAll().where('id', '=', work[0]!.id).executeTakeFirstOrThrow();
      expect(after).toEqual({ ...before, plotCellX: null, plotCellY: null });
      expect(Number((await tx.selectFrom('villageResources').select('amount').where('villageId', '=', DEVELOPMENT_IDS.village)
        .where('resourceCode', '=', 'carrot').executeTakeFirstOrThrow()).amount)).toBe(50);
      const migrated = await tx.selectFrom('gardenPlots').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).orderBy('cellY').execute();
      expect(migrated.map((plot) => Number(plot.storedAmount))).toEqual([26, 26]);
      expect(migrated.map((plot) => Number(plot.remainder))).toEqual([0, 0.5]);
    });
    await enterWorld(page);
    await page.getByRole('button', { name: 'Gérer les Jardins' }).click();
    await expect(page.getByText('2 récolteurs · 612 carottes en transit')).toBeVisible();
    await expect(page.getByRole('button', { name: /Parcelle 1024, 512/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Parcelle 1024, 513/ })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('garden-legacy-global.png') });
    await db.updateTable('gardenHarvests').set({ completesAt: new Date(Date.now() - 1) }).where('id', '=', work[0]!.id).execute();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: /Parcelle 1024, 512 · 26 carottes/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: /Parcelle 1024, 513 · 26 carottes/ })).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(async () => Number((await db.selectFrom('villageResources').select('amount')
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'carrot').executeTakeFirstOrThrow()).amount)).toBe(662);
    expect(await db.selectFrom('gardenHarvests').select('id').where('worldId', '=', DEVELOPMENT_IDS.world).execute()).toHaveLength(1);
    expect(await db.selectFrom('populationCohorts').select('id').where('harvestId', '=', work[0]!.id).execute()).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath('garden-legacy-delivered.png') });
  } finally { await db.destroy(); }
});

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
