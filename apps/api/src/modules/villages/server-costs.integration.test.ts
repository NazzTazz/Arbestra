import { startVillageWorksite } from './service.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import {
  DEV_TIMING_HEADER,
  parseDevServerTiming,
  readServerEvents,
  applyVillageFrame,
  type VillageState,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { buildApp } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';
import { instrumentDevDriver } from '../operations/dev-timing.js';
import { readVillageProjection, VillageSyncSession } from './sync.js';
import { villageSyncRevision } from './sync-revision.js';
import { gzipSync } from 'node:zlib';
import { commandProcessing } from './processing.js';

// Opt-in HTTP cost inventory, on an isolated disposable world. SQL parameters
// (session tokens and player data) are deliberately absent from the artifact.
const enabled = process.env.ARBESTRA_SERVER_COST_AUDIT === '1';
const scale = Number(process.env.ARBESTRA_AUDIT_SCALE ?? 1);
if (![1, 10, 100].includes(scale)) throw Error('Audit scale must be 1, 10 or 100');
const repeated = process.env.ARBESTRA_AUDIT_REPEATED === '1';
const backlog = process.env.ARBESTRA_AUDIT_BACKLOG === '1';
const spatial = process.env.ARBESTRA_AUDIT_SPATIAL === '1';
const socket = process.env.ARBESTRA_AUDIT_SOCKET === '1';
const receiptsOnly = process.env.ARBESTRA_AUDIT_RECEIPTS === '1';
const v2 = process.env.ARBESTRA_AUDIT_V2 === '1';
const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected cost audit database');
class ObservedDialect extends PostgresDialect {
  override createDriver() {
    return instrumentDevDriver(super.createDriver());
  }
}
type Statement = { sql: string; ms: number };
let statements: Statement[] | undefined;
const db = new Kysely<Database>({
  dialect: new ObservedDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }),
  plugins: [new CamelCasePlugin()],
  log: (event) => {
    if (statements && event.level === 'query') statements.push({ sql: event.query.sql, ms: event.queryDurationMillis });
  },
});
const accountId = randomUUID(),
  token = randomUUID(),
  worldId = randomUUID(),
  villageId = randomUUID();
const hallId = randomUUID(),
  homeId = randomUUID(),
  workshopId = randomUUID(),
  slug = 'cost-audit-' + worldId;
let app: FastifyInstance | undefined;
const errors: Error[] = [],
  samples: object[] = [];
