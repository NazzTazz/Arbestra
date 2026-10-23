import { expect, test } from '@playwright/test';
import { createDatabase } from '../../apps/api/src/database/connection';
import { DEVELOPMENT_IDS as seedIds } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { randomUUID } from 'node:crypto';
import { publishTrade } from '../../apps/api/src/modules/villages/trade-economy';
import { beginTradePair } from '../../apps/api/src/modules/villages/trade-service';

test('publie au toucher, échange avec Oracle et reçoit un convoi joueur à travers la couture torique', async ({
  page,
  isMobile,
}, testInfo) => {
  // Includes cold Babylon startup and an actual round trip; individual assertions stay bounded.
  test.setTimeout(360000);
  const ids = { world: randomUUID(), village: randomUUID(), townHall: randomUUID(), account: seedIds.account },
    slug = `market-qa-${randomUUID()}`;
  const db = createDatabase(testDatabaseUrl()),
    errors: string[] = [];
  const merchant = randomUUID(),
    merchantAccount = randomUUID(),
    merchantHall = randomUUID();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  const touch = async (locator: ReturnType<typeof page.getByRole>) => {
    if (isMobile) await locator.tap();
    else await locator.click();
  };
  const amount = async (code: string) =>
    Number(
      (
        await db
          .selectFrom('villageResources')
          .select('amount')
          .where('worldId', '=', ids.world)
          .where('villageId', '=', ids.village)
          .where('resourceCode', '=', code)
          .executeTakeFirstOrThrow()
      ).amount,
    );
  try {
    // Bounded private flat world: the real API, navigation worker and renderer,
    // without the unrelated full-size world's cold geography and tutorial.
    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto('worlds')
        .values({
          id: ids.world,
          slug,
          name: 'Marché tactile',
          topology: 'torus',
          widthCells: 128,
          heightCells: 128,
          chunkSize: 32,
          seed: 1,
          generationVersion: 1,
          generationStatus: 'ready',
          generatedAt: new Date(),
          isOpen: false,
        })
        .execute();
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++)
          await tx
            .insertInto('worldChunks')
            .values({
              worldId: ids.world,
              chunkX: x,
              chunkY: y,
              generationVersion: 1,
              terrainCodes: Array(1024).fill(1),
              elevations: Array(1024).fill(1),
            })
            .execute();
      await tx
        .insertInto('worldMemberships')
        .values({ worldId: ids.world, accountId: ids.account, playerName: 'Recette tactile' })
        .execute();
      await tx
        .insertInto('villages')
        .values({
          id: ids.village,
          worldId: ids.world,
          ownerAccountId: ids.account,
          name: 'Comptoir',
          anchorCellX: 4,
          anchorCellY: 64,
        })
        .execute();
      await tx
        .insertInto('buildings')
        .values({
          id: ids.townHall,
          worldId: ids.world,
          villageId: ids.village,
          buildingType: 'town-hall',
          level: 2,
          status: 'completed',
          completedAt: new Date(),
          constructionStartedAt: null,
          constructionCompletesAt: null,
        })
        .execute();
      await tx
        .insertInto('worldCellOccupancies')
        .values({ worldId: ids.world, cellX: 3, cellY: 64, buildingId: ids.townHall, featureId: null, role: 'anchor' })
        .execute();
      await tx
        .insertInto('villageResources')
        .values([
          { worldId: ids.world, villageId: ids.village, resourceCode: 'wood', amount: 2173 },
          { worldId: ids.world, villageId: ids.village, resourceCode: 'carrot', amount: 50 },
          { worldId: ids.world, villageId: ids.village, resourceCode: 'stone', amount: 0 },
        ])
        .execute();
      await tx
        .insertInto('villageResourceFlows')
        .values({
          worldId: ids.world,
          villageId: ids.village,
          resourceCode: 'wood',
          baseRatePerHour: 0,
          remainder: 0,
          productionUpdatedAt: new Date(),
        })
        .execute();
      await tx
        .insertInto('populationCohorts')
        .values({
          worldId: ids.world,
          villageId: ids.village,
          originVillageId: ids.village,
          memberCount: 15,
          activity: 'idle',
          energy: 10,
          energyProgress: 0,
          energyUpdatedAt: new Date(),
          restingSince: null,
          foodUsedSinceRest: 0,
          harvestId: null,
          extractionId: null,
        })
        .execute();
    });
    await page.goto('/');
    await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
    await page.getByLabel('Mot de passe').fill('arbestra');
    await touch(page.getByRole('button', { name: 'Se connecter' }));
    await page.locator(`a[href$="world=${slug}"]`).click();
    const canvas = page.getByTestId('village-canvas');
    await expect(canvas).toBeVisible({ timeout: 120000 });
    await touch(page.getByRole('button', { name: 'Vue libre', exact: true }));
    await touch(page.getByRole('button', { name: 'Exploitation', exact: true }));
    await expect(canvas).toHaveAttribute('data-world-interaction-ready', 'true', { timeout: 40000 });
    await expect
      .poll(
        () =>
          canvas.evaluate(
            (element, id) =>
              (JSON.parse(element.dataset.buildingScreens ?? '[]') as Array<{ id: string }>).some((p) => p.id === id),
            ids.townHall,
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    const roof = await canvas.evaluate((element, id) => {
      const p = (
        JSON.parse(element.dataset.buildingScreens ?? '[]') as Array<{ id: string; x: number; y: number }>
      ).find((p) => p.id === id)!;
      const r = element.getBoundingClientRect();
      return { x: r.x + r.width * p.x, y: r.y + r.height * p.y };
    }, ids.townHall);
    if (isMobile) await page.touchscreen.tap(roof.x, roof.y);
    else await page.mouse.click(roof.x, roof.y);
    const panel = page.getByRole('region', { name: 'Place de marché' });
    await expect(panel.getByRole('heading', { name: 'Que cherchez-vous ?' })).toBeVisible();
    await expect(panel.locator('.market-resource img')).toHaveCount(5, { timeout: 60000 });
    await page.screenshot({ path: testInfo.outputPath('market-resources.png') });
    await touch(panel.getByRole('button', { name: 'Carottes', exact: true }));
    await touch(panel.getByRole('button', { name: '250', exact: true }));
    await touch(panel.getByRole('button', { name: 'Continuer', exact: true }));
    await touch(panel.getByRole('button', { name: 'Bois brut', exact: true }));
    await expect(panel.getByRole('button', { name: '2 500', exact: true })).toBeDisabled();
    await touch(panel.getByRole('button', { name: 'Tout mon stock' }));
    await expect(panel.locator('output')).toContainText('2 173');
    await touch(panel.getByRole('button', { name: '100', exact: true }));
    await touch(panel.getByRole('button', { name: 'Continuer', exact: true }));
    await expect(panel).toContainText('250 Carottes');
    await expect(panel).toContainText('100 Bois brut');
    await touch(panel.getByRole('button', { name: 'Retour', exact: true }));
    await expect(panel.getByRole('button', { name: '100', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await touch(panel.getByRole('button', { name: 'Continuer', exact: true }));
    await expect(panel.getByRole('slider', { name: 'Temps de trajet maximum' })).toBeVisible();
    expect(await panel.locator('input[type=number]').count()).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('market-summary.png') });
    await touch(panel.getByRole('button', { name: 'Valider', exact: true }));
    await expect(panel).toContainText('Offre publiée', { timeout: 30000 });
    expect(await amount('wood')).toBe(2073);
    expect(await amount('carrot')).toBe(50);
    await touch(panel.getByRole('button', { name: 'Annuler et récupérer ma réserve' }));
    await expect(panel).toContainText('Réserve restituée', { timeout: 30000 });
    expect(await amount('wood')).toBe(2173);
    await touch(panel.getByRole('button', { name: 'Consulter les offres' }));
    await touch(panel.getByRole('button', { name: 'Carottes', exact: true }));
    await touch(panel.getByRole('button', { name: '50 Carottes 18 Bois brut', exact: true }));
    await touch(panel.getByRole('button', { name: 'Confirmer l’échange Oracle' }));
    await expect(panel).toContainText('Échange Oracle livré', { timeout: 30000 });
    expect(await amount('wood')).toBe(2155);
    expect(await amount('carrot')).toBe(100);
    await page.screenshot({ path: testInfo.outputPath('market-oracle-delivered.png') });
    const account = await db
      .selectFrom('accounts')
      .select('passwordHash')
      .where('id', '=', ids.account)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('accounts')
      .values({ id: merchantAccount, email: `${merchantAccount}@market.test`, passwordHash: account.passwordHash })
      .execute();
    await db
      .insertInto('worldMemberships')
      .values({ worldId: ids.world, accountId: merchantAccount, playerName: 'Marchand tactile' })
      .execute();
    await db
      .insertInto('villages')
      .values({
        id: merchant,
        worldId: ids.world,
        ownerAccountId: merchantAccount,
        name: 'Marché voisin',
        anchorCellX: 116,
        anchorCellY: 64,
      })
      .execute();
    await db
      .insertInto('buildings')
      .values({
        id: merchantHall,
        worldId: ids.world,
        villageId: merchant,
        buildingType: 'town-hall',
        level: 2,
        status: 'completed',
        completedAt: new Date(),
        constructionStartedAt: null,
        constructionCompletesAt: null,
      })
      .execute();
    await db
      .insertInto('worldCellOccupancies')
      .values({ worldId: ids.world, cellX: 116, cellY: 64, buildingId: merchantHall, featureId: null, role: 'anchor' })
      .execute();
    await db
      .insertInto('villageResources')
      .values(
        ['wood', 'stone', 'carrot'].map((resourceCode) => ({
          worldId: ids.world,
          villageId: merchant,
          resourceCode,
          amount: 2000,
        })),
      )
      .execute();
    await db.transaction().execute(async (tx) => {
      const through = await beginTradePair(tx, ids.world, [merchant]);
      await publishTrade(
        tx,
        { worldId: ids.world, villageId: merchant, through },
        {
          action: 'publish',
          commandId: randomUUID(),
          requestedResource: 'wood',
          requestedAmount: 100,
          offeredResource: 'stone',
          offeredAmount: 250,
          maxTravelSeconds: 600,
        },
      );
    });
    await touch(panel.getByRole('button', { name: 'Pierre brute', exact: true }));
    const neighbour = panel.locator('.market-offer').filter({ hasText: 'Marché voisin' });
    await expect(neighbour).toBeVisible({ timeout: 30000 });
    await touch(neighbour.getByRole('button', { name: 'Voir le trajet et accepter' }));
    await expect(panel.getByRole('heading', { name: 'Confirmer cet échange' })).toBeVisible({ timeout: 30000 });
    await touch(panel.getByRole('button', { name: 'Confirmer le départ' }));
    await expect(panel).toContainText('Vos porteurs sont en route', { timeout: 30000 });
    const journey = await db
      .selectFrom('tradeJourneys')
      .selectAll()
      .where('worldId', '=', ids.world)
      .where('destinationVillageId', '=', merchant)
      .executeTakeFirstOrThrow();
    expect(journey.workerCount).toBe(1);
    expect(journey.path.length).toBeGreaterThan(2);
    expect(journey.path.some((p, i, all) => i > 0 && Math.abs(p.cellX - all[i - 1]!.cellX) > 64)).toBe(true);
    await expect
      .poll(
        () =>
          canvas.evaluate(
            (element, id) =>
              (JSON.parse(element.dataset.workerPositions ?? '[]') as Array<{ id: string; enabled: boolean }>).some(
                (p) => p.id === `worker-${id}-0` && p.enabled,
              ),
            journey.id,
          ),
        { timeout: 10000 },
      )
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath('market-player-convoy.png') });
    await expect.poll(() => amount('stone'), { timeout: 75000 }).toBe(250);
    expect(await amount('wood')).toBe(2055);
    expect(
      (await db.selectFrom('populationCohorts').select('id').where('tradeJourneyId', '=', journey.id).execute()).length,
    ).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close().catch(() => {});
    const journeys = await db
      .selectFrom('tradeJourneys')
      .select('id')
      .where('worldId', '=', ids.world)
      .where('destinationVillageId', '=', merchant)
      .execute();
    if (journeys.length)
      await db
        .updateTable('populationCohorts')
        .set({ tradeJourneyId: null, activity: 'idle' })
        .where('worldId', '=', ids.world)
        .where(
          'tradeJourneyId',
          'in',
          journeys.map((j) => j.id),
        )
        .execute();
    await db.deleteFrom('populationCohorts').where('worldId', '=', ids.world).execute();
    await db.deleteFrom('worlds').where('id', '=', ids.world).execute();
    await db.deleteFrom('accounts').where('id', '=', merchantAccount).execute();
    await db.destroy();
  }
});
