import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createDatabase } from '../../apps/api/src/database/connection';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_IDS as ids } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { constructBuilding, getVillageState } from '../../apps/api/src/modules/villages/service';
import { waitForVillage } from './world-interactions';

test('le tailleur est inspectable en Exploitation et transforme un lot après sa pause', async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, 'Picking du toit vérifié avec le cadrage desktop.');
  // Cold scene loading plus fixture setup can exceed 150 s on the development
  // laptop. Individual action/visibility deadlines below remain unchanged.
  test.setTimeout(300_000);
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  // The hint can appear between a visibility check and the next click. Handle
  // its actual appearance during Playwright's actionability checks.
  const oracleHint = page.locator('.oracle-provisions-overlay');
  await page.addLocatorHandler(oracleHint, async () => {
    await oracleHint.getByRole('button', { name: 'Masquer', exact: true }).click();
  });
  const network = await page.context().newCDPSession(page);
  await network.send('Network.enable');
  const requests = new Map<string, { path: string; method: string; protocol: string | null; started: number }>();
  const traffic: object[] = [];
  network.on('Network.requestWillBeSent', (event) => {
    const path = new URL(event.request.url).pathname;
    if (!path.startsWith('/api/')) return;
    requests.set(event.requestId, {
      path,
      method: event.request.method,
      protocol: event.request.headers['x-arbestra-protocol'] ?? event.request.headers['x-village-sync'] ?? null,
      started: event.timestamp,
    });
  });
  // Separates browser queueing (connection limit) from server wait time.
  const timings = new Map<string, { queuedMs: number; serverWaitMs: number }>();
  network.on('Network.responseReceived', (event) => {
    const request = requests.get(event.requestId),
      timing = event.response.timing;
    if (request && timing)
      timings.set(event.requestId, {
        queuedMs: Math.round((timing.requestTime - request.started) * 1000 + Math.max(0, timing.sendStart)),
        serverWaitMs: Math.round(timing.receiveHeadersEnd - timing.sendEnd),
      });
  });
  network.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId);
    if (request)
      traffic.push({
        ...request,
        ...timings.get(event.requestId),
        kind: 'http',
        wireBytes: event.encodedDataLength,
        durationMs: (event.timestamp - request.started) * 1000,
      });
  });
  network.on('Network.eventSourceMessageReceived', (event) => {
    const request = requests.get(event.requestId);
    if (request)
      traffic.push({
        path: request.path,
        kind: 'sse',
        event: event.eventName,
        payloadBytes: Buffer.byteLength(event.data),
      });
  });
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  try {
    await db
      .updateTable('villageResources')
      .set({ amount: 100 })
      .where('worldId', '=', ids.world)
      .where('villageId', '=', ids.village)
      .where('resourceCode', '=', 'stone')
      .execute();
    const state = await getVillageState(db, ids.account, 'aube', ids.village);
    const free = new Set(state.cells.filter((cell) => cell.canBuild).map((cell) => `${cell.cellX}:${cell.cellY}`));
    const anchor = state.cells
      .filter((cell) => [0, 1].every((dx) => [0, 1].every((dy) => free.has(`${cell.cellX + dx}:${cell.cellY + dy}`))))
      .sort((a, b) => Math.hypot(a.cellX - 1024, a.cellY - 512) - Math.hypot(b.cellX - 1024, b.cellY - 512))[0]!;
    await constructBuilding(db, ids.account, 'aube', ids.village, anchor.cellX, anchor.cellY, 'stonemason', 0);
    await db
      .updateTable('villageResources')
      .set({ amount: 25 })
      .where('worldId', '=', ids.world)
      .where('villageId', '=', ids.village)
      .where('resourceCode', '=', 'stone')
      .execute();
    await page.goto('/');
    await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
    await page.getByLabel('Mot de passe').fill('arbestra');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
    const canvas = page.getByTestId('village-canvas');
    // The full seed world renders 71 initial terrain units on cold headless Chromium.
    await waitForVillage(canvas);
    await page.getByRole('button', { name: 'Vue libre', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Exploitation', exact: true })).toBeEnabled({ timeout: 40_000 });
    await page.getByRole('button', { name: 'Exploitation', exact: true }).click();
    const cells = [0, 1].flatMap((dx) => [0, 1].map((dy) => `${anchor.cellX + dx}:${anchor.cellY + dy}`));
    await expect
      .poll(
        () =>
          canvas.evaluate((element, ids) => {
            const points = JSON.parse(element.dataset.cellScreens ?? '[]') as Array<{ id: string }>;
            return ids.every((id) => points.some((point) => point.id === id));
          }, cells),
        { timeout: 30_000 },
      )
      .toBe(true);
    const roof = await canvas.evaluate((element, ids) => {
      const points = (
        JSON.parse(element.dataset.cellScreens ?? '[]') as Array<{ id: string; x: number; y: number }>
      ).filter((point) => ids.includes(point.id));
      const box = element.getBoundingClientRect();
      return {
        x: box.x + (box.width * points.reduce((sum, point) => sum + point.x, 0)) / 4,
        y: box.y + box.height * (points.reduce((sum, point) => sum + point.y, 0) / 4 - 0.165),
      };
    }, cells);
    // Clic ordinaire sur le toit visible au-dessus de la palette, sans Maj.
    await page.mouse.click(roof.x, roof.y);
    const panel = page.getByRole('region', { name: 'Fabrication de matières' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: '1 h', exact: true }).click({ timeout: 10_000 });
    await expect(panel.getByRole('button', { name: 'Produire', exact: true })).toBeEnabled();
    // A real click must reach the workshop even where the harvest showroom overlaps it.
    await panel.getByRole('button', { name: 'Produire', exact: true }).click({ timeout: 10_000 });
    await panel.getByRole('button', { name: 'Pause après ce lot', exact: true }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'lots achevés' })).toContainText('Pause après ce lot');
    await page.screenshot({ path: testInfo.outputPath('processing.png') });
    expect(
      Number(
        (
          await db
            .selectFrom('villageResources')
            .select('amount')
            .where('villageId', '=', ids.village)
            .where('resourceCode', '=', 'stone')
            .executeTakeFirstOrThrow()
        ).amount,
      ),
    ).toBe(0);
    // Échéance accélérée uniquement dans la base de test ; le rendement reste réel.
    await db
      .updateTable('processingLots')
      .set({ completesAt: new Date(Date.now() - 1000) })
      .where('worldId', '=', ids.world)
      .where('villageId', '=', ids.village)
      .where('completedAt', 'is', null)
      .execute();
    await expect(panel).toContainText('En pause · 1/6 lots achevés', { timeout: 15_000 });
    await expect(panel.getByRole('button', { name: 'Reprendre', exact: true })).toBeVisible();
    expect(
      await db
        .selectFrom('processingOrders')
        .select(['status', 'completedLots'])
        .where('worldId', '=', ids.world)
        .where('villageId', '=', ids.village)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'paused', completedLots: 1 });
    expect(
      Number(
        (
          await db
            .selectFrom('villageResources')
            .select('amount')
            .where('villageId', '=', ids.village)
            .where('resourceCode', '=', 'cut-stone')
            .executeTakeFirstOrThrow()
        ).amount,
      ),
    ).toBe(20);
    expect(browserErrors).toEqual([]);
    const commands = [...requests.values()].filter(
      (request) => request.method === 'POST' && request.path.endsWith('/processing'),
    );
    expect(commands).toHaveLength(2);
    // Workshop slice of V2: negotiated commands, one bootstrap and its stream.
    expect(commands.map((request) => request.protocol)).toEqual(['2', '2']);
    expect(
      [...requests.values()].filter((request) => request.method === 'GET' && request.path.endsWith('/bootstrap')),
    ).toHaveLength(1);
    expect(
      [...requests.values()].some((request) => request.method === 'POST' && request.path.endsWith('/sync/stream')),
    ).toBe(true);
    const firstCommandAt = Math.min(...commands.map((request) => request.started));
    expect(
      [...requests.values()].filter(
        (request) => request.method === 'GET' && request.path.endsWith('/village') && request.started > firstCommandAt,
      ),
    ).toEqual([]);
  } finally {
    try {
      const trafficPath = testInfo.outputPath('atelier-network.json');
      await writeFile(
        trafficPath,
        JSON.stringify(
          {
            note: 'HTTP encodedDataLength includes wire headers; SSE data bytes exclude framing. No tokens or business payloads retained.',
            traffic,
          },
          null,
          2,
        ),
      );
      await testInfo.attach('atelier-network.json', { path: trafficPath, contentType: 'application/json' });
    } finally {
      // Playwright owns CDP/context teardown; detach after a timeout can fail
      // and previously prevented the database pool from being closed.
      await db.destroy();
    }
  }
});
