import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { sql, type KyselyPlugin, type QueryId, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import { constructBuilding, constructBuildingArea } from './service.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { applyVillageFrame, VillageStateSchema, type VillageState, type VillageFrame, type VillageCommandResponse } from '@arbestra/contracts';
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
    sessionTtlDays: 30, constructionDurationOverrideMs: 600000, scheduledTaskPollIntervalMs: 250 }, db);
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


it('returns a construction frame from the client exact HTTP base instead of a full village',async()=>{
  const initial=await app.inject({url:`/api/worlds/${slug}/village?villageId=${villageId}`,cookies:{arbestra_session:token}});
  expect(initial.statusCode).toBe(200);const base=initial.json<VillageState>();
  if(process.env.RC1_HTTP_BROWSER_FIXTURE==='1')writeFileSync('test-results/http-construction-browser-state.json',JSON.stringify(base));
  const payload={commandId:randomUUID(),buildingType:'dwelling',houseVariant:'logs',anchorCellX:67,anchorCellY:64,cells:[{cellX:67,cellY:64}]};
  const response=await app.inject({method:'POST',url:`/api/worlds/${slug}/villages/${villageId}/buildings`,cookies:{arbestra_session:token},payload,
    headers:{'x-village-sync':'1','x-village-revision':String(base.syncRevision),'x-village-server-time':base.serverTime}});
  expect(response.statusCode,response.body).toBe(201);
  const result=response.json<{kind:string;commandId:string;frame:VillageFrame}>();
  expect(result.kind).toBe('frame');expect(result.commandId).toBe(payload.commandId);
  const applied=applyVillageFrame(base,result.frame);expect(applied.kind).toBe('applied');
  if(applied.kind!=='applied')throw Error('Frame rejected');
  expect(applied.state.village.wood).toBe(base.village.wood-25);
  expect(applied.state.cells.find(c=>c.cellX===67&&c.cellY===64)?.building?.type).toBe('dwelling');
});

const config = { databaseUrl:url,host:'127.0.0.1',port:0,isProduction:false,cookieName:'arbestra_session',sessionTtlDays:30,
  constructionDurationOverrideMs:600000,scheduledTaskPollIntervalMs:250 };
