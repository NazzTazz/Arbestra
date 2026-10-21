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

// Opt-in HTTP cost inventory, on an isolated disposable world. SQL parameters
// (session tokens and player data) are deliberately absent from the artifact.
const enabled = process.env.ARBESTRA_SERVER_COST_AUDIT === '1';
const url = testDatabaseUrl(), target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected cost audit database');
class ObservedDialect extends PostgresDialect {
  override createDriver() { return instrumentDevDriver(super.createDriver()); }
}
type Statement = { sql: string; ms: number };
let statements: Statement[] | undefined;
const db = new Kysely<Database>({ dialect: new ObservedDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }),
  plugins: [new CamelCasePlugin()], log: event => {
    if (statements && event.level === 'query') statements.push({ sql: event.query.sql, ms: event.queryDurationMillis });
  } });
const accountId = randomUUID(), token = randomUUID(), worldId = randomUUID(), villageId = randomUUID();
const hallId = randomUUID(), homeId = randomUUID(), workshopId = randomUUID(), slug = 'cost-audit-' + worldId;
let app: FastifyInstance | undefined;
const errors: Error[] = [], samples: object[] = [];
beforeAll(async () => {
  if (!enabled) return;
  await db.transaction().execute(async tx => {
    await tx.insertInto('accounts').values({ id: accountId, email: accountId + '@cost-audit.test', passwordHash: 'fixture' }).execute();
    await tx.insertInto('sessions').values({ accountId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) }).execute();
    await tx.insertInto('worlds').values({ id: worldId, slug, name: 'Cost audit', topology: 'torus', widthCells: 512, heightCells: 256,
      chunkSize: 32, seed: 4109, generationVersion: 1, generationStatus: 'ready', isOpen: true, generatedAt: new Date() }).execute();
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Audit' }).execute();
    await tx.insertInto('villages').values({ id: villageId, worldId, ownerAccountId: accountId, name: 'Audit', anchorCellX: 64,
      anchorCellY: 64, economyActivatedAt: new Date() }).execute();
    await tx.insertInto('worldChunks').values(Array.from({ length: 16 * 8 }, (_, i) => ({ worldId, chunkX: i % 16, chunkY: Math.floor(i / 16),
      generationVersion: 1, terrainCodes: Array(1024).fill(1), elevations: Array(1024).fill(0) }))).execute();
    for (const resourceCode of ['wood', 'carrot', 'stone', 'timber', 'cut-stone', 'rings']) {
      await tx.insertInto('villageResources').values({ worldId, villageId, resourceCode, amount: 2000 })
        .onConflict(c => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: 2000 })).execute();
      await tx.insertInto('villageResourceFlows').values({ worldId, villageId, resourceCode, baseRatePerHour: 0,
        remainder: 0, productionUpdatedAt: new Date() }).execute();
    }
    for (const [id, buildingType, level, cellX] of [[hallId, 'town-hall', 2, 64], [homeId, 'dwelling', 1, 65], [workshopId, 'sawmill', 1, 63]] as const) {
      await tx.insertInto('buildings').values({ id, worldId, villageId, buildingType, level, targetLevel: null, status: 'completed',
        constructionStartedAt: null, constructionCompletesAt: null, completedAt: new Date() }).execute();
      await tx.insertInto('worldCellOccupancies').values({ worldId, buildingId: id, cellX, cellY: 64, featureId: null, role: 'anchor' }).execute();
    }
    await tx.insertInto('populationCohorts').values({ worldId, villageId, originVillageId: villageId, memberCount: 30, activity: 'idle',
      energy: 8, energyProgress: 0, energyUpdatedAt: new Date(), restingSince: null, foodUsedSinceRest: 0 }).execute();
    await tx.insertInto('villagePopulations').values({ worldId, villageId, growthStartedAt: new Date(), nextArrivalAt: null })
      .onConflict(c => c.columns(['worldId', 'villageId']).doUpdateSet({ nextArrivalAt: null })).execute();
  });
  app = await buildApp({ databaseUrl: url, host: '127.0.0.1', port: 0, isProduction: false, cookieName: 'arbestra_session',
    sessionTtlDays: 30, constructionDurationOverrideMs: 600000, scheduledTaskPollIntervalMs: 250, expeditionWorkerEnabled: false }, db);
  app.addHook('onError', async (_request, _reply, error) => { errors.push(error); });
  await app.ready();
}, 120000);
afterAll(async () => {
  statements = undefined;
  if (enabled) {
    mkdirSync('test-results/server-costs', { recursive: true });
    const label = (process.env.ARBESTRA_AUDIT_LABEL ?? 'current').replace(/[^a-zA-Z0-9_-]/g, '_');
    writeFileSync(`test-results/server-costs/${label}.json`, JSON.stringify({ at: new Date().toISOString(),
      fixture: 'isolated legacy world; initial phase: 3 completed buildings, 30 inhabitants, no deposits; extended phase adds 3 deposits and a university; no economic worker',
      counting: 'driver calls including transaction control; SQL bodies without parameters; trigger internals excluded', samples }, null, 2));
    await app?.close();
    await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
    await db.deleteFrom('depositExtractions').where('worldId', '=', worldId).execute();
    await db.deleteFrom('stoneDeposits').where('worldId', '=', worldId).execute();
    await db.deleteFrom('worlds').where('id', '=', worldId).execute();
    await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  }
  await db.destroy();
}, 60000);