beforeAll(async () => {
  if (!enabled) return;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('accounts')
      .values({ id: accountId, email: accountId + '@cost-audit.test', passwordHash: 'fixture' })
      .execute();
    await tx
      .insertInto('sessions')
      .values({ accountId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
      .execute();
    await tx
      .insertInto('worlds')
      .values({
        id: worldId,
        slug,
        name: 'Cost audit',
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
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Audit' }).execute();
    await tx
      .insertInto('villages')
      .values({
        id: villageId,
        worldId,
        ownerAccountId: accountId,
        name: 'Audit',
        anchorCellX: 64,
        anchorCellY: 64,
        economyActivatedAt: new Date(),
      })
      .execute();
    await tx
      .insertInto('worldChunks')
      .values(
        Array.from({ length: 16 * 8 }, (_, i) => ({
          worldId,
          chunkX: i % 16,
          chunkY: Math.floor(i / 16),
          generationVersion: 1,
          terrainCodes: Array(1024).fill(1),
          elevations: Array(1024).fill(0),
        })),
      )
      .execute();
    for (const resourceCode of ['wood', 'carrot', 'stone', 'timber', 'cut-stone', 'rings']) {
      await tx
        .insertInto('villageResources')
        .values({ worldId, villageId, resourceCode, amount: 2000 })
        .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: 2000 }))
        .execute();
      await tx
        .insertInto('villageResourceFlows')
        .values({ worldId, villageId, resourceCode, baseRatePerHour: 0, remainder: 0, productionUpdatedAt: new Date() })
        .execute();
    }
    for (const [id, buildingType, level, cellX] of [
      [hallId, 'town-hall', 2, 64],
      [homeId, 'dwelling', 1, 65],
      [workshopId, 'sawmill', 1, 63],
    ] as const) {
      await tx
        .insertInto('buildings')
        .values({
          id,
          worldId,
          villageId,
          buildingType,
          level,
          targetLevel: null,
          status: 'completed',
          constructionStartedAt: null,
          constructionCompletesAt: null,
          completedAt: new Date(),
        })
        .execute();
      await tx
        .insertInto('worldCellOccupancies')
        .values({ worldId, buildingId: id, cellX, cellY: 64, featureId: null, role: 'anchor' })
        .execute();
    }
    await tx
      .insertInto('populationCohorts')
      .values({
        worldId,
        villageId,
        originVillageId: villageId,
        memberCount: 30,
        activity: 'idle',
        energy: 8,
        energyProgress: 0,
        energyUpdatedAt: new Date(),
        restingSince: null,
        foodUsedSinceRest: 0,
      })
      .execute();
    await tx
      .insertInto('villagePopulations')
      .values({ worldId, villageId, growthStartedAt: new Date(), nextArrivalAt: null })
      .onConflict((c) => c.columns(['worldId', 'villageId']).doUpdateSet({ nextArrivalAt: null }))
      .execute();
  });
  // Unrelated, unplaced buildings exercise collection/housing growth separately
  // from the workshop. This is not a representative spatial/rendering fixture.
  const extraBuildings = Array.from({ length: 3 * (scale - 1) }, () => ({
    id: randomUUID(),
    worldId,
    villageId,
    buildingType: 'dwelling',
    level: 1,
    targetLevel: null,
    status: 'completed' as const,
    constructionStartedAt: null,
    constructionCompletesAt: null,
    completedAt: new Date(),
  }));
  if (extraBuildings.length)
    await db.transaction().execute(async (tx) => {
      await tx.insertInto('buildings').values(extraBuildings).execute();
      if (spatial)
        await tx
          .insertInto('worldCellOccupancies')
          .values(
            extraBuildings.map((building, i) => ({
              worldId,
              buildingId: building.id,
              featureId: null,
              role: 'anchor' as const,
              cellX: 54 + (i % 20),
              cellY: 68 + Math.floor(i / 20),
            })),
          )
          .execute();
    });
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
      expeditionWorkerEnabled: false,
    },
    db,
  );
  app.addHook('onError', async (_request, _reply, error) => {
    errors.push(error);
  });
  await app.ready();
}, 120000);
afterAll(async () => {
  statements = undefined;
  if (enabled) {
    mkdirSync('test-results/server-costs', { recursive: true });
    const label = (process.env.ARBESTRA_AUDIT_LABEL ?? 'current').replace(/[^a-zA-Z0-9_-]/g, '_');
    writeFileSync(
      `test-results/server-costs/${label}.json`,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          fixture: repeated
            ? `${3 * scale} completed buildings (${spatial ? 3 * scale : 3} placed), 30 initial inhabitants, no deposits; isolated legacy world, no economic worker`
            : 'isolated legacy world; initial phase: 3 completed buildings, 30 inhabitants, no deposits; extended phase adds 3 deposits and a university; no economic worker',
          scale,
          backlog,
          spatial,
          socket,
          receiptsOnly,
          v2,
          repetitions: repeated ? 30 : 1,
          counting:
            'driver calls including transaction control; SQL bodies without parameters; trigger internals excluded; gzip is offline estimate, not negotiated wire compression',
          samples,
        },
        null,
        2,
      ),
    );
    await app?.close();
    await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
    await db.deleteFrom('depositExtractions').where('worldId', '=', worldId).execute();
    await db.deleteFrom('stoneDeposits').where('worldId', '=', worldId).execute();
    await db.deleteFrom('worlds').where('id', '=', worldId).execute();
    await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  }
  await db.destroy();
}, 60000);

