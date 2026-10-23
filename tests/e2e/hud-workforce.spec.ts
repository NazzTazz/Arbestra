import { expect as baseExpect, test, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../apps/api/src/database/connection';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
const expect = baseExpect.configure({ timeout: 30000 });

test('règle les deux ressources et accumule les gestes Population à la souris et au toucher', async ({
  page,
  context,
  isMobile,
}, testInfo) => {
  test.setTimeout(420000);
  const url = testDatabaseUrl(),
    target = new URL(url);
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test')
    throw Error('Unexpected HUD browser database');
  const db = createDatabase(url),
    worldId = randomUUID(),
    villageId = randomUUID(),
    slug = `hud-${randomUUID()}`,
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const touch = async (locator: Locator) =>
    isMobile ? locator.tap({ timeout: 30000 }) : locator.click({ timeout: 30000 });
  const cdp = isMobile ? await context.newCDPSession(page) : null;
  async function drag(from: Locator, to: Locator) {
    const a = await from.boundingBox(),
      b = await to.boundingBox();
    if (!a || !b) throw Error('Missing gesture target');
    const x = a.x + a.width / 2,
      y = a.y + a.height / 2,
      dx = b.x + b.width / 2,
      dy = b.y + b.height / 2;
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 5; i++)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + ((dx - x) * i) / 5, y: y + ((dy - y) * i) / 5 }],
        });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(dx, dy, { steps: 5 });
    }
    await expect(page.locator('.population-drag-preview')).toBeVisible();
    await expect(to).toHaveClass(/is-drop-target/);
    if ((await from.getAttribute('data-population-group')) === 'carrots')
      await expect(page.locator('.population-drag-preview img')).toHaveAttribute('src', '/thumbnails/carrot.png');
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
    await expect(page.locator('.population-drag-preview')).toHaveCount(0);
  }
  try {
    await db.transaction().execute(async (tx) => {
      const now = new Date();
      await tx
        .insertInto('worlds')
        .values({
          id: worldId,
          slug,
          name: 'Recette HUD',
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
        .values({ worldId, accountId: DEVELOPMENT_IDS.account, playerName: 'Recette HUD' })
        .execute();
      await tx
        .insertInto('villages')
        .values({
          id: villageId,
          worldId,
          ownerAccountId: DEVELOPMENT_IDS.account,
          name: 'Les équipes',
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
      for (const resourceCode of ['wood', 'stone', 'timber', 'cut-stone', 'carrot']) {
        const amount = resourceCode === 'carrot' ? 1000 : 2000;
        await tx
          .insertInto('villageResources')
          .values({ worldId, villageId, resourceCode, amount })
          .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount }))
          .execute();
      }
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
          memberCount: 120,
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
    // Login uses the normal cookie endpoint; the tested page is the world client.
    const worldBase = process.env.HUD_QA_WORLD_URL ?? 'http://localhost:5274';
    expect(
      (
        await page.request.post(`${worldBase}/api/auth/login`, {
          data: { email: 'player@arbestra.local', password: 'arbestra' },
        })
      ).ok(),
    ).toBe(true);
    await page.goto(`${worldBase}/?world=${slug}`);
    const canvas = page.getByTestId('village-canvas');
    await expect(canvas).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.world-loading')).toBeHidden({ timeout: 90000 });
    await touch(page.getByRole('button', { name: 'Vue libre', exact: true }));
    await touch(page.getByRole('button', { name: 'Exploitation', exact: true }));
    await touch(page.getByRole('button', { name: 'Chantiers', exact: true }));
    const wood = page.getByRole('article', { name: 'Coupe de bois' }),
      stone = page.getByRole('article', { name: 'Extraction de roche' });
    await expect(wood.getByRole('button')).toHaveCount(4);
    await expect(stone.getByRole('button')).toHaveCount(4);
    // The first command commits, but its HTTP reply is lost after a mode switch.
    // SSE can already include it: pending settings must neither reset nor double-count it.
    let release!: () => void,
      firstCommitted = false;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const sentIds: string[] = [];
    const poolUrl = `**/villages/${villageId}/extraction-pools`;
    await page.route(poolUrl, async (route) => {
      sentIds.push(route.request().postDataJSON().commandId);
      if (sentIds.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        firstCommitted = true;
        await held;
        await route.abort('failed').catch(() => {});
      } else await route.continue();
    });
    try {
      for (let i = 0; i < 3; i++) await touch(wood.getByRole('button', { name: 'Ajouter un chantier', exact: true }));
      await expect.poll(() => firstCommitted).toBe(true);
      await expect(wood.locator('output').first()).toHaveText('4');
      await expect(wood).toContainText('3 réglages à confirmer');
      await touch(page.getByRole('button', { name: 'Population', exact: true }));
      await touch(page.getByRole('button', { name: 'Exploitation', exact: true }));
      if (!(await wood.isVisible())) await touch(page.getByRole('button', { name: 'Chantiers', exact: true }));
      await expect(wood.locator('output').first()).toHaveText('4');
      await page.screenshot({ path: testInfo.outputPath('pending-after-mode-switch.png') });
    } finally {
      release();
    }
    await expect(wood).not.toContainText('à confirmer');
    await expect.poll(async () => sentIds.length).toBe(4);
    expect(sentIds[0]).toBe(sentIds[1]);
    expect(new Set(sentIds).size).toBe(3);
    expect(
      (
        await db
          .selectFrom('extractionPools')
          .select('siteCount')
          .where('worldId', '=', worldId)
          .where('villageId', '=', villageId)
          .where('resourceCode', '=', 'wood')
          .executeTakeFirstOrThrow()
      ).siteCount,
    ).toBe(4);
    await page.unroute(poolUrl);
    for (let i = 0; i < 3; i++) await touch(wood.getByRole('button', { name: 'Retirer un chantier', exact: true }));
    await expect(wood.locator('output').first()).toHaveText('1');
    await expect(wood).not.toContainText('à confirmer');
    await touch(wood.getByRole('button', { name: 'Ajouter un chantier', exact: true }));
    await expect(wood.locator('output').first()).toHaveText('2');
    await touch(wood.getByRole('button', { name: 'Ajouter cinq habitants', exact: true }));
    await expect(wood.locator('output').last()).toHaveText('10');
    await touch(wood.getByRole('button', { name: 'Retirer un chantier', exact: true }));
    await expect(wood.locator('output').first()).toHaveText('1');
    await touch(wood.getByRole('button', { name: 'Retirer un chantier', exact: true }));
    await expect(wood.locator('output').first()).toHaveText('0');
    await expect(wood).toContainText('En pause');
    await touch(wood.getByRole('button', { name: 'Ajouter un chantier', exact: true }));
    await expect(wood.locator('output').first()).toHaveText('1');
    await touch(stone.getByRole('button', { name: 'Ajouter un chantier', exact: true }));
    await expect(stone.locator('output').first()).toHaveText('2');
    await expect(stone.locator('output').last()).toHaveText('5');
    await expect(wood.locator('output').last()).toHaveText('10');
    await page.screenshot({ path: testInfo.outputPath('exploitation.png') });
    await touch(page.getByRole('button', { name: 'Population', exact: true }));
    const groups = page.getByRole('region', { name: 'Population', exact: true });
    await expect(groups.locator('.population-hud-groups > button')).toHaveCount(4);
    await expect(groups.getByRole('button', { name: 'Connaissances', exact: true })).toHaveCount(0);
    await expect(groups).not.toContainText('Repas pour tout le groupe');
    const panel = await page.locator('.workforce-toolbar').boundingBox(),
      modes = await page.getByRole('navigation', { name: 'Modes du monde' }).boundingBox();
    expect(panel!.height).toBeLessThanOrEqual(modes!.height - 10);
    const idle = groups.locator('[data-population-group="idle"]'),
      rest = groups.locator('[data-population-group="resting"]'),
      active = groups.locator('[data-population-group="working"]'),
      carrots = groups.locator('[data-population-group="carrots"]');
    // Native gestures are sent rapidly; the durable FIFO must retain all ten.
    for (let i = 0; i < 10; i++) await drag(idle, rest);
    await expect(rest).toHaveAccessibleName('Au repos : 100 habitants', { timeout: 120000 });
    await expect(idle).toHaveAccessibleName('Disponibles : 20 habitants');
    await drag(carrots, idle);
    await expect(carrots).toHaveAccessibleName('Carottes disponibles : 980', { timeout: 30000 });
    await drag(rest, carrots);
    await expect(carrots).toHaveAccessibleName('Carottes disponibles : 880', { timeout: 30000 });
    // Active meal and deferred rotation use a real workshop assignment.
    const building = await db
      .insertInto('buildings')
      .values({
        worldId,
        villageId,
        buildingType: 'sawmill',
        level: 1,
        status: 'completed',
        completedAt: new Date(),
        constructionStartedAt: null,
        constructionCompletesAt: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const response = await page.request.post(`${worldBase}/api/worlds/${slug}/villages/${villageId}/processing`, {
      data: { commandId: randomUUID(), action: 'start', buildingId: building.id, lots: 2, workerCount: 1 },
    });
    expect(response.ok()).toBe(true);
    await expect(active).toHaveAccessibleName('Actifs : 1 habitant', { timeout: 30000 });
    await drag(carrots, active);
    await expect(carrots).toHaveAccessibleName('Carottes disponibles : 879', { timeout: 30000 });
    await drag(active, rest);
    await expect(groups).toContainText('1 habitant à relever', { timeout: 30000 });
    const worker = await db
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('processingLotId', 'is not', null)
      .executeTakeFirstOrThrow();
    expect(worker.pendingRelease).toBe('resting');
    expect(worker.foodUsedSinceRest).toBe(2);
    await expect(active).toHaveAccessibleName('Actifs : 1 habitant');
    const entries = await groups.locator('.population-hud-groups > button').evaluateAll((buttons) =>
      buttons.map((button) => ({
        imageBottom: button.querySelector('img')!.getBoundingClientRect().bottom,
        labelTop: button.querySelector(':scope > span:not(.population-icon)')!.getBoundingClientRect().top,
      })),
    );
    for (const entry of entries) expect(entry.imageBottom).toBeLessThanOrEqual(entry.labelTop);
    await page.screenshot({ path: testInfo.outputPath('population.png') });
    const layout = await groups.boundingBox();
    expect(layout!.x).toBeGreaterThanOrEqual(0);
    expect(layout!.x + layout!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(
      await groups
        .locator('img')
        .evaluateAll((images) =>
          images.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0),
        ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } catch (error) {
    await page.screenshot({ path: testInfo.outputPath('hud-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await page.close().catch(() => {});
    await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
    await db.deleteFrom('worlds').where('id', '=', worldId).execute();
    await db.destroy();
  }
});
