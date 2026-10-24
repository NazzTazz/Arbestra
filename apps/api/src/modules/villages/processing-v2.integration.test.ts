import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  applySyncV2Batch,
  visibleSyncV2Scope,
  ProcessingConfirmationV2Schema,
  readServerEvents,
  type SyncV2Batch,
  type ProcessingCommand,
  type ProcessingConfirmationV2,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { buildApp } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';
import type { FastifyInstance } from 'fastify';
import { commandProcessingV2 } from './processing-v2.js';
import { captureSyncV2 } from './sync-v2-capture.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected processing V2 test database');
const db = createDatabase(url);
const ids = { world: randomUUID(), village: randomUUID(), account: randomUUID() },
  slug = 'processing-v2-' + ids.world,
  token = randomUUID();
let app: FastifyInstance;
const root = `/api/worlds/${slug}/villages/${ids.village}`;
beforeAll(async () => {
  await migrateToLatest(url);
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('accounts')
      .values({ id: ids.account, email: ids.account + '@v2.test', passwordHash: 'fixture' })
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
        name: 'Processing V2',
        topology: 'torus',
        widthCells: 64,
        heightCells: 64,
        chunkSize: 32,
        seed: 1,
        generationVersion: 1,
        generationStatus: 'ready',
      })
      .execute();
    await tx
      .insertInto('worldMemberships')
      .values({ worldId: ids.world, accountId: ids.account, playerName: 'V2 fixture' })
      .execute();
    await tx
      .insertInto('villages')
      .values({
        id: ids.village,
        worldId: ids.world,
        ownerAccountId: ids.account,
        name: 'V2 fixture',
        anchorCellX: 16,
        anchorCellY: 16,
        economyActivatedAt: new Date(),
      })
      .execute();
    for (const chunkX of [0, 1])
      for (const chunkY of [0, 1])
        await tx
          .insertInto('worldChunks')
          .values({
            worldId: ids.world,
            chunkX,
            chunkY,
            generationVersion: 1,
            terrainCodes: Array(1024).fill(1),
            elevations: Array(1024).fill(0),
          })
          .execute();
    const resources = await tx.selectFrom('resourceTypes').select('code').execute();
    await tx
      .insertInto('villageResources')
      .values(
        resources.map((r) => ({
          worldId: ids.world,
          villageId: ids.village,
          resourceCode: r.code,
          amount: ['wood', 'carrot', 'stone'].includes(r.code) ? 2000 : 0,
        })),
      )
      .onConflict((c) =>
        c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: sql.ref('excluded.amount') }),
      )
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
      .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ baseRatePerHour: 0 }))
      .execute();
    await tx
      .insertInto('villagePopulations')
      .values({ worldId: ids.world, villageId: ids.village, nextArrivalAt: null })
      .onConflict((c) => c.columns(['worldId', 'villageId']).doUpdateSet({ nextArrivalAt: null }))
      .execute();
    await tx.deleteFrom('populationCohorts').where('worldId', '=', ids.world).execute();
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
    await tx
      .insertInto('playerScience')
      .values({ worldId: ids.world, accountId: ids.account, observationsSince: null, solarReport: null })
      .onConflict((c) => c.doNothing())
      .execute();
    await tx
      .insertInto('buildings')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        buildingType: 'town-hall',
        level: 1,
        status: 'completed',
        completedAt: new Date(),
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
      scheduledTaskPollIntervalMs: 250,
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
async function send(command: ProcessingCommand): Promise<ProcessingConfirmationV2> {
  const response = await app.inject({
    method: 'POST',
    url: root + '/processing',
    cookies: { session: token },
    headers: { 'x-arbestra-protocol': '2', 'x-arbestra-generation': '9' },
    payload: command,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
it('publishes actual start/pause/cancel effects atomically, merges inverted ACKs and replays only the original receipt', async () => {
  const buildingId = (
    await db
      .insertInto('buildings')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        buildingType: 'sawmill',
        level: 1,
        status: 'completed',
        completedAt: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  await db
    .updateTable('populationCohorts')
    .set({ energy: 10, energyProgress: 0, energyUpdatedAt: new Date() })
    .where('villageId', '=', ids.village)
    .execute();
  const request = { protocol: 2 as const, generation: 9, scopes: [], cursors: [] };
  const initial = await captureSyncV2(db, ids.account, slug, ids.village, request);
  const base = applySyncV2Batch(
    {
      worldId: ids.world,
      villageId: ids.village,
      generation: 9,
      scopes: new Map(),
      subscribedScopes: new Set(initial.groups.map((group) => `${group.stream.kind}:${group.stream.key}`)),
    },
    initial,
  );
  expect(base.kind).toBe('applied');
  const start = { commandId: randomUUID(), action: 'start' as const, buildingId, lots: 2, workerCount: 1 };
  const started = await send(start);
  expect(Value.Check(ProcessingConfirmationV2Schema, started)).toBe(true);
  expect(started.effects?.observedAt).toBe(started.commandTime);
  const pause = { commandId: randomUUID(), action: 'pause' as const, orderId: started.result.orderId! };
  const paused = await send(pause);
  const cancel = { commandId: randomUUID(), action: 'cancel' as const, orderId: started.result.orderId! };
  const cancelled = await send(cancel);
  expect(Value.Check(ProcessingConfirmationV2Schema, cancelled)).toBe(true);
  const effects = applySyncV2Batch(base.state, cancelled.effects!);
  expect(effects.kind).toBe('applied');
  const key = `village:${ids.village}`;
  expect(effects.state.scopes.get(key)!.revision).toBe(base.state.scopes.get(key)!.revision);
  const inverted = applySyncV2Batch(effects.state, paused.effects!);
  expect(
    visibleSyncV2Scope(inverted.state.scopes.get(key)!).get(`processingOrders:${started.result.orderId}`),
  ).toMatchObject({ status: 'cancel-requested' });
  const resume = {
    ...request,
    cursors: initial.groups.map((group) => ({ ...group.stream, revision: group.toRevision })),
  };
  const delta = await captureSyncV2(db, ids.account, slug, ids.village, resume);
  const converged = applySyncV2Batch(inverted.state, delta);
  expect(converged.kind).toBe('applied');
  expect(converged.state.scopes.get(key)!.effects.size).toBe(0);
  expect(
    visibleSyncV2Scope(converged.state.scopes.get(key)!).get(`processingOrders:${started.result.orderId}`),
  ).toMatchObject({ status: 'cancel-requested' });
  const beforeTasks = await db.selectFrom('scheduledTasks').selectAll().orderBy('id').execute();
  const beforeJournal = (
    await sql`select * from game_sync_streams where world_id=${ids.world} order by stream_kind,scope_key`.execute(db)
  ).rows;
  const replay = await send(start);
  expect(replay).toEqual({ ...started, effects: undefined });
  expect(await db.selectFrom('scheduledTasks').selectAll().orderBy('id').execute()).toEqual(beforeTasks);
  expect(
    (await sql`select * from game_sync_streams where world_id=${ids.world} order by stream_kind,scope_key`.execute(db))
      .rows,
  ).toEqual(beforeJournal);
  await expect(commandProcessingV2(db, ids.account, slug, ids.village, { ...start, lots: 3 }, 9)).rejects.toMatchObject(
    { code: 'COMMAND_REUSED' },
  );
}, 120000);

it('recovers a commit between HTTP capture and the real authenticated SSE socket without a full snapshot', async () => {
  const response = await app.inject({
    method: 'POST',
    url: root + '/sync/read',
    cookies: { session: token },
    headers: { 'x-arbestra-protocol': '2' },
    payload: { protocol: 2, generation: 9, scopes: [], cursors: [] },
  });
  expect(response.statusCode, response.body).toBe(200);
  const initial = response.json<SyncV2Batch>();
  await db
    .updateTable('villageResources')
    .set({ amount: 1777 })
    .where('worldId', '=', ids.world)
    .where('villageId', '=', ids.village)
    .where('resourceCode', '=', 'wood')
    .execute();
  const address = await app.listen({ host: '127.0.0.1', port: 0 }),
    controller = new AbortController(),
    deadline = setTimeout(() => controller.abort(), 10000);
  const batches: SyncV2Batch[] = [];
  try {
    const stream = await fetch(address + root + '/sync/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-arbestra-protocol': '2', cookie: `session=${token}` },
      signal: controller.signal,
      body: JSON.stringify({
        protocol: 2,
        generation: 9,
        scopes: [],
        cursors: initial.groups.map((g) => ({ ...g.stream, revision: g.toRevision })),
      }),
    });
    expect(stream.status).toBe(200);
    await readServerEvents(stream.body!, {
      signal: controller.signal,
      current: () => true,
      onEvent: (event) => {
        if (event.event === 'batch') {
          batches.push(JSON.parse(event.data));
          controller.abort();
        }
      },
    });
  } finally {
    clearTimeout(deadline);
    controller.abort();
  }
  expect(batches).toHaveLength(1);
  expect(batches[0]!.coverage).toBe('delta');
  expect(
    batches[0]!.groups.flatMap((g) => g.changes).filter((c) => c.component === 'resources')[0]?.upsert,
  ).toMatchObject([{ code: 'wood', amount: 1777 }]);
  expect(JSON.stringify(batches)).not.toMatch(/travelRoutes|buildingTypes|villageState/);
}, 30000);

it('bootstraps the default village of a world without knowing its id, behind protocol negotiation', async () => {
  const url = `/api/worlds/${slug}/village/bootstrap?generation=3&include=traffic`;
  const response = await app.inject({
    method: 'GET',
    url,
    cookies: { session: token },
    headers: { 'x-arbestra-protocol': '2' },
  });
  expect(response.statusCode, response.body).toBe(200);
  const batch = response.json<SyncV2Batch>();
  expect(batch).toMatchObject({
    protocol: 2,
    worldId: ids.world,
    villageId: ids.village,
    generation: 3,
    coverage: 'scope-snapshot',
  });
  expect(batch.groups.map((group) => group.stream.kind).sort()).toEqual(['traffic', 'village']);
  expect((await app.inject({ method: 'GET', url, cookies: { session: token } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'GET', url, headers: { 'x-arbestra-protocol': '2' } })).statusCode).toBe(401);
}, 60000);