async function request(
  name: string,
  suffix: string,
  payload?: object,
  status = 200,
  headers: Record<string, string> = {},
) {
  const queries: Statement[] = [],
    started = performance.now();
  statements = queries;
  let response;
  try {
    response = await app!.inject({
      method: payload ? 'POST' : 'GET',
      url: suffix.startsWith('/api/') ? suffix : `/api/worlds/${slug}/villages/${villageId}${suffix}`,
      cookies: { arbestra_session: token },
      headers: { [DEV_TIMING_HEADER]: '1', ...headers },
      ...(payload ? { payload } : {}),
    });
  } finally {
    statements = undefined;
  }
  const control = queries.filter((q) =>
    /^\s*(begin|commit|rollback|start transaction|set transaction)/i.test(q.sql),
  ).length;
  const sample = {
    name,
    status: response.statusCode,
    ms: Math.round(performance.now() - started),
    bytes: Buffer.byteLength(response.body),
    gzipBytes: gzipSync(response.body).length,
    calls: queries.length,
    control,
    sqlMs: Math.round(queries.reduce((n, q) => n + q.ms, 0)),
    phases: parseDevServerTiming(response.headers['server-timing']?.toString() ?? null),
    queries,
  };
  samples.push(sample);
  console.info(
    JSON.stringify({ name, status: sample.status, ms: sample.ms, calls: sample.calls, control, bytes: sample.bytes }),
  );
  expect(response.statusCode, errors.at(-1)?.stack ?? response.body).toBe(status);
  return response.body ? response.json() : null;
}

