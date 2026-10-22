import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'kysely';
import Fastify from 'fastify';
import { applySyncV2Batch, visibleSyncV2Scope, readServerEvents, type SyncV2State } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { capturePrivateSync, captureSyncV2 } from './sync-v2-capture.js';
import { servePrivateSyncStream } from './sync-v2-stream.js';

const url=testDatabaseUrl(), target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected capture-test database');
const db=createDatabase(url);
beforeAll(async()=>{
  await resetE2eState(url);
  await sql`delete from game_sync_streams where world_id=${ids.world}`.execute(db);
  await sql`insert into game_sync_streams(world_id,stream_kind,scope_key) values(${ids.world},'village',${ids.village})`.execute(db);
  await db.updateTable('villageResourceFlows').set({baseRatePerHour:0}).where('worldId','=',ids.world).execute();
},60000);
afterAll(async()=>{
  await sql`delete from game_sync_streams where world_id=${ids.world}`.execute(db);
  await db.destroy();
});

it('captures shared scopes with private data and recovers their atomic changes from applied cursors',async()=>{
  await sql`insert into game_sync_streams(world_id,stream_kind,scope_key) values
    (${ids.world},'knowledge',${ids.account}),(${ids.world},'manifest',${ids.world}),(${ids.world},'offers','all')
    on conflict do nothing`.execute(db);
  const request = {protocol:2 as const,generation:7,scopes:[{kind:'offers' as const,key:'all'}],cursors:[]};
  const initial=await captureSyncV2(db,ids.account,'aube',ids.village,request);
  const subscribedScopes=new Set(initial.groups.map(group=>`${group.stream.kind}:${group.stream.key}`));
  const applied=applySyncV2Batch({worldId:ids.world,villageId:ids.village,generation:7,scopes:new Map(),subscribedScopes},initial);
  expect(applied.kind).toBe('applied');
  expect(initial.groups.map(group=>group.stream.kind).sort()).toEqual(['knowledge','manifest','offers','village']);
  const knowledge=visibleSyncV2Scope(applied.state.scopes.get(`knowledge:${ids.account}`)!);
  expect(knowledge.has('knowledgeScience:*')).toBe(true);
  expect(knowledge.has('knowledgeCoverage:*')).toBe(true);
  expect(visibleSyncV2Scope(applied.state.scopes.get(`manifest:${ids.world}`)!).get('gameManifest:*')).toMatchObject({world:{id:ids.world}});
  const resume={...request,cursors:initial.groups.map(group=>({...group.stream,revision:group.toRevision}))};
  await db.transaction().execute(async tx=>{
    await tx.selectFrom('villages').select('id').where('worldId','=',ids.world).where('id','=',ids.village).forUpdate().executeTakeFirstOrThrow();
    await tx.updateTable('villageResources').set({amount:1980}).where('worldId','=',ids.world).where('villageId','=',ids.village).where('resourceCode','=','wood').execute();
    await sql`select game_sync_touch(${ids.world}::uuid,'village',${ids.village},'resources','wood')`.execute(tx);
    await sql`select game_sync_touch(${ids.world}::uuid,'offers','all','offerIndex','*')`.execute(tx);
    await sql`select game_sync_publish()`.execute(tx);
  });
  const delta=await captureSyncV2(db,ids.account,'aube',ids.village,resume);
  expect(delta.coverage).toBe('delta');
  expect(delta.groups.filter(group=>group.changes.length).map(group=>group.stream.kind).sort()).toEqual(['offers','village']);
  const next=applySyncV2Batch(applied.state,delta);
  expect(next.kind).toBe('applied');
  expect(visibleSyncV2Scope(next.state.scopes.get(`village:${ids.village}`)!).get('resources:wood')).toMatchObject({amount:1980});
  const idle=await captureSyncV2(db,ids.account,'aube',ids.village,{...request,cursors:delta.groups.map(group=>({...group.stream,revision:group.toRevision}))});
  expect(idle.groups.every(group=>group.changes.length===0)).toBe(true);
  expect(applySyncV2Batch(next.state,idle).kind).toBe('ignored');
  await expect(captureSyncV2(db,ids.account,'aube',ids.village,{...request,scopes:[{kind:'knowledge',key:randomUUID()}]}))
    .rejects.toMatchObject({code:'SYNC_SCOPE_NOT_FOUND'});
},60000);