const snapshot = async (server=app) => {
  const response=await server.inject({url:`/api/worlds/${slug}/village?villageId=${villageId}`,cookies:{arbestra_session:token}});
  expect(response.statusCode).toBe(200);return response.json<VillageState>();
};
const headers=(base:VillageState)=>({'x-village-sync':'1','x-village-revision':String(base.syncRevision),'x-village-server-time':base.serverTime});
const buildPayload=(x:number)=>({commandId:randomUUID(),buildingType:'dwelling',houseVariant:'logs',anchorCellX:x,anchorCellY:64,cells:[{cellX:x,cellY:64}]});
const build=(payload:ReturnType<typeof buildPayload>,base:VillageState,server=app)=>server.inject({method:'POST',url:`/api/worlds/${slug}/villages/${villageId}/buildings`,cookies:{arbestra_session:token},headers:headers(base),payload});
function applied(base:VillageState,response:VillageCommandResponse){
  expect(response.kind).toBe('frame');if(response.kind!=='frame')throw Error('Expected frame');
  const result=applyVillageFrame(base,response.frame);expect(result.kind).toBe('applied');if(result.kind!=='applied')throw Error('Rejected frame');return result.state;
}
it('deduplicates incremental HTTP and SSE in either order and retries the same construction receipt',async()=>{
  const base=await snapshot(),stream=new VillageSyncSession(read,revision);
  await stream.check();const payload=buildPayload(68),response=await build(payload,base);
  expect(response.statusCode,response.body).toBe(201);const first=response.json<VillageCommandResponse>(),local=applied(base,first);
  const sse=await stream.check();expect(sse.event).toBe('frame');
  if(first.kind!=='frame'||sse.event!=='frame')throw Error('Expected frames');
  expect(applyVillageFrame(local,sse.data).kind).toBe('ignored');
  const sseFirst=applied(base,{kind:'frame',frame:sse.data,commandTime:base.serverTime,serverTime:base.serverTime});
  expect(applyVillageFrame(sseFirst,first.frame).kind).toBe('ignored');
  const retry=await build(payload,local);expect(retry.statusCode).toBe(201);
  const reply=retry.json<VillageCommandResponse>(),next=reply.kind==='snapshot'?reply.state:applied(local,reply);
  expect(next.village.wood).toBe(local.village.wood);
  expect(next.cells.find(c=>c.cellX===68&&c.cellY===64)?.building?.id).toBe(local.cells.find(c=>c.cellX===68&&c.cellY===64)?.building?.id);
  expect(await db.selectFrom('buildingCommandReceipts').selectAll().where('worldId','=',worldId).where('commandId','=',payload.commandId).execute()).toHaveLength(1);
});
it('includes a due unrelated completion and upgrades in the command frame, with a coherent unknown-base fallback',async()=>{
  const base=await snapshot();
  const due=await db.selectFrom('worldCellOccupancies').select('buildingId').where('worldId','=',worldId).where('cellX','=',67).where('cellY','=',64).executeTakeFirstOrThrow();
  await db.updateTable('buildings').set({constructionCompletesAt:new Date(Date.now()-1000)}).where('id','=',due.buildingId!).execute();
  const response=await build(buildPayload(69),base);expect(response.statusCode,response.body).toBe(201);
  const local=applied(base,response.json<VillageCommandResponse>());
  expect(local.cells.find(c=>c.building?.id===due.buildingId)?.building?.status).toBe('completed');
  // The exact projection just sent is also a usable transport base.
  const upgrade=await app.inject({method:'POST',url:`/api/worlds/${slug}/villages/${villageId}/buildings/${due.buildingId}/upgrade`,cookies:{arbestra_session:token},headers:headers(local),payload:{commandId:randomUUID(),expectedLevel:2}});
  expect(upgrade.statusCode,upgrade.body).toBe(201);const upgraded=applied(local,upgrade.json<VillageCommandResponse>());
  expect(upgraded.cells.find(c=>c.building?.id===due.buildingId)?.building?.targetLevel).toBe(2);
  const fallback=await build(buildPayload(70),{...upgraded,serverTime:'2020-01-01T00:00:00.000Z'});
  expect(fallback.statusCode).toBe(201);const reply=fallback.json<VillageCommandResponse>();expect(reply.kind).toBe('snapshot');
  if(reply.kind==='snapshot'){expect(reply.state.syncRevision).toBe(await revision());expect(reply.state.cells.find(c=>c.cellX===70&&c.cellY===64)?.building).toBeTruthy();}
});
it('returns an incremental garden extension using the same transactional finalization',async()=>{
  const garden=await constructBuilding(db,accountId,slug,villageId,64,65,'garden',0,randomUUID());
  const id=garden.cells.find(c=>c.cellX===64&&c.cellY===65)?.building?.id;if(!id)throw Error('No garden');
  const base=await snapshot(),response=await app.inject({method:'POST',url:`/api/worlds/${slug}/villages/${villageId}/buildings/${id}/expansions`,cookies:{arbestra_session:token},headers:headers(base),payload:{commandId:randomUUID(),cells:[{cellX:64,cellY:66}]}});
  expect(response.statusCode,response.body).toBe(201);const next=applied(base,response.json<VillageCommandResponse>());
  expect(next.cells.find(c=>c.cellX===64&&c.cellY===66)?.footprint?.buildingId).toBe(id);
  expect(next.village.wood).toBeLessThan(base.village.wood);
});
it('releases the village lock before projecting the incremental construction response',async()=>{
  let armed=false,readOnly=false,gated=false,expired=false,enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(r=>{enter=r;}),barrier=new Promise<void>(r=>{release=r;}),queries=new Set<QueryId>();
  const plugin:KyselyPlugin={
    transformQuery(args){const text=JSON.stringify(args.node);if(armed&&text.includes('set transaction read only'))readOnly=true;
      if(armed&&readOnly&&!gated&&text.includes('village_sync_changes')){gated=true;queries.add(args.queryId);}return args.node;},
    async transformResult(args){if(queries.delete(args.queryId)){enter();await barrier;}return args.result;},
  };
  const server=await buildApp(config,db.withPlugin(plugin));let pending:ReturnType<typeof build>|undefined;
  const deadline=setTimeout(()=>{expired=true;release();},30000);
  try{
    const base=await snapshot(server);armed=true;pending=build(buildPayload(71),base,server);
    await Promise.race([entered,pending.then(()=>{throw Error('Response completed without projection barrier');})]);
    expect(expired).toBe(false);
    const stored=await db.selectFrom('worldCellOccupancies').selectAll().where('worldId','=',worldId).where('cellX','=',71).where('cellY','=',64).execute();
    expect(stored).toHaveLength(1); // The command really committed before this pause.
    await db.transaction().execute(async tx=>{await sql`set local lock_timeout='1000ms'`.execute(tx);
      await tx.selectFrom('villages').select('id').where('id','=',villageId).forUpdate().executeTakeFirstOrThrow();
      await tx.updateTable('villages').set({name:'Concurrent command while response is projecting'}).where('id','=',villageId).execute();});
  }finally{clearTimeout(deadline);release();try{if(pending){const response=await pending;expect(response.statusCode,response.body).toBe(201);}}finally{await server.close();}}
  expect(gated).toBe(true);expect((await read()).village.name).toBe('Concurrent command while response is projecting');
});
it('rolls back observed commit-mode construction writes and the revision on an exact injected failure',async()=>{
  const tables=['villages','villageResources','villageResourceFlows','buildings','worldCellOccupancies','scheduledTasks','buildingCommandReceipts','populationCohorts','gardenPlots','buildingExpansions','villageAccomplishments','buildingResourceBuffers','scienceActivities','playerScience','buildingHiddenSupplies'] as const;
  async function stored(source:Kysely<Database>){const result:Record<string,unknown>={};for(const table of tables)result[table]=await source.selectFrom(table).selectAll().where('worldId','=',worldId).execute();return result;}
  const before=await stored(db),r=await revision(),commandId=randomUUID(),injected=Error('construction commit-mode after observed finalization');let observed=false;
  await expect(db.transaction().execute(async tx=>{
    const inside={transaction:()=>({execute:<T>(f:(t:Transaction<Database>)=>Promise<T>)=>f(tx)})} as unknown as Kysely<Database>;
    await constructBuildingArea(inside,accountId,slug,villageId,'dwelling',{cellX:62,cellY:65},[{cellX:62,cellY:65}],0,commandId,undefined,0,'logs','commit');
    expect(await tx.selectFrom('buildingCommandReceipts').selectAll().where('worldId','=',worldId).where('commandId','=',commandId).execute()).toHaveLength(1);
    expect(await tx.selectFrom('worldCellOccupancies').selectAll().where('worldId','=',worldId).where('cellX','=',62).where('cellY','=',65).execute()).toHaveLength(1);
    const created=await tx.selectFrom('buildingCommandReceipts').innerJoin('buildings','buildings.id','buildingCommandReceipts.buildingId').select('buildings.status').where('buildingCommandReceipts.commandId','=',commandId).executeTakeFirstOrThrow();
    expect(created.status).toBe('completed'); // Zero-duration transition finalized at the command bound.
    expect((await villageSyncRevision(tx,worldId)).revision).toBe(r+1);observed=true;throw injected;
  })).rejects.toBe(injected);
  expect(observed).toBe(true);expect(await revision()).toBe(r);expect(await stored(db)).toEqual(before);
});

it('measures legacy and incremental replies on the same isolated warm village',async()=>{
 const results=[];
 for(const [x,incremental] of [[63,false],[62,true],[61,false],[60,true]] as const){
  const base=await snapshot(),started=performance.now();
  const response=await app.inject({method:'POST',url:`/api/worlds/${slug}/villages/${villageId}/buildings`,cookies:{arbestra_session:token},
    ...(incremental?{headers:headers(base)}:{}),payload:buildPayload(x)});
  expect(response.statusCode,response.body).toBe(201);
  const data=response.json<VillageState|VillageCommandResponse>();
  const mode='kind' in data?data.kind:'legacy';if(incremental)expect(mode).toBe('frame');
  results.push({mode,totalMs:Math.round(performance.now()-started),responseBytes:Buffer.byteLength(response.body),baseBytes:Buffer.byteLength(JSON.stringify(base))});
 }
 console.info('CONSTRUCTION_HTTP_PROFILE',{world:'isolated v1 flat 512x256',results});
});