it.runIf(enabled && !repeated)(
  'records HTTP reads, previews, commands and retries on the same disposable village',
  async () => {
    await request('village cold', `/api/worlds/${slug}/village`);
    await request('village warm', `/api/worlds/${slug}/village`);
    await request('session', '/api/auth/session');
    await request('world list', '/api/worlds');
    await request('terrain chunks', `/api/worlds/${slug}/terrain?chunks=1,1;2,2`);
    await request('terrain updates', `/api/worlds/${slug}/terrain/updates?chunks=1,1;2,2`);
    await request('terrain overview', `/api/worlds/${slug}/terrain/overview`);
    await request('terrain overview cached', `/api/worlds/${slug}/terrain/overview`);
    await request('terrain overview unchanged', `/api/worlds/${slug}/terrain/overview`, undefined, 304, {
      'if-none-match': `"terrain-${worldId}-1-1"`,
    });
    await request('terrain vegetation', `/api/worlds/${slug}/terrain/overview/vegetation`);
    await request('terrain villages', `/api/worlds/${slug}/terrain/overview/villages?x=64&y=64`);
    await request('harvest receipts', '/harvest-intents?ids=' + randomUUID());
    await request('expedition receipts', '/science/expeditions');
    await request('market offers', '/market/offers');
    await request('processing preview', '/processing/preview', { buildingId: workshopId, workerCount: 1 });
    const pool = { commandId: randomUUID(), resource: 'wood', action: 'sites-up' };
    await request('pool add', '/extraction-pools', pool);
    await request('pool retry', '/extraction-pools', pool);
    await request('pool staff', '/extraction-pools', {
      commandId: randomUUID(),
      resource: 'wood',
      action: 'people-up',
    });
    await request('population feed', '/population/gestures', {
      commandId: randomUUID(),
      action: 'feed',
      group: 'idle',
    });
    const resting = { commandId: randomUUID(), action: 'rest' };
    await request('population rest', '/population/gestures', resting);
    await request('population retry', '/population/gestures', resting);
    const process = { action: 'start', commandId: randomUUID(), buildingId: workshopId, lots: 2, workerCount: 1 };
    const processing = await request('processing start', '/processing', process);
    await request('processing retry', '/processing', process);
    const orderId = processing.village.processingOrders[0].id;
    await request('processing pause', '/processing', { action: 'pause', commandId: randomUUID(), orderId });
    const build = {
      commandId: randomUUID(),
      buildingType: 'dwelling',
      houseVariant: 'logs',
      quarterTurns: 0,
      anchorCellX: 66,
      anchorCellY: 64,
      cells: [{ cellX: 66, cellY: 64 }],
      expectedCosts: [{ resourceCode: 'wood', amount: 25 }],
    };
    const compact = { 'x-village-sync': '1', 'x-construction-confirmation': '1' };
    await request('construction ack', '/buildings', build, 201, compact);
    await request('construction retry', '/buildings', build, 201, compact);
    await request('village active', `/api/worlds/${slug}/village`);
    const base = await request('village sync base', `/api/worlds/${slug}/village`);
    const syncHeaders = {
      'x-village-sync': '1',
      'x-village-revision': String(base.syncRevision),
      'x-village-server-time': base.serverTime,
    };
    await request('processing incremental retry', '/processing', process, 200, syncHeaders);
    await request(
      'house upgrade ack',
      `/buildings/${homeId}/upgrade`,
      { commandId: randomUUID(), expectedLevel: 2 },
      201,
      compact,
    );
    // The extended phase owns additional geometry; the baseline phase above stays comparable.
    const featureIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, featureId] of featureIds.entries()) {
      await db
        .insertInto('worldFeatures')
        .values({ id: featureId, worldId, featureTypeCode: 'stone_outcrop', state: 'available', variantSeed: 42 })
        .execute();
      await db
        .insertInto('stoneDeposits')
        .values({
          worldId,
          featureId,
          cellX: 64 + i,
          cellY: 67,
          initialAmount: 1000,
          remainingAmount: 1000,
          reservedAmount: 0,
          revision: 1,
          updatedAt: new Date(),
        })
        .execute();
      await db
        .insertInto('worldCellOccupancies')
        .values({ worldId, featureId, cellX: 64 + i, cellY: 67, buildingId: null, role: 'body' })
        .execute();
    }
    const site = { commandId: randomUUID(), mode: 'extract', workerCap: 1, featureIds: [featureIds[1]!] };
    const exploit = {
      commandId: randomUUID(),
      workerCap: 1,
      durationMs: null,
      cohortId: null,
      woodMode: 'cut',
      gardens: [],
      wood: [],
      stone: [featureIds[2]!],
    };
    await request('stone details', `/features/${featureIds[0]}`);
    await request('exploitation preview stone', '/exploitation/preview', exploit);
    // Worksites start through exploitation orders; the fixture creates one directly.
    const startedSite = await startVillageWorksite(
      db,
      accountId,
      slug,
      villageId,
      site as Parameters<typeof startVillageWorksite>[4],
    );
    await request('worksite pause', `/worksites/${startedSite.worksite.id}`, {
      commandId: randomUUID(),
      action: 'pause',
    });
    await request('exploitation start stone', '/exploitation', exploit);
    const publication = {
      action: 'publish',
      commandId: randomUUID(),
      offeredResource: 'wood',
      offeredAmount: 50,
      requestedResource: 'stone',
      requestedAmount: 100,
      maxTravelSeconds: 600,
    };
    const published = await request('trade publish', '/market/trades', publication);
    await request('trade cancel', '/market/trades', {
      commandId: randomUUID(),
      action: 'cancel',
      offerId: published.village.market.offers[0].id,
    });
    const universityId = randomUUID();
    await db
      .insertInto('buildings')
      .values({
        id: universityId,
        worldId,
        villageId,
        buildingType: 'university',
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
      .values({ worldId, buildingId: universityId, cellX: 62, cellY: 64, featureId: null, role: 'anchor' })
      .execute();
    await request(
      'science research',
      '/science',
      { action: 'research', buildingId: universityId, programCode: 'mathematics-1', workerCount: 1 },
      200,
      syncHeaders,
    );
    await request('science pause', '/science', { action: 'pause', programCode: 'mathematics-1' }, 200, syncHeaders);
    const processingBase = await request('processing modern base', `/api/worlds/${slug}/village`);
    const processingHeaders = {
      'x-village-sync': '1',
      'x-village-revision': String(processingBase.syncRevision),
      'x-village-server-time': processingBase.serverTime,
    };
    const cancel = { action: 'cancel', commandId: randomUUID(), orderId };
    expect((await request('processing incremental cancel', '/processing', cancel, 200, processingHeaders)).kind).toBe(
      'frame',
    );
    await request('processing incremental confirmed retry', '/processing', cancel, 200, processingHeaders);
  },
  240000,
);

