import {VillageSyncProjections} from '../villages/sync-projections.js';
import {randomUUID} from 'node:crypto';
import {sql} from 'kysely';
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {ROUTE_POLICY_VERSION,type ExpeditionIntent,type RouteQuery,type RouteResult} from '@arbestra/contracts';
import {createDatabase} from '../../database/connection.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {migrateToLatest} from '../../database/migrate.js';
import {receiveExpedition,readExpeditionReceipts,acquireExpedition,finaliseExpedition,renewExpeditionLease,expireExpeditions,ExpeditionCoordinator} from './expeditions.js';
import {scienceCommand,completeScienceAt} from './service.js';
import {beginVillageEconomy} from '../villages/reconcile-economy.js';
import {NavigationCompute} from '../navigation/compute.js';
import {loadNavigationContext,navigationRevision} from '../navigation/context.js';
import {buildApp} from '../../app.js';
import {hashSessionToken} from '../../security/sessions.js';
import type {FastifyInstance} from 'fastify';
const url=testDatabaseUrl(),target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected private expedition test DB');
const db=createDatabase(url),world=randomUUID(),account=randomUUID(),village=randomUUID(),hall=randomUUID(),cohort=randomUUID(),slug='expedition-'+world,token=randomUUID();
const compute=new NavigationCompute();let app:FastifyInstance;
const request=(x=60):ExpeditionIntent=>({commandId:randomUUID(),action:'explore',target:{cellX:x,cellY:8},budgetSeconds:600});
const send=(r:ExpeditionIntent)=>receiveExpedition(db,account,slug,village,r);
async function prepare(claim:NonNullable<Awaited<ReturnType<typeof acquireExpedition>>>){
 let prepared!:{query:RouteQuery;revision:string;result:RouteResult};
 const result=await compute.run(async known=>{
  const ctx=await loadNavigationContext(db,world,known.sources,new Set());
  const query:RouteQuery={worldId:world,contextId:ctx.contextId,policyVersion:ROUTE_POLICY_VERSION,movementProfileId:'pedestrian-v1',traversalConstraintsId:'none',
   starts:ctx.data!.accesses.filter(a=>a.buildingId===hall).map(a=>({kind:'access',accessId:a.id})),goals:[{kind:'point',...claim.request.target}],limits:{maxNodes:262144,maxDurationMs:5000}};
  prepared={query,revision:ctx.revision,result:{kind:'context-unavailable',visited:0}};return{query,data:ctx.data!};
 });return{...prepared,result};
}
beforeAll(async()=>{
 await migrateToLatest(url);await compute.start();
 await db.insertInto('accounts').values({id:account,email:account+'@expeditions.test',passwordHash:'fixture'}).execute();
 await db.transaction().execute(async tx=>{
  await tx.insertInto('worlds').values({id:world,slug,name:'Private expedition fixture',topology:'torus',widthCells:128,heightCells:128,chunkSize:32,seed:41,generationVersion:1,generationStatus:'ready',isOpen:true,generatedAt:new Date()}).execute();
  await tx.insertInto('worldMemberships').values({worldId:world,accountId:account,playerName:'Expedition'}).execute();
  await tx.insertInto('villages').values({id:village,worldId:world,ownerAccountId:account,name:'Source',anchorCellX:8,anchorCellY:8,economyActivatedAt:new Date()}).execute();
  for(let chunkX=0;chunkX<4;chunkX++)for(let chunkY=0;chunkY<4;chunkY++)await tx.insertInto('worldChunks').values({worldId:world,chunkX,chunkY,generationVersion:1,terrainCodes:Array(1024).fill(1),elevations:Array(1024).fill(100)}).execute();
  for(const code of ['wood','carrot','stone'])await tx.insertInto('villageResources').values({worldId:world,villageId:village,resourceCode:code,amount:2000}).execute();
  await tx.insertInto('villageResourceFlows').values({worldId:world,villageId:village,resourceCode:'wood',baseRatePerHour:0,remainder:0,productionUpdatedAt:new Date()}).execute();
  await tx.insertInto('buildings').values({id:hall,worldId:world,villageId:village,buildingType:'town-hall',level:1,targetLevel:null,status:'completed',constructionStartedAt:null,constructionCompletesAt:null,completedAt:new Date()}).execute();
  await tx.insertInto('worldCellOccupancies').values({worldId:world,buildingId:hall,featureId:null,role:'anchor',cellX:8,cellY:8}).execute();
  await tx.insertInto('playerScience').values({worldId:world,accountId:account,observationsSince:null,solarReport:null}).execute();
  for(const level of [1,2])await tx.insertInto('sciencePrograms').values({worldId:world,accountId:account,code:'geography-'+level,discipline:'geography',level,workDoneMs:9999999,paused:false,acquiredAt:new Date(),createdAt:new Date(),workerCap:1}).execute();
  await tx.insertInto('populationCohorts').values({id:cohort,worldId:world,villageId:village,originVillageId:village,memberCount:1,activity:'idle',energy:10,energyProgress:0,energyUpdatedAt:new Date(),restingSince:null,foodUsedSinceRest:0,harvestId:null,extractionId:null,scienceActivityId:null,processingLotId:null,cartographer:true}).execute();
 });
 await db.insertInto('sessions').values({accountId:account,tokenHash:hashSessionToken(token),expiresAt:new Date(Date.now()+3600000)}).execute();
 app=await buildApp({databaseUrl:url,host:'127.0.0.1',port:0,isProduction:false,cookieName:'arbestra_session',sessionTtlDays:30,constructionDurationOverrideMs:null,scheduledTaskPollIntervalMs:250,expeditionWorkerEnabled:false},db);
},120000);
beforeEach(async()=>{
 await db.updateTable('buildings').set({visualLayout:null,quarterTurns:0}).where('id','=',hall).execute();
 await db.updateTable('populationCohorts').set({activity:'idle',energy:10,energyProgress:0,energyUpdatedAt:new Date(),restingSince:null,scienceActivityId:null}).where('worldId','=',world).execute();
 await db.deleteFrom('sciencePlaces').where('worldId','=',world).execute();
 await db.insertInto('sciencePlaces').values({worldId:world,accountId:account,cellX:8,cellY:8,terrainCode:1,elevation:100,observedAt:new Date(),surveyed:false,sourceActivityId:null}).execute();
 await db.deleteFrom('scienceActivities').where('worldId','=',world).execute();
 await db.deleteFrom('scheduledTasks').where('worldId','=',world).execute();
 await db.deleteFrom('expeditionSubmissions').where('worldId','=',world).execute();
});
afterAll(async()=>{
 await compute.close();if(app)await app.close();
 await db.deleteFrom('populationCohorts').where('worldId','=',world).execute();
 await db.deleteFrom('sciencePlaces').where('worldId','=',world).execute();
 await db.deleteFrom('worlds').where('id','=',world).execute();
 await db.deleteFrom('accounts').where('id','=',account).execute();await db.destroy();
},60000);
describe.sequential('durable FIFO expedition admission on a private world',()=>{
 it('records duplicate HTTP intentions once and never reserves a cartographer at receipt',async()=>{
  const r=request();const {commandId:omitted,...legacy}=r;void omitted;
  const outdated=await app.inject({method:'POST',url:'/api/worlds/'+slug+'/villages/'+village+'/science',headers:{cookie:'arbestra_session='+token},payload:legacy});expect(outdated.statusCode).toBe(400);expect(outdated.json()).toMatchObject({code:'SCIENCE_COMMAND_ID_REQUIRED'});
  const [a,b]=await Promise.all([send(r),send(r)]);expect(a).toEqual(b);expect(a.status).toBe('pending');
  expect(await db.selectFrom('expeditionSubmissions').select('commandId').where('worldId','=',world).execute()).toHaveLength(1);
  expect((await db.selectFrom('populationCohorts').select('activity').where('id','=',cohort).executeTakeFirstOrThrow()).activity).toBe('idle');
  await expect(send({...r,target:{cellX:59,cellY:8}})).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
  const response=await app.inject({method:'POST',url:'/api/worlds/'+slug+'/villages/'+village+'/science',headers:{cookie:'arbestra_session='+token},payload:r});
  expect(response.statusCode).toBe(202);expect(response.json()).toEqual(a);
 });
 it('keeps the first leased request ahead of the second, then admits exactly once',async()=>{
  const first=request(),second=request(61);await send(first);await send(second);
  const claim=(await acquireExpedition(db))!;expect(claim.commandId).toBe(first.commandId);
  expect(await acquireExpedition(db)).toBeUndefined();
  const prepared=await prepare(claim);expect(prepared.result.kind).toBe('found');
  await finaliseExpedition(db,claim,prepared);await finaliseExpedition(db,claim,prepared);
  const receipt=(await readExpeditionReceipts(db,account,slug,village,[first.commandId]))[0]!;
  expect(receipt.status).toBe('admitted');expect(await db.selectFrom('scienceActivities').select('id').where('worldId','=',world).execute()).toHaveLength(1);
  const later=(await acquireExpedition(db))!;expect(later.commandId).toBe(second.commandId);await finaliseExpedition(db,later,await prepare(later));
  expect((await readExpeditionReceipts(db,account,slug,village,[second.commandId]))[0]).toMatchObject({status:'rejected',code:'CARTOGRAPHERS_UNAVAILABLE'});
 });
 it('uses the persisted visual orientation for each door instead of the default building turn',async()=>{
  for(const turn of [0,1,2,3]){
   await db.updateTable('buildings').set({quarterTurns:0,visualLayout:{recipe:'town-hall',version:1,quarterTurns:turn,entranceFace:'-z',offset:[0,0]}}).where('id','=',hall).execute();
   const context=await loadNavigationContext(db,world,new Set(),new Set()),door=context.data!.accesses.find(a=>a.buildingId===hall)!;
   const expected=[{cellX:8,cellY:6.875},{cellX:6.875,cellY:8},{cellX:8,cellY:9.125},{cellX:9.125,cellY:8}][turn];
   expect(door.path.at(-1)).toEqual(expected);
  }
 });
 it('preserves the historical exemption for an occupied legacy target cell',async()=>{
  const house=randomUUID();await db.insertInto('buildings').values({id:house,worldId:world,villageId:village,buildingType:'dwelling',level:1,targetLevel:null,status:'completed',constructionStartedAt:null,constructionCompletesAt:null,completedAt:new Date()}).execute();
  await db.insertInto('worldCellOccupancies').values({worldId:world,buildingId:house,featureId:null,role:'anchor',cellX:12,cellY:8}).execute();
  try{await send(request(12));const claim=(await acquireExpedition(db))!,prepared=await prepare(claim);expect(prepared.result.kind).toBe('found');await finaliseExpedition(db,claim,prepared);expect((await readExpeditionReceipts(db,account,slug,village))[0]!.status).toBe('admitted');}
  finally{await db.deleteFrom('worldCellOccupancies').where('worldId','=',world).where('buildingId','=',house).execute();await db.deleteFrom('buildings').where('worldId','=',world).where('id','=',house).execute();}
 });
 it('rejects a candidate from another world or with noncanonical vertices without creating a mission',async()=>{
  await send(request());const claim=(await acquireExpedition(db))!,prepared=await prepare(claim);
  expect(prepared.result.kind).toBe('found');if(prepared.result.kind!=='found')throw Error('Expected certified fixture path');
  await expect(finaliseExpedition(db,claim,{...prepared,query:{...prepared.query,worldId:randomUUID()}})).rejects.toThrow('Contexte de navigation incohérent');
  const path=prepared.result.path.map((p,i)=>i?{...p}:{cellX:128,cellY:p.cellY});
  await expect(finaliseExpedition(db,claim,{...prepared,result:{...prepared.result,path}})).rejects.toThrow('Chemin de navigation incohérent');
  expect(await db.selectFrom('scienceActivities').select('id').where('worldId','=',world).execute()).toEqual([]);
  expect((await db.selectFrom('populationCohorts').select(['activity','scienceActivityId']).where('id','=',cohort).executeTakeFirstOrThrow())).toEqual({activity:'idle',scienceActivityId:null});
 });
 it('lets another village depart while the first village computation is held, with two CPU lanes',async()=>{
  const other=randomUUID(),otherHall=randomUUID(),otherCohort=randomUUID();
  await db.transaction().execute(async tx=>{
   await tx.insertInto('villages').values({id:other,worldId:world,ownerAccountId:account,name:'Other',anchorCellX:100,anchorCellY:100,economyActivatedAt:new Date()}).execute();
   await tx.insertInto('buildings').values({id:otherHall,worldId:world,villageId:other,buildingType:'town-hall',level:1,targetLevel:null,status:'completed',constructionStartedAt:null,constructionCompletesAt:null,completedAt:new Date()}).execute();
   await tx.insertInto('worldCellOccupancies').values({worldId:world,buildingId:otherHall,featureId:null,role:'anchor',cellX:100,cellY:100}).execute();
   await tx.insertInto('populationCohorts').values({id:otherCohort,worldId:world,villageId:other,originVillageId:other,memberCount:1,activity:'idle',energy:10,energyProgress:0,energyUpdatedAt:new Date(),restingSince:null,foodUsedSinceRest:0,harvestId:null,extractionId:null,scienceActivityId:null,processingLotId:null,cartographer:true}).execute();
   await tx.insertInto('sciencePlaces').values({worldId:world,accountId:account,cellX:100,cellY:100,terrainCode:1,elevation:100,observedAt:new Date(),surveyed:false,sourceActivityId:null}).execute();
  });
  const real=new NavigationCompute(2);await real.start();let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});
  const executor={get available(){return real.available;},close:()=>real.close(),run:(load:Parameters<NavigationCompute['run']>[0])=>real.run(async known=>{const job=await load(known);if(job.query.goals.some(g=>g.kind==='point'&&g.cellX===60)){enter();await gate;}return job;})};
  const coordinator=new ExpeditionCoordinator(db,executor),first=request(),second={...request(),target:{cellX:112,cellY:100}};
  await send(first);await receiveExpedition(db,account,slug,other,second);
  const a=(await acquireExpedition(db))!,b=(await acquireExpedition(db))!;expect(a.villageId).toBe(village);expect(b.villageId).toBe(other);
  const held=coordinator.process(a);
  try{await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(Error('first-village compute barrier')),5000))]);await coordinator.process(b);
   expect((await readExpeditionReceipts(db,account,slug,other,[second.commandId]))[0]!.status).toBe('admitted');
   expect((await readExpeditionReceipts(db,account,slug,village,[first.commandId]))[0]!.status).toBe('pending');
  }finally{release();await held;await coordinator.close();}
  expect((await readExpeditionReceipts(db,account,slug,village,[first.commandId]))[0]!.status).toBe('admitted');
 });
 it('checks current workforce at admission without locking a village during CPU work',async()=>{
  await send(request());const claim=(await acquireExpedition(db))!,prepared=await prepare(claim);
  await db.transaction().execute(async tx=>{
   await sql`set local lock_timeout='500ms'`.execute(tx);
   await tx.selectFrom('villages').select('id').where('id','=',village).forUpdate().execute();
   await tx.updateTable('populationCohorts').set({activity:'resting',energy:0,energyProgress:0,energyUpdatedAt:new Date(),restingSince:new Date()}).where('id','=',cohort).execute();
  });
  await finaliseExpedition(db,claim,prepared);
  expect((await readExpeditionReceipts(db,account,slug,village))[0]).toMatchObject({status:'rejected',code:'CARTOGRAPHERS_UNAVAILABLE'});
 });
 it('discards a physically stale candidate but ignores economic-only changes',async()=>{
  const revision=await navigationRevision(db,world);
  await db.updateTable('villageResources').set({amount:1999}).where('worldId','=',world).where('resourceCode','=','wood').execute();
  expect(await navigationRevision(db,world)).toBe(revision);
  await send(request());const claim=(await acquireExpedition(db))!,prepared=await prepare(claim);
  await db.updateTable('buildings').set({quarterTurns:1}).where('id','=',hall).execute();
  expect(await navigationRevision(db,world)).not.toBe(revision);
  await finaliseExpedition(db,claim,prepared);
  expect((await readExpeditionReceipts(db,account,slug,village))[0]!.status).toBe('pending');
  expect(await db.selectFrom('scienceActivities').select('id').where('worldId','=',world).execute()).toHaveLength(0);
  const next=(await acquireExpedition(db))!;expect(next.attempt).toBe(2);await finaliseExpedition(db,next,await prepare(next));
  expect((await readExpeditionReceipts(db,account,slug,village))[0]!.status).toBe('admitted');
 });
 it('rolls back observed activity and assignment on the exact injected failure',async()=>{
  await send(request());const claim=(await acquireExpedition(db))!,prepared=await prepare(claim),injected=Error('after observed expedition assignment');
  const before=await db.selectFrom('populationCohorts').selectAll().where('worldId','=',world).execute();
  await expect(finaliseExpedition(db,claim,prepared,async(tx,id)=>{
   expect(await tx.selectFrom('scienceActivities').select('id').where('id','=',id).executeTakeFirst()).toBeDefined();
   expect((await tx.selectFrom('populationCohorts').select('scienceActivityId').where('id','=',cohort).executeTakeFirstOrThrow()).scienceActivityId).toBe(id);
   throw injected;
  })).rejects.toBe(injected);
  expect(await db.selectFrom('populationCohorts').selectAll().where('worldId','=',world).execute()).toEqual(before);
  expect(await db.selectFrom('scienceActivities').select('id').where('worldId','=',world).execute()).toHaveLength(0);
  expect((await readExpeditionReceipts(db,account,slug,village))[0]!.status).toBe('pending');
 });
 it('reclaims expired leases, rejects a late old attempt, and bounds expiry',async()=>{
  await send(request());const old=(await acquireExpedition(db))!,prepared=await prepare(old);
  await db.updateTable('expeditionSubmissions').set({leaseUntil:new Date(Date.now()-1000)}).where('worldId','=',world).execute();
  const current=(await acquireExpedition(db))!;expect(current.attemptToken).not.toBe(old.attemptToken);
  expect(await renewExpeditionLease(db,old)).toBe(false);expect(await renewExpeditionLease(db,current)).toBe(true);
  await finaliseExpedition(db,old,prepared);expect((await readExpeditionReceipts(db,account,slug,village))[0]!.status).toBe('pending');
  await db.updateTable('expeditionSubmissions').set({expiresAt:new Date(Date.now()-1000)}).where('worldId','=',world).execute();
  await expireExpeditions(db);await finaliseExpedition(db,current,prepared);
  expect((await readExpeditionReceipts(db,account,slug,village))[0]).toMatchObject({status:'failed',code:'EXPEDITION_EXPIRED'});
 });
 it('enforces an atomic per-village queue limit',async()=>{
  const outcomes=await Promise.allSettled(Array.from({length:6},()=>send(request())));
  expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(4);
  for(const r of outcomes)if(r.status==='rejected')expect(r.reason).toMatchObject({statusCode:429});
 });

 it('lets another command take the village while the computation phase is suspended',async()=>{
  await send(request());const claim=(await acquireExpedition(db))!;
  let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;}),real=new NavigationCompute();
  const executor={available:1,close:()=>real.close(),run:(load:Parameters<NavigationCompute['run']>[0])=>real.run(async known=>{const job=await load(known);enter();await gate;return job;})};
  const coordinator=new ExpeditionCoordinator(db,executor);
  const flight=coordinator.process(claim);
  try{
   await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(Error('compute barrier timeout')),10000))]);
   await db.transaction().execute(async tx=>{await sql`set local lock_timeout='500ms'`.execute(tx);
    await tx.selectFrom('villages').select('id').where('id','=',village).forUpdate().execute();
    await tx.updateTable('populationCohorts').set({activity:'resting',energy:0,energyProgress:0,energyUpdatedAt:new Date(),restingSince:new Date()}).where('id','=',cohort).execute();
   });
  }finally{release();await flight;await coordinator.close();}
  expect((await readExpeditionReceipts(db,account,slug,village))[0]).toMatchObject({status:'rejected',code:'CARTOGRAPHERS_UNAVAILABLE'});
 });
 it('excludes a physical writer until final admission commits, with observed PostgreSQL waiting',async()=>{
  await send(request());const claim=(await acquireExpedition(db))!,prepared=await prepare(claim);
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});
  const finalising=finaliseExpedition(db,claim,prepared,async()=>{enter();await gate;});
  await entered;let writerFinished=false;
  const writer=db.transaction().execute(async tx=>{
   await sql`set local application_name='expedition-writer-proof'`.execute(tx);
   await sql`select pg_advisory_xact_lock_shared(hashtextextended(${'infrastructure:'+world},0))`.execute(tx);
   writerFinished=true;
  });
  try{
   let observed=false;const deadline=Date.now()+700;
   while(!observed&&Date.now()<deadline){
    const rows=await sql<{wait:string}>`select wait_event_type as wait from pg_stat_activity where application_name='expedition-writer-proof'`.execute(db);
    observed=rows.rows.some(r=>r.wait==='Lock');if(!observed)await new Promise(r=>setTimeout(r,10));
   }
   expect(observed).toBe(true);expect(writerFinished).toBe(false);
  }finally{release();await Promise.allSettled([finalising,writer]);}
  await finalising;await writer;expect(writerFinished).toBe(true);
  expect((await readExpeditionReceipts(db,account,slug,village))[0]!.status).toBe('admitted');
 });
 it('sends a durable refusal by SSE without changing village revision, then rejoins it',async()=>{
  if(!app.server.listening)await app.listen({host:'127.0.0.1',port:0});
  const port=(app.server.address() as {port:number}).port,r=request();await send(r);
  const response=await fetch('http://127.0.0.1:'+port+'/api/worlds/'+slug+'/villages/'+village+'/events',{headers:{cookie:'arbestra_session='+token},signal:AbortSignal.timeout(15000)});
  const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';
  const receipt=async(status:string)=>{
   for(;;){let end:number;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);if(event.includes('event: expedition-receipt')){const line=event.split('\n').find(l=>l.startsWith('data: '));const value=JSON.parse(line!.slice(6));if(value.commandId===r.commandId&&value.status===status)return value;}}
    const next=await reader.read();if(next.done)throw Error('SSE ended before receipt');buffer+=decoder.decode(next.value,{stream:true});
   }
  };
  try{
   await receipt('pending');const revision=await navigationRevision(db,world);
   await db.updateTable('expeditionSubmissions').set({expiresAt:new Date(Date.now()-1000)}).where('worldId','=',world).execute();
   await expireExpeditions(db);expect(await receipt('failed')).toMatchObject({code:'EXPEDITION_EXPIRED'});
   expect(await navigationRevision(db,world)).toBe(revision);
   expect((await readExpeditionReceipts(db,account,slug,village,[r.commandId]))[0]!.status).toBe('failed');
  }finally{await reader.cancel();}
 });

 it('delivers a committed receipt while the initial village projection is deliberately held',async()=>{
  if(!app.server.listening)await app.listen({host:'127.0.0.1',port:0});
  let release!:()=>void,enter!:()=>void,finish!:()=>void;
  const gate=new Promise<void>(r=>{release=r;}),entered=new Promise<void>(r=>{enter=r;}),finished=new Promise<void>(r=>{finish=r;});
  const original=VillageSyncProjections.prototype.read;
  const spy=vi.spyOn(VillageSyncProjections.prototype,'read').mockImplementationOnce(async function(this:VillageSyncProjections,...args:Parameters<typeof original>){enter();await gate;try{return await original.apply(this,args);}finally{finish();}});
  const r=request();await send(r);const port=(app.server.address() as {port:number}).port;
  const response=await fetch('http://127.0.0.1:'+port+'/api/worlds/'+slug+'/villages/'+village+'/events',{headers:{cookie:'arbestra_session='+token},signal:AbortSignal.timeout(15000)});
  const reader=response.body!.getReader();
  try{
   await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(Error('projection barrier timeout')),5000))]);
   await db.updateTable('expeditionSubmissions').set({expiresAt:new Date(Date.now()-1000)}).where('worldId','=',world).execute();await expireExpeditions(db);
   const received=(async()=>{const decoder=new TextDecoder();let text='';for(;;){const chunk=await reader.read();if(chunk.done)throw Error('SSE closed before terminal');text+=decoder.decode(chunk.value,{stream:true});const events=text.split('\n\n');text=events.pop()!;for(const event of events)if(event.includes('event: expedition-receipt')){const value=JSON.parse(event.split('\n').find(l=>l.startsWith('data: '))!.slice(6));if(value.commandId===r.commandId&&value.status==='failed')return value;}}})();
   expect(await Promise.race([received,new Promise((_,reject)=>setTimeout(()=>reject(Error('receipt held behind projection')),3000))])).toMatchObject({status:'failed',code:'EXPEDITION_EXPIRED'});
  }finally{release();spy.mockRestore();await reader.cancel();await finished;}
 });
 it('recalls a fractional journey from its real position and reports only its travelled prefix',async()=>{
  const path=[{cellX:8,cellY:7.584},{cellX:8,cellY:7.125},{cellX:9,cellY:7.125},{cellX:9,cellY:7},{cellX:20,cellY:7}];
  const id=await db.transaction().execute(async tx=>scienceCommand(tx,await beginVillageEconomy(tx,world,village),{action:'explore',target:{cellX:20,cellY:7},budgetSeconds:120},path));
  expect(id).toBeTypeOf('string');const before=await db.selectFrom('scienceActivities').selectAll().where('id','=',id!).executeTakeFirstOrThrow();
  expect(await db.selectFrom('sciencePlaces').selectAll().where('worldId','=',world).where('sourceActivityId','=',id!).execute()).toEqual([]);
  const recallAt=new Date(before.startedAt.getTime()+5200);
  await db.transaction().execute(async tx=>{const economy=await beginVillageEconomy(tx,world,village);await scienceCommand(tx,{...economy,through:recallAt},{action:'recall',activityId:id!});});
  const recalled=await db.selectFrom('scienceActivities').selectAll().where('id','=',id!).executeTakeFirstOrThrow();
  const turn=recalled.pathCells[Math.floor(recalled.pathCells.length/2)]!;expect(turn.cellX).toBeCloseTo(12.616);expect(turn.cellY).toBe(7);
  expect(recalled.completesAt.getTime()-recallAt.getTime()).toBe(5200);expect(recalled.surveyCells).toEqual([]);
  await db.transaction().execute(async tx=>{const economy=await beginVillageEconomy(tx,world,village);await completeScienceAt(tx,{...economy,through:recalled.completesAt},id!,recalled.completesAt);});
  const report=await db.selectFrom('sciencePlaces').selectAll().where('worldId','=',world).where('sourceActivityId','=',id!).orderBy('cellX').execute();
  expect(report.map(p=>[p.cellX,p.cellY]).sort()).toEqual([[8,8],[8,7],[9,7],[10,7],[11,7],[12,7],[13,7]].sort());expect(report.every(p=>p.elevation===100&&!p.surveyed)).toBe(true);
 });
 it('cuts a certified fractional path by mission budget without claiming the requested destination',async()=>{
  const id=await db.transaction().execute(async tx=>scienceCommand(tx,await beginVillageEconomy(tx,world,village),{action:'explore',target:{cellX:20,cellY:7},budgetSeconds:76},[{cellX:8,cellY:7.584},{cellX:8,cellY:7.125},{cellX:9,cellY:7.125},{cellX:9,cellY:7},{cellX:20,cellY:7}]));
  const activity=await db.selectFrom('scienceActivities').selectAll().where('id','=',id!).executeTakeFirstOrThrow();
  expect(activity.surveyCells).toEqual([{cellX:9,cellY:7}]);expect(activity.completesAt.getTime()-activity.startedAt.getTime()).toBeLessThanOrEqual(76000);
 });
 it('runs the warm real coordinator and returns the committed receipt',async()=>{
  const r=request();await send(r);const claim=(await acquireExpedition(db))!;await prepare(claim);const coordinator=new ExpeditionCoordinator(db,compute);
  try{await coordinator.process(claim);}finally{await coordinator.close();}
  expect((await readExpeditionReceipts(db,account,slug,village,[r.commandId]))[0]!.status).toBe('admitted');
 });
});
