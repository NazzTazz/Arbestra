import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  sql,
  CamelCasePlugin,
  PostgresDialect,
  Kysely,
  type KyselyPlugin,
  type QueryId,
  type Transaction,
} from 'kysely';
import pg from 'pg';
import type { Database } from '../../database/schema.js';
import { readWorksites } from '../deposits/worksites.js';
import { NavigationCompute } from '../navigation/compute.js';
import { readExtraction, readExtractions } from '../deposits/stone-extractions.js';
import { infrastructureCommand, infrastructurePreview } from './infrastructure.js';
import {
  prepareInfrastructureEdit,
  buildingAccesses,
  applyInfrastructureConfirmation,
  type InfrastructureConfirmation,
  type InfrastructureRequest,
} from '@arbestra/contracts';
import {
  constructBuilding,
  constructBuildingArea,
  withVillageProjection,
  readInfrastructureSpatialState,
  state,
  getVillageState,
  reconcileVillageForRead,
} from './service.js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as contracts from '@arbestra/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  applyVillageFrame,
  VillageStateSchema,
  type VillageState,
  type VillageFrame,
  type VillageCommandResponse,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { hashSessionToken } from '../../security/sessions.js';
import { buildApp } from '../../app.js';
import { completeConstruction } from './complete-construction.js';
import { readVillageProjection, reconcileSyncDeadline, VillageSyncSession } from './sync.js';
import { villageSyncRevision } from './sync-revision.js';
import { instrumentHttp, OperationsTelemetry, operationsFor } from '../operations/telemetry.js';
import { discoverBuildingSuppliesInTransaction } from './service.js';
import { HttpError } from '../../errors.js';
import { DevTimingTrace, withDevTiming } from '../operations/dev-timing.js';
import { parseDevServerTiming } from '@arbestra/contracts';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected synchronization fixture DB');
const db = createDatabase(url),
  accountId = randomUUID(),
  token = randomUUID();
let worldId = randomUUID(),
  villageId = randomUUID(),
  hallId = randomUUID(),
  houseId = randomUUID(),
  slug = 'sync-' + worldId;
let app: FastifyInstance;
const read = () => readVillageProjection(db, accountId, slug, villageId);
const revision = async () => (await villageSyncRevision(db, worldId)).revision;

it('reads grouped command receipts over HTTP without replaying commands or returning private request payloads', async () => {
  const commandId = randomUUID(),
    orderId = randomUUID();
  const commandTime = new Date('2026-10-21T12:00:00Z');
  await db
    .insertInto('processingCommandReceipts')
    .values({
      worldId,
      villageId,
      commandId,
      orderId,
      commandTime,
      request: JSON.stringify({ action: 'pause', commandId, orderId }),
    })
    .execute();
  const send = (payload: Record<string, unknown>, target = villageId) =>
    app.inject({
      method: 'POST',
      url: `/api/worlds/${slug}/villages/${target}/commands/receipts/read`,
      cookies: { arbestra_session: token },
      payload,
    });
  const response = await send({
    commands: [
      { family: 'processing', commandId },
      { family: 'processing', commandId: randomUUID() },
    ],
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    worldId,
    villageId,
    receipts: [
      {
        family: 'processing',
        commandId,
        status: 'applied',
        commandTime: commandTime.toISOString(),
        result: { orderId },
      },
    ],
  });
  expect(
    (await db.selectFrom('buildings').select('status').where('id', '=', houseId).executeTakeFirstOrThrow()).status,
  ).toBe('under-construction');
  expect(
    (await send({ commands: Array.from({ length: 33 }, () => ({ family: 'processing', commandId })) })).statusCode,
  ).toBe(400);
  expect((await send({ commands: [{ family: 'processing', commandId, injected: true }] })).statusCode).toBe(400);
  expect((await send({ commands: [{ family: 'processing', commandId }] }, randomUUID())).statusCode).toBe(404);
});

beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@sync.test', passwordHash: 'fixture' })
    .execute();
  await db
    .insertInto('sessions')
    .values({ accountId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
    .execute();
  app = await buildApp(
    {
      databaseUrl: url,
      host: '127.0.0.1',
      port: 0,
      isProduction: false,
      cookieName: 'arbestra_session',
      sessionTtlDays: 30,
      constructionDurationOverrideMs: 600000,
      scheduledTaskPollIntervalMs: 250,
    },
    db,
  );
  app.get('/snapshot-race', { schema: { response: { 200: VillageStateSchema } } }, async () => {
    const captured = await read();
    await db
      .updateTable('villages')
      .set({ name: 'After snapshot before response' })
      .where('id', '=', villageId)
      .execute();
    return captured;
  });
  app.get('/noc-v11-fixture/:kind', async (request, reply) => {
    const { kind } = request.params as { kind: string };
    if (kind === 'busy') throw new HttpError(503, 'ADMIN_BUSY', 'Capacité occupée.');
    if (kind === 'unavailable') throw new HttpError(503, 'ADMIN_DATA_UNAVAILABLE', 'Lecture indisponible.');
    if (kind === 'direct') return reply.status(503).send({ code: 'must-not-inspect-payload' });
    throw new Error('secret-exception\npostgres://secret-noc:password@private', {
      cause: new Error('nested-secret-noc'),
    });
  });
  app.get(
    '/noc-v11-serialization',
    {
      schema: {
        response: {
          200: { type: 'object', required: ['requiredNumber'], properties: { requiredNumber: { type: 'integer' } } },
        },
      },
    },
    async () => ({}),
  );
  app.get(
    '/noc-v11-validation',
    {
      schema: {
        querystring: { type: 'object', required: ['count'], properties: { count: { type: 'integer', minimum: 1 } } },
      },
    },
    async () => ({ ok: true }),
  );
}, 120000);
beforeEach(async () => {
  // Every case owns fresh geometry and cursors; earlier construction tests cannot obstruct later roads.
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  worldId = randomUUID();
  villageId = randomUUID();
  hallId = randomUUID();
  houseId = randomUUID();
  slug = 'sync-' + worldId;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('worlds')
      .values({
        id: worldId,
        slug,
        name: 'Sync test',
        topology: 'torus',
        widthCells: 512,
        heightCells: 256,
        chunkSize: 32,
        seed: 4109,
        generationVersion: 1,
        generationStatus: 'ready',
        isOpen: true,
        generatedAt: new Date(),
      })
      .execute();
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Sync' }).execute();
    await tx
      .insertInto('villages')
      .values({
        id: villageId,
        worldId,
        ownerAccountId: accountId,
        name: 'Initial',
        anchorCellX: 64,
        anchorCellY: 64,
        economyActivatedAt: new Date(),
      })
      .execute();
    for (const chunkX of [1, 2])
      for (const chunkY of [1, 2])
        await tx
          .insertInto('worldChunks')
          .values({
            worldId,
            chunkX,
            chunkY,
            generationVersion: 1,
            terrainCodes: Array(1024).fill(1),
            elevations: Array(1024).fill(0),
          })
          .execute();
    for (const code of ['wood', 'carrot', 'stone'])
      await tx
        .insertInto('villageResources')
        .values({ worldId, villageId, resourceCode: code, amount: 2000 })
        .execute();
    await tx
      .insertInto('villageResourceFlows')
      .values({
        worldId,
        villageId,
        resourceCode: 'wood',
        baseRatePerHour: 0,
        remainder: 0,
        productionUpdatedAt: new Date(),
      })
      .execute();
    await tx
      .insertInto('playerScience')
      .values({ worldId, accountId, observationsSince: null, solarReport: null })
      .execute();
    await tx
      .insertInto('buildings')
      .values([
        {
          id: hallId,
          worldId,
          villageId,
          buildingType: 'town-hall',
          level: 1,
          targetLevel: null,
          status: 'completed',
          constructionStartedAt: null,
          constructionCompletesAt: null,
          completedAt: new Date(),
        },
        {
          id: houseId,
          worldId,
          villageId,
          buildingType: 'dwelling',
          level: 1,
          targetLevel: null,
          status: 'under-construction',
          constructionStartedAt: new Date(Date.now() - 2000),
          constructionCompletesAt: new Date(Date.now() - 1000),
          completedAt: null,
        },
      ])
      .execute();
    for (const [buildingId, cellX] of [
      [hallId, 64],
      [houseId, 65],
    ] as const)
      await tx
        .insertInto('worldCellOccupancies')
        .values({ worldId, buildingId, featureId: null, cellX, cellY: 64, role: 'anchor' })
        .execute();
  });
});
afterAll(async () => {
  if (app) await app.close();
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
}, 60000);

it('joins a commit between the HTTP snapshot and subscription, with read-only snapshots', async () => {
  const snapshot = await read(),
    firstRevision = await revision();
  expect(snapshot.syncRevision).toBe(firstRevision);
  expect(await revision()).toBe(firstRevision);
  await db.transaction().execute(async (tx) => {
    await tx.updateTable('villages').set({ name: 'During join' }).where('id', '=', villageId).execute();
  });
  const stream = new VillageSyncSession(read, revision),
    event = await stream.check();
  expect(event.event).toBe('snapshot');
  if (event.event !== 'snapshot') throw Error('No join snapshot');
  expect(event.data.village.name).toBe('During join');
  expect(event.data.syncRevision).toBe(firstRevision + 1);
  expect(await revision()).toBe(firstRevision + 1);
});

it('keeps commit markers and business changes invisible after an exact injected rollback', async () => {
  const before = await read(),
    priorRevision = await revision(),
    injected = Error('sync rollback after observed writes');
  const storedBefore = {
    village: await db.selectFrom('villages').selectAll().where('id', '=', villageId).executeTakeFirstOrThrow(),
    resources: await db
      .selectFrom('villageResources')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .orderBy('resourceCode')
      .execute(),
  };
  await expect(
    db.transaction().execute(async (tx) => {
      await tx.updateTable('villages').set({ name: 'Must roll back' }).where('id', '=', villageId).execute();
      await tx
        .updateTable('villageResources')
        .set({ amount: 999 })
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('resourceCode', '=', 'wood')
        .execute();
      expect((await villageSyncRevision(tx, worldId)).revision).toBe(priorRevision + 1);
      expect(
        (
          await tx
            .selectFrom('villageResources')
            .select('amount')
            .where('worldId', '=', worldId)
            .where('villageId', '=', villageId)
            .where('resourceCode', '=', 'wood')
            .executeTakeFirstOrThrow()
        ).amount,
      ).toBe('999');
      throw injected;
    }),
  ).rejects.toBe(injected);
  expect(await revision()).toBe(priorRevision);
  const after = await read();
  expect(after.village.name).toBe(before.village.name);
  expect(after.village.wood).toBe(before.village.wood);
  expect({
    village: await db.selectFrom('villages').selectAll().where('id', '=', villageId).executeTakeFirstOrThrow(),
    resources: await db
      .selectFrom('villageResources')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .orderBy('resourceCode')
      .execute(),
  }).toEqual(storedBefore);
});

