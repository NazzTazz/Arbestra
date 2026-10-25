import { expect as baseExpect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../apps/api/src/database/connection';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
import { constructBuilding } from '../../apps/api/src/modules/villages/service';
import { waitForVillage } from './world-interactions';
const expect = baseExpect.configure({ timeout: 30000 });

// V2 village mode on a touch device, in a world created after the V2
// migrations: first load, HUD and an external construction, without any
// historical village read or stream.
test('le village V2 se charge et suit une construction extérieure sur mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Parcours tactile ; le parcours ordinateur est couvert par village-sync-v2.spec.ts.');
  test.setTimeout(300000);
  const url = testDatabaseUrl(),
    target = new URL(url);
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test')
    throw Error('Unexpected V2 mobile database');
  const db = createDatabase(url),
    worldId = randomUUID(),
    villageId = randomUUID(),
    slug = `v2-mobile-${randomUUID()}`,
    errors: string[] = [];
  const requests: Array<{ method: string; path: string }> = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) requests.push({ method: request.method(), path });
  });
  await page.addInitScript(() => localStorage.setItem('arbestra:sync-v2', '1'));
  try {
    await db.transaction().execute(async (tx) => {
      const now = new Date();
      await tx
        .insertInto('worlds')
        .values({
          id: worldId,
          slug,
          name: 'Recette V2 mobile',
          topology: 'torus',
          widthCells: 128,
          heightCells: 128,
          chunkSize: 32,
          seed: 1,
          generationVersion: 1,
          generationStatus: 'ready',
          generatedAt: now,
          isOpen: false,
        })
        .execute();
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++)
          await tx
            .insertInto('worldChunks')
            .values({
              worldId,
              chunkX: x,
              chunkY: y,
              generationVersion: 1,
              terrainCodes: Array(1024).fill(1),
              elevations: Array(1024).fill(1),
            })
            .execute();
      await tx
        .insertInto('worldMemberships')
        .values({ worldId, accountId: DEVELOPMENT_IDS.account, playerName: 'Recette V2' })
        .execute();
      await tx
        .insertInto('villages')
        .values({
          id: villageId,
          worldId,
          ownerAccountId: DEVELOPMENT_IDS.account,
          name: 'Le village mobile',
          anchorCellX: 64,
          anchorCellY: 64,
          economyActivatedAt: now,
        })
        .execute();
      const hall = await tx
        .insertInto('buildings')
        .values({
          worldId,
          villageId,
          buildingType: 'town-hall',
          level: 1,
          status: 'completed',
          completedAt: now,
          constructionStartedAt: null,
          constructionCompletesAt: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('worldCellOccupancies')
        .values({ worldId, cellX: 64, cellY: 64, buildingId: hall.id, featureId: null, role: 'anchor' })
        .execute();
      for (const resourceCode of ['wood', 'stone', 'timber', 'cut-stone', 'carrot'])
        await tx
          .insertInto('villageResources')
          .values({ worldId, villageId, resourceCode, amount: 2000 })
          .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: 2000 }))
          .execute();
      await tx
        .insertInto('villageResourceFlows')
        .values({
          worldId,
          villageId,
          resourceCode: 'wood',
          baseRatePerHour: 0,
          remainder: 0,
          productionUpdatedAt: now,
        })
        .execute();
      await tx
        .insertInto('populationCohorts')
        .values({
          worldId,
          villageId,
          originVillageId: villageId,
          memberCount: 20,
          activity: 'idle',
          energy: 8,
          energyProgress: 0,
          energyUpdatedAt: now,
          restingSince: null,
          foodUsedSinceRest: 0,
          harvestId: null,
          extractionId: null,
        })
        .execute();
    });
    const worldBase = 'http://localhost:5274';
    expect(
      (
        await page.request.post(`${worldBase}/api/auth/login`, {
          data: { email: 'player@arbestra.local', password: 'arbestra' },
        })
      ).ok(),
    ).toBe(true);
    await page.goto(`${worldBase}/?world=${slug}`);
    const canvas = page.getByTestId('village-canvas');
    await waitForVillage(canvas);
    await expect(page.locator('.world-loading')).toBeHidden({ timeout: 90000 });
    // Stocks from the V2 private stream (French grouping uses a narrow space).
    await expect(page.locator('[data-resource="stone"]').first()).toHaveAttribute('aria-label', /^2\s000\s/);
    // Placed elsewhere (another tab, a worker): the private stream and the
    // presentation bring the new footprint to the touch client.
    const presentationReads = () => requests.filter((request) => request.path.endsWith('/presentation')).length,
      readsBefore = presentationReads();
    await constructBuilding(db, DEVELOPMENT_IDS.account, slug, villageId, 66, 64, 'sawmill', null);
    // Its cost reaches the HUD through the private stream only...
    await expect
      .poll(
        async () =>
          [
            await page.locator('[data-resource="wood"]').first().getAttribute('aria-label'),
            await page.locator('[data-resource="stone"]').first().getAttribute('aria-label'),
          ].some((label) => !/^2\s000\s/.test(label ?? '')),
        { timeout: 20000 },
      )
      .toBe(true);
    // ...and the new footprint is a structural change: presentation reread.
    await expect.poll(presentationReads, { timeout: 20000 }).toBeGreaterThan(readsBefore);
    expect(requests.filter((request) => request.path.endsWith('/bootstrap'))).toEqual([
      { method: 'GET', path: `/api/worlds/${slug}/village/bootstrap` },
    ]);
    expect(requests.filter((request) => request.method === 'GET' && request.path.endsWith('/village'))).toEqual([]);
    expect(requests.filter((request) => request.path.endsWith('/events'))).toEqual([]);
    expect(requests.filter((request) => request.path.endsWith('/presentation')).length).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  } finally {
    await db.deleteFrom('worlds').where('id', '=', worldId).execute();
    await db.destroy();
  }
});
