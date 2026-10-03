import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { createDatabase } from '../../apps/api/src/database/connection';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';

test.setTimeout(150_000);

test.afterAll(async () => {
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  try {
    const fixture = await db.selectFrom('stoneDeposits').innerJoin('worldFeatures', (join) => join
      .onRef('worldFeatures.worldId', '=', 'stoneDeposits.worldId')
      .onRef('worldFeatures.id', '=', 'stoneDeposits.featureId'))
      .select('stoneDeposits.featureId')
      .where('stoneDeposits.worldId', '=', DEVELOPMENT_IDS.world)
      .where('stoneDeposits.cellX', '=', 1024).where('stoneDeposits.cellY', '=', 514)
      .where('worldFeatures.variantSeed', '=', 42).executeTakeFirst();
    if (!fixture) return;
    await db.transaction().execute(async (transaction) => {
      await transaction.deleteFrom('stoneDeposits').where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('featureId', '=', fixture.featureId).execute();
      await transaction.deleteFrom('worldFeatures').where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('id', '=', fixture.featureId).execute();
    });
  } finally { await db.destroy(); }
});

test('une inspection lente laisse démarrer une extraction', async ({ page, isMobile }) => {
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  let featureId = randomUUID();
  try {
    const existing = await db.selectFrom('worldCellOccupancies').select('featureId')
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('cellX', '=', 1024).where('cellY', '=', 514).executeTakeFirst();
    if (existing?.featureId) featureId = existing.featureId;
    else {
      expect(existing).toBeUndefined();
      await db.insertInto('worldFeatures').values({ id: featureId, worldId: DEVELOPMENT_IDS.world,
        featureTypeCode: 'stone_outcrop', state: 'available', variantSeed: 42 }).execute();
      await db.insertInto('worldCellOccupancies').values({ worldId: DEVELOPMENT_IDS.world, featureId,
        buildingId: null, pendingExpansionId: null, cellX: 1024, cellY: 514, role: 'body' }).execute();
      await db.insertInto('stoneDeposits').values({ worldId: DEVELOPMENT_IDS.world, featureId,
        cellX: 1024, cellY: 514, initialAmount: 1000, remainingAmount: 1000,
        reservedAmount: 0, revision: 1, updatedAt: new Date() }).execute();
    }
  } finally { await db.destroy(); }

  let inspections = 0;
  let streamed = false;
  page.on('response', async response => {
    if (!response.url().includes('/terrain?') || !response.ok()) return;
    const body = await response.json().catch(() => null) as { chunks?: Array<{ features: Array<{ id: string }> }> } | null;
    if (body?.chunks?.some(c => c.features.some(f => f.id === featureId))) streamed = true;
  });
  await page.route((url) => url.pathname.endsWith(`/features/${featureId}`), async (route) => {
    inspections++;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.continue();
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  const canvas = page.getByTestId('village-canvas');
  await expect(canvas).toBeVisible({ timeout: 40_000 });
  try {
    await expect.poll(() => canvas.evaluate((element, id) =>
      (JSON.parse(element.dataset.featureScreens ?? '[]') as Array<{ id: string }>).some((item) => item.id === id), featureId), { timeout: 30000 }).toBe(true);
  } catch (error) {
    console.log('stone render diagnostics', { streamed, streaming: await canvas.getAttribute('data-terrain-streaming'), features: await canvas.getAttribute('data-feature-screens') });
    throw error;
  }
  const point = await canvas.evaluate((element, id) => {
    const positions = JSON.parse(element.dataset.featureScreens ?? '[]') as Array<{ id: string; x: number; y: number }>;
    const feature = positions.find((item) => item.id === id);
    if (!feature) return null;
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width * feature.x, y: box.y + box.height * feature.y };
  }, featureId);
  expect(point).not.toBeNull();
  if (isMobile) await page.touchscreen.tap(point!.x, point!.y);
  else await page.mouse.click(point!.x, point!.y);
  const extract = page.getByRole('button', { name: 'Extraire avec 1 habitant' });
  await expect(extract).toBeEnabled({ timeout: 20_000 });
  expect(inspections).toBe(1);
  const started = page.waitForResponse((response) => response.url().endsWith('/extractions') &&
    response.request().method() === 'POST' && response.ok(), { timeout: 45_000 });
  await extract.click();
  await started;
  await expect(page.getByText(/Extraction lancée/)).toBeVisible({ timeout: 10_000 });
  await expect(canvas).toHaveAttribute('data-worker-model', 'low-poly');
  await expect.poll(async () => Number(await canvas.getAttribute('data-worker-figures'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas.getAttribute('data-worker-vertices'))).toBeLessThan(250);
  if (!isMobile) {
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    for (let step = 0; step < 7; step++) await page.mouse.wheel(0, -1_000);
    await page.screenshot({ path: 'test-results/worker-low-poly.png' });
  }
});
