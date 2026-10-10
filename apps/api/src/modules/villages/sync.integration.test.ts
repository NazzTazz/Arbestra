import { randomUUID } from 'node:crypto';
import { sql, type KyselyPlugin, type QueryId } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { applyVillageFrame, VillageStateSchema, type VillageState, type VillageFrame } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { hashSessionToken } from '../../security/sessions.js';
import { buildApp } from '../../app.js';
import { completeConstruction } from './complete-construction.js';
import { readVillageProjection, reconcileSyncDeadline, VillageSyncSession } from './sync.js';
import { villageSyncRevision } from './sync-revision.js';

const url = testDatabaseUrl(), target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected synchronization fixture DB');
const db = createDatabase(url), worldId = randomUUID(), villageId = randomUUID(), accountId = randomUUID(), hallId = randomUUID(), houseId = randomUUID();
const slug = 'sync-' + worldId, token = randomUUID(); let app: FastifyInstance;
const read = () => readVillageProjection(db, accountId, slug, villageId);
const revision = async () => (await villageSyncRevision(db, worldId)).revision;

beforeAll(async () => {
  await migrateToLatest(url);
  await db.insertInto('accounts').values({ id: accountId, email: accountId + '@sync.test', passwordHash: 'fixture' }).execute();
  await db.transaction().execute(async tx => {
    await tx.insertInto('worlds').values({ id: worldId, slug, name: 'Sync test', topology: 'torus', widthCells: 512, heightCells: 256,
      chunkSize: 32, seed: 4109, generationVersion: 1, generationStatus: 'ready', isOpen: true, generatedAt: new Date() }).execute();
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Sync' }).execute();
    await tx.insertInto('villages').values({ id: villageId, worldId, ownerAccountId: accountId, name: 'Initial', anchorCellX: 64, anchorCellY: 64, economyActivatedAt: new Date() }).execute();
    for (const chunkX of [1, 2]) for (const chunkY of [1, 2]) await tx.insertInto('worldChunks').values({ worldId, chunkX, chunkY,
      generationVersion: 1, terrainCodes: Array(1024).fill(1), elevations: Array(1024).fill(0) }).execute();
    for (const code of ['wood', 'carrot', 'stone']) await tx.insertInto('villageResources').values({ worldId, villageId, resourceCode: code, amount: 2000 }).execute();
    await tx.insertInto('villageResourceFlows').values({ worldId, villageId, resourceCode: 'wood', baseRatePerHour: 0, remainder: 0, productionUpdatedAt: new Date() }).execute();
    await tx.insertInto('playerScience').values({ worldId, accountId, observationsSince: null, solarReport: null }).execute();
    await tx.insertInto('buildings').values([
      { id: hallId, worldId, villageId, buildingType: 'town-hall', level: 1, targetLevel: null, status: 'completed', constructionStartedAt: null, constructionCompletesAt: null, completedAt: new Date() },
      { id: houseId, worldId, villageId, buildingType: 'dwelling', level: 1, targetLevel: null, status: 'under-construction', constructionStartedAt: new Date(Date.now() - 2000), constructionCompletesAt: new Date(Date.now() - 1000), completedAt: null },
    ]).execute();
    for (const [buildingId, cellX] of [[hallId, 64], [houseId, 65]] as const) await tx.insertInto('worldCellOccupancies').values({ worldId, buildingId, featureId: null, cellX, cellY: 64, role: 'anchor' }).execute();
  });
  await db.insertInto('sessions').values({ accountId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) }).execute();
  app = await buildApp({ databaseUrl: url, host: '127.0.0.1', port: 0, isProduction: false, cookieName: 'arbestra_session',
    sessionTtlDays: 30, constructionDurationOverrideMs: 3000, scheduledTaskPollIntervalMs: 250 }, db);
  app.get('/snapshot-race', {schema:{response:{200:VillageStateSchema}}}, async()=>{
    const captured=await read();
    await db.updateTable('villages').set({name:'After snapshot before response'}).where('id','=',villageId).execute();
    return captured;
  });
}, 120000);
afterAll(async () => {
  if (app) await app.close();
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', '=', accountId).execute(); await db.destroy();
}, 60000);