async function request(name: string, suffix: string, payload?: object, status = 200, headers: Record<string, string> = {}) {
  const queries: Statement[] = [], started = performance.now();
  statements = queries;
  let response;
  try {
    response = await app!.inject({ method: payload ? 'POST' : 'GET',
      url: suffix.startsWith('/api/') ? suffix : `/api/worlds/${slug}/villages/${villageId}${suffix}`,
      cookies: { arbestra_session: token }, headers: { [DEV_TIMING_HEADER]: '1', ...headers }, ...(payload ? { payload } : {}) });
  } finally { statements = undefined; }
  const control = queries.filter(q => /^\s*(begin|commit|rollback|start transaction|set transaction)/i.test(q.sql)).length;
  const sample = { name, status: response.statusCode, ms: Math.round(performance.now() - started),
    bytes: Buffer.byteLength(response.body), calls: queries.length, control, sqlMs: Math.round(queries.reduce((n, q) => n + q.ms, 0)),
    phases: parseDevServerTiming(response.headers['server-timing']?.toString() ?? null), queries };
  samples.push(sample);
  console.info(JSON.stringify({ name, status: sample.status, ms: sample.ms, calls: sample.calls, control, bytes: sample.bytes }));
  expect(response.statusCode, errors.at(-1)?.stack ?? response.body).toBe(status);
  return response.body ? response.json() : null;
}