it.runIf(enabled && repeated && !backlog && !socket && !receiptsOnly && !v2)(
  'measures atelier command, exact retry and induced SSE separately after warmup',
  async () => {
    // The V1 session and low-level reader compute real deltas. This excludes the
    // socket/auth/deadline loop and navigation worker dispatch; report separately
    // from browser wire traffic, measured by the Playwright scenario.
    const session = new VillageSyncSession(
      () => readVillageProjection(db, accountId, slug, villageId),
      async () => (await villageSyncRevision(db, worldId)).revision,
    );
    async function sync(name: string) {
      const queries: Statement[] = [],
        started = performance.now();
      statements = queries;
      try {
        const event = await session.check();
        const body = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
        samples.push({
          name,
          ms: performance.now() - started,
          calls: queries.length,
          bytes: Buffer.byteLength(body),
          gzipBytes: gzipSync(body).length,
          sqlMs: queries.reduce((n, q) => n + q.ms, 0),
          queries,
        });
        return event;
      } finally {
        statements = undefined;
      }
    }
    await request('warmup bootstrap', `/api/worlds/${slug}/village`);
    await sync('warmup SSE snapshot');
    // Missing input is a real supported branch; no lots or workers are silently
    // reset between measurements. All 31 orders use fresh UUIDs and finish cancelled.
    await db
      .updateTable('villageResources')
      .set({ amount: 0 })
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('resourceCode', '=', 'wood')
      .execute();
    for (let iteration = 0; iteration <= 30; iteration++) {
      const prefix = iteration ? 'measured ' : 'warmup ';
      const start = { action: 'start', commandId: randomUUID(), buildingId: workshopId, lots: 2, workerCount: 1 };
      const result = await request(prefix + 'start missing-input', '/processing', start);
      const orderId = result.village.processingOrders.find((o: { status: string }) => o.status === 'blocked').id;
      for (const action of ['pause', 'resume', 'cancel'] as const) {
        const payload = {
          commandId: randomUUID(),
          action,
          orderId,
          ...(action === 'resume' ? { workerCount: 1 } : {}),
        };
        await request(prefix + action, '/processing', payload);
        await sync(prefix + action + ' SSE');
        await request(prefix + action + ' retry', '/processing', payload);
        await sync(prefix + action + ' retry SSE');
      }
    }
  },
  900000,
);

it.runIf(enabled && repeated && v2)(
  'measures the same atelier scenario through V2: commands, exact retries, induced delta reads and first load',
  async () => {
    // Same fixture and branches as the V1 scenario above. The induced cost is
    // one delta read per command (what each open stream performs), not a
    // whole-village projection; first load is bootstrap plus presentation.
    const negotiated = { 'x-arbestra-protocol': '2' },
      command = { ...negotiated, 'x-arbestra-generation': '1' };
    type Batch = { groups: Array<{ stream: { kind: string; key: string; epoch: string }; toRevision: string }> };
    let batch: Batch = await request(
      'warmup V2 bootstrap',
      `/api/worlds/${slug}/village/bootstrap?generation=1&include=knowledge,manifest,traffic`,
      undefined,
      200,
      negotiated,
    );
    await request('warmup V2 presentation', '/presentation', undefined, 200, negotiated);
    async function delta(name: string) {
      batch = await request(
        name,
        '/sync/read',
        {
          protocol: 2,
          generation: 1,
          scopes: batch.groups.map((group) => ({ kind: group.stream.kind, key: group.stream.key })),
          cursors: batch.groups.map((group) => ({ ...group.stream, revision: group.toRevision })),
        },
        200,
        negotiated,
      );
    }
    await db
      .updateTable('villageResources')
      .set({ amount: 0 })
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('resourceCode', '=', 'wood')
      .execute();
    for (let iteration = 0; iteration <= 30; iteration++) {
      const prefix = iteration ? 'measured ' : 'warmup ';
      batch = await request(
        prefix + 'V2 bootstrap',
        `/api/worlds/${slug}/village/bootstrap?generation=1&include=knowledge,manifest,traffic`,
        undefined,
        200,
        negotiated,
      );
      await request(prefix + 'V2 presentation', '/presentation', undefined, 200, negotiated);
      const start = { action: 'start', commandId: randomUUID(), buildingId: workshopId, lots: 2, workerCount: 1 };
      const orderId = (await request(prefix + 'V2 start missing-input', '/processing', start, 200, command)).result
        .orderId;
      for (const action of ['pause', 'resume', 'cancel'] as const) {
        const payload = {
          commandId: randomUUID(),
          action,
          orderId,
          ...(action === 'resume' ? { workerCount: 1 } : {}),
        };
        await request(prefix + 'V2 ' + action, '/processing', payload, 200, command);
        await delta(prefix + 'V2 ' + action + ' delta');
        await request(prefix + 'V2 ' + action + ' retry', '/processing', payload, 200, command);
        await delta(prefix + 'V2 ' + action + ' retry delta');
      }
    }
  },
  900000,
);