it('recovers a committed change without notification through a pure coherent capture',async()=>{
  const beforeTasks=await db.selectFrom('scheduledTasks').selectAll().where('worldId','=',ids.world).orderBy('id').execute();
  const initial=await capturePrivateSync(db,ids.account,'aube',ids.village,1,null);
  expect(initial.coverage).toBe('scope-snapshot');
  const applied=applySyncV2Batch({worldId:ids.world,villageId:ids.village,generation:1,scopes:new Map()},initial);
  expect(applied.kind).toBe('applied');
  let state:SyncV2State=applied.state;
  const cursor=initial.groups[0]!;
  await db.transaction().execute(async tx=>{
    await tx.selectFrom('villages').select('id').where('worldId','=',ids.world).where('id','=',ids.village).forUpdate().executeTakeFirstOrThrow();
    await tx.updateTable('villageResources').set({amount:1975}).where('worldId','=',ids.world).where('villageId','=',ids.village).where('resourceCode','=','wood').execute();
    await sql`select game_sync_touch(${ids.world}::uuid,'village',${ids.village},'resources','wood')`.execute(tx);
    await sql`select game_sync_publish()`.execute(tx);
    // Deliberately no NOTIFY: replay depends on the durable journal.
  });
  const delta=await capturePrivateSync(db,ids.account,'aube',ids.village,1,{epoch:cursor.stream.epoch,revision:cursor.toRevision});
  expect(delta.coverage).toBe('delta');
  expect(delta.groups[0]?.changes).toMatchObject([{component:'resources',upsert:[{code:'wood',amount:1975}],remove:[]}]);
  const result=applySyncV2Batch(state,delta);expect(result.kind).toBe('applied');state=result.state;
  expect(visibleSyncV2Scope(state.scopes.get(`village:${ids.village}`)!).get('resources:wood')).toMatchObject({amount:1975});
  const next=delta.groups[0]!;
  expect((await capturePrivateSync(db,ids.account,'aube',ids.village,1,{epoch:next.stream.epoch,revision:next.toRevision})).groups[0]?.changes).toEqual([]);
  expect(await db.selectFrom('scheduledTasks').selectAll().where('worldId','=',ids.world).orderBy('id').execute()).toEqual(beforeTasks);
},60000);

it('checks current world membership and ownership before reading a private journal',async()=>{
  await expect(capturePrivateSync(db,randomUUID(),'aube',ids.village,1,null)).rejects.toMatchObject({code:'VILLAGE_NOT_FOUND'});
  await expect(capturePrivateSync(db,ids.account,'another-world',ids.village,1,null)).rejects.toMatchObject({code:'VILLAGE_NOT_FOUND'});
  await expect(capturePrivateSync(db,ids.account,'aube',randomUUID(),1,null)).rejects.toMatchObject({code:'VILLAGE_NOT_FOUND'});
});

it('streams a durable delta over a real socket after the initial capture, without NOTIFY or a global projection',async()=>{
  const bootstrap=await capturePrivateSync(db,ids.account,'aube',ids.village,2,null);
  const initial=bootstrap.groups[0]!;
  let state=applySyncV2Batch({worldId:ids.world,villageId:ids.village,generation:2,scopes:new Map()},bootstrap).state;
  const app=Fastify(), abort=new AbortController(), errors:unknown[]=[];
  app.post('/sync/stream',async(_request,reply)=>servePrivateSyncStream(reply,
    {epoch:initial.stream.epoch,revision:initial.toRevision},
    cursor=>capturePrivateSync(db,ids.account,'aube',ids.village,2,cursor),{pollMs:25,onError:error=>errors.push(error)}));
  let ready!:()=>void, done!:()=>void, failed!:(error:unknown)=>void;
  const opened=new Promise<void>(resolve=>{ready=resolve;});
  const delivered=new Promise<void>((resolve,reject)=>{done=resolve;failed=reject;});
  let pump:Promise<void>|undefined;
  const timeout=setTimeout(()=>{failed(Error('Timed out awaiting durable SSE delta'));abort.abort();},15000);
  try{
    const address=await app.listen({host:'127.0.0.1',port:0});
    const response=await fetch(address+'/sync/stream',{method:'POST',signal:abort.signal});
    expect(response.status).toBe(200);
    pump=readServerEvents(response.body!,{signal:abort.signal,current:()=>!abort.signal.aborted,onEvent:event=>{
      if(event.event==='heartbeat')ready();
      if(event.event==='batch'){
        const value=JSON.parse(event.data), result=applySyncV2Batch(state,value);
        expect(result.kind).toBe('applied');state=result.state;
        expect(value.groups[0].changes.map((change:{component:string})=>change.component)).toEqual(['resources']);done();
      }
    }}).catch(error=>{if(!abort.signal.aborted)failed(error);});
    await Promise.race([opened,delivered]);
    await db.transaction().execute(async tx=>{
      await tx.selectFrom('villages').select('id').where('worldId','=',ids.world).where('id','=',ids.village).forUpdate().executeTakeFirstOrThrow();
      await tx.updateTable('villageResources').set({amount:1900}).where('worldId','=',ids.world).where('villageId','=',ids.village).where('resourceCode','=','wood').execute();
      await sql`select game_sync_touch(${ids.world}::uuid,'village',${ids.village},'resources','wood')`.execute(tx);
      await sql`select game_sync_publish()`.execute(tx);
    });
    await delivered;
    expect(visibleSyncV2Scope(state.scopes.get(`village:${ids.village}`)!).get('resources:wood')).toMatchObject({amount:1900});
    expect(errors).toEqual([]);
  }finally{
    clearTimeout(timeout);abort.abort();await pump;await app.close();
  }
},60000);