it.runIf(enabled)('records HTTP reads, previews, commands and retries on the same disposable village', async () => {
  await request('village cold', `/api/worlds/${slug}/village`);
  await request('village warm', `/api/worlds/${slug}/village`);
  await request('session', '/api/auth/session');
  await request('world list', '/api/worlds');
  await request('terrain chunks', `/api/worlds/${slug}/terrain?chunks=1,1;2,2`);
  await request('terrain updates', `/api/worlds/${slug}/terrain/updates?chunks=1,1;2,2`);
  await request('terrain overview', `/api/worlds/${slug}/terrain/overview`);
  await request('terrain overview cached', `/api/worlds/${slug}/terrain/overview`);
  await request('terrain overview unchanged', `/api/worlds/${slug}/terrain/overview`, undefined, 304,
    { 'if-none-match': `"terrain-${worldId}-1-1"` });
  await request('terrain vegetation', `/api/worlds/${slug}/terrain/overview/vegetation`);
  await request('terrain villages', `/api/worlds/${slug}/terrain/overview/villages?x=64&y=64`);
  await request('harvest receipts', '/harvest-intents?ids=' + randomUUID());
  await request('expedition receipts', '/science/expeditions');
  await request('market offers', '/market/offers');
  const market = { offeredResource: 'wood', requestedResource: 'stone', amount: 100 };
  const quote = await request('market preview', '/market/preview', market);
  await request('processing preview', '/processing/preview', { buildingId: workshopId, workerCount: 1 });
  const pool = { commandId: randomUUID(), resource: 'wood', action: 'sites-up' };
  await request('pool add', '/extraction-pools', pool);
  await request('pool retry', '/extraction-pools', pool);
  await request('pool staff', '/extraction-pools', { commandId: randomUUID(), resource: 'wood', action: 'people-up' });
  await request('population feed', '/population/gestures', { commandId: randomUUID(), action: 'feed', group: 'idle' });
  const resting = { commandId: randomUUID(), action: 'rest' };
  await request('population rest', '/population/gestures', resting);
  await request('population retry', '/population/gestures', resting);
  const trade = { ...market, commandId: randomUUID(), expectedReceivedAmount: quote.receivedAmount };
  await request('market exchange', '/market', trade);
  await request('market retry', '/market', trade);
  const process = { action: 'start', commandId: randomUUID(), buildingId: workshopId, lots: 2, workerCount: 1 };
  const processing = await request('processing start', '/processing', process);
  await request('processing retry', '/processing', process);
  const orderId = processing.village.processingOrders[0].id;
  await request('processing pause', '/processing', { action: 'pause', commandId: randomUUID(), orderId });
  const build = { commandId: randomUUID(), buildingType: 'dwelling', houseVariant: 'logs', quarterTurns: 0,
    anchorCellX: 66, anchorCellY: 64, cells: [{ cellX: 66, cellY: 64 }], expectedCosts: [{ resourceCode: 'wood', amount: 25 }] };
  const compact = { 'x-village-sync': '1', 'x-construction-confirmation': '1' };
  await request('construction ack', '/buildings', build, 201, compact);
  await request('construction retry', '/buildings', build, 201, compact);
  await request('village active', `/api/worlds/${slug}/village`);
  const base = await request('village sync base', `/api/worlds/${slug}/village`);
  const syncHeaders = { 'x-village-sync': '1', 'x-village-revision': String(base.syncRevision), 'x-village-server-time': base.serverTime };
  await request('market incremental retry', '/market', trade, 200, syncHeaders);
  await request('processing incremental retry', '/processing', process, 200, syncHeaders);
  await request('house upgrade ack', `/buildings/${homeId}/upgrade`, { commandId: randomUUID(), expectedLevel: 2 }, 201, compact);
  // The extended phase owns additional geometry; the baseline phase above stays comparable.
  const featureIds = [randomUUID(), randomUUID(), randomUUID()];
  for (const [i, featureId] of featureIds.entries()) {
    await db.insertInto('worldFeatures').values({ id: featureId, worldId, featureTypeCode: 'stone_outcrop', state: 'available', variantSeed: 42 }).execute();
    await db.insertInto('stoneDeposits').values({ worldId, featureId, cellX: 64 + i, cellY: 67, initialAmount: 1000,
      remainingAmount: 1000, reservedAmount: 0, revision: 1, updatedAt: new Date() }).execute();
    await db.insertInto('worldCellOccupancies').values({ worldId, featureId, cellX: 64 + i, cellY: 67, buildingId: null, role: 'body' }).execute();
  }
  const site = { commandId: randomUUID(), mode: 'extract', workerCap: 1, featureIds: [featureIds[1]!] };
  const exploit = { commandId: randomUUID(), workerCap: 1, durationMs: null, cohortId: null, woodMode: 'cut', gardens: [], wood: [], stone: [featureIds[2]!] };
  await request('stone details', `/features/${featureIds[0]}`);
  await request('worksite preview', '/worksites/preview', site);
  await request('exploitation preview stone', '/exploitation/preview', exploit);
  const extraction = { commandId: randomUUID(), workerCount: 1 };
  await request('stone extraction', `/features/${featureIds[0]}/extractions`, extraction);
  await request('stone extraction retry', `/features/${featureIds[0]}/extractions`, extraction);
  const startedSite = await request('worksite start', '/worksites', site);
  await request('worksite pause', `/worksites/${startedSite.worksite.id}`, { commandId: randomUUID(), action: 'pause' });
  await request('exploitation start stone', '/exploitation', exploit);
  const publication = { action: 'publish', commandId: randomUUID(), offeredResource: 'wood', offeredAmount: 50,
    requestedResource: 'stone', requestedAmount: 100, maxTravelSeconds: 600 };
  const published = await request('trade publish', '/market/trades', publication);
  await request('trade cancel', '/market/trades', { commandId: randomUUID(), action: 'cancel', offerId: published.village.market.offers[0].id });
  const universityId = randomUUID();
  await db.insertInto('buildings').values({ id: universityId, worldId, villageId, buildingType: 'university', level: 1,
    targetLevel: null, status: 'completed', constructionStartedAt: null, constructionCompletesAt: null, completedAt: new Date() }).execute();
  await db.insertInto('worldCellOccupancies').values({ worldId, buildingId: universityId, cellX: 62, cellY: 64, featureId: null, role: 'anchor' }).execute();
  await request('science research', '/science', { action: 'research', buildingId: universityId, programCode: 'mathematics-1', workerCount: 1 }, 200, syncHeaders);
  await request('science pause', '/science', { action: 'pause', programCode: 'mathematics-1' }, 200, syncHeaders);
  const marketBase = await request('market modern base', `/api/worlds/${slug}/village`);
  const marketHeaders = { 'x-village-sync': '1', 'x-village-revision': String(marketBase.syncRevision), 'x-village-server-time': marketBase.serverTime };
  const modernTrade = { ...trade, commandId: randomUUID() };
  expect((await request('market incremental exchange', '/market', modernTrade, 200, marketHeaders)).kind).toBe('frame');
  await request('market incremental confirmed retry', '/market', modernTrade, 200, marketHeaders);
  const processingBase = await request('processing modern base', `/api/worlds/${slug}/village`);
  const processingHeaders = { 'x-village-sync': '1', 'x-village-revision': String(processingBase.syncRevision), 'x-village-server-time': processingBase.serverTime };
  const cancel = { action: 'cancel', commandId: randomUUID(), orderId };
  expect((await request('processing incremental cancel', '/processing', cancel, 200, processingHeaders)).kind).toBe('frame');
  await request('processing incremental confirmed retry', '/processing', cancel, 200, processingHeaders);
}, 240000);