it.runIf(enabled && repeated && receiptsOnly)(
  'measures bounded receipt reads without replaying their business command',
  async () => {
    const commandId = randomUUID();
    await db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('villages')
        .select('id')
        .where('id', '=', villageId)
        .where('worldId', '=', worldId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await commandProcessing(
        tx,
        { worldId, villageId, through: new Date() },
        { commandId, action: 'start', buildingId: workshopId, lots: 2, workerCount: 1 },
      );
    });
    const before = await db
      .selectFrom('scheduledTasks')
      .selectAll()
      .where('worldId', '=', worldId)
      .orderBy('id')
      .execute();
    for (let iteration = 0; iteration <= 30; iteration++) {
      const prefix = iteration ? 'measured ' : 'warmup ';
      const known = await request(prefix + 'receipt known', '/commands/receipts/read', {
        commands: [{ family: 'processing', commandId }],
      });
      expect(known.receipts).toHaveLength(1);
      const missing = await request(prefix + 'receipt unknown', '/commands/receipts/read', {
        commands: [{ family: 'processing', commandId: randomUUID() }],
      });
      expect(missing.receipts).toEqual([]);
    }
    expect(
      await db.selectFrom('scheduledTasks').selectAll().where('worldId', '=', worldId).orderBy('id').execute(),
    ).toEqual(before);
  },
  120000,
);

it.runIf(enabled && repeated && socket && !backlog && !receiptsOnly)(
  'measures actual HTTP plus induced socket SSE, authorization, deadline checks and navigation dispatch',
  async () => {
    const address = await app!.listen({ host: '127.0.0.1', port: 0 });
    const path = `/api/worlds/${slug}/villages/${villageId}`;
    const headers = { cookie: `arbestra_session=${token}`, 'content-type': 'application/json' };
    const abort = new AbortController();
    let state: VillageState | undefined,
      eventCount = 0,
      wireBytes = 0,
      streamError: unknown;
    const response = await fetch(address + path + '/events', { headers, signal: abort.signal });
    expect(response.status).toBe(200);
    const body = response.body!.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          wireBytes += chunk.byteLength;
          controller.enqueue(chunk);
        },
      }),
    );
    const consume = readServerEvents(body, {
      signal: abort.signal,
      current: () => !abort.signal.aborted,
      onEvent: (event) => {
        if (event.event === 'snapshot') state = JSON.parse(event.data) as VillageState;
        if (event.event === 'frame') {
          if (!state) throw Error('Frame before snapshot');
          const applied = applyVillageFrame(state, JSON.parse(event.data));
          if (applied.kind !== 'applied') throw Error('Socket measurement lost its canonical base');
          state = applied.state;
        }
        if (['snapshot', 'frame', 'revision'].includes(event.event)) eventCount++;
      },
    }).catch((error) => {
      if (!abort.signal.aborted) streamError = error;
    });
    async function until(ready: () => boolean) {
      const deadline = performance.now() + 30000;
      while (!ready()) {
        if (streamError) throw streamError;
        if (performance.now() > deadline) throw Error('Socket synchronization deadline exceeded');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    async function measured(name: string, payload: object, ready: (result: VillageState) => boolean) {
      const queries: Statement[] = [],
        started = performance.now(),
        bytesBefore = wireBytes,
        eventsBefore = eventCount;
      statements = queries;
      try {
        const reply = await fetch(address + path + '/processing', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        });
        const text = await reply.text();
        expect(reply.status, text).toBe(200);
        const result = JSON.parse(text) as VillageState;
        await until(() => eventCount > eventsBefore && ready(result));
        const bytes = Buffer.byteLength(text) + wireBytes - bytesBefore;
        samples.push({
          name,
          ms: performance.now() - started,
          calls: queries.length,
          bytes,
          gzipBytes: gzipSync(text).length,
          sqlMs: queries.reduce((sum, query) => sum + query.ms, 0),
          httpBytes: Buffer.byteLength(text),
          sseBytes: wireBytes - bytesBefore,
          counting: 'HTTP and SSE body bytes, without HTTP framing; gzip estimate covers HTTP only',
          queries,
        });
        return result;
      } finally {
        statements = undefined;
      }
    }
    try {
      await until(() => !!state);
      await db
        .updateTable('villageResources')
        .set({ amount: 0 })
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('resourceCode', '=', 'wood')
        .execute();
      for (let iteration = 0; iteration <= 30; iteration++) {
        const prefix = iteration ? 'measured socket ' : 'warmup socket ';
        const command = { commandId: randomUUID(), action: 'start', buildingId: workshopId, lots: 2, workerCount: 1 };
        const started = await measured(
          prefix + 'start',
          command,
          (result) =>
            state!.village.processingOrders?.some(
              (order) => order.id === result.village.processingOrders?.find((o) => o.status === 'blocked')?.id,
            ) ?? false,
        );
        const orderId = started.village.processingOrders!.find((order) => order.status === 'blocked')!.id;
        for (const action of ['pause', 'resume', 'cancel'] as const) {
          const payload = {
            commandId: randomUUID(),
            action,
            orderId,
            ...(action === 'resume' ? { workerCount: 1 } : {}),
          };
          const expected = action === 'pause' ? 'paused' : action === 'resume' ? 'blocked' : 'cancelled';
          await measured(
            prefix + action,
            payload,
            () => state!.village.processingOrders?.find((order) => order.id === orderId)?.status === expected,
          );
          await measured(prefix + action + ' retry', payload, () => true);
        }
      }
    } finally {
      abort.abort();
      await consume;
    }
  },
  900000,
);

