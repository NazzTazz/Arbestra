import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {sql,type Kysely,type Transaction,type Selectable} from 'kysely';
import {ROUTE_POLICY_VERSION,spawnDelta,type ExpeditionIntent,type ExpeditionReceipt,type RouteResult,type RouteQuery} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {HttpError} from '../../errors.js';
import {ownedVillage} from '../villages/service.js';
import {beginVillageEconomy} from '../villages/reconcile-economy.js';
import {scienceCommand} from './service.js';
import {NavigationCompute,type NavigationExecutor} from '../navigation/compute.js';
import {loadNavigationContext,navigationRevision,type NavigationData} from '../navigation/context.js';
type Submission=Selectable<Database['expeditionSubmissions']>;
const isPending=(row:Submission)=>row.receipt.status==='pending';
const base=(r:Submission)=>({kind:'expedition-receipt' as const,commandId:r.commandId,worldId:r.worldId,villageId:r.villageId,version:r.receipt.version+1,receivedAt:r.receipt.receivedAt,requestedTarget:r.request.target});
const terminal=(r:Submission,status:'failed'|'rejected',code:string,message:string):ExpeditionReceipt=>({...base(r),status,code,message});
async function store(tx:Transaction<Database>,row:Submission,receipt:ExpeditionReceipt){
 await tx.updateTable('expeditionSubmissions').set({receipt:JSON.stringify(receipt),leaseUntil:null,attemptToken:null}).where('worldId','=',row.worldId).where('villageId','=',row.villageId).where('commandId','=',row.commandId).execute();
}
export async function receiveExpedition(db:Kysely<Database>,accountId:string,slug:string,villageId:string,input:ExpeditionIntent):Promise<ExpeditionReceipt>{
 const request:ExpeditionIntent={commandId:input.commandId.toLowerCase(),action:input.action,target:{cellX:input.target.cellX,cellY:input.target.cellY},budgetSeconds:input.budgetSeconds};
 const duplicate=(row:Submission)=>{if(row.accountId!==accountId||!isDeepStrictEqual(row.request,request))throw new HttpError(409,'COMMAND_ID_CONFLICT','Cette demande existe avec un autre ordre.');return row.receipt;};
 // A retry reads its receipt and current ownership in one statement, without
 // a transaction or admission latch. New orders are rechecked under the latch.
 const prior=await db.selectFrom('expeditionSubmissions as s')
  .innerJoin('villages as v',j=>j.onRef('v.worldId','=','s.worldId').onRef('v.id','=','s.villageId'))
  .innerJoin('worlds as w','w.id','s.worldId')
  .innerJoin('worldMemberships as m',j=>j.onRef('m.worldId','=','s.worldId').on('m.accountId','=',accountId))
  .selectAll('s').select(['w.widthCells','w.heightCells']).where('w.slug','=',slug).where('v.ownerAccountId','=',accountId)
  .where('s.villageId','=',villageId).where('s.commandId','=',request.commandId).executeTakeFirst();
 if(prior){if(request.target.cellX>=prior.widthCells||request.target.cellY>=prior.heightCells)throw new HttpError(400,'INVALID_SURVEY_TARGET','Objectif hors des coordonnées canoniques.');return duplicate(prior);}
 return db.transaction().execute(async tx=>{
  const v=await ownedVillage(tx,accountId,slug,villageId);
  if(request.target.cellX>=v.widthCells||request.target.cellY>=v.heightCells)throw new HttpError(400,'INVALID_SURVEY_TARGET','Objectif hors des coordonnées canoniques.');
  const existing=()=>tx.selectFrom('expeditionSubmissions').selectAll().where('worldId','=',v.worldId).where('villageId','=',villageId).where('commandId','=',request.commandId).executeTakeFirst();
  // Retries are reads and do not join the serialised admission queue.
  const previous=await existing();if(previous)return duplicate(previous);
  // Serialise only new submissions, then recheck a concurrent identical insert.
  // This also makes the global quota atomic across API instances.
  await sql`select pg_advisory_xact_lock(hashtextextended('expedition-submissions',0))`.execute(tx);
  const concurrent=await existing();if(concurrent)return duplicate(concurrent);
  const counts=await sql<{total:string;local:string}>`select count(*)::text total,count(*) filter(where village_id=${villageId} and world_id=${v.worldId})::text local from expedition_submissions where receipt->>'status'='pending'`.execute(tx);
  if(Number(counts.rows[0]!.total)>=64||Number(counts.rows[0]!.local)>=4)throw new HttpError(429,'EXPEDITION_QUEUE_FULL','La préparation est occupée. Réessayez.');
  const at=(await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow()).at;
  const receipt:ExpeditionReceipt={kind:'expedition-receipt',commandId:request.commandId,worldId:v.worldId,villageId,version:1,receivedAt:at.toISOString(),status:'pending',requestedTarget:request.target};
  await tx.insertInto('expeditionSubmissions').values({worldId:v.worldId,villageId,accountId,commandId:request.commandId,request:JSON.stringify(request),receipt:JSON.stringify(receipt)}).execute();
  return receipt;
 });
}
export async function readExpeditionReceipts(db:Kysely<Database>,accountId:string,slug:string,villageId:string,ids?:string[],before?:string):Promise<ExpeditionReceipt[]>{
 return db.transaction().execute(async tx=>{
  const village=await ownedVillage(tx,accountId,slug,villageId);
  if(ids&&(ids.length>64||ids.some(id=>!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))))throw new HttpError(400,'EXPEDITION_IDS_INVALID','Identifiants invalides.');
  if(before&&!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(before))throw new HttpError(400,'EXPEDITION_CURSOR_INVALID','Curseur invalide.');
  const query=()=>tx.selectFrom('expeditionSubmissions').select(['receipt','receivedOrder']).where('worldId','=',village.worldId).where('villageId','=',villageId).where('accountId','=',accountId);
  if(ids)return(await query().where('commandId','in',ids).execute()).map(r=>r.receipt);
  const pending=await query().where(sql<boolean>`receipt->>'status'='pending'`).execute();
  let history=query().where(sql<boolean>`receipt->>'status'<>'pending'`);
  if(before){const cursor=await query().where('commandId','=',before).executeTakeFirst();if(!cursor)throw new HttpError(400,'EXPEDITION_CURSOR_INVALID','Curseur invalide.');history=history.where('receivedOrder','<',cursor.receivedOrder);}
  return [...pending,...await history.orderBy('receivedOrder','desc').limit(64).execute()].map(r=>r.receipt);
 });
}
export async function acquireExpedition(db:Kysely<Database>):Promise<Submission|undefined>{
 return db.transaction().execute(async tx=>{
  const row=await tx.selectFrom('expeditionSubmissions as s').selectAll('s')
   .where(sql<boolean>`s.receipt->>'status'='pending'`).where('s.expiresAt','>',sql<Date>`statement_timestamp()`)
   .where(eb=>eb.or([eb('s.leaseUntil','is',null),eb('s.leaseUntil','<=',sql<Date>`statement_timestamp()`)]))
   .where(eb=>eb.not(eb.exists(eb.selectFrom('expeditionSubmissions as prior').select('prior.commandId')
    .whereRef('prior.worldId','=','s.worldId').whereRef('prior.villageId','=','s.villageId')
    .whereRef('prior.receivedOrder','<','s.receivedOrder').where(sql<boolean>`prior.receipt->>'status'='pending'`))))
   .orderBy('s.receivedOrder').limit(1).forUpdate('s').skipLocked().executeTakeFirst();
  if(!row)return;
  if(row.attempt>=3){await store(tx,row,terminal(row,'failed','EXPEDITION_RETRIES_EXHAUSTED','La préparation a été interrompue plusieurs fois. Réessayez.'));return;}
  return tx.updateTable('expeditionSubmissions').set({attempt:row.attempt+1,attemptToken:randomUUID(),leaseUntil:sql`statement_timestamp()+interval '10 seconds'`})
   .where('worldId','=',row.worldId).where('villageId','=',row.villageId).where('commandId','=',row.commandId).returningAll().executeTakeFirstOrThrow();
 });
}
/** Only the live attempt may renew, and never beyond the order's deadline. */
export async function renewExpeditionLease(db:Kysely<Database>,claim:Submission){
 const changed=await db.updateTable('expeditionSubmissions').set({leaseUntil:sql`least(expires_at,statement_timestamp()+interval '10 seconds')`})
  .where('worldId','=',claim.worldId).where('villageId','=',claim.villageId).where('commandId','=',claim.commandId)
  .where('attemptToken','=',claim.attemptToken).where(sql<boolean>`receipt->>'status'='pending'`)
  .where('leaseUntil','>',sql<Date>`statement_timestamp()`).where('expiresAt','>',sql<Date>`statement_timestamp()`).executeTakeFirst();
 return Number(changed.numUpdatedRows)===1;
}
export async function expireExpeditions(db:Kysely<Database>){
 await db.transaction().execute(async tx=>{
  const rows=await tx.selectFrom('expeditionSubmissions').selectAll().where(sql<boolean>`receipt->>'status'='pending'`)
   .where('expiresAt','<=',sql<Date>`statement_timestamp()`).orderBy('receivedOrder').limit(64).forUpdate().skipLocked().execute();
  for(const row of rows)await store(tx,row,terminal(row,'failed','EXPEDITION_EXPIRED','La préparation a dépassé son délai. Réessayez.'));
 });
}
export async function finaliseExpedition(db:Kysely<Database>,claim:Submission,prepared:{query:RouteQuery;revision:string;result:RouteResult},afterAdmission?:(tx:Transaction<Database>,activityId:string)=>Promise<void>){
 return db.transaction().execute(async tx=>{
  await sql`set local lock_timeout='500ms'`.execute(tx);await sql`set local statement_timeout='2s'`.execute(tx);
  // PostgreSQL 17 bounds the whole transaction, including successive statements.
  await sql`set local transaction_timeout='2s'`.execute(tx);
  const row=await tx.selectFrom('expeditionSubmissions').selectAll().where('worldId','=',claim.worldId).where('villageId','=',claim.villageId).where('commandId','=',claim.commandId).forUpdate().executeTakeFirst();
  if(!row||!isPending(row)||row.attemptToken!==claim.attemptToken)return;
  const now=()=>tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow();
  if(row.expiresAt<=(await now()).at||!row.leaseUntil||row.leaseUntil<=(await now()).at)return;
  const economy=await beginVillageEconomy(tx,row.worldId,row.villageId,undefined,[],[],true);
  const village=await tx.selectFrom('villages').innerJoin('worlds','worlds.id','villages.worldId').select(['ownerAccountId','slug','widthCells','heightCells']).where('villages.worldId','=',row.worldId).where('villages.id','=',row.villageId).executeTakeFirstOrThrow();
  if(village.ownerAccountId!==row.accountId){await store(tx,row,terminal(row,'rejected','VILLAGE_OWNER_CHANGED','Ce village ne vous appartient plus.'));return;}
  if(!row.leaseUntil||row.leaseUntil<=(await now()).at)return;
  const revision=await navigationRevision(tx,row.worldId);
  if(revision!==prepared.revision){await tx.updateTable('expeditionSubmissions').set({leaseUntil:null,attemptToken:null}).where('worldId','=',row.worldId).where('villageId','=',row.villageId).where('commandId','=',row.commandId).execute();return;}
  if(row.expiresAt<=(await now()).at){await store(tx,row,terminal(row,'failed','EXPEDITION_EXPIRED','La préparation a dépassé son délai.'));return;}
  if(prepared.query.worldId!==row.worldId||!prepared.query.contextId.startsWith(row.worldId+':'+prepared.revision+':'))throw Error('Contexte de navigation incohérent');
  if(prepared.result.kind==='context-unavailable'){await store(tx,row,terminal(row,'failed','EXPEDITION_CONTEXT_UNAVAILABLE','Le contexte de trajet est indisponible. Réessayez.'));return;}
  if(prepared.result.kind!=='found'){
   await store(tx,row,terminal(row,prepared.result.kind==='unreachable'?'rejected':'failed',prepared.result.kind==='unreachable'?'DESTINATION_UNREACHABLE':'ROUTE_BUDGET_EXCEEDED',prepared.result.kind==='unreachable'?'Aucun accès praticable à ces extrémités.':'La recherche n’a pas pu établir de trajet dans son budget.'));return;
  }
  const result=prepared.result;
  const validPath=result.path.every((p,i,path)=>Number.isFinite(p.cellX)&&Number.isFinite(p.cellY)&&p.cellX>=0&&p.cellX<village.widthCells&&p.cellY>=0&&p.cellY<village.heightCells&&(!i||Math.abs(spawnDelta(p.cellX,path[i-1]!.cellX,village.widthCells))<1e-9||Math.abs(spawnDelta(p.cellY,path[i-1]!.cellY,village.heightCells))<1e-9));
  if(!validPath)throw Error('Chemin de navigation incohérent');
  if(result.contextId!==prepared.query.contextId||result.policyVersion!==ROUTE_POLICY_VERSION||result.movementProfileId!=='pedestrian-v1'||result.traversalConstraintsId!==prepared.query.traversalConstraintsId||!result.path.length||result.path.length>8192||result.path.at(-1)!.cellX!==row.request.target.cellX||result.path.at(-1)!.cellY!==row.request.target.cellY)throw Error('Résultat de navigation incohérent');
  await sql`savepoint expedition_admission`.execute(tx);
  try{
   const activityId=await scienceCommand(tx,economy,row.request,prepared.result.path);
   if(typeof activityId!=='string')throw Error('Admission sans activité');
   await afterAdmission?.(tx,activityId);
   const activity=await tx.selectFrom('scienceActivities').select(['startedAt','completesAt','surveyCells']).where('worldId','=',row.worldId).where('villageId','=',row.villageId).where('id','=',activityId).executeTakeFirstOrThrow();
   if(row.expiresAt<=(await now()).at)throw new HttpError(503,'EXPEDITION_EXPIRED','La préparation a dépassé son délai.');
   await store(tx,row,{...base(row),status:'admitted',activityId,startedAt:activity.startedAt.toISOString(),completesAt:activity.completesAt.toISOString(),effectiveTarget:activity.surveyCells[0]!});
   await sql`release savepoint expedition_admission`.execute(tx);
  }catch(error){
   await sql`rollback to savepoint expedition_admission`.execute(tx);await sql`release savepoint expedition_admission`.execute(tx);
   if(!(error instanceof HttpError)||error.statusCode>=500)throw error;
   await store(tx,row,terminal(row,'rejected',error.code,error.message));
  }
 });
}
export class ExpeditionCoordinator {
 private ticking=false;private stopped=false;private timer:ReturnType<typeof setTimeout>|undefined;private flights=new Set<Promise<void>>();private manifests=new Map<string,NavigationData['accesses']>();
 constructor(private db:Kysely<Database>,private compute:NavigationExecutor=new NavigationCompute(),private onError:(e:unknown)=>void=()=>{}){}
 start(){this.stopped=false;void this.tick();return()=>this.close();}
 private async tick(){
  if(this.stopped||this.ticking)return;this.ticking=true;
  try{
   await expireExpeditions(this.db);
   while(this.compute.available&&this.flights.size<2){
    const claim=await acquireExpedition(this.db);if(!claim)break;
    const flight=this.process(claim).catch(this.onError).finally(()=>{this.flights.delete(flight);if(!this.stopped){if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>void this.tick(),0);}});
    this.flights.add(flight);
   }
  }catch(error){this.onError(error);}
  this.ticking=false;if(!this.stopped){if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>void this.tick(),250);}
 }
 async process(claim:Submission){
  let prepared: {query:RouteQuery;revision:string;result:RouteResult}|undefined,renewing:Promise<unknown>|undefined;
  const heartbeat=setInterval(()=>{if(!renewing)renewing=renewExpeditionLease(this.db,claim).catch(this.onError).finally(()=>{renewing=undefined;});},3000);heartbeat.unref();
  try{
   const result=await this.compute.run(async known=>{
    const context=await loadNavigationContext(this.db,claim.worldId,known.sources,new Set([...known.contexts].filter(id=>this.manifests.has(id))));
    if(context.data){this.manifests.set(context.contextId,context.data.accesses);while(this.manifests.size>4)this.manifests.delete(this.manifests.keys().next().value!);}
    const hall=await this.db.selectFrom('buildings').select('id').where('worldId','=',claim.worldId).where('villageId','=',claim.villageId).where('buildingType','=','town-hall').executeTakeFirst();
    const starts=(this.manifests.get(context.contextId)??[]).filter(a=>a.buildingId===hall?.id).map(a=>({kind:'access' as const,accessId:a.id}));
    const query:RouteQuery={worldId:claim.worldId,contextId:context.contextId,policyVersion:ROUTE_POLICY_VERSION,movementProfileId:'pedestrian-v1',traversalConstraintsId:'none',starts,
     goals:[{kind:'point',...claim.request.target}],limits:{maxNodes:262144,maxDurationMs:5000}};
    prepared={query,revision:context.revision,result:{kind:'context-unavailable',visited:0}};
    return{query,...(context.data?{data:context.data}:{})};
   });
   if(prepared)await finaliseExpedition(this.db,claim,{...prepared,result});
  }catch(error){
   await this.db.transaction().execute(async tx=>{
    const current=await tx.selectFrom('expeditionSubmissions').selectAll().where('worldId','=',claim.worldId).where('villageId','=',claim.villageId).where('commandId','=',claim.commandId).forUpdate().executeTakeFirst();
    if(!current||!isPending(current)||current.attemptToken!==claim.attemptToken)return;
    if(current.attempt>=3)await store(tx,current,terminal(current,'failed','EXPEDITION_COMPUTE_FAILED','La préparation a été interrompue. Réessayez.'));
    else await tx.updateTable('expeditionSubmissions').set({attemptToken:null,leaseUntil:null}).where('worldId','=',claim.worldId).where('villageId','=',claim.villageId).where('commandId','=',claim.commandId).execute();
   });this.onError(error);
  }finally{clearInterval(heartbeat);await renewing;}
 }
 async close(){this.stopped=true;if(this.timer)clearTimeout(this.timer);await this.compute.close();await Promise.allSettled([...this.flights]);}
}