it('counts commits correctly even when a later transaction commits first', async () => {
  const before = await revision();
  let acquired!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
      acquired = r;
    }),
    barrier = new Promise<void>((r) => {
      release = r;
    });
  const deadline = setTimeout(() => release(), 10_000);
  const a = db.transaction().execute(async (tx) => {
    await tx.insertInto('worldFactorySettings').values({ worldId, enabled: true }).execute();
    acquired();
    await barrier;
  });
  try {
    await Promise.race([
      entered,
      a.then(() => {
        throw Error('Transaction ended before barrier');
      }),
    ]);
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('villages').set({ name: 'Second commits first' }).where('id', '=', villageId).execute();
    });
    expect(await revision()).toBe(before + 1);
    expect((await read()).factoryEnabled).toBe(false);
  } finally {
    clearTimeout(deadline);
    release();
    await a;
  }
  expect(await revision()).toBe(before + 2);
  expect((await read()).factoryEnabled).toBe(true);
});

it('keeps the projection and revision in the same database view during a concurrent commit', async () => {
  const before = await read(),
    queries = new Set<QueryId>();
  let gated = false;
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      if (!gated && JSON.stringify(args.node).includes('village_sync_changes')) {
        gated = true;
        queries.add(args.queryId);
      }
      return args.node;
    },
    async transformResult(args) {
      if (queries.delete(args.queryId))
        await db
          .updateTable('villages')
          .set({ name: 'Committed inside snapshot read' })
          .where('id', '=', villageId)
          .execute();
      return args.result;
    },
  };
  const concurrent = await readVillageProjection(db.withPlugin(plugin), accountId, slug, villageId);
  expect(gated).toBe(true);
  expect(concurrent.village.name).toBe(before.village.name);
  expect(concurrent.syncRevision).toBe(before.syncRevision);
  const after = await read();
  expect(after.village.name).toBe('Committed inside snapshot read');
  expect(after.syncRevision).toBe(before.syncRevision! + 1);
});

it('replaces a snapshot whose revision became uncertain before the HTTP response', async () => {
  const response = await app.inject({ url: '/snapshot-race', cookies: { arbestra_session: token } });
  expect(response.statusCode).toBe(200);
  const snapshot = response.json<VillageState>();
  expect(snapshot.village.name).toBe('After snapshot before response');
  expect(snapshot.syncRevision).toBe(await revision());
});