it.runIf(enabled && repeated && backlog)(
  'measures a pause after two overdue paid lots and verifies their exact output',
  async () => {
    for (let iteration = 0; iteration <= 30; iteration++) {
      const through = new Date(Date.now() - 30 * 60_000);
      await db.transaction().execute(async (tx) => {
        await tx
          .selectFrom('villages')
          .select('id')
          .where('worldId', '=', worldId)
          .where('id', '=', villageId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        await tx
          .updateTable('villageResources')
          .set({ amount: 50 })
          .where('worldId', '=', worldId)
          .where('villageId', '=', villageId)
          .where('resourceCode', '=', 'wood')
          .execute();
        await tx
          .updateTable('villageResources')
          .set({ amount: 0 })
          .where('worldId', '=', worldId)
          .where('villageId', '=', villageId)
          .where('resourceCode', '=', 'timber')
          .execute();
        await tx
          .updateTable('populationCohorts')
          .set({ energy: 10, energyProgress: 0, energyUpdatedAt: through })
          .where('worldId', '=', worldId)
          .where('villageId', '=', villageId)
          .execute();
        // Explicit historical fixture, using the same business mutation as the
        // isolated processing oracle. No scheduler or development data is touched.
        await commandProcessing(
          tx,
          { worldId, villageId, through },
          {
            action: 'start',
            commandId: randomUUID(),
            buildingId: workshopId,
            lots: 6,
            workerCount: 1,
          },
        );
      });
      const order = await db
        .selectFrom('processingOrders')
        .select('id')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('status', '=', 'running')
        .executeTakeFirstOrThrow();
      const prefix = iteration ? 'measured ' : 'warmup ';
      const command = { commandId: randomUUID(), action: 'pause', orderId: order.id };
      const result = await request(prefix + 'overdue pause', '/processing', command);
      expect(result.village.processingOrders.find((row: { id: string }) => row.id === order.id)).toMatchObject({
        status: 'paused',
        completedLots: 2,
        currentLot: null,
      });
      expect(result.village.resources.find((row: { code: string }) => row.code === 'timber').amount).toBe(40);
      const replay = await request(prefix + 'overdue pause retry', '/processing', command);
      expect(replay.village.resources.find((row: { code: string }) => row.code === 'timber').amount).toBe(40);
      await request(prefix + 'overdue cleanup cancel', '/processing', {
        commandId: randomUUID(),
        action: 'cancel',
        orderId: order.id,
      });
    }
  },
  900000,
);
