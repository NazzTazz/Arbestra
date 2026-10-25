import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { createDatabase } from '../../apps/api/src/database/connection';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { openVillage } from './world-interactions';

test.setTimeout(150_000);

test.afterAll(async () => {
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  try {
    const fixture = await db
      .selectFrom('stoneDeposits')
      .innerJoin('worldFeatures', (join) =>
        join
          .onRef('worldFeatures.worldId', '=', 'stoneDeposits.worldId')
          .onRef('worldFeatures.id', '=', 'stoneDeposits.featureId'),
      )
      .select('stoneDeposits.featureId')
      .where('stoneDeposits.worldId', '=', DEVELOPMENT_IDS.world)
      .where('stoneDeposits.cellX', '=', 1024)
      .where('stoneDeposits.cellY', '=', 514)
      .where('worldFeatures.variantSeed', '=', 42)
      .executeTakeFirst();
    if (!fixture) return;
    await db.transaction().execute(async (transaction) => {
      await transaction
        .deleteFrom('stoneDeposits')
        .where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('featureId', '=', fixture.featureId)
        .execute();
      await transaction
        .deleteFrom('worldFeatures')
        .where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('id', '=', fixture.featureId)
        .execute();
    });
  } finally {
    await db.destroy();
  }
});

test('un geste pierre démarre une extraction sans attendre une inspection', async ({ page, isMobile }, testInfo) => {
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  let featureId = randomUUID();
  try {
    const existing = await db
      .selectFrom('worldCellOccupancies')
      .select('featureId')
      .where('worldId', '=', DEVELOPMENT_IDS.world)
      .where('cellX', '=', 1024)
      .where('cellY', '=', 514)
      .executeTakeFirst();
    if (existing?.featureId) featureId = existing.featureId;
    else {
      expect(existing).toBeUndefined();
      await db
        .insertInto('worldFeatures')
        .values({
          id: featureId,
          worldId: DEVELOPMENT_IDS.world,
          featureTypeCode: 'stone_outcrop',
          state: 'available',
          variantSeed: 42,
        })
        .execute();
      await db
        .insertInto('worldCellOccupancies')
        .values({
          worldId: DEVELOPMENT_IDS.world,
          featureId,
          buildingId: null,
          pendingExpansionId: null,
          cellX: 1024,
          cellY: 514,
          role: 'body',
        })
        .execute();
      await db
        .insertInto('stoneDeposits')
        .values({
          worldId: DEVELOPMENT_IDS.world,
          featureId,
          cellX: 1024,
          cellY: 514,
          initialAmount: 1000,
          remainingAmount: 1000,
          reservedAmount: 0,
          revision: 1,
          updatedAt: new Date(),
        })
        .execute();
    }
  } finally {
    await db.destroy();
  }

  let inspections = 0;
  let streamed = false;
  page.on('response', async (response) => {
    if (!response.url().includes('/terrain?') || !response.ok()) return;
    const body = (await response.json().catch(() => null)) as {
      chunks?: Array<{ features: Array<{ id: string }> }>;
    } | null;
    if (body?.chunks?.some((c) => c.features.some((f) => f.id === featureId))) streamed = true;
  });
  await page.route(
    (url) => url.pathname.endsWith(`/features/${featureId}`),
    async (route) => {
      inspections++;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    },
  );
  const canvas = await openVillage(page);
  await page.getByRole('button', { name: 'Vue libre', exact: true }).click();
  await page.getByRole('button', { name: 'Exploitation', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-world-interaction-ready', 'true', { timeout: 40_000 });
  try {
    await expect
      .poll(
        () =>
          canvas.evaluate(
            (element, id) =>
              (JSON.parse(element.dataset.featureScreens ?? '[]') as Array<{ id: string }>).some(
                (item) => item.id === id,
              ),
            featureId,
          ),
        { timeout: 30000 },
      )
      .toBe(true);
  } catch (error) {
    console.log('stone render diagnostics', {
      streamed,
      streaming: await canvas.getAttribute('data-terrain-streaming'),
      features: await canvas.getAttribute('data-feature-screens'),
    });
    throw error;
  }
  await page
    .getByRole('region', { name: 'Récolte', exact: true })
    .getByRole('button', { name: 'Pierre brute', exact: true })
    .click();
  if (isMobile) {
    // Reframe the target above the taller worksite card before the actual touch gesture.
    await page.mouse.move(60, 400);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(60, 130, { steps: 12 });
    await page.mouse.up({ button: 'right' });
  }
  const hideHint = page.getByRole('button', { name: 'Masquer', exact: true });
  if (await hideHint.isVisible()) await hideHint.click();
  await expect
    .poll(() =>
      canvas.evaluate((element, id) => {
        const feature = (
          JSON.parse(element.dataset.featureScreens ?? '[]') as Array<{ id: string; x: number; y: number }>
        ).find((item) => item.id === id)!;
        const box = element.getBoundingClientRect();
        return document
          .elementFromPoint(box.x + box.width * feature.x, box.y + box.height * feature.y)
          ?.getAttribute('data-testid');
      }, featureId),
    )
    .toBe('village-canvas');
  const point = await canvas.evaluate((element, id) => {
    const feature = (
      JSON.parse(element.dataset.featureScreens ?? '[]') as Array<{ id: string; x: number; y: number }>
    ).find((item) => item.id === id)!;
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width * feature.x, y: box.y + box.height * feature.y };
  }, featureId);
  // Current UI submits durable harvest gestures; it no longer offers a direct
  // "Extraire avec 1 habitant" button in the read-only inspector.
  const started = page.waitForResponse(
    (response) =>
      response.url().endsWith('/harvest-intents') && response.request().method() === 'POST' && response.ok(),
    { timeout: 45_000 },
  );
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await started;
  const verify = createDatabase(testDatabaseUrl());
  try {
    await expect
      .poll(
        async () =>
          (
            await verify
              .selectFrom('depositExtractions')
              .select('id')
              .where('worldId', '=', DEVELOPMENT_IDS.world)
              .where('villageId', '=', DEVELOPMENT_IDS.village)
              .where('featureId', '=', featureId)
              .where('status', '=', 'in-progress')
              .execute()
          ).length,
        { timeout: 45_000 },
      )
      .toBe(1);
  } finally {
    await verify.destroy();
  }
  expect(inspections).toBe(0);
  await expect(canvas).toHaveAttribute('data-worker-model', 'low-poly');
  await expect.poll(async () => Number(await canvas.getAttribute('data-worker-figures'))).toBeGreaterThan(0);
  const figures = Number(await canvas.getAttribute('data-worker-figures'));
  // Shared figure: eight body boxes, two tool boxes and one cargo box (24 vertices each).
  expect(Number(await canvas.getAttribute('data-worker-vertices')) / figures).toBeLessThanOrEqual(264);
  await page.screenshot({ path: testInfo.outputPath('stone-gesture.png') });
});