it('recovers an unannounced worker commit on a connected SSE client, without a following mutation', async () => {
  // The stream's initial cursor is not due: its deadline fallback must not be
  // the reason this lost publication is recovered. The worker commits alone.
  await db
    .updateTable('buildings')
    .set({ constructionCompletesAt: new Date(Date.now() + 3600000) })
    .where('worldId', '=', worldId)
    .where('id', '=', houseId)
    .execute();
  const operations = operationsFor(app);
  if (!operations) throw Error('HTTP/SSE instrumentation is not registered');
  const observation = () =>
    operations.snapshot({
      status: 'unknown',
      latencyMs: null,
      observedAt: null,
      connections: null,
      activeQueries: null,
      note: 'Database health is not probed by this SSE assertion.',
    });
  const httpBefore = observation().http;
  const base = await app.listen({ host: '127.0.0.1', port: 0 }),
    controller = new AbortController();
  const response = await fetch(`${base}/api/worlds/${slug}/villages/${villageId}/events?revision=0`, {
    signal: controller.signal,
    headers: { cookie: `arbestra_session=${token}`, 'Last-Event-ID': '999999', 'X-Request-Id': 'forged-sse-id' },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const requestId = response.headers.get('x-request-id');
  expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  async function nextEvent() {
    const deadline = setTimeout(() => controller.abort(), 15000);
    try {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary !== -1) {
          const message = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = /^event: (.*)$/m.exec(message)?.[1],
            data = /^data: (.*)$/m.exec(message)?.[1];
          if (event && data) return { event, data: JSON.parse(data) };
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw Error('Stream ended');
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      clearTimeout(deadline);
    }
  }
  try {
    const initial = await nextEvent();
    expect(initial.event).toBe('snapshot');
    const local = initial.data as VillageState;
    const connected = observation();
    expect(connected.sse).toMatchObject({
      connections: 1,
      accounts: 1,
      worlds: [{ worldId, connections: 1, accounts: 1 }],
    });
    expect(connected.http.activeRequests).toBe(0); // The open SSE has its own counter.
    expect(connected.http.requests).toBe(httpBefore.requests);
    expect(local.cells.find((c) => c.building?.id === houseId)?.building?.status).toBe('under-construction');
    const started = performance.now();
    // Actual worker handler and transaction; there is intentionally no publish call.
    await db.transaction().execute(async (tx) => {
      await tx
        .updateTable('buildings')
        .set({ constructionCompletesAt: new Date(Date.now() - 1000) })
        .where('worldId', '=', worldId)
        .where('id', '=', houseId)
        .execute();
      const task = await tx
        .insertInto('scheduledTasks')
        .values({
          worldId,
          taskType: 'building.complete',
          subjectId: houseId,
          payload: {},
          dueAt: new Date(),
          availableAt: new Date(),
          attempts: 0,
          lastError: null,
          completedAt: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await completeConstruction(tx, task);
    });
    const committed = performance.now();
    const committedRevision = await revision();
    let event = await nextEvent();
    while (event.event === 'revision') event = await nextEvent();
    expect(event.event).toBe('frame');
    const frame = event.data as VillageFrame;
    const result = applyVillageFrame(local, frame);
    expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') throw Error('Frame not applied');
    expect(result.state.cells.find((c) => c.building?.id === houseId)?.building?.status).toBe('completed');
    expect(result.state.syncRevision).toBe(committedRevision);
    expect(await revision()).toBe(committedRevision); // No following business mutation.
    expect(applyVillageFrame(result.state, frame).kind).toBe('ignored');
    console.info('SYNC_WORKER_RECOVERY', {
      totalMs: Math.round(performance.now() - started),
      afterCommitMs: Math.round(performance.now() - committed),
      snapshotBytes: JSON.stringify(local).length,
      frameBytes: JSON.stringify(frame).length,
    });
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
    const closeDeadline = performance.now() + 5_000;
    while (observation().sse.connections !== 0 && performance.now() < closeDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const disconnected = observation();
    expect(disconnected.sse).toMatchObject({ connections: 0, accounts: 0, worlds: [] });
    expect(disconnected.http.activeRequests).toBe(0);
    expect(disconnected.http.requests).toBe(httpBefore.requests);
    expect(disconnected.http.aborted).toBe(httpBefore.aborted);
    expect(operations.httpDiagnostics.list({ requestId: requestId! }).items).toHaveLength(0);
  }
});

it('versions real HTTP reads and refuses an unauthenticated stream', async () => {
  const response = await app.inject({
    url: `/api/worlds/${slug}/village?villageId=${villageId}`,
    cookies: { arbestra_session: token },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json<VillageState>().syncRevision).toBe(await revision());
  const operations = operationsFor(app)!;
  const database = {
    status: 'unknown' as const,
    latencyMs: null,
    observedAt: null,
    connections: null,
    activeQueries: null,
    note: 'Test',
  };
  const beforeRefusal = operations.snapshot(database).http;
  const denied = await app.inject({ url: `/api/worlds/${slug}/villages/${villageId}/events` });
  expect(denied.statusCode).toBe(401);
  expect(denied.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  expect(operations.snapshot(database).http.errors4xx).toBe(beforeRefusal.errors4xx + 1);
  const foreign = await app.inject({
    url: `/api/worlds/${slug}/villages/${hallId}/events`,
    cookies: { arbestra_session: token },
  });
  expect(foreign.statusCode).toBe(404);
  // No foreign world's markers are part of this revision.
  const count = (
    await sql<{
      n: string;
    }>`select count(*)::text as n from village_sync_changes where world_id=${worldId}::uuid`.execute(db)
  ).rows[0]!.n;
  expect(Number(count)).toBe(await revision());
});

it('preserves supplies credits and SQL with HTTP and development diagnostics enabled or absent', async () => {
  // Replay the same existing economic command against the same private fixture.
  // Exact sentinel rollbacks restore it between variants, after observing writes.
  await db
    .updateTable('buildings')
    .set({ constructionCompletesAt: new Date(Date.now() + 3_600_000) })
    .where('id', '=', houseId)
    .execute();
  await db
    .insertInto('buildingHiddenSupplies')
    .values({ worldId, villageId, buildingId: hallId, resourceCode: 'wood', amount: 250, claimedAt: null })
    .execute();
  const tables = [
    'villageResources',
    'villageResourceFlows',
    'buildingHiddenSupplies',
    'villageAccomplishments',
    'buildings',
    'scheduledTasks',
    'populationCohorts',
    'sciencePlaces',
    'playerScience',
  ] as const;
  async function stored(source: Kysely<Database>) {
    const result: Record<string, unknown> = {};
    for (const table of tables)
      result[table] = await source.selectFrom(table).selectAll().where('worldId', '=', worldId).execute();
    return result;
  }
  // Only the real statement_timestamp-derived dates differ across the replays.
  // geographyRevision is max(science_places.observed_at) in milliseconds, not a counter.
  const withoutDates = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (key, item: unknown) =>
        key === 'geographyRevision' && typeof item === 'number' && item > 0 ? '<timestamp>' : item,
      ).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, '<timestamp>'),
    ) as unknown;
  const before = await stored(db),
    priorRevision = await revision();
  const results: Array<{ response: unknown; stored: unknown; queryKinds: string[] }> = [];
  for (const mode of ['plain', 'http', 'dev'] as const) {
    const enabled = mode !== 'plain',
      devTrace = new DevTimingTrace();
    const server = Fastify(),
      telemetry = new OperationsTelemetry(Date.now, false, { slowThresholdMs: 250 });
    let clock = 0;
    if (enabled)
      instrumentHttp(server, telemetry, {
        monotonicNow: () => {
          clock += 300;
          return clock;
        },
      });
    const queryKinds: string[] = [];
    const plugin: KyselyPlugin = {
      transformQuery(args) {
        queryKinds.push(args.node.kind);
        return args.node;
      },
      async transformResult(args) {
        return args.result;
      },
    };
    const injected = new Error('noc-supplies-after-observed-writes');
    server.post('/supplies', async () => {
      let response: VillageState | undefined, written: unknown;
      const execute = () =>
        db
          .withPlugin(plugin)
          .transaction()
          .execute(async (tx) => {
            response = await discoverBuildingSuppliesInTransaction(tx, accountId, slug, villageId, hallId);
            expect(response.village.wood).toBe(2250);
            const repeated = await discoverBuildingSuppliesInTransaction(tx, accountId, slug, villageId, hallId);
            expect(repeated.village.wood).toBe(2250); // No double credit on retry.
            written = await stored(tx);
            expect(
              await tx.selectFrom('villageAccomplishments').selectAll().where('worldId', '=', worldId).execute(),
            ).toHaveLength(1);
            expect(
              (
                await tx
                  .selectFrom('buildingHiddenSupplies')
                  .select('claimedAt')
                  .where('worldId', '=', worldId)
                  .executeTakeFirstOrThrow()
              ).claimedAt,
            ).not.toBeNull();
            throw injected;
          });
      await expect(mode === 'dev' ? withDevTiming(devTrace, execute) : execute()).rejects.toBe(injected);
      if (mode === 'dev') {
        const timings = parseDevServerTiming(devTrace.header());
        expect(timings.find((m) => m.phase === 'sql')!.count).toBeGreaterThan(20);
        expect(timings.some((m) => m.phase === 'economy')).toBe(true);
        expect(timings.some((m) => m.phase === 'snapshot')).toBe(true);
      }
      results.push({ response: withoutDates(response), stored: withoutDates(written), queryKinds });
      return response;
    });
    try {
      const response = await server.inject({ method: 'POST', url: '/supplies' });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<VillageState>().village.wood).toBe(2250);
      if (enabled) expect(telemetry.httpDiagnostics.metadata().retained).toBe(1);
      expect(await stored(db)).toEqual(before);
      expect(await revision()).toBe(priorRevision);
    } finally {
      await server.close();
      telemetry.close();
    }
  }
  expect(results[1]).toEqual(results[0]);
  expect(results[2]).toEqual(results[0]);
}, 120_000);

it('reports actual village and terrain phases only on opted-in development reads', async () => {
  // Terrain reads require the complete 3×3 halo around chunk (2,2).
  for (const chunkX of [1, 2, 3])
    for (const chunkY of [1, 2, 3])
      if (chunkX === 3 || chunkY === 3)
        await db
          .insertInto('worldChunks')
          .values({
            worldId,
            chunkX,
            chunkY,
            generationVersion: 1,
            terrainCodes: Array(1024).fill(1),
            elevations: Array(1024).fill(0),
          })
          .execute();
  const before = await app.inject({ url: `/api/worlds/${slug}/village`, cookies: { arbestra_session: token } });
  expect(before.statusCode, before.body).toBe(200);
  expect(before.headers['server-timing']).toBeUndefined();
  for (const [path, phases] of [
    ['village', ['auth', 'village', 'village_lock', 'economy', 'snapshot', 'sync', 'serialize', 'pool', 'sql']],
    ['terrain?chunks=2,2', ['auth', 'terrain', 'knowledge', 'chunks', 'serialize', 'pool', 'sql']],
  ] as const) {
    const response = await app.inject({
      url: `/api/worlds/${slug}/${path}`,
      cookies: { arbestra_session: token },
      headers: { 'x-arbestra-dev-timing': '1' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const rows = parseDevServerTiming(String(response.headers['server-timing']));
    for (const phase of phases)
      expect(
        rows.map((m) => m.phase),
        phase,
      ).toContain(phase);
    expect(rows.find((m) => m.phase === 'sql')!.count).toBeGreaterThan(0);
    expect(response.headers['server-timing']).not.toMatch(/select |password|accountId|token/);
    expect(response.json().world.id).toBe(worldId);
  }
}, 120_000);

it('classifies HTTP outcomes through the real application error handler', async () => {
  const telemetry = operationsFor(app)!;
  for (const [url, status, code] of [
    ['/noc-v11-fixture/busy', 503, 'ADMIN_BUSY'],
    ['/noc-v11-fixture/unavailable', 503, 'ADMIN_DATA_UNAVAILABLE'],
    ['/noc-v11-fixture/direct', 503, 'HTTP_SERVER_RESPONSE'],
    ['/noc-v11-fixture/exception', 500, 'INTERNAL_ERROR'],
    ['/noc-v11-serialization', 500, 'INTERNAL_ERROR'],
  ] as const) {
    const response = await app.inject({
      url: url + '?secret=query-secret-noc',
      headers: { 'x-request-id': randomUUID() },
    });
    expect(response.statusCode, response.body).toBe(status);
    const requestId = response.headers['x-request-id'] as string;
    const detail = telemetry.httpRequestDetail(requestId, telemetry.instanceId);
    expect(detail.observation).toMatchObject({
      requestId,
      statusCode: status,
      safeCode: code,
      outcome: 'response',
      reasons: expect.arrayContaining(['server_error']),
    });
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.httpRequest).toEqual({ instanceId: telemetry.instanceId, requestId });
    expect(JSON.stringify(detail)).not.toMatch(/secret-noc|password|private|must-not-inspect-payload/);
  }
  const validation = await app.inject('/noc-v11-validation?count=invalid');
  expect(validation.statusCode).toBe(400);
  expect(validation.json().code).toBe('VALIDATION_ERROR');
  expect(validation.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
});

it('deduplicates a real construction response and its SSE frame, retaining command idempotence', async () => {
  const stream = new VillageSyncSession(read, revision);
  const initial = await stream.check();
  if (initial.event !== 'snapshot') throw Error('No snapshot');
  const payload = {
    commandId: randomUUID(),
    buildingType: 'dwelling',
    houseVariant: 'logs',
    anchorCellX: 66,
    anchorCellY: 64,
    cells: [{ cellX: 66, cellY: 64 }],
  };
  const command = () =>
    app.inject({
      method: 'POST',
      url: `/api/worlds/${slug}/villages/${villageId}/buildings`,
      cookies: { arbestra_session: token },
      payload,
    });
  const first = await command();
  expect(first.statusCode).toBe(201);
  const accepted = first.json<VillageState>();
  const event = await stream.check();
  expect(event.event).toBe('frame');
  if (event.event !== 'frame') throw Error('No frame');
  expect(applyVillageFrame(accepted, event.data).kind).toBe('ignored');
  const once = applyVillageFrame(initial.data, event.data);
  expect(once.kind).toBe('applied');
  const retry = await command();
  expect(retry.statusCode).toBe(201);
  const retried = retry.json<VillageState>();
  expect(retried.cells.find((c) => c.cellX === 66 && c.cellY === 64)?.building?.id).toBe(
    accepted.cells.find((c) => c.cellX === 66 && c.cellY === 64)?.building?.id,
  );
  expect(retried.village.wood).toBe(accepted.village.wood);
  expect(
    await db
      .selectFrom('buildings')
      .select('id')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .execute(),
  ).toHaveLength(3);
});

it('reconciles a due construction and resting activity without relying on a live worker', async () => {
  const building = await db
    .selectFrom('worldCellOccupancies')
    .select('buildingId')
    .where('worldId', '=', worldId)
    .where('cellX', '=', 65)
    .where('cellY', '=', 64)
    .executeTakeFirstOrThrow();
  await db
    .updateTable('buildings')
    .set({ constructionCompletesAt: new Date(Date.now() - 1000) })
    .where('worldId', '=', worldId)
    .where('id', '=', building.buildingId!)
    .execute();
  const cohortId = randomUUID(),
    since = new Date(Date.now() - 6 * 3600000);
  await db
    .insertInto('populationCohorts')
    .values({
      id: cohortId,
      worldId,
      villageId,
      originVillageId: villageId,
      memberCount: 1,
      activity: 'resting',
      energy: 0,
      energyProgress: 0,
      energyUpdatedAt: since,
      restingSince: since,
      foodUsedSinceRest: 0,
      harvestId: null,
      extractionId: null,
    })
    .execute();
  const session = new VillageSyncSession(read, revision, (snapshot) =>
    reconcileSyncDeadline(db, accountId, slug, villageId, snapshot),
  );
  const initial = await session.check();
  expect(initial.event).toBe('snapshot');
  const update = await session.check();
  expect(update.event).toBe('frame');
  expect(
    (await db.selectFrom('buildings').select('status').where('id', '=', building.buildingId!).executeTakeFirstOrThrow())
      .status,
  ).toBe('completed');
  expect(
    (await db.selectFrom('populationCohorts').select('activity').where('id', '=', cohortId).executeTakeFirstOrThrow())
      .activity,
  ).toBe('idle');
});

it('offloads HTTP snapshot navigation without changing the projected routes', async () => {
  await reconcileVillageForRead(db, accountId, slug, villageId);
  const reference = await read();
  const inline = vi.spyOn(contracts, 'buildTravelNetwork');
  try {
    const response = await app.inject({ url: `/api/worlds/${slug}/village`, cookies: { arbestra_session: token } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<VillageState>().travelRoutes).toEqual(reference.travelRoutes);
    expect(inline).not.toHaveBeenCalled();
  } finally {
    inline.mockRestore();
  }
});

it('releases the only SQL connection before route computation and retains the captured revision', async () => {
  await reconcileVillageForRead(db, accountId, slug, villageId);
  const reference = await read();
  const single = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1 }) }),
    plugins: [new CamelCasePlugin()],
  });
  let enter!: () => void, release!: () => void, expire!: (error: Error) => void;
  const entered = new Promise<void>((r) => {
      enter = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  const timeout = new Promise<never>((_, reject) => {
    expire = reject;
  });
  const timer = setTimeout(() => {
    release();
    expire(Error('Projection worker barrier timed out'));
  }, 15000);
  const pending = readVillageProjection(single, accountId, slug, villageId, {
    network: async (load) => {
      const captured = await load({ sources: new Set() });
      enter();
      await gate;
      return contracts.buildTravelNetwork(captured.state);
    },
  });
  let changed: Promise<unknown> | undefined;
  try {
    await Promise.race([
      entered,
      timeout,
      pending.then(() => {
        throw Error('Missing off-thread projection');
      }),
    ]);
    // This statement needs the sole connection and must finish while the CPU
    // result is still withheld. It also advances the world after the capture.
    changed = single
      .updateTable('villages')
      .set({ name: 'Changed during CPU work' })
      .where('id', '=', villageId)
      .execute();
    await Promise.race([changed, timeout]);
    expect(await revision()).toBeGreaterThan(reference.syncRevision!);
    release();
    const result = await pending;
    expect(result.village.name).toBe(reference.village.name);
    expect(result.syncRevision).toBe(reference.syncRevision);
    expect(result.travelRoutes).toEqual(reference.travelRoutes);
  } finally {
    clearTimeout(timer);
    release();
    await Promise.allSettled([pending, ...(changed ? [changed] : [])]);
    await single.destroy();
  }
});

it('initial read releases economic locks before its coherent transport projection', async () => {
  let enter!: () => void, release!: () => void, rejectTimeout!: (error: Error) => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const gatedQueries = new Set<QueryId>();
  let projecting = false,
    gated = false;
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      const node = JSON.stringify(args.node);
      if (node.includes('set transaction read only')) projecting = true;
      if (projecting && !gated && node.includes('village_sync_changes')) {
        gated = true;
        gatedQueries.add(args.queryId);
      }
      return args.node;
    },
    async transformResult(args) {
      if (gatedQueries.delete(args.queryId)) {
        enter();
        await barrier;
      }
      return args.result;
    },
  };
  const pending = getVillageState(db.withPlugin(plugin), accountId, slug, villageId);
  const timer = setTimeout(() => {
    release();
    rejectTimeout(Error('Initial projection barrier timed out'));
  }, 15_000);
  try {
    await Promise.race([
      entered,
      timeout,
      pending.then(() => {
        throw Error('Read completed without a post-commit projection');
      }),
    ]);
    const beforeRevision = await revision();
    expect(
      (await db.selectFrom('buildings').select('status').where('id', '=', houseId).executeTakeFirstOrThrow()).status,
    ).toBe('completed');
    // A real second transaction can lock/change the village while the projection waits.
    await db.transaction().execute(async (tx) => {
      await sql`set local lock_timeout='500ms'`.execute(tx);
      await tx
        .updateTable('villages')
        .set({ name: 'Committed during projection' })
        .where('id', '=', villageId)
        .execute();
    });
    expect(await revision()).toBeGreaterThan(beforeRevision);
    release();
    const result = await pending;
    expect(result.village.name).toBe('Initial');
    expect(result.syncRevision).toBe(beforeRevision);
    expect(result.cells.find((c) => c.building?.id === houseId)?.building?.status).toBe('completed');
  } finally {
    clearTimeout(timer);
    release();
    await pending.catch(() => undefined);
  }
});

it('deadline reconciliation commits the economy without assembling a discarded snapshot', async () => {
  const previous = await read(),
    trace = new DevTimingTrace();
  const task = await db
    .insertInto('scheduledTasks')
    .values({
      worldId,
      taskType: 'building.complete',
      subjectId: houseId,
      payload: {},
      dueAt: new Date(),
      availableAt: new Date(),
      attempts: 0,
      lastError: null,
      completedAt: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await withDevTiming(trace, () => reconcileSyncDeadline(db, accountId, slug, villageId, previous));
  expect(
    (await db.selectFrom('buildings').select('status').where('id', '=', houseId).executeTakeFirstOrThrow()).status,
  ).toBe('completed');
  expect(await db.selectFrom('scheduledTasks').selectAll().where('id', '=', task.id).executeTakeFirstOrThrow()).toEqual(
    task,
  );
  expect(trace.metrics.has('snapshot')).toBe(false);
  expect(trace.metrics.has('navigation')).toBe(false);
  expect(trace.metrics.get('reconcile')?.count).toBe(1);
});

it('overlapping read wakeups join one economic transaction after ownership checks', async () => {
  let enter!: () => void, release!: () => void, joined!: () => void, expire!: (error: Error) => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const checked = new Promise<void>((resolve) => {
    joined = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const timeout = new Promise<never>((_, reject) => {
    expire = reject;
  });
  let locks = 0,
    ownerships = 0;
  const lockQueries = new Set<QueryId>(),
    ownershipQueries = new Set<QueryId>();
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      const text = JSON.stringify(args.node);
      if (text.includes('world_memberships')) {
        ownerships++;
        if (ownerships === 3) ownershipQueries.add(args.queryId);
      }
      if (text.includes('villages') && text.includes('ForUpdate')) {
        locks++;
        if (locks === 1) lockQueries.add(args.queryId);
      }
      return args.node;
    },
    async transformResult(args) {
      if (ownershipQueries.delete(args.queryId)) joined();
      if (lockQueries.delete(args.queryId)) {
        enter();
        await barrier;
      }
      return args.result;
    },
  };
  const source = db.withPlugin(plugin),
    jobs: Array<Promise<unknown>> = [];
  const timer = setTimeout(() => {
    release();
    expire(Error('Shared read barrier timed out'));
  }, 15_000);
  try {
    const first = reconcileVillageForRead(source, accountId, slug);
    jobs.push(first);
    await Promise.race([
      entered,
      timeout,
      first.then(() => {
        throw Error('Missing economic lock barrier');
      }),
    ]);
    const second = reconcileVillageForRead(source, accountId, slug, villageId);
    jobs.push(second);
    await Promise.race([checked, timeout]);
    await setImmediate();
    expect(ownerships).toBe(3);
    expect(locks).toBe(1);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(b).toEqual(a);
    expect(locks).toBe(1);
    expect(
      (await db.selectFrom('buildings').select('status').where('id', '=', houseId).executeTakeFirstOrThrow()).status,
    ).toBe('completed');
    await reconcileVillageForRead(source, accountId, slug, villageId);
    expect(locks).toBe(2); // A settled wakeup is not a cache.
  } finally {
    clearTimeout(timer);
    release();
    await Promise.allSettled(jobs);
  }
});

it('measures the idle authoritative revision check separately from snapshot reads', async () => {
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await revision();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.info('SYNC_REVISION_CHECK', {
    markers: await revision(),
    samples: times.length,
    medianMs: Math.round(times[5]!),
    maxMs: Math.round(times[9]!),
  });
});

it('returns a construction frame from the client exact HTTP base instead of a full village', async () => {
  const initial = await app.inject({
    url: `/api/worlds/${slug}/village?villageId=${villageId}`,
    cookies: { arbestra_session: token },
  });
  expect(initial.statusCode).toBe(200);
  const base = initial.json<VillageState>();
  if (process.env.RC1_HTTP_BROWSER_FIXTURE === '1') mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/http-construction-browser-state.json', JSON.stringify(base));
  const payload = {
    commandId: randomUUID(),
    buildingType: 'dwelling',
    houseVariant: 'logs',
    anchorCellX: 67,
    anchorCellY: 64,
    cells: [{ cellX: 67, cellY: 64 }],
  };
  const response = await app.inject({
    method: 'POST',
    url: `/api/worlds/${slug}/villages/${villageId}/buildings`,
    cookies: { arbestra_session: token },
    payload,
    headers: {
      'x-village-sync': '1',
      'x-village-revision': String(base.syncRevision),
      'x-village-server-time': base.serverTime,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const result = response.json<{ kind: string; commandId: string; frame: VillageFrame }>();
  expect(result.kind).toBe('frame');
  expect(result.commandId).toBe(payload.commandId);
  const applied = applyVillageFrame(base, result.frame);
  expect(applied.kind).toBe('applied');
  if (applied.kind !== 'applied') throw Error('Frame rejected');
  expect(applied.state.village.wood).toBe(base.village.wood - 25);
  expect(applied.state.cells.find((c) => c.cellX === 67 && c.cellY === 64)?.building?.type).toBe('dwelling');
});

const config = {
  databaseUrl: url,
  host: '127.0.0.1',
  port: 0,
  isProduction: false,
  cookieName: 'arbestra_session',
  sessionTtlDays: 30,
  constructionDurationOverrideMs: 600000,
  scheduledTaskPollIntervalMs: 250,
};

it.each(['market', 'processing', 'science'] as const)(
  'publishes %s frames after commit while another command can lock the village',
  async (family) => {
    const workshopId = randomUUID();
    await db.updateTable('buildings').set({ level: 2 }).where('id', '=', hallId).execute();
    await db
      .insertInto('buildings')
      .values({
        id: workshopId,
        worldId,
        villageId,
        buildingType: 'sawmill',
        level: 1,
        targetLevel: null,
        status: 'completed',
        constructionStartedAt: null,
        constructionCompletesAt: null,
        completedAt: new Date(),
      })
      .execute();
    await db
      .insertInto('worldCellOccupancies')
      .values({ worldId, buildingId: workshopId, cellX: 63, cellY: 64, role: 'anchor', featureId: null })
      .execute();
    await db
      .insertInto('populationCohorts')
      .values({
        worldId,
        villageId,
        originVillageId: villageId,
        memberCount: 10,
        activity: 'idle',
        energy: 10,
        energyProgress: 0,
        energyUpdatedAt: new Date(),
        restingSince: null,
        foodUsedSinceRest: 0,
      })
      .execute();
    await db
      .insertInto('sciencePrograms')
      .values({
        worldId,
        accountId,
        code: 'mathematics-1',
        discipline: 'mathematics',
        level: 1,
        createdAt: new Date(),
        acquiredAt: null,
        paused: false,
        workDoneMs: 0,
        workerCap: 1,
      })
      .execute();
    let armed = false,
      readOnly = false,
      gated = false,
      expired = false,
      enter!: () => void,
      release!: () => void;
    const entered = new Promise<void>((r) => {
        enter = r;
      }),
      barrier = new Promise<void>((r) => {
        release = r;
      });
    const queries = new Set<QueryId>();
    const plugin: KyselyPlugin = {
      transformQuery(args) {
        const query = JSON.stringify(args.node);
        if (armed && query.includes('set transaction read only')) readOnly = true;
        if (armed && readOnly && !gated && query.includes('village_sync_changes')) {
          gated = true;
          queries.add(args.queryId);
        }
        return args.node;
      },
      async transformResult(args) {
        if (queries.delete(args.queryId)) {
          enter();
          await barrier;
        }
        return args.result;
      },
    };
    const server = await buildApp(config, db.withPlugin(plugin));
    let pending: ReturnType<typeof build> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const base = await snapshot(server),
        commandId = randomUUID();
      const quote = await server.inject({
        method: 'POST',
        url: `/api/worlds/${slug}/villages/${villageId}/market/preview`,
        cookies: { arbestra_session: token },
        payload: { offeredResource: 'wood', requestedResource: 'stone', amount: 100 },
      });
      expect(quote.statusCode, quote.body).toBe(200);
      const payload =
        family === 'market'
          ? {
              commandId,
              offeredResource: 'wood',
              requestedResource: 'stone',
              amount: 100,
              expectedReceivedAmount: quote.json().receivedAmount,
            }
          : family === 'processing'
            ? { commandId, action: 'start', buildingId: workshopId, lots: 2, workerCount: 1 }
            : { action: 'pause', programCode: 'mathematics-1' };
      armed = true;
      deadline = setTimeout(() => {
        expired = true;
        release();
      }, 30000);
      pending = server.inject({
        method: 'POST',
        url: `/api/worlds/${slug}/villages/${villageId}/${family}`,
        cookies: { arbestra_session: token },
        headers: headers(base),
        payload,
      });
      await Promise.race([
        entered,
        pending.then((r) => {
          throw Error(`Response completed without projection barrier: ${r.statusCode}`);
        }),
      ]);
      expect(expired).toBe(false);
      // The change is already visible from a separate connection, before reply computation.
      if (family === 'market')
        expect(
          await db.selectFrom('marketExchanges').select('id').where('worldId', '=', worldId).execute(),
        ).toHaveLength(1);
      if (family === 'processing')
        expect(
          await db.selectFrom('processingOrders').select('id').where('worldId', '=', worldId).execute(),
        ).toHaveLength(1);
      if (family === 'science')
        expect(
          (
            await db
              .selectFrom('sciencePrograms')
              .select('paused')
              .where('worldId', '=', worldId)
              .executeTakeFirstOrThrow()
          ).paused,
        ).toBe(true);
      await db.transaction().execute(async (tx) => {
        await sql`set local lock_timeout='1000ms'`.execute(tx);
        await tx
          .selectFrom('villages')
          .select('id')
          .where('worldId', '=', worldId)
          .where('id', '=', villageId)
          .forUpdate()
          .executeTakeFirstOrThrow();
      });
      expect(expired).toBe(false);
      release();
      const response = await pending;
      expect(response.statusCode, response.body).toBe(200);
      const result = response.json<VillageCommandResponse>();
      expect(result.kind).toBe('frame');
      if (result.kind !== 'frame') throw Error('Expected incremental reply');
      const next = applied(base, result);
      if (family === 'market') expect(next.village.wood).toBe(base.village.wood - 100);
      if (family === 'processing') expect(next.village.processingOrders).toHaveLength(1);
      if (family === 'science')
        expect(next.science!.programs.find((p) => p.code === 'mathematics-1')?.status).toBe('paused');
      expect(applyVillageFrame(next, result.frame).kind).toBe('ignored');
      const dueId = randomUUID(),
        now = Date.now();
      if (family !== 'science')
        await db
          .insertInto('buildings')
          .values({
            id: dueId,
            worldId,
            villageId,
            buildingType: 'dwelling',
            level: 1,
            status: 'under-construction',
            constructionStartedAt: new Date(now - 2000),
            constructionCompletesAt: new Date(now - 1000),
          })
          .execute();
      const retry = await server.inject({
        method: 'POST',
        url: `/api/worlds/${slug}/villages/${villageId}/${family}`,
        cookies: { arbestra_session: token },
        headers: headers(next),
        payload,
      });
      expect(retry.statusCode, retry.body).toBe(200);
      const retryResult = retry.json<VillageCommandResponse>();
      const retried = retryResult.kind === 'snapshot' ? retryResult.state : applied(next, retryResult);
      expect(retried.village.wood).toBe(next.village.wood);
      if (family !== 'science')
        expect(
          (
            await db
              .selectFrom('buildings')
              .select('status')
              .where('worldId', '=', worldId)
              .where('id', '=', dueId)
              .executeTakeFirstOrThrow()
          ).status,
        ).toBe('under-construction');
    } finally {
      clearTimeout(deadline);
      release();
      try {
        await pending;
      } finally {
        await server.close();
      }
    }
  },
  60000,
);

const snapshot = async (server = app) => {
  const response = await server.inject({
    url: `/api/worlds/${slug}/village?villageId=${villageId}`,
    cookies: { arbestra_session: token },
  });
  expect(response.statusCode).toBe(200);
  return response.json<VillageState>();
};
const headers = (base: VillageState) => ({
  'x-village-sync': '1',
  'x-village-revision': String(base.syncRevision),
  'x-village-server-time': base.serverTime,
});
const buildPayload = (x: number) => ({
  commandId: randomUUID(),
  buildingType: 'dwelling',
  houseVariant: 'logs',
  anchorCellX: x,
  anchorCellY: 64,
  cells: [{ cellX: x, cellY: 64 }],
});
it('confirms construction and its stock debit even when display navigation is unavailable', async () => {
  const base = await snapshot(),
    payload = buildPayload(67);
  const navigation = vi
    .spyOn(NavigationCompute.prototype, 'network')
    .mockRejectedValue(new Error('display navigation deliberately unavailable'));
  try {
    const send = () =>
      app.inject({
        method: 'POST',
        url: `/api/worlds/${slug}/villages/${villageId}/buildings`,
        cookies: { arbestra_session: token },
        headers: { ...headers(base), 'x-construction-confirmation': '1' },
        payload,
      });
    const response = await send();
    expect(response.statusCode, response.body).toBe(201);
    const confirmation = response.json();
    expect(confirmation).toMatchObject({ kind: 'construction', worldId, villageId, commandId: payload.commandId });
    expect(confirmation.resources.find((r: { code: string }) => r.code === 'wood').amount).toBe(base.village.wood - 25);
    const house = confirmation.cells.find((c: { cellX: number; cellY: number }) => c.cellX === 67 && c.cellY === 64);
    expect(house).toMatchObject({ canBuild: false, building: { type: 'dwelling', status: 'under-construction' } });
    expect(confirmation.minimumRevision).toBe(await revision());
    expect(confirmation).not.toHaveProperty('syncRevision');
    expect(confirmation).not.toHaveProperty('travelRoutes');
    const retry = await send();
    expect(retry.statusCode, retry.body).toBe(201);
    const amounts = (resources: Array<{ code: string; amount: number }>) =>
      resources.map(({ code, amount }) => ({ code, amount }));
    expect(amounts(retry.json().resources)).toEqual(amounts(confirmation.resources));
    expect(
      retry.json().cells.find((c: { cellX: number; cellY: number }) => c.cellX === 67 && c.cellY === 64)?.building?.id,
    ).toBe(house.building.id);
    expect(
      await db
        .selectFrom('buildingCommandReceipts')
        .select('commandId')
        .where('worldId', '=', worldId)
        .where('commandId', '=', payload.commandId)
        .execute(),
    ).toHaveLength(1);
    expect(navigation).not.toHaveBeenCalled();
  } finally {
    navigation.mockRestore();
  }
}, 60000);
it('confirms upgrades and garden extensions without display navigation, preserving reserved footprints', async () => {
  await db
    .updateTable('buildings')
    .set({ visualLayout: { recipe: 'log-house', version: 1, quarterTurns: 0, entranceFace: '-z', offset: [0, 0] } })
    .where('worldId', '=', worldId)
    .where('id', '=', houseId)
    .execute();
  const garden = await constructBuilding(db, accountId, slug, villageId, 64, 65, 'garden', 0, randomUUID());
  const gardenId = garden.cells.find((c) => c.cellX === 64 && c.cellY === 65)?.building?.id;
  expect(gardenId).toBeTruthy();
  const base = await snapshot(),
    navigation = vi
      .spyOn(NavigationCompute.prototype, 'network')
      .mockRejectedValue(new Error('display navigation unavailable'));
  try {
    const upgrade = await app.inject({
      method: 'POST',
      url: `/api/worlds/${slug}/villages/${villageId}/buildings/${houseId}/upgrade`,
      cookies: { arbestra_session: token },
      headers: { ...headers(base), 'x-construction-confirmation': '1' },
      payload: { commandId: randomUUID(), expectedLevel: 2 },
    });
    expect(upgrade.statusCode, upgrade.body).toBe(201);
    expect(
      upgrade.json().cells.find((c: { building: { id: string } | null }) => c.building?.id === houseId)?.building,
    ).toMatchObject({ status: 'under-construction', targetLevel: 2 });
    const extension = await app.inject({
      method: 'POST',
      url: `/api/worlds/${slug}/villages/${villageId}/buildings/${gardenId}/expansions`,
      cookies: { arbestra_session: token },
      headers: { ...headers(base), 'x-construction-confirmation': '1' },
      payload: { commandId: randomUUID(), cells: [{ cellX: 64, cellY: 66 }] },
    });
    expect(extension.statusCode, extension.body).toBe(201);
    expect(
      extension.json().cells.find((c: { cellX: number; cellY: number }) => c.cellX === 64 && c.cellY === 66),
    ).toMatchObject({ canBuild: false, footprint: { buildingId: gardenId, state: 'reserved' } });
    expect(navigation).not.toHaveBeenCalled();
  } finally {
    navigation.mockRestore();
  }
}, 60000);
const build = (payload: ReturnType<typeof buildPayload>, base: VillageState, server = app) =>
  server.inject({
    method: 'POST',
    url: `/api/worlds/${slug}/villages/${villageId}/buildings`,
    cookies: { arbestra_session: token },
    headers: headers(base),
    payload,
  });
function applied(base: VillageState, response: VillageCommandResponse) {
  expect(response.kind).toBe('frame');
  if (response.kind !== 'frame') throw Error('Expected frame');
  const result = applyVillageFrame(base, response.frame);
  expect(result.kind).toBe('applied');
  if (result.kind !== 'applied') throw Error('Rejected frame');
  return result.state;
}
it('deduplicates incremental HTTP and SSE in either order and retries the same construction receipt', async () => {
  const base = await snapshot(),
    stream = new VillageSyncSession(read, revision);
  await stream.check();
  const payload = buildPayload(68),
    response = await build(payload, base);
  expect(response.statusCode, response.body).toBe(201);
  const first = response.json<VillageCommandResponse>(),
    local = applied(base, first);
  const sse = await stream.check();
  expect(sse.event).toBe('frame');
  if (first.kind !== 'frame' || sse.event !== 'frame') throw Error('Expected frames');
  expect(applyVillageFrame(local, sse.data).kind).toBe('ignored');
  const sseFirst = applied(base, {
    kind: 'frame',
    frame: sse.data,
    commandTime: base.serverTime,
    serverTime: base.serverTime,
  });
  expect(applyVillageFrame(sseFirst, first.frame).kind).toBe('ignored');
  const retry = await build(payload, local);
  expect(retry.statusCode).toBe(201);
  const reply = retry.json<VillageCommandResponse>(),
    next = reply.kind === 'snapshot' ? reply.state : applied(local, reply);
  expect(next.village.wood).toBe(local.village.wood);
  expect(next.cells.find((c) => c.cellX === 68 && c.cellY === 64)?.building?.id).toBe(
    local.cells.find((c) => c.cellX === 68 && c.cellY === 64)?.building?.id,
  );
  expect(
    await db
      .selectFrom('buildingCommandReceipts')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('commandId', '=', payload.commandId)
      .execute(),
  ).toHaveLength(1);
});
it('leaves unrelated completion to its handler while retaining upgrade frames and coherent unknown-base fallback', async () => {
  await constructBuilding(
    db,
    accountId,
    slug,
    villageId,
    67,
    64,
    'dwelling',
    600000,
    randomUUID(),
    undefined,
    0,
    'logs',
  );
  const base = await snapshot();
  const due = await db
    .selectFrom('worldCellOccupancies')
    .select('buildingId')
    .where('worldId', '=', worldId)
    .where('cellX', '=', 67)
    .where('cellY', '=', 64)
    .executeTakeFirstOrThrow();
  await db
    .updateTable('buildings')
    .set({ constructionStartedAt: new Date(Date.now() - 2000), constructionCompletesAt: new Date(Date.now() - 1000) })
    .where('id', '=', due.buildingId!)
    .execute();
  const response = await build(buildPayload(69), base);
  expect(response.statusCode, response.body).toBe(201);
  const local = applied(base, response.json<VillageCommandResponse>());
  expect(local.cells.find((c) => c.building?.id === due.buildingId)?.building?.status).toBe('under-construction');
  // The exact projection just sent is also a usable transport base.
  const upgrade = await app.inject({
    method: 'POST',
    url: `/api/worlds/${slug}/villages/${villageId}/buildings/${due.buildingId}/upgrade`,
    cookies: { arbestra_session: token },
    headers: headers(local),
    payload: { commandId: randomUUID(), expectedLevel: 2 },
  });
  expect(upgrade.statusCode, upgrade.body).toBe(201);
  const upgraded = applied(local, upgrade.json<VillageCommandResponse>());
  expect(upgraded.cells.find((c) => c.building?.id === due.buildingId)?.building?.targetLevel).toBe(2);
  const fallback = await build(buildPayload(70), { ...upgraded, serverTime: '2020-01-01T00:00:00.000Z' });
  expect(fallback.statusCode).toBe(201);
  const reply = fallback.json<VillageCommandResponse>();
  expect(reply.kind).toBe('snapshot');
  if (reply.kind === 'snapshot') {
    expect(reply.state.syncRevision).toBe(await revision());
    expect(reply.state.cells.find((c) => c.cellX === 70 && c.cellY === 64)?.building).toBeTruthy();
  }
});
it('returns an incremental garden extension using the same transactional finalization', async () => {
  const garden = await constructBuilding(db, accountId, slug, villageId, 64, 65, 'garden', 0, randomUUID());
  const id = garden.cells.find((c) => c.cellX === 64 && c.cellY === 65)?.building?.id;
  if (!id) throw Error('No garden');
  const base = await snapshot(),
    response = await app.inject({
      method: 'POST',
      url: `/api/worlds/${slug}/villages/${villageId}/buildings/${id}/expansions`,
      cookies: { arbestra_session: token },
      headers: headers(base),
      payload: { commandId: randomUUID(), cells: [{ cellX: 64, cellY: 66 }] },
    });
  expect(response.statusCode, response.body).toBe(201);
  const next = applied(base, response.json<VillageCommandResponse>());
  expect(next.cells.find((c) => c.cellX === 64 && c.cellY === 66)?.footprint?.buildingId).toBe(id);
  expect(next.village.wood).toBeLessThan(base.village.wood);
});
it.each([false, true])(
  'releases the village lock before publishing the construction response (confirmation=%s)',
  async (confirmation) => {
    let armed = false,
      readOnly = false,
      gated = false,
      expired = false,
      enter!: () => void,
      release!: () => void;
    const entered = new Promise<void>((r) => {
        enter = r;
      }),
      barrier = new Promise<void>((r) => {
        release = r;
      }),
      queries = new Set<QueryId>();
    const plugin: KyselyPlugin = {
      transformQuery(args) {
        const text = JSON.stringify(args.node);
        if (armed && text.includes('set transaction read only')) readOnly = true;
        if (armed && (confirmation || readOnly) && !gated && text.includes('village_sync_changes')) {
          gated = true;
          queries.add(args.queryId);
        }
        return args.node;
      },
      async transformResult(args) {
        if (queries.delete(args.queryId)) {
          enter();
          await barrier;
        }
        return args.result;
      },
    };
    const server = await buildApp(config, db.withPlugin(plugin));
    let pending: ReturnType<typeof build> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const base = await snapshot(server);
      armed = true;
      deadline = setTimeout(() => {
        expired = true;
        release();
      }, 30000);
      pending = confirmation
        ? server.inject({
            method: 'POST',
            url: `/api/worlds/${slug}/villages/${villageId}/buildings`,
            cookies: { arbestra_session: token },
            headers: { ...headers(base), 'x-construction-confirmation': '1' },
            payload: buildPayload(66),
          })
        : build(buildPayload(66), base, server);
      await Promise.race([
        entered,
        pending.then(() => {
          throw Error('Response completed without projection barrier');
        }),
      ]);
      expect(expired).toBe(false);
      const stored = await db
        .selectFrom('worldCellOccupancies')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('cellX', '=', 66)
        .where('cellY', '=', 64)
        .execute();
      expect(stored).toHaveLength(1); // The command really committed before this pause.
      await db.transaction().execute(async (tx) => {
        await sql`set local lock_timeout='1000ms'`.execute(tx);
        await tx.selectFrom('villages').select('id').where('id', '=', villageId).forUpdate().executeTakeFirstOrThrow();
        await tx
          .updateTable('villages')
          .set({ name: 'Concurrent command while response is projecting' })
          .where('id', '=', villageId)
          .execute();
      });
      expect(expired).toBe(false); // The independent writer finished while the response was still held.
    } finally {
      clearTimeout(deadline);
      release();
      try {
        if (pending) {
          const response = await pending;
          expect(response.statusCode, response.body).toBe(201);
        }
      } finally {
        await server.close();
      }
    }
    expect(gated).toBe(true);
    expect((await read()).village.name).toBe('Concurrent command while response is projecting');
  },
);
it('rolls back observed commit-mode construction writes and the revision on an exact injected failure', async () => {
  const tables = [
    'villages',
    'villageResources',
    'villageResourceFlows',
    'buildings',
    'worldCellOccupancies',
    'scheduledTasks',
    'buildingCommandReceipts',
    'populationCohorts',
    'gardenPlots',
    'buildingExpansions',
    'villageAccomplishments',
    'buildingResourceBuffers',
    'scienceActivities',
    'playerScience',
    'buildingHiddenSupplies',
  ] as const;
  async function stored(source: Kysely<Database>) {
    const result: Record<string, unknown> = {};
    for (const table of tables)
      result[table] = await source.selectFrom(table).selectAll().where('worldId', '=', worldId).execute();
    return result;
  }
  const before = await stored(db),
    r = await revision(),
    commandId = randomUUID(),
    injected = Error('construction commit-mode after observed finalization');
  let observed = false;
  await expect(
    db.transaction().execute(async (tx) => {
      const inside = {
        transaction: () => ({ execute: <T>(f: (t: Transaction<Database>) => Promise<T>) => f(tx) }),
        getExecutor: () => tx.getExecutor(),
      } as unknown as Kysely<Database>;
      await constructBuildingArea(
        inside,
        accountId,
        slug,
        villageId,
        'dwelling',
        { cellX: 62, cellY: 65 },
        [{ cellX: 62, cellY: 65 }],
        0,
        commandId,
        undefined,
        0,
        'logs',
        'commit',
      );
      expect(
        await tx
          .selectFrom('buildingCommandReceipts')
          .selectAll()
          .where('worldId', '=', worldId)
          .where('commandId', '=', commandId)
          .execute(),
      ).toHaveLength(1);
      expect(
        await tx
          .selectFrom('worldCellOccupancies')
          .selectAll()
          .where('worldId', '=', worldId)
          .where('cellX', '=', 62)
          .where('cellY', '=', 65)
          .execute(),
      ).toHaveLength(1);
      const created = await tx
        .selectFrom('buildingCommandReceipts')
        .innerJoin('buildings', 'buildings.id', 'buildingCommandReceipts.buildingId')
        .select('buildings.status')
        .where('buildingCommandReceipts.commandId', '=', commandId)
        .executeTakeFirstOrThrow();
      expect(created.status).toBe('under-construction'); // Even zero-duration jobs are completed by their handler.
      expect((await villageSyncRevision(tx, worldId)).revision).toBe(r + 1);
      observed = true;
      throw injected;
    }),
  ).rejects.toBe(injected);
  expect(observed).toBe(true);
  expect(await revision()).toBe(r);
  expect(await stored(db)).toEqual(before);
});

it('measures legacy and incremental replies on the same isolated warm village', async () => {
  const results = [];
  for (const [x, incremental] of [
    [63, false],
    [62, true],
    [61, false],
    [60, true],
  ] as const) {
    const base = await snapshot(),
      started = performance.now();
    const response = await app.inject({
      method: 'POST',
      url: `/api/worlds/${slug}/villages/${villageId}/buildings`,
      cookies: { arbestra_session: token },
      ...(incremental ? { headers: headers(base) } : {}),
      payload: buildPayload(x),
    });
    expect(response.statusCode, response.body).toBe(201);
    const data = response.json<VillageState | VillageCommandResponse>();
    const mode = 'kind' in data ? data.kind : 'legacy';
    if (incremental) expect(mode).toBe('frame');
    results.push({
      mode,
      totalMs: Math.round(performance.now() - started),
      responseBytes: Buffer.byteLength(response.body),
      baseBytes: Buffer.byteLength(JSON.stringify(base)),
    });
  }
  console.info('CONSTRUCTION_HTTP_PROFILE', { world: 'isolated v1 flat 512x256', results });
});

const roadPayload = (base: VillageState, y = 66): InfrastructureRequest => {
  const operation: InfrastructureRequest['operation'] = {
    kind: 'road',
    stroke: {
      id: 'preview',
      points: [
        { x: 64 * 8, y: y * 8 },
        { x: 66 * 8, y: y * 8 },
      ],
      width: 4,
      material: 'stone-1',
      border: false,
      operation: 'paint',
    },
  };
  return {
    commandId: randomUUID(),
    sessionId: randomUUID(),
    revision: base.infrastructure!.revision,
    operation,
    expected: prepareInfrastructureEdit(base, operation, 'preview').quote,
  };
};
const road = (payload: InfrastructureRequest, base: VillageState, server = app) =>
  server.inject({
    method: 'POST',
    url: '/api/worlds/' + slug + '/villages/' + villageId + '/infrastructure',
    cookies: { arbestra_session: token },
    headers: headers(base),
    payload,
  });
it('road optimization: read-only preview completes while the village is locked and leaves due economy unchanged', async () => {
  const base = await read(),
    r = await revision();
  let release!: () => void, enter!: () => void;
  const entered = new Promise<void>((f) => (enter = f)),
    barrier = new Promise<void>((f) => (release = f));
  const holder = db.transaction().execute(async (tx) => {
    await tx.selectFrom('villages').select('id').where('id', '=', villageId).forUpdate().executeTakeFirstOrThrow();
    enter();
    await barrier;
  });
  let pending: ReturnType<typeof infrastructurePreview> | undefined;
  const deadline = setTimeout(release, 15000);
  try {
    await entered;
    // A lock timeout makes the old FOR UPDATE preview fail deterministically.
    const timed = {
      transaction: () => ({
        setIsolationLevel: () => ({
          execute: <T>(run: (tx: Transaction<Database>) => Promise<T>) =>
            db
              .transaction()
              .setIsolationLevel('repeatable read')
              .execute(async (tx) => {
                await sql`set local lock_timeout='1000ms'`.execute(tx);
                return run(tx);
              }),
        }),
      }),
    } as unknown as Kysely<Database>;
    pending = infrastructurePreview(timed, accountId, slug, villageId, roadPayload(base));
    expect(await pending).toMatchObject({ valid: true });
    expect(await revision()).toBe(r);
    expect(
      (await db.selectFrom('buildings').select('status').where('id', '=', houseId).executeTakeFirstOrThrow()).status,
    ).toBe('under-construction');
  } finally {
    clearTimeout(deadline);
    release();
    await holder;
    if (pending) await pending.catch(() => {});
  }
}, 30000);
it('road optimization: projects the frame after releasing locks, deduplicates HTTP/SSE and supports retry and undo', async () => {
  let armed = false,
    readOnly = false,
    gated = false,
    enter!: () => void,
    release!: () => void;
  const entered = new Promise<void>((f) => (enter = f)),
    barrier = new Promise<void>((f) => (release = f)),
    queries = new Set<QueryId>();
  const plugin: KyselyPlugin = {
    transformQuery(a) {
      const text = JSON.stringify(a.node);
      if (armed && text.includes('set transaction read only')) readOnly = true;
      if (armed && readOnly && !gated && text.includes('village_sync_changes')) {
        gated = true;
        queries.add(a.queryId);
      }
      return a.node;
    },
    async transformResult(a) {
      if (queries.delete(a.queryId)) {
        enter();
        await barrier;
      }
      return a.result;
    },
  };
  const server = await buildApp(config, db.withPlugin(plugin));
  let pending: ReturnType<typeof road> | undefined;
  const deadline = setTimeout(release, 20000),
    started = performance.now();
  try {
    const base = await snapshot(server),
      payload = roadPayload(base),
      stream = new VillageSyncSession(read, revision);
    await stream.check();
    armed = true;
    pending = road(payload, base, server);
    await Promise.race([
      entered,
      pending.then(() => {
        throw Error('Response ended without post-commit projection');
      }),
    ]);
    expect(
      await db
        .selectFrom('infrastructureReceipts')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('commandId', '=', payload.commandId)
        .execute(),
    ).toHaveLength(1);
    await db.transaction().execute(async (tx) => {
      await sql`set local lock_timeout='1000ms'`.execute(tx);
      await tx.selectFrom('villages').select('id').where('id', '=', villageId).forUpdate().executeTakeFirstOrThrow();
    });
    release();
    const response = await pending;
    expect(response.statusCode, response.body).toBe(200);
    const reply = response.json<VillageCommandResponse>(),
      local = applied(base, reply);
    expect(local.infrastructure!.revision).toBe(base.infrastructure!.revision + 1);
    expect(local.village.resources.find((r) => r.code === 'stone')!.amount).toBe(
      base.village.resources.find((r) => r.code === 'stone')!.amount - payload.expected!.stoneDebit,
    );
    const event = await stream.check();
    expect(event.event).toBe('frame');
    if (event.event === 'frame') expect(applyVillageFrame(local, event.data).kind).toBe('ignored');
    if (reply.kind === 'frame') expect(applyVillageFrame(local, reply.frame).kind).toBe('ignored');
    const retry = await road(payload, local, server);
    expect(retry.statusCode, retry.body).toBe(200);
    const retried = retry.json<VillageCommandResponse>();
    const next = retried.kind === 'snapshot' ? retried.state : applied(local, retried);
    expect(next.infrastructure).toEqual(local.infrastructure);
    expect(next.village.resources.map((r) => [r.code, r.amount]).sort()).toEqual(
      local.village.resources.map((r) => [r.code, r.amount]).sort(),
    );
    const undo = await road(
      {
        commandId: randomUUID(),
        sessionId: payload.sessionId,
        revision: next.infrastructure!.revision,
        operation: { kind: 'undo', target: payload.commandId },
      },
      next,
      server,
    );
    expect(undo.statusCode, undo.body).toBe(200);
    const restored = applied(next, undo.json<VillageCommandResponse>());
    expect(restored.infrastructure!.roads).toEqual(base.infrastructure!.roads);
    expect(restored.village.resources.map((r) => [r.code, r.amount]).sort()).toEqual(
      base.village.resources.map((r) => [r.code, r.amount]).sort(),
    );
    console.info('ROAD_FRAME_BYTES', {
      snapshot: Buffer.byteLength(JSON.stringify(base)),
      frame: Buffer.byteLength(response.body),
      totalWithBarrierMs: Math.round(performance.now() - started),
    });
  } finally {
    clearTimeout(deadline);
    release();
    try {
      if (pending) await pending;
    } finally {
      await server.close();
    }
  }
}, 60000);
it('road optimization: rolls back observed plan, debit, receipt and revision on an exact failure', async () => {
  const tables = [
    'villages',
    'villageResources',
    'villageResourceFlows',
    'buildings',
    'worldCellOccupancies',
    'populationCohorts',
    'scheduledTasks',
    'villageInfrastructure',
    'infrastructureReceipts',
    'buildingHiddenSupplies',
    'villageAccomplishments',
    'gardenPlots',
    'scienceActivities',
    'playerScience',
  ] as const;
  async function stored(source: Kysely<Database>) {
    const result: Record<string, unknown> = {};
    for (const table of tables)
      result[table] = await source.selectFrom(table).selectAll().where('worldId', '=', worldId).execute();
    return result;
  }
  const base = await read(),
    before = await stored(db),
    r = await revision(),
    payload = roadPayload(base, 67),
    injected = Error('road after observed finalization');
  let observed = false;
  await expect(
    db.transaction().execute(async (tx) => {
      const inside = {
        transaction: () => ({ execute: <T>(run: (t: Transaction<Database>) => Promise<T>) => run(tx) }),
      } as unknown as Kysely<Database>;
      await infrastructureCommand(inside, accountId, slug, villageId, payload, 'confirmation');
      expect(
        (
          await tx
            .selectFrom('villageInfrastructure')
            .select('plan')
            .where('worldId', '=', worldId)
            .executeTakeFirstOrThrow()
        ).plan.revision,
      ).toBe(payload.revision + 1);
      expect(
        await tx
          .selectFrom('infrastructureReceipts')
          .selectAll()
          .where('worldId', '=', worldId)
          .where('commandId', '=', payload.commandId)
          .execute(),
      ).toHaveLength(1);
      expect(
        Number(
          (
            await tx
              .selectFrom('villageResources')
              .select('amount')
              .where('worldId', '=', worldId)
              .where('resourceCode', '=', 'stone')
              .executeTakeFirstOrThrow()
          ).amount,
        ),
      ).toBe(base.village.resources.find((r) => r.code === 'stone')!.amount - payload.expected!.stoneDebit);
      expect((await villageSyncRevision(tx, worldId)).revision).toBe(r + 1);
      observed = true;
      throw injected;
    }),
  ).rejects.toBe(injected);
  expect(observed).toBe(true);
  expect(await revision()).toBe(r);
  expect(await stored(db)).toEqual(before);
});

it('road optimization: measures valid legacy and incremental commands on the same isolated village', async () => {
  const results = [];
  for (const [y, incremental] of [
    [68, false],
    [69, true],
    [70, false],
    [71, true],
  ] as const) {
    const base = await snapshot(),
      payload = roadPayload(base, y),
      previewStart = performance.now(),
      preview = await infrastructurePreview(db, accountId, slug, villageId, payload);
    expect(preview.valid, preview.message ?? '').toBe(true);
    const previewMs = Math.round(performance.now() - previewStart),
      started = performance.now();
    const response = await app.inject({
      method: 'POST',
      url: '/api/worlds/' + slug + '/villages/' + villageId + '/infrastructure',
      cookies: { arbestra_session: token },
      ...(incremental ? { headers: headers(base) } : {}),
      payload,
    });
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json<VillageState | VillageCommandResponse>(),
      mode = 'kind' in data ? data.kind : 'legacy';
    if (incremental) expect(mode).toBe('frame');
    const serverTiming = String(response.headers['server-timing'] ?? '');
    expect(serverTiming).toMatch(/^road_tx;dur=\d+\.\d, road_sync;dur=\d+\.\d$/);
    const timing = serverTiming.match(/^road_tx;dur=(\d+\.\d), road_sync;dur=(\d+\.\d)$/)!;
    results.push({
      mode,
      previewMs,
      totalMs: Math.round(performance.now() - started),
      transactionMs: Number(timing[1]),
      projectionMs: Number(timing[2]),
      responseBytes: Buffer.byteLength(response.body),
      baseBytes: Buffer.byteLength(JSON.stringify(base)),
    });
  }
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    'test-results/road-command-measures.json',
    JSON.stringify({ world: 'isolated v1 flat 512x256, no reset', results }, null, 2),
  );
  console.info('ROAD_COMMAND_PROFILE', results);
});

it('road optimization: batches worksite projections in three reads with identical active missions and ordered targets', async () => {
  const abort = Error('isolated batch projection cleanup'),
    r = await revision();
  let checked = false;
  await expect(
    db.transaction().execute(async (tx) => {
      const features = [randomUUID(), randomUUID()],
        at = new Date(),
        siteIds: string[] = [];
      for (const [i, featureId] of features.entries()) {
        await tx
          .insertInto('worldFeatures')
          .values({ id: featureId, worldId, featureTypeCode: 'stone_outcrop', state: 'available', variantSeed: 2 })
          .execute();
        await tx
          .insertInto('stoneDeposits')
          .values({
            worldId,
            featureId,
            cellX: 80 + i,
            cellY: 80,
            initialAmount: 2000,
            remainingAmount: 2000,
            reservedAmount: 100,
            revision: 1,
            updatedAt: at,
          })
          .execute();
      }
      for (let i = 0; i < 6; i++) {
        const site = await tx
          .insertInto('extractionWorksites')
          .values({
            worldId,
            villageId,
            commandId: randomUUID(),
            requestedFeatureIds: features,
            requestedWorkerCap: 2,
            workerCap: 2,
            resourceCode: 'stone',
            mode: 'extract',
            status: 'paused',
            waitReason: null,
            nextWakeAt: null,
            lastDepartureAt: null,
            updatedAt: at,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        siteIds.push(site.id);
        for (const [ordinal, featureId] of [...features].reverse().entries())
          await tx
            .insertInto('extractionWorksiteTargets')
            .values({
              worksiteId: site.id,
              worldId,
              villageId,
              featureId,
              ordinal,
              status: i === 0 ? 'pending' : 'completed',
              admittedAt: null,
              thresholdReachedAt: null,
              completedAt: i === 0 ? null : at,
              reason: null,
            })
            .execute();
      }
      const mission = await tx
        .insertInto('depositExtractions')
        .values({
          worldId,
          villageId,
          featureId: features[0]!,
          worksiteId: siteIds[0]!,
          commandId: randomUUID(),
          status: 'in-progress',
          workerCount: 2,
          reservedAmount: 100,
          startedAt: at,
          completesAt: new Date(at.getTime() + 600000),
          completedAt: null,
          pathCells: sql`${JSON.stringify([
            { cellX: 64, cellY: 64 },
            { cellX: 80, cellY: 80 },
          ])}::jsonb`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const expectedMission = await readExtraction(tx, worldId, villageId, mission.id);
      let reads = 0;
      const source = tx.withPlugin({
        transformQuery(a) {
          if (a.node.kind === 'SelectQueryNode') reads++;
          return a.node;
        },
        async transformResult(a) {
          return a.result;
        },
      }) as Transaction<Database>;
      const projected = await readWorksites(source, worldId, villageId);
      expect(reads).toBe(3);
      expect(projected).toHaveLength(6);
      expect(projected.find((s) => s.id === siteIds[0])!.activeExtraction).toEqual(expectedMission);
      for (const site of projected) {
        expect(site.targets.map((t) => t.featureId)).toEqual([...features].reverse());
        expect(site.targets.map((t) => [t.cellX, t.cellY])).toEqual([
          [81, 80],
          [80, 80],
        ]);
        if (site.id !== siteIds[0]) expect(site.activeExtraction).toBeNull();
      }
      expect((await readExtractions(tx, worldId, villageId)).map((r) => r.extraction)).toEqual([expectedMission]);
      expect(await readWorksites(tx, worldId, randomUUID())).toEqual([]);
      expect(await readExtractions(tx, worldId, randomUUID())).toEqual([]);
      checked = true;
      throw abort;
    }),
  ).rejects.toBe(abort);
  expect(checked).toBe(true);
  expect(await revision()).toBe(r);
});

it('road optimization: shares footprints, doors, routes and prices with the full projection without unrelated reads', async () => {
  await withVillageProjection(db, accountId, slug, villageId, async (tx, economy, village) => {
    const full = await state(tx, accountId, slug, economy, false, true),
      context = await readInfrastructureSpatialState(tx, village, economy);
    for (const cell of full.cells)
      if (cell.building)
        expect(buildingAccesses(context.snapshot, cell.building.id)).toEqual(buildingAccesses(full, cell.building.id));
    expect(context.snapshot.cells.map((c) => [c.cellX, c.cellY, c.footprint]).sort()).toEqual(
      full.cells
        .filter((c) => c.footprint)
        .map((c) => [c.cellX, c.cellY, c.footprint])
        .sort(),
    );
    expect(context.snapshot.travelRoutes).toEqual(full.travelRoutes);
    const payload = roadPayload(full, 72);
    expect(prepareInfrastructureEdit(context.snapshot, payload.operation, payload.commandId)).toEqual(
      prepareInfrastructureEdit(full, payload.operation, payload.commandId),
    );
  });
  const selects: string[] = [];
  const plugin: KyselyPlugin = {
    transformQuery(a) {
      if (a.node.kind === 'SelectQueryNode') selects.push(JSON.stringify(a.node));
      return a.node;
    },
    async transformResult(a) {
      return a.result;
    },
  };
  const base = await read(),
    payload = roadPayload(base, 72),
    before = await revision();
  expect(await infrastructurePreview(db.withPlugin(plugin), accountId, slug, villageId, payload)).toMatchObject({
    valid: true,
    quote: payload.expected,
  });
  const queries = selects.join(' ');
  for (const unrelated of [
    'population_cohorts',
    'extraction_worksites',
    'market_exchanges',
    'science_activities',
    'building_type_levels',
  ])
    expect(queries).not.toContain(unrelated);
  expect(await revision()).toBe(before);
});

it('road confirmation: confirms without projection, preserves economy, retries and undoes exactly', async () => {
  let armed = false,
    projections = 0,
    fullReads = 0,
    resourceWrites = 0;
  const plugin: KyselyPlugin = {
    transformQuery(a) {
      if (armed) {
        const text = JSON.stringify(a.node);
        if (text.includes('set transaction read only')) projections++;
        if (text.includes('world_factory_settings')) fullReads++;
        if (a.node.kind === 'UpdateQueryNode' && text.includes('village_resources')) resourceWrites++;
      }
      return a.node;
    },
    async transformResult(a) {
      return a.result;
    },
  };
  const server = await buildApp(config, db.withPlugin(plugin));
  const send = (payload: InfrastructureRequest) =>
    server.inject({
      method: 'POST',
      url: '/api/worlds/' + slug + '/villages/' + villageId + '/infrastructure',
      cookies: { arbestra_session: token },
      headers: { 'x-infrastructure-confirmation': '1' },
      payload,
    });
  try {
    const base = await snapshot(server),
      stream = new VillageSyncSession(read, revision);
    await stream.check();
    const payload = roadPayload(base, 73),
      started = performance.now();
    armed = true;
    const response = await send(payload);
    expect(response.statusCode, response.body).toBe(200);
    const confirmation = response.json<InfrastructureConfirmation>();
    expect(confirmation.kind).toBe('infrastructure-confirmation');
    expect(confirmation.commandId).toBe(payload.commandId);
    expect(confirmation.fromRevision).toBe(base.infrastructure!.revision);
    expect(confirmation.toRevision).toBe(base.infrastructure!.revision + 1);
    expect(projections).toBe(0);
    expect(fullReads).toBe(0);
    expect('syncRevision' in confirmation).toBe(false);
    expect('travelRoutes' in confirmation).toBe(false);
    const accepted = applyInfrastructureConfirmation(base.infrastructure!, confirmation);
    expect(accepted.kind).toBe('applied');
    if (accepted.kind !== 'applied') throw Error('No authoritative plan');
    expect(
      (await db.selectFrom('buildings').select('status').where('id', '=', houseId).executeTakeFirstOrThrow()).status,
    ).toBe('completed');
    const paidStone = Number(
      (
        await db
          .selectFrom('villageResources')
          .select('amount')
          .where('worldId', '=', worldId)
          .where('resourceCode', '=', 'stone')
          .executeTakeFirstOrThrow()
      ).amount,
    );
    expect(paidStone).toBe(
      base.village.resources.find((r) => r.code === 'stone')!.amount - payload.expected!.stoneDebit,
    );
    const retry = await send(payload);
    expect(retry.statusCode, retry.body).toBe(200);
    const retryConfirmation = retry.json<InfrastructureConfirmation>();
    expect({ ...retryConfirmation, changes: undefined }).toEqual({ ...confirmation, changes: undefined });
    expect(applyInfrastructureConfirmation(base.infrastructure!, retryConfirmation)).toEqual(accepted);
    expect(applyInfrastructureConfirmation(accepted.plan, retryConfirmation).kind).toBe('ignored');
    const local = { ...base, infrastructure: accepted.plan },
      operation: InfrastructureRequest['operation'] = {
        kind: 'road',
        stroke: {
          id: 'free',
          points: [
            { x: 64 * 8, y: 74 * 8 },
            { x: 66 * 8, y: 74 * 8 },
          ],
          width: 4,
          material: 'earth',
          border: false,
          operation: 'paint',
        },
      };
    const free: InfrastructureRequest = {
      commandId: randomUUID(),
      sessionId: payload.sessionId,
      revision: accepted.plan.revision,
      operation,
      expected: prepareInfrastructureEdit(local, operation, 'free').quote,
    };
    expect(free.expected!.stoneDebit).toBe(0);
    expect(free.expected!.woodDebit).toBe(0);
    resourceWrites = 0;
    const freeResponse = await send(free);
    expect(freeResponse.statusCode, freeResponse.body).toBe(200);
    expect(resourceWrites).toBe(0);
    const next = applyInfrastructureConfirmation(accepted.plan, freeResponse.json());
    expect(next.kind).toBe('applied');
    if (next.kind !== 'applied') throw Error('No free plan');
    expect(applyInfrastructureConfirmation(next.plan, confirmation).kind).toBe('ignored');
    const undoPayload: InfrastructureRequest = {
      commandId: randomUUID(),
      sessionId: free.sessionId,
      revision: next.plan.revision,
      operation: { kind: 'undo', target: free.commandId },
    };
    const undo = await send(undoPayload);
    expect(undo.statusCode, undo.body).toBe(200);
    const restored = applyInfrastructureConfirmation(next.plan, undo.json());
    expect(restored.kind).toBe('applied');
    if (restored.kind !== 'applied') throw Error('No undo plan');
    expect(restored.plan.roads).toEqual(accepted.plan.roads);
    const undoRetry = await send(undoPayload);
    expect(undoRetry.statusCode, undoRetry.body).toBe(200);
    const retriedUndo = undoRetry.json<InfrastructureConfirmation>(),
      firstUndo = undo.json<InfrastructureConfirmation>();
    expect({ ...retriedUndo, changes: undefined }).toEqual({ ...firstUndo, changes: undefined });
    expect(applyInfrastructureConfirmation(next.plan, retriedUndo)).toEqual(restored);
    expect(projections).toBe(0);
    expect(fullReads).toBe(0);
    armed = false;
    const event = await stream.check();
    expect(event.event).toBe('frame');
    if (event.event !== 'frame') throw Error('No full convergence frame');
    const converged = applyVillageFrame(base, event.data);
    expect(converged.kind).toBe('applied');
    if (converged.kind !== 'applied') throw Error('No converged state');
    expect(converged.state.infrastructure).toEqual(restored.plan);
    expect(converged.state.village.resources.find((r) => r.code === 'stone')!.amount).toBe(paidStone);
    const staleId = await send({ ...payload, revision: payload.revision + 1 });
    expect(staleId.statusCode).toBe(409);
    expect(staleId.json().code).toBe('COMMAND_REUSED');
    const lightingOperation: InfrastructureRequest['operation'] = { kind: 'lighting', cell: '64:76' },
      lighting: InfrastructureRequest = {
        commandId: randomUUID(),
        sessionId: payload.sessionId,
        revision: restored.plan.revision,
        operation: lightingOperation,
        expected: prepareInfrastructureEdit(converged.state, lightingOperation, 'lighting').quote,
      };
    const fallback = await send(lighting);
    expect(fallback.statusCode, fallback.body).toBe(200);
    expect(['snapshot', 'frame']).toContain(fallback.json<VillageCommandResponse>().kind);
    console.info('ROAD_CONFIRMATION', {
      responseBytes: Buffer.byteLength(response.body),
      serverTiming: response.headers['server-timing'],
      testMs: Math.round(performance.now() - started),
    });
  } finally {
    await server.close();
  }
}, 60000);
