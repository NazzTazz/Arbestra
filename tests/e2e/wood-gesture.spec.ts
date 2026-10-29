import { randomUUID } from 'node:crypto';
import { expect, test, type Locator } from '@playwright/test';

import { createDatabase } from '../../apps/api/src/database/connection';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { chooseMode, openVillage } from './world-interactions';

// Gesture grammar of the wood tool (docs/SPEC-GRAMMAIRE-GESTUELLE.md): a long
// press switches to clearing, a swipe queues the trees it crosses (red), and
// « Annuler » withdraws them (no longer red).
test.setTimeout(180_000);

// Away from the town hall, whose panel would answer a press.
const cell = { cellX: 1030, cellY: 517 };
let featureId = randomUUID();

test.afterAll(async () => {
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  try {
    await db.transaction().execute(async (tx) => {
      await tx
        .deleteFrom('worldCellOccupancies')
        .where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('featureId', '=', featureId)
        .execute();
      await tx
        .deleteFrom('woodlandDeposits')
        .where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('featureId', '=', featureId)
        .execute();
      await tx
        .deleteFrom('worldFeatures')
        .where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('id', '=', featureId)
        .execute();
    });
  } finally {
    await db.destroy();
  }
});

type Tree = { featureId: string; treeIndex: number | null; state: string; tint: boolean; x: number; y: number };
const trees = (canvas: Locator) =>
  canvas.evaluate(
    (element) => (element as unknown as { arbestraTreeScreens?: () => Tree[] }).arbestraTreeScreens?.() ?? [],
  );

test('un glissé en défrichage met les arbres en file en rouge, « Annuler » les retire', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Appui long et glissé à la souris ; le toucher partage le même geste.');
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  try {
    const existing = await db
      .selectFrom('worldCellOccupancies')
      .select('featureId')
      .where('worldId', '=', DEVELOPMENT_IDS.world)
      .where('cellX', '=', cell.cellX)
      .where('cellY', '=', cell.cellY)
      .executeTakeFirst();
    expect(existing).toBeUndefined();
    featureId = randomUUID();
    const now = new Date();
    // Three trees of 500 in a world without RC1 forest (woodland-layout.ts draws 3).
    await db
      .insertInto('worldFeatures')
      .values({
        id: featureId,
        worldId: DEVELOPMENT_IDS.world,
        featureTypeCode: 'woodland',
        state: 'available',
        variantSeed: 5,
      })
      .execute();
    await db
      .insertInto('woodlandDeposits')
      .values({
        worldId: DEVELOPMENT_IDS.world,
        featureId,
        ...cell,
        initialAmount: 1500,
        remainingAmount: 1500,
        reservedAmount: 0,
        revision: 1,
        updatedAt: now,
        regrowthUpdatedAt: now,
      })
      .execute();
    await db
      .insertInto('worldCellOccupancies')
      .values({ worldId: DEVELOPMENT_IDS.world, ...cell, featureId, buildingId: null, role: 'body' })
      .execute();
  } finally {
    await db.destroy();
  }

  const canvas = await openVillage(page);
  await chooseMode(page, 'Exploitation');
  await page.getByRole('button', { name: 'Bois brut', exact: true }).click();
  await canvas.evaluate(
    (element, target) =>
      (element as unknown as { arbestraFocusCell: (c: typeof target) => void }).arbestraFocusCell(target),
    cell,
  );
  const box = (await canvas.boundingBox())!;
  const ours = async () => (await trees(canvas)).filter((t) => t.featureId === featureId);
  await expect
    .poll(async () => (await ours()).filter((t) => t.x > 0.1 && t.x < 0.9 && t.y > 0.1 && t.y < 0.75).length, {
      timeout: 60_000,
    })
    .toBe(3);
  // The camera glides to the grove: read its trees once they stop moving on screen.
  const settled = async () => {
    let previous = '';
    for (let i = 0; i < 40; i++) {
      const now = (await ours()).sort((a, b) => a.x - b.x);
      const key = JSON.stringify(now.map((t) => [t.x.toFixed(3), t.y.toFixed(3)]));
      if (key === previous) return now;
      previous = key;
      await page.waitForTimeout(500);
    }
    throw new Error('the camera never settled');
  };
  let grove = await settled();
  const at = (t: Tree) => ({ x: box.x + t.x * box.width, y: box.y + t.y * box.height });

  // Long press on a tree: clearing, nothing designated.
  const indicator = page.locator('.wood-mode-indicator');
  await expect(indicator).toContainText('Coupe');
  await page.mouse.move(at(grove[0]!).x, at(grove[0]!).y);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await page.screenshot({ path: test.info().outputPath('wood-gesture-long-press.png') });
  await expect(indicator).toContainText('Défrichage');
  await expect(page.locator('.wood-mode-frame')).toBeVisible();

  // A swipe across the three trees queues them for clearing, in red.
  grove = await settled();
  const intent = page.waitForResponse((r) => r.url().endsWith('/harvest-intents') && r.request().method() === 'POST');
  await page.mouse.move(at(grove[0]!).x - 20, at(grove[0]!).y);
  await page.mouse.down();
  for (const tree of grove) await page.mouse.move(at(tree).x, at(tree).y, { steps: 8 });
  await page.mouse.move(at(grove[2]!).x + 20, at(grove[2]!).y, { steps: 4 });
  await page.mouse.up();
  const sent = (await (await intent).request().postDataJSON()) as {
    woodMode?: string;
    woodTrees?: Array<{ treeIndices: number[] }>;
  };
  expect(sent.woodMode).toBe('clear');
  expect(sent.woodTrees?.[0]?.treeIndices.slice().sort()).toEqual([0, 1, 2]);
  await expect.poll(async () => (await ours()).filter((t) => t.tint).length, { timeout: 30_000 }).toBe(3);

  // « Annuler » withdraws the gesture's trees: no longer red.
  const cancel = page.getByRole('button', { name: /^Annuler/ });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.locator('.harvest-cancel-result')).toContainText(/Annulé|Geste annulé/, { timeout: 15_000 });
  await expect.poll(async () => (await ours()).filter((t) => t.tint).length, { timeout: 30_000 }).toBe(0);
  await page.screenshot({ path: test.info().outputPath('wood-gesture-cancelled.png') });
});