it('joins a commit between the HTTP snapshot and subscription, with read-only snapshots', async () => {
  const snapshot = await read(), firstRevision = await revision();
  expect(snapshot.syncRevision).toBe(firstRevision); expect(await revision()).toBe(firstRevision);
  await db.transaction().execute(async tx => { await tx.updateTable('villages').set({ name: 'During join' }).where('id', '=', villageId).execute(); });
  const stream = new VillageSyncSession(read, revision), event = await stream.check();
  expect(event.event).toBe('snapshot'); if (event.event !== 'snapshot') throw Error('No join snapshot');
  expect(event.data.village.name).toBe('During join'); expect(event.data.syncRevision).toBe(firstRevision + 1);
  expect(await revision()).toBe(firstRevision + 1);
});

it('keeps commit markers and business changes invisible after an exact injected rollback', async () => {
  const before = await read(), priorRevision = await revision(), injected = Error('sync rollback after observed writes');
  const storedBefore = { village: await db.selectFrom('villages').selectAll().where('id','=',villageId).executeTakeFirstOrThrow(),
    resources: await db.selectFrom('villageResources').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).orderBy('resourceCode').execute() };
  await expect(db.transaction().execute(async tx => {
    await tx.updateTable('villages').set({ name: 'Must roll back' }).where('id', '=', villageId).execute();
    await tx.updateTable('villageResources').set({ amount: 999 }).where('worldId', '=', worldId).where('villageId', '=', villageId).where('resourceCode', '=', 'wood').execute();
    expect((await villageSyncRevision(tx, worldId)).revision).toBe(priorRevision + 1);
    expect((await tx.selectFrom('villageResources').select('amount').where('worldId', '=', worldId).where('villageId', '=', villageId).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow()).amount).toBe('999');
    throw injected;
  })).rejects.toBe(injected);
  expect(await revision()).toBe(priorRevision); const after = await read();
  expect(after.village.name).toBe(before.village.name); expect(after.village.wood).toBe(before.village.wood);
  expect({ village: await db.selectFrom('villages').selectAll().where('id','=',villageId).executeTakeFirstOrThrow(),
    resources: await db.selectFrom('villageResources').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).orderBy('resourceCode').execute() }).toEqual(storedBefore);
});

it('counts commits correctly even when a later transaction commits first', async () => {
  const before = await revision(); let acquired!: () => void, release!: () => void;
  const entered = new Promise<void>(r => { acquired = r; }), barrier = new Promise<void>(r => { release = r; });
  const deadline=setTimeout(()=>release(),10_000);
  const a = db.transaction().execute(async tx => {
    await tx.insertInto('worldFactorySettings').values({ worldId, enabled: true }).execute(); acquired(); await barrier;
  });
  try {
    await Promise.race([entered,a.then(()=>{throw Error('Transaction ended before barrier');})]);
    await db.transaction().execute(async tx => { await tx.updateTable('villages').set({ name: 'Second commits first' }).where('id', '=', villageId).execute(); });
    expect(await revision()).toBe(before + 1); expect((await read()).factoryEnabled).toBe(false);
  } finally { clearTimeout(deadline);release(); await a; }
  expect(await revision()).toBe(before + 2); expect((await read()).factoryEnabled).toBe(true);
});

it('keeps the projection and revision in the same database view during a concurrent commit',async()=>{
  const before=await read(), queries=new Set<QueryId>();let gated=false;
  const plugin:KyselyPlugin={
    transformQuery(args){if(!gated&&JSON.stringify(args.node).includes('village_sync_changes')){gated=true;queries.add(args.queryId);}return args.node;},
    async transformResult(args){if(queries.delete(args.queryId))await db.updateTable('villages').set({name:'Committed inside snapshot read'}).where('id','=',villageId).execute();return args.result;},
  };
  const concurrent=await readVillageProjection(db.withPlugin(plugin),accountId,slug,villageId);
  expect(gated).toBe(true);expect(concurrent.village.name).toBe(before.village.name);expect(concurrent.syncRevision).toBe(before.syncRevision);
  const after=await read();expect(after.village.name).toBe('Committed inside snapshot read');expect(after.syncRevision).toBe(before.syncRevision!+1);
});

