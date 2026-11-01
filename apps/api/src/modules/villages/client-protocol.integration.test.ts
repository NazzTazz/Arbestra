import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { buildApp } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';

// An old tab (before the V2-only client) sends no `x-arbestra-protocol`: it must
// be told to reload, cheaply, before anything is authenticated, validated or run.
const MESSAGE = "Une nouvelle version d'Arbestra est disponible. Rechargez la page.";

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected client protocol test database');
const db = createDatabase(url);
const ids = { world: randomUUID(), village: randomUUID(), account: randomUUID() },
  slug = 'client-protocol-' + ids.world,
  token = randomUUID();
const root = `/api/worlds/${slug}/villages/${ids.village}`;
const V2 = { 'x-arbestra-protocol': '2', 'x-arbestra-generation': '4' };
let app: FastifyInstance;

beforeAll(async () => {
  await migrateToLatest(url);
  await db.transaction().execute(async (tx) => {
    const now = new Date();
    await tx
      .insertInto('accounts')
      .values({ id: ids.account, email: ids.account + '@protocol.test', passwordHash: 'fixture' })
      .execute();
    await tx
      .insertInto('sessions')
      .values({ accountId: ids.account, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
      .execute();
    await tx
      .insertInto('worlds')
      .values({
        id: ids.world,
        slug,
        name: 'Client protocol',
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
      .values({ worldId: ids.world, accountId: ids.account, playerName: 'Protocol' })
      .execute();
    await tx
      .insertInto('villages')
      .values({
        id: ids.village,
        worldId: ids.world,
        ownerAccountId: ids.account,
        name: 'Protocol',
        anchorCellX: 64,
        anchorCellY: 64,
        economyActivatedAt: now,
      })
      .execute();
    const hall = await tx
      .insertInto('buildings')
      .values({
        worldId: ids.world,
        villageId: ids.village,
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
      .values({ worldId: ids.world, cellX: 64, cellY: 64, buildingId: hall.id, featureId: null, role: 'anchor' })
      .execute();
    for (const resourceCode of ['wood', 'stone', 'timber', 'cut-stone', 'carrot'])
      await tx
        .insertInto('villageResources')
        .values({ worldId: ids.world, villageId: ids.village, resourceCode, amount: 2000 })
        .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: 2000 }))
        .execute();
    await tx
      .insertInto('villageResourceFlows')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        resourceCode: 'wood',
        baseRatePerHour: 0,
        remainder: 0,
        productionUpdatedAt: now,
      })
      .execute();
  });
  app = await buildApp(
    {
      databaseUrl: url,
      host: '127.0.0.1',
      port: 0,
      isProduction: false,
      cookieName: 'session',
      sessionTtlDays: 30,
      scheduledTaskPollIntervalMs: 60000,
      expeditionWorkerEnabled: false,
      constructionDurationOverrideMs: null,
    },
    db,
  );
}, 120000);
afterAll(async () => {
  await app?.close();
  await db.deleteFrom('worlds').where('id', '=', ids.world).execute();
  await db.deleteFrom('accounts').where('id', '=', ids.account).execute();
  await db.destroy();
}, 30000);

const uuid = randomUUID;
/** Every mutating route that used to answer a historical contract without the header. */
const gated: Array<{ name: string; url: string; payload?: object }> = [
  { name: 'market trade', url: '/market/trades', payload: { action: 'cancel', commandId: uuid(), offerId: uuid() } },
  { name: 'processing', url: '/processing', payload: { action: 'cancel', commandId: uuid(), orderId: uuid() } },
  { name: 'exploitation', url: '/exploitation', payload: { commandId: uuid() } },
  { name: 'science (research)', url: '/science', payload: { action: 'research', commandId: uuid() } },
  { name: 'cat eyes', url: '/discover-cat-eyes' },
  { name: 'building', url: '/buildings', payload: { commandId: uuid(), buildingType: 'dwelling' } },
  { name: 'garden expansion', url: `/buildings/${uuid()}/expansions`, payload: { commandId: uuid(), cells: [] } },
  { name: 'upgrade', url: `/buildings/${uuid()}/upgrade`, payload: { commandId: uuid() } },
  { name: 'worksite', url: `/worksites/${uuid()}`, payload: { commandId: uuid(), action: 'pause' } },
  { name: 'hidden supplies', url: `/buildings/${uuid()}/discover-supplies` },
  { name: 'extraction pool', url: '/extraction-pools', payload: { commandId: uuid() } },
  { name: 'population gesture', url: '/population/gestures', payload: { commandId: uuid() } },
];

const state = async () => ({
  revisions: (
    await sql<{
      revision: string;
    }>`select revision::text from game_sync_streams where world_id=${ids.world} order by stream_kind,scope_key`.execute(
      db,
    )
  ).rows,
  buildings: await db.selectFrom('buildings').select(['id', 'status']).where('worldId', '=', ids.world).execute(),
  resources: await db
    .selectFrom('villageResources')
    .select(['resourceCode', 'amount'])
    .where('worldId', '=', ids.world)
    .orderBy('resourceCode')
    .execute(),
  hudReceipts: Number(
    (
      await db
        .selectFrom('hudWorkforceReceipts')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('worldId', '=', ids.world)
        .executeTakeFirstOrThrow()
    ).n,
  ),
});

function expectUpgradeRequired(response: LightMyRequestResponse, what: string) {
  expect(response.statusCode, what + ': ' + response.body).toBe(426);
  expect(response.json(), what).toEqual({ code: 'CLIENT_UPGRADE_REQUIRED', message: MESSAGE });
  // RFC 9110 §15.5.22: the refusal names the protocol to move to.
  expect(response.headers.upgrade, what).toBe('arbestra-sync/2');
}

it('refuses every historical command without the V2 header, before authentication, writing nothing', async () => {
  const before = await state();
  for (const route of gated) {
    // With a session, without one, and with another protocol number: the same refusal.
    const base: InjectOptions = {
      method: 'POST',
      url: root + route.url,
      ...(route.payload ? { payload: route.payload } : {}),
    };
    for (const request of [
      { cookies: { session: token } },
      {},
      { cookies: { session: token }, headers: { 'x-arbestra-protocol': '1' } },
      { cookies: { session: token }, headers: { 'x-arbestra-generation': '4' } },
    ] satisfies InjectOptions[])
      expectUpgradeRequired(await app.inject({ ...base, ...request }), route.name);
  }
  expect(await state()).toEqual(before);
});

it('refuses the retired village read and the retired event stream for every caller', async () => {
  for (const request of [{ cookies: { session: token } }, {}, { cookies: { session: token }, headers: V2 }]) {
    expectUpgradeRequired(await app.inject({ method: 'GET', url: `/api/worlds/${slug}/village`, ...request }), 'read');
    expectUpgradeRequired(
      await app.inject({ method: 'GET', url: `/api/worlds/${slug}/village?villageId=${ids.village}`, ...request }),
      'read of a village',
    );
    expectUpgradeRequired(await app.inject({ method: 'GET', url: root + '/events', ...request }), 'stream');
    expectUpgradeRequired(
      await app.inject({ method: 'GET', url: root + '/events?revision=3', ...request }),
      'stream from a revision',
    );
  }
});

it('leaves the routes that have no protocol header alone', async () => {
  // Expedition receipts, previews and reads are not historical twins of a V2 command.
  const notRefused = async (request: InjectOptions) =>
    expect((await app.inject(request)).statusCode, JSON.stringify(request)).not.toBe(426);
  const headers = { cookie: 'session=' + token };
  for (const action of ['survey', 'explore'])
    await notRefused({
      method: 'POST',
      url: root + '/science',
      headers,
      payload: { action, commandId: uuid() },
    });
  await notRefused({ method: 'POST', url: root + '/exploitation/preview', headers, payload: {} });
  await notRefused({ method: 'POST', url: root + '/processing/preview', headers, payload: {} });
  await notRefused({ method: 'POST', url: root + '/commands/receipts/read', headers, payload: {} });
  await notRefused({ method: 'POST', url: root + '/harvest-intents', headers, payload: {} });
  await notRefused({ method: 'GET', url: root + '/market/offers', headers });
  await notRefused({ method: 'GET', url: `/api/worlds/${slug}/village/bootstrap`, headers });
});

it('does not consume the command identifier: the same placement passes under V2 right after the refusal', async () => {
  const command = {
    commandId: uuid(),
    buildingType: 'dwelling',
    anchorCellX: 66,
    anchorCellY: 64,
    cells: [{ cellX: 66, cellY: 64 }],
    quarterTurns: 0,
    houseVariant: 'logs',
  };
  const before = await state();
  expectUpgradeRequired(
    await app.inject({
      method: 'POST',
      url: root + '/buildings',
      cookies: { session: token },
      payload: command,
    }),
    'placement',
  );
  expect(await state()).toEqual(before);
  const accepted = await app.inject({
    method: 'POST',
    url: root + '/buildings',
    cookies: { session: token },
    headers: V2,
    payload: command,
  });
  expect(accepted.statusCode, accepted.body).toBe(201);
  const created = accepted.json<{ commandId: string; result: { buildingId?: string } }>();
  expect(created.commandId).toBe(command.commandId);
  expect(
    await db.selectFrom('buildings').select('status').where('id', '=', created.result.buildingId!).executeTakeFirst(),
  ).toEqual({ status: 'under-construction' });
  expect((await state()).buildings).toHaveLength(before.buildings.length + 1);
}, 60000);
