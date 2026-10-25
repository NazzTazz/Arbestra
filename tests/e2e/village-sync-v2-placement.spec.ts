import { expect, test } from '@playwright/test';
import { createDatabase } from '../../apps/api/src/database/connection';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_IDS as ids } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { getVillageState } from '../../apps/api/src/modules/villages/service';
import { clickCell, openVillage } from './world-interactions';

// A placement confirmed on the V2 contract shows its building at once, without
// waiting for the presentation reread (whose travel network is recomputed).
test('une pose V2 apparaît dès la confirmation, avant la relecture de présentation', async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, 'Parcours de pose vérifié avec le cadrage desktop.');
  test.setTimeout(300_000);
  await page.addInitScript(() => localStorage.setItem('arbestra:sync-v2', '1'));
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  try {
    await db
      .updateTable('villageResources')
      .set({ amount: 2000 })
      .where('worldId', '=', ids.world)
      .where('villageId', '=', ids.village)
      .where('resourceCode', 'in', ['wood', 'stone'])
      .execute();
    const site = (await getVillageState(db, ids.account, 'aube', ids.village)).cells
      .filter((cell) => cell.canBuild)
      .sort((a, b) => Math.hypot(a.cellX - 1024, a.cellY - 512) - Math.hypot(b.cellX - 1024, b.cellY - 512))[0]!;
    // Once the placement is sent, hold every presentation read for 20 s: far
    // longer than the slow headless rendering of this machine needs.
    let placed = 0;
    const placements: Array<{ protocol: string | undefined; status: number; at: number }> = [];
    await page.route('**/presentation*', async (route) => {
      if (placed) await new Promise((resolve) => setTimeout(resolve, 20_000));
      await route.continue();
    });
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/buildings')) placed = Date.now();
    });
    page.on('response', (response) => {
      if (response.request().method() === 'POST' && response.url().endsWith('/buildings'))
        placements.push({
          protocol: response.request().headers()['x-arbestra-protocol'],
          status: response.status(),
          at: Date.now(),
        });
    });
    const canvas = await openVillage(page);
    const buildings = () =>
      canvas.evaluate((element) =>
        (JSON.parse(element.dataset.buildingScreens ?? '[]') as Array<{ id: string }>).map((b) => b.id),
      );
    await expect.poll(async () => (await buildings()).length, { timeout: 60_000 }).toBeGreaterThan(0);
    const before = new Set(await buildings());
    await page.getByRole('button', { name: 'Vue libre', exact: true }).click();
    await page.getByRole('button', { name: 'Constructions', exact: true }).click();
    await page
      .getByRole('region', { name: 'Modèles · Habitat' })
      .getByRole('button', { name: 'Maison en troncs', exact: true })
      .click();
    // Left click places directly.
    await clickCell(page, site, isMobile);
    await expect.poll(() => placements.length, { timeout: 15_000 }).toBe(1);
    expect(placements[0]).toMatchObject({ protocol: '2', status: 201 });
    // Well before the held presentation read is answered.
    let presentedAt = 0;
    page.on('response', (response) => {
      if (response.url().includes('/presentation')) presentedAt = Date.now();
    });
    await expect
      .poll(async () => (await buildings()).some((id) => !before.has(id)), { timeout: 18_000, intervals: [100] })
      .toBe(true);
    expect(presentedAt).toBe(0);
    const shownAfterMs = Date.now() - placements[0]!.at;
    await page.screenshot({ path: testInfo.outputPath('placement-v2.png') });
    // The recomputed presentation then takes over without losing the building.
    await page.waitForResponse((response) => response.url().includes('/presentation'), { timeout: 30_000 });
    await expect.poll(async () => (await buildings()).some((id) => !before.has(id)), { timeout: 5000 }).toBe(true);
    testInfo.annotations.push({ type: 'shown-after-ms', description: String(shownAfterMs) });
    expect(browserErrors).toEqual([]);
  } finally {
    await db.destroy();
  }
});
