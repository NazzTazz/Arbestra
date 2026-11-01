import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { DEV_TIMING_HEADER, parseDevServerTiming } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { buildApp } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';
import { instrumentDevDriver } from '../operations/dev-timing.js';
import { gzipSync } from 'node:zlib';
import { commandProcessing } from './processing.js';

// Opt-in HTTP cost inventory, on an isolated disposable world. SQL parameters
// (session tokens and player data) are deliberately absent from the artifact.
// Lot I.3: the V1 scenarios (village read, historical replies, SSE sessions) went
// with the V1 routes; the V2 atelier scenario and the receipts read remain.
const enabled = process.env.ARBESTRA_SERVER_COST_AUDIT === '1';
const scale = Number(process.env.ARBESTRA_AUDIT_SCALE ?? 1);
if (![1, 10, 100].includes(scale)) throw Error('Audit scale must be 1, 10 or 100');
const repeated = process.env.ARBESTRA_AUDIT_REPEATED === '1';
const spatial = process.env.ARBESTRA_AUDIT_SPATIAL === '1';
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
          spatial,
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