it('replaces a snapshot whose revision became uncertain before the HTTP response',async()=>{
  const response=await app.inject({url:'/snapshot-race',cookies:{arbestra_session:token}});
  expect(response.statusCode).toBe(200);const snapshot=response.json<VillageState>();
  expect(snapshot.village.name).toBe('After snapshot before response');expect(snapshot.syncRevision).toBe(await revision());
});

it('recovers an unannounced worker commit on a connected SSE client, without a following mutation', async () => {
  // The stream's initial cursor is not due: its deadline fallback must not be
  // the reason this lost publication is recovered. The worker commits alone.
  await db.updateTable('buildings').set({ constructionCompletesAt: new Date(Date.now() + 3600000) })
    .where('worldId', '=', worldId).where('id', '=', houseId).execute();
  const base = await app.listen({ host: '127.0.0.1', port: 0 }), controller = new AbortController();
  const response = await fetch(`${base}/api/worlds/${slug}/villages/${villageId}/events?revision=0`, {
    signal: controller.signal, headers: { cookie: `arbestra_session=${token}`, 'Last-Event-ID': '999999' },
  });
  expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('text/event-stream');
  const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = '';
  async function nextEvent() {
    const deadline = setTimeout(() => controller.abort(), 15000);
    try {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary !== -1) {
          const message = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const event = /^event: (.*)$/m.exec(message)?.[1], data = /^data: (.*)$/m.exec(message)?.[1];
          if (event && data) return { event, data: JSON.parse(data) };
          continue;
        }
        const chunk = await reader.read(); if (chunk.done) throw Error('Stream ended'); buffer += decoder.decode(chunk.value, { stream: true });
      }
    } finally { clearTimeout(deadline); }
  }
  try {
    const initial = await nextEvent(); expect(initial.event).toBe('snapshot'); const local = initial.data as VillageState;
    expect(local.cells.find(c => c.building?.id === houseId)?.building?.status).toBe('under-construction');
    const started = performance.now();
    // Actual worker handler and transaction; there is intentionally no publish call.
    await db.transaction().execute(async tx => {
      await tx.updateTable('buildings').set({ constructionCompletesAt: new Date(Date.now() - 1000) })
        .where('worldId', '=', worldId).where('id', '=', houseId).execute();
      const task = await tx.insertInto('scheduledTasks').values({ worldId, taskType: 'building.complete', subjectId: houseId,
        payload: {}, dueAt: new Date(), availableAt: new Date(), attempts: 0, lastError: null, completedAt: null }).returningAll().executeTakeFirstOrThrow();
      await completeConstruction(tx, task);
    });
    const committed = performance.now();
    const committedRevision = await revision();
    let event = await nextEvent(); while (event.event === 'revision') event = await nextEvent();
    expect(event.event).toBe('frame'); const frame = event.data as VillageFrame;
    const result = applyVillageFrame(local, frame); expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') throw Error('Frame not applied');
    expect(result.state.cells.find(c => c.building?.id === houseId)?.building?.status).toBe('completed');
    expect(result.state.syncRevision).toBe(committedRevision);
    expect(await revision()).toBe(committedRevision); // No following business mutation.
    expect(applyVillageFrame(result.state, frame).kind).toBe('ignored');
    console.info('SYNC_WORKER_RECOVERY', { totalMs: Math.round(performance.now() - started), afterCommitMs: Math.round(performance.now()-committed), snapshotBytes: JSON.stringify(local).length, frameBytes: JSON.stringify(frame).length });
  } finally { controller.abort(); await reader.cancel().catch(() => undefined); }
});

