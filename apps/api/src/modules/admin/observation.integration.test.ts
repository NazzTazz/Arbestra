import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {sql} from 'kysely';
import {createDatabase} from '../../database/connection.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {migrateToLatest} from '../../database/migrate.js';
import {createSessionToken,hashSessionToken} from '../../security/sessions.js';
import {hashAdminSessionToken} from './auth.js';
import {HttpError} from '../../errors.js';
import {ObservationHub} from './observation-hub.js';
import {ObservationReads} from './observation-reads.js';
import {registerObservationRoutes} from './observation-routes.js';
import {instrumentObservationActions,observationCommitted} from './observation-actions.js';
import {NavigationCompute} from '../navigation/compute.js';
import {registerVillageSync} from '../villages/sync.js';
import {ownedVillage} from '../villages/service.js';
import {authenticate} from '../auth/service.js';
import {receiveHarvestIntent} from '../villages/harvest-submissions.js';
import type {AppConfig} from '../../config.js';
import type {ObservationLease} from '@arbestra/contracts';

const url=testDatabaseUrl(),target=new URL(url);if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected observation fixture target');
const db=createDatabase(url),world=randomUUID(),village=randomUUID(),owner=randomUUID(),admin=randomUUID(),hall=randomUUID(),slug='observe-'+world;
const token=createSessionToken(),playerToken=createSessionToken(),hub=new ObservationHub(),navigation=new NavigationCompute(),app=Fastify({logger:false});
const headers={host:'localhost',origin:'http://localhost',cookie:'arbestra_admin_session='+token};
const playerHeaders={host:'game.localhost',origin:'http://game.localhost',cookie:'arbestra_session='+playerToken};
const config:AppConfig={databaseUrl:url,host:'127.0.0.1',port:0,isProduction:false,cookieName:'arbestra_session',sessionTtlDays:30,constructionDurationOverrideMs:null,scheduledTaskPollIntervalMs:250,adminAccountIds:[admin],adminOrigin:'http://localhost'};
Object.assign(config,{worldOrigin:'http://game.localhost'});
const readsDb=createDatabase(url,()=>{}, {observation:true});const reads=new ObservationReads(readsDb,hub);
let lease:ObservationLease;
let base:string;
beforeAll(async()=>{
 await migrateToLatest(url);await navigation.start();await app.register(cookie);
 app.setErrorHandler((e,_r,reply)=>reply.status(e instanceof HttpError?e.statusCode:500).send({code:e instanceof HttpError?e.code:'INTERNAL_ERROR'}));
 await db.insertInto('accounts').values([admin,owner].map(id=>({id,email:id+'@observation.test',passwordHash:'fixture'}))).execute();
 await db.transaction().execute(async tx=>{
  await tx.insertInto('worlds').values({id:world,slug,name:'Observation fixture',topology:'torus',widthCells:128,heightCells:128,chunkSize:32,seed:41,generationVersion:1,generationStatus:'ready',isOpen:true,generatedAt:new Date()}).execute();
  await tx.insertInto('worldMemberships').values({worldId:world,accountId:owner,playerName:'Observed'}).execute();
  await tx.insertInto('villages').values({id:village,worldId:world,ownerAccountId:owner,name:'Observed village',anchorCellX:8,anchorCellY:8,economyActivatedAt:new Date()}).execute();
  for(let x=0;x<4;x++)for(let y=0;y<4;y++)await tx.insertInto('worldChunks').values({worldId:world,chunkX:x,chunkY:y,generationVersion:1,terrainCodes:Array(1024).fill(1),elevations:Array(1024).fill(100)}).execute();
  for(const code of ['wood','carrot','stone'])await tx.insertInto('villageResources').values({worldId:world,villageId:village,resourceCode:code,amount:2000}).execute();
  await tx.insertInto('villageResourceFlows').values({worldId:world,villageId:village,resourceCode:'wood',baseRatePerHour:0,remainder:0,productionUpdatedAt:new Date()}).execute();
  await tx.insertInto('buildings').values({id:hall,worldId:world,villageId:village,buildingType:'town-hall',level:1,status:'under-construction',targetLevel:2,constructionStartedAt:new Date(Date.now()-120000),constructionCompletesAt:new Date(Date.now()-60000),completedAt:null}).execute();
  await tx.insertInto('worldCellOccupancies').values({worldId:world,buildingId:hall,role:'anchor',cellX:8,cellY:8,featureId:null}).execute();
  await tx.insertInto('scheduledTasks').values({worldId:world,taskType:'building.complete',subjectId:hall,payload:{villageId:village},dueAt:new Date(Date.now()-60000),availableAt:new Date(Date.now()+3600000),completedAt:null,lastError:null}).execute();
  await tx.insertInto('playerScience').values({worldId:world,accountId:owner,observationsSince:null,solarReport:null}).execute();
  await tx.insertInto('sessions').values([{accountId:admin,tokenHash:hashAdminSessionToken(token),expiresAt:new Date(Date.now()+3600000)},{accountId:owner,tokenHash:hashSessionToken(playerToken),expiresAt:new Date(Date.now()+3600000)}]).execute();
 });
 const projections=await registerVillageSync(app,db,config,navigation);
 await registerObservationRoutes(app,db,config,hub,projections);
 instrumentObservationActions(app,hub);
 app.post('/api/worlds/:worldSlug/villages/:villageId/harvest-intents',async request=>{await authenticate(db,request.cookies.arbestra_session);return receiveHarvestIntent(db,owner,slug,village,request.body as Parameters<typeof receiveHarvestIntent>[4]);});
 app.post('/api/worlds/:worldSlug/villages/:villageId/market',async request=>{await authenticate(db,request.cookies.arbestra_session);await ownedVillage(db,owner,slug,village);await db.transaction().execute(async tx=>{await tx.updateTable('villageResources').set({amount:2100}).where('worldId','=',world).where('villageId','=',village).where('resourceCode','=','wood').execute();});observationCommitted(request);throw Error('Injected post-commit projection failure');});
 await app.ready();
 // Receipt reads use both bounded connections concurrently. Their business
 // assertions must not accidentally test a cold second connection's 500 ms
 // acquisition refusal on a loaded development machine.
 for(let attempt=0;attempt<4;attempt++){
  const warm=await Promise.allSettled([sql`select 1`.execute(readsDb),sql`select 1`.execute(readsDb)]);
  if(warm.every(r=>r.status==='fulfilled'))break;
  if(attempt===3)expect(warm.map(r=>r.status)).toEqual(['fulfilled','fulfilled']);
 }
 lease=hub.create(admin,await reads.target(world,village));
 // Warm the route's separate bounded pool; cold connection refusal is allowed,
 // while the assertions below must exercise authorization and target lookup.
 for(let attempt=0;attempt<4;attempt++){
  const warmed=await app.inject({method:'GET',url:'/api/admin/observations/'+lease.id,headers});
  if(warmed.statusCode===503&&attempt<3)continue;expect(warmed.statusCode).toBe(200);break;
 }
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw Error('Missing fixture port');base='http://127.0.0.1:'+address.port;
},120000);
afterAll(async()=>{await app.close();await navigation.close();await readsDb.destroy();await db.deleteFrom('worlds').where('id','=',world).execute();await db.deleteFrom('accounts').where('id','in',[owner,admin]).execute();await db.destroy();});
it('refuses ordinary users and cross-origin creation; creates a context-bound admin lease',async()=>{
 const payload={worldId:world,villageId:village};
 expect((await app.inject({method:'POST',url:'/api/admin/observations/',headers:{host:headers.host,origin:headers.origin},payload})).statusCode).toBe(401);
 expect((await app.inject({method:'POST',url:'/api/admin/observations/',headers:{...headers,cookie:'arbestra_admin_session='+playerToken},payload})).statusCode).toBe(401);
 expect((await app.inject({method:'POST',url:'/api/admin/observations/',headers:{...headers,origin:'http://evil.localhost'},payload})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:'/api/admin/observations/',headers,payload:{worldId:randomUUID(),villageId:village}})).statusCode).toBe(404);
 const response=await app.inject({method:'POST',url:'/api/admin/observations/',headers,payload});expect(response.statusCode).toBe(200);hub.close(lease.id);lease=response.json();expect(lease.accountId).toBe(owner);
});
it('reports a timed-out observation read as a retryable unavailability, not an internal error',async()=>{
 let acquired!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{acquired=r;}),held=new Promise<void>(r=>{release=r;});
 const transaction=db.transaction().execute(async tx=>{await sql`lock table villages in access exclusive mode`.execute(tx);acquired();await held;});
 const outcome=Promise.allSettled([transaction]);let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await Promise.race([entered,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Observation lock barrier expired')),10000);})]);
  const response=await app.inject({method:'POST',url:'/api/admin/observations/',headers,payload:{worldId:world,villageId:village}});
  expect(response.statusCode).toBe(503);expect(response.json().code).toBe('ADMIN_DATA_UNAVAILABLE');expect(response.headers['retry-after']).toBe('2');
 }finally{clearTimeout(timer);release();const result=await outcome;expect(result[0]?.status).toBe('fulfilled');}
});
it('reads an overdue village without mutation, exposes terrain through only the admin origin',async()=>{
 const before=await sql`select (select jsonb_agg(to_jsonb(b)) from buildings b where world_id=${world}::uuid) b,(select jsonb_agg(to_jsonb(t)) from scheduled_tasks t where world_id=${world}::uuid) tasks,(select jsonb_agg(to_jsonb(r)) from village_resources r where world_id=${world}::uuid) resources,(select count(*) from village_sync_changes where world_id=${world}::uuid) revision`.execute(db);
 const state=await reads.snapshot(lease);expect(state.village.id).toBe(village);
 const response=await app.inject({method:'GET',url:'/api/admin/observations/'+lease.id+'/snapshot',headers});expect(response.statusCode).toBe(200);
 const terrain=await app.inject({method:'GET',url:'/api/admin/observations/'+lease.id+'/terrain?kind=chunks&chunks=0,0',headers});expect(terrain.statusCode).toBe(200);
 const after=await sql`select (select jsonb_agg(to_jsonb(b)) from buildings b where world_id=${world}::uuid) b,(select jsonb_agg(to_jsonb(t)) from scheduled_tasks t where world_id=${world}::uuid) tasks,(select jsonb_agg(to_jsonb(r)) from village_resources r where world_id=${world}::uuid) resources,(select count(*) from village_sync_changes where world_id=${world}::uuid) revision`.execute(db);expect(after.rows).toEqual(before.rows);
 await expect(readsDb.updateTable('villageResources').set({amount:1}).where('worldId','=',world).execute()).rejects.toMatchObject({code:'25006'});
});
it('opens and refreshes an observation when predictive navigation is unavailable',async()=>{
 const diagnostic=vi.spyOn(navigation,'observationNetwork').mockRejectedValue(new HttpError(503,'OBSERVATION_BUSY','Cold navigation cache'));
 const reader=new ObservationReads(readsDb,hub),cold=hub.create(admin,await reads.target(world,village));
 const before=await db.selectFrom('buildings').selectAll().where('worldId','=',world).execute();
 try{
  const initial=await reader.snapshot(cold);expect(initial.village.id).toBe(village);expect(hub.status(cold.id,admin).degraded).toBe(false);
  expect(initial.cells.some(c=>c.building?.id===hall)).toBe(true);
  expect(initial.cells.every(c=>!c.canBuild)).toBe(true);
  await db.updateTable('villages').set({name:'Observed updated'}).where('worldId','=',world).where('id','=',village).execute();
  // Bounded cache cadence; advancing the clock triggers a real fresh DB read.
  const time=vi.spyOn(Date,'now').mockReturnValue(Date.now()+2100);
  try{const refreshed=await reader.snapshot(cold);expect(refreshed.village.name).toBe('Observed updated');expect(refreshed.syncRevision!).toBeGreaterThan(initial.syncRevision!);}finally{time.mockRestore();}
  expect(diagnostic).not.toHaveBeenCalled();expect(await db.selectFrom('buildings').selectAll().where('worldId','=',world).execute()).toEqual(before);
 }finally{diagnostic.mockRestore();hub.close(cold.id);await db.updateTable('villages').set({name:'Observed village'}).where('worldId','=',world).where('id','=',village).execute();}
});
it('keeps the persisted mixed harvest receipt separate from its successful HTTP submission',async()=>{
 const commandId=randomUUID(),stone=randomUUID();const response=await app.inject({method:'POST',url:'/api/worlds/'+slug+'/villages/'+village+'/harvest-intents',headers:playerHeaders,payload:{commandId,gardens:[{cellX:12,cellY:8}],wood:[],stone:[stone]}});expect(response.statusCode).toBe(200);expect(response.json().pending).toBe(true);
 let action=hub.status(lease.id,admin).actions.find(a=>a.commandId===commandId)!;expect(action).toMatchObject({businessOutcome:'pending',httpOutcome:'finished',statusCode:200});
 // A persisted worker result fixture tests projection of partial decisions, not the harvest solver.
 await db.updateTable('harvestSubmissions').set({receipt:JSON.stringify({commandId,accepted:[{key:'garden:12:8',cellX:12,cellY:8,resource:'carrot',amount:20}],refused:[{key:stone,reason:'secret SQL must not escape'}]})}).where('worldId','=',world).where('commandId','=',commandId).execute();
 await reads.receipts(lease,admin);action=hub.status(lease.id,admin).actions.find(a=>a.commandId===commandId)!;expect(action.businessOutcome).toBe('partial');expect(action.accepted).toEqual(['garden:12:8']);expect(JSON.stringify(action)).not.toContain('secret SQL');
});
it('retains a proven commit when response preparation fails',async()=>{
 const response=await app.inject({method:'POST',url:'/api/worlds/'+slug+'/villages/'+village+'/market',headers:playerHeaders,payload:{}});expect(response.statusCode).toBe(500);
 const stored=await db.selectFrom('villageResources').select('amount').where('worldId','=',world).where('resourceCode','=','wood').executeTakeFirstOrThrow();expect(Number(stored.amount)).toBe(2100);
 expect(hub.status(lease.id,admin).actions.at(-1)).toMatchObject({kind:'market',businessOutcome:'accepted',httpOutcome:'finished',statusCode:500});
});
it('does not accept a player camera from the administrative origin or another session',async()=>{
 const path='/api/worlds/'+slug+'/villages/'+village+'/observation';
 expect((await app.inject({method:'POST',url:path+'/status',headers:{...playerHeaders,origin:'http://elsewhere'}})).statusCode).toBe(403);
 const created=await app.inject({method:'POST',url:path+'/sources',headers:playerHeaders});expect(created.statusCode).toBe(200);
 const sourceId=created.json().sourceId,payload={version:1,sourceId,poseSequence:1,visible:true,pose:{mode:'village',cellX:8,cellY:8,alpha:1,beta:.8,radius:20,altitude:0,fov:.55}};
 expect((await app.inject({method:'POST',url:path+'/camera',headers:playerHeaders,payload})).statusCode).toBe(200);
 expect((await app.inject({method:'POST',url:path+'/camera',headers:{...headers,cookie:'arbestra_session='+playerToken},payload})).statusCode).toBe(403);
 const other=createSessionToken();await db.insertInto('sessions').values({accountId:owner,tokenHash:hashSessionToken(other),expiresAt:new Date(Date.now()+60000)}).execute();
 try{expect((await app.inject({method:'POST',url:path+'/camera',headers:{...playerHeaders,cookie:'arbestra_session='+other},payload})).statusCode).toBe(404);}finally{await db.deleteFrom('sessions').where('tokenHash','=',hashSessionToken(other)).execute();}
});
it('opens the world client using a one-use grant, isolated read cookie and revocable admin session',async()=>{
 const launched=await app.inject({method:'POST',url:'/api/admin/observations/launch',headers,payload:{worldId:world,villageId:village}});expect(launched.statusCode).toBe(200);
 const link=new URL(launched.json().url),token=new URLSearchParams(link.hash.slice(1)).get('observationToken')!,id=link.searchParams.get('observe')!;
 expect(link.origin).toBe('http://game.localhost');expect(link.pathname).toBe('/village');expect(link.searchParams.get('world')).toBe(slug);
 const game={host:'game.localhost',origin:'http://game.localhost'};
 try{
  const wrongOrigin=await app.inject({method:'POST',url:'/api/observation/exchange',headers,payload:{token}});expect(wrongOrigin.statusCode).toBe(403);
  // A delayed data read must not consume the one-use token without issuing its
  // cookie. Only later data delivery needs to acquire the observation pool.
  let acquired!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{acquired=r;}),held=new Promise<void>(r=>{release=r;});
  const transaction=db.transaction().execute(async tx=>{await sql`lock table villages in access exclusive mode`.execute(tx);acquired();await held;});
  const outcome=Promise.allSettled([transaction]);let timer:ReturnType<typeof setTimeout>|undefined;
  let exchanged;
  try{
   await Promise.race([entered,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Exchange lock barrier expired')),10000);})]);
   exchanged=await app.inject({method:'POST',url:'/api/observation/exchange',headers:game,payload:{token}});
  }finally{clearTimeout(timer);release();const result=await outcome;expect(result[0]?.status).toBe('fulfilled');}
  expect(exchanged.statusCode).toBe(200);expect(exchanged.json().accountId).toBe(owner);
  const cookie=exchanged.cookies.find(c=>c.name==='arbestra_observer')!;expect(cookie.httpOnly).toBe(true);expect(cookie.path).toBe('/api/observation/'+id);expect(cookie.domain).toBeUndefined();expect(cookie.sameSite?.toLowerCase()).toBe('strict');
  const view={...game,cookie:cookie.name+'='+cookie.value},path='/api/observation/'+id;
  expect((await app.inject({method:'POST',url:'/api/observation/exchange',headers:game,payload:{token}})).statusCode).toBe(401);
  expect((await app.inject({method:'GET',url:path+'/snapshot',headers:game})).statusCode).toBe(401);
  const before=await db.selectFrom('buildings').selectAll().where('worldId','=',world).execute();
  const snapshot=await app.inject({method:'GET',url:path+'/snapshot',headers:view});expect(snapshot.statusCode).toBe(200);expect(snapshot.json().village.id).toBe(village);
  expect((await app.inject({method:'GET',url:path+'/terrain?kind=chunks&chunks=0,0',headers:view})).statusCode).toBe(200);
  expect(await db.selectFrom('buildings').selectAll().where('worldId','=',world).execute()).toEqual(before);
  expect((await app.inject({method:'GET',url:'/api/observation/'+lease.id+'/snapshot',headers:view})).statusCode).toBe(401);
  expect((await app.inject({method:'GET',url:'/api/admin/observations/'+id,headers:{...headers,cookie:view.cookie}})).statusCode).toBe(401);
  const command=await app.inject({method:'POST',url:'/api/worlds/'+slug+'/villages/'+village+'/market',headers:view,payload:{}});expect(command.statusCode).toBe(401);
  const previous=config.adminAccountIds;Object.assign(config,{adminAccountIds:[]});
  try{expect((await app.inject({method:'GET',url:path,headers:view})).statusCode).toBe(401);expect(()=>hub.get(id,admin)).toThrow();}finally{Object.assign(config,{adminAccountIds:previous});}
 }finally{hub.close(id);}
});
it('invalidates cached metadata and snapshots immediately after an owner change',async()=>{
 await reads.snapshot(lease);
 const second=hub.create(admin,await reads.target(world,village));let replacement:ObservationLease|undefined;
 await db.insertInto('worldMemberships').values({worldId:world,accountId:admin,playerName:'Replacement'}).execute();
 try{
  await db.updateTable('villages').set({ownerAccountId:admin}).where('worldId','=',world).where('id','=',village).execute();
  replacement=hub.create(admin,await reads.target(world,village));
  const metadata=await app.inject({method:'GET',url:'/api/admin/observations/'+lease.id,headers});expect(metadata.statusCode).toBe(409);
  const cached=await app.inject({method:'GET',url:'/api/admin/observations/'+second.id+'/snapshot',headers});expect(cached.statusCode).toBe(409);
  expect(()=>hub.get(lease.id,admin)).toThrow();expect(()=>hub.get(second.id,admin)).toThrow();
  expect(hub.status(replacement.id,admin).actions).toEqual([]);expect(hub.status(replacement.id,admin).sources).toEqual([]);
 }finally{
  hub.close(second.id);if(replacement)hub.close(replacement.id);
  await db.updateTable('villages').set({ownerAccountId:owner}).where('worldId','=',world).where('id','=',village).execute();
  await db.deleteFrom('worldMemberships').where('worldId','=',world).where('accountId','=',admin).execute();
  lease=hub.create(admin,await reads.target(world,village));
 }
});
it('reports recovery on a real SSE stream even when the snapshot has not changed',async()=>{
 const previousOrigin=config.adminOrigin;Object.assign(config,{adminOrigin:base});
 const controller=new AbortController(),initial=await reads.snapshot(lease);
 let calls=0;
 const snapshot=vi.spyOn(ObservationReads.prototype,'snapshot').mockImplementation(async l=>{
  calls++;
  if(calls===2)throw Error('Injected transient observation failure');
  hub.degrade(l,false);return initial;
 });
 try{
  const response=await fetch(base+'/api/admin/observations/'+lease.id+'/events',{headers:{cookie:headers.cookie,origin:base},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
  expect(response.status).toBe(200);const reader=response.body!.getReader();
  let pending='',snapshots=0,sawDelay=false,recovered=false;
  while(!recovered){const chunk=await reader.read();if(chunk.done)break;pending+=new TextDecoder().decode(chunk.value);
   for(let end;(end=pending.indexOf('\n\n'))!==-1;){const packet=pending.slice(0,end);pending=pending.slice(end+2);
    if(packet.startsWith('event: snapshot'))snapshots++;
    if(packet.startsWith('event: degraded'))sawDelay=true;
    if(packet.startsWith('event: status')){const status=JSON.parse(packet.split('\ndata: ')[1]!);if(sawDelay&&!status.degraded)recovered=true;}
   }
  }
  expect(sawDelay).toBe(true);expect(recovered).toBe(true);expect(snapshots).toBe(1);expect(calls).toBeGreaterThanOrEqual(3);
 }finally{controller.abort();snapshot.mockRestore();Object.assign(config,{adminOrigin:previousOrigin});}
});
it('replaces a real SSE stream, then revokes both delivery and collection when the admin session disappears',async()=>{
 Object.assign(config,{adminOrigin:base,worldOrigin:base});
 const firstController=new AbortController(),secondController=new AbortController(),viewerController=new AbortController();
 const open=async(controller:AbortController)=>{const response=await fetch(base+'/api/admin/observations/'+lease.id+'/events',{headers:{cookie:headers.cookie,origin:base},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});expect(response.status).toBe(200);return response.body!.getReader();};
 const until=async(reader:ReadableStreamDefaultReader<Uint8Array>,needle:string)=>{let text='';for(;;){const result=await reader.read();if(result.done)return text;text+=new TextDecoder().decode(result.value);if(text.includes(needle))return text;}};
 try{const first=await open(firstController);expect(await until(first,'event: snapshot')).toContain('Observed village');const second=await open(secondController);expect(await until(second,'event: snapshot')).toContain('Observed village');
  await until(first,'impossible-marker');
  const originHeaders={host:new URL(base).host,origin:base,cookie:headers.cookie};
  const launch=await app.inject({method:'POST',url:'/api/admin/observations/launch',headers:originHeaders,payload:{worldId:world,villageId:village}});expect(launch.statusCode).toBe(200);
  const credential=new URLSearchParams(new URL(launch.json().url).hash.slice(1)).get('observationToken')!;
  const exchange=await app.inject({method:'POST',url:'/api/observation/exchange',headers:{host:originHeaders.host,origin:base},payload:{token:credential}});expect(exchange.statusCode).toBe(200);
  const cookie=exchange.cookies.find(c=>c.name==='arbestra_observer')!,viewerId=exchange.json().id;
  const response=await fetch(base+'/api/observation/'+viewerId+'/events',{headers:{origin:base,cookie:cookie.name+'='+cookie.value},signal:AbortSignal.any([viewerController.signal,AbortSignal.timeout(15000)])});expect(response.status).toBe(200);
  const viewer=response.body!.getReader();expect(await until(viewer,'event: snapshot')).toContain('Observed village');
  await db.deleteFrom('sessions').where('tokenHash','=',hashAdminSessionToken(token)).execute();
  const ended=await until(second,'impossible-marker');expect(ended).toContain('expired');expect(()=>hub.get(lease.id,admin)).toThrow();
  expect(await until(viewer,'impossible-marker')).toContain('expired');expect(()=>hub.get(viewerId,admin)).toThrow();
 }finally{firstController.abort();secondController.abort();viewerController.abort();}
});