it('versions real HTTP reads and refuses an unauthenticated stream', async () => {
  const response = await app.inject({ url: `/api/worlds/${slug}/village?villageId=${villageId}`, cookies: { arbestra_session: token } });
  expect(response.statusCode).toBe(200); expect(response.json<VillageState>().syncRevision).toBe(await revision());
  const denied = await app.inject({ url: `/api/worlds/${slug}/villages/${villageId}/events` }); expect(denied.statusCode).toBe(401);
  const foreign=await app.inject({url:`/api/worlds/${slug}/villages/${hallId}/events`,cookies:{arbestra_session:token}});expect(foreign.statusCode).toBe(404);
  // No foreign world's markers are part of this revision.
  const count = (await sql<{n:string}>`select count(*)::text as n from village_sync_changes where world_id=${worldId}::uuid`.execute(db)).rows[0]!.n;
  expect(Number(count)).toBe(await revision());
});

it('deduplicates a real construction response and its SSE frame, retaining command idempotence',async()=>{
  const stream=new VillageSyncSession(read,revision);const initial=await stream.check();if(initial.event!=='snapshot')throw Error('No snapshot');
  const payload={commandId:randomUUID(),buildingType:'dwelling',houseVariant:'logs',anchorCellX:66,anchorCellY:64,cells:[{cellX:66,cellY:64}]};
  const command=()=>app.inject({method:'POST',url:`/api/worlds/${slug}/villages/${villageId}/buildings`,cookies:{arbestra_session:token},payload});
  const first=await command();expect(first.statusCode).toBe(201);const accepted=first.json<VillageState>();
  const event=await stream.check();expect(event.event).toBe('frame');if(event.event!=='frame')throw Error('No frame');
  expect(applyVillageFrame(accepted,event.data).kind).toBe('ignored');
  const once=applyVillageFrame(initial.data,event.data);expect(once.kind).toBe('applied');
  const retry=await command();expect(retry.statusCode).toBe(201);const retried=retry.json<VillageState>();
  expect(retried.cells.find(c=>c.cellX===66&&c.cellY===64)?.building?.id).toBe(accepted.cells.find(c=>c.cellX===66&&c.cellY===64)?.building?.id);
  expect(retried.village.wood).toBe(accepted.village.wood);
  expect(await db.selectFrom('buildings').select('id').where('worldId','=',worldId).where('villageId','=',villageId).execute()).toHaveLength(3);
});

it('reconciles a due construction and resting activity without relying on a live worker',async()=>{
  const building=await db.selectFrom('worldCellOccupancies').select('buildingId').where('worldId','=',worldId).where('cellX','=',66).where('cellY','=',64).executeTakeFirstOrThrow();
  await db.updateTable('buildings').set({constructionCompletesAt:new Date(Date.now()-1000)}).where('worldId','=',worldId).where('id','=',building.buildingId!).execute();
  const cohortId=randomUUID(),since=new Date(Date.now()-6*3600000);
  await db.insertInto('populationCohorts').values({id:cohortId,worldId,villageId,originVillageId:villageId,memberCount:1,activity:'resting',energy:0,energyProgress:0,
    energyUpdatedAt:since,restingSince:since,foodUsedSinceRest:0,harvestId:null,extractionId:null}).execute();
  const session=new VillageSyncSession(read,revision,snapshot=>reconcileSyncDeadline(db,accountId,slug,villageId,snapshot));
  const initial=await session.check();expect(initial.event).toBe('snapshot');
  const update=await session.check();expect(update.event).toBe('frame');
  expect((await db.selectFrom('buildings').select('status').where('id','=',building.buildingId!).executeTakeFirstOrThrow()).status).toBe('completed');
  expect((await db.selectFrom('populationCohorts').select('activity').where('id','=',cohortId).executeTakeFirstOrThrow()).activity).toBe('idle');
});

it('measures the idle authoritative revision check separately from snapshot reads',async()=>{
  const times:number[]=[];
  for(let i=0;i<10;i++){const start=performance.now();await revision();times.push(performance.now()-start);}
  times.sort((a,b)=>a-b);console.info('SYNC_REVISION_CHECK',{markers:await revision(),samples:times.length,medianMs:Math.round(times[5]!),maxMs:Math.round(times[9]!)});
});
