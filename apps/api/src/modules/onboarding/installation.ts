import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {sql,type Kysely,type Transaction} from 'kysely';
import {emptyInfrastructure,poseStarterElement,type StarterElement,type StarterInstallation,type SpawnPoseRequest,type StarterPoseRequest} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {HttpError} from '../../errors.js';
import {beginVillageEconomy} from '../villages/reconcile-economy.js';
import {STARTER_KIT} from './starter-kit.js';
import {spawnSnapshot} from './spawn-map.js';
import {persistRc1Resources,removeSpawnTrees} from './rc1-resources.js';
import type {SpawnCompute} from './spawn-compute.js';
import type {InstallationPlan} from './installation-plan.js';
import type {ElementPlan} from './element-plan.js';
function fail(code:string,message:string):never {throw new HttpError(409,code,message);}
function serialize(row:Database['villageStarterInstallations']|Record<string,unknown>):StarterInstallation{
 return {villageId:row.villageId as string,kit:row.kit as unknown as StarterInstallation['kit'],remaining:row.remaining as unknown as string[],anchor:{x:row.anchorX as number,y:row.anchorY as number},quarterTurns:row.quarterTurns as number,referenceHeight:row.referenceHeight as number};
}
export async function readInstallation(db:Kysely<Database>,accountId:string,slug:string):Promise<StarterInstallation|null>{
 const row=await db.selectFrom('villageStarterInstallations').innerJoin('worlds','worlds.id','villageStarterInstallations.worldId').selectAll('villageStarterInstallations').where('worlds.slug','=',slug).where('accountId','=',accountId).executeTakeFirst();
 return row?serialize(row):null;
}
async function insertElement(tx:Transaction<Database>,worldId:string,villageId:string,element:ReturnType<typeof poseStarterElement>,through:Date){
 const id=randomUUID();await tx.insertInto('buildings').values({id,worldId,villageId,buildingType:element.type,level:element.level,quarterTurns:element.quarterTurns,visualLayout:element.visualLayout,status:'completed',targetLevel:null,constructionStartedAt:null,constructionCompletesAt:null,completedAt:through}).execute();
 await tx.insertInto('worldCellOccupancies').values(element.cells.map(c=>({...c,worldId,buildingId:id,featureId:null}))).execute();
 if(element.type==='town-hall')await tx.insertInto('buildingHiddenSupplies').values({worldId,villageId,buildingId:id,resourceCode:'carrot',amount:2000,claimedAt:null}).execute();
 const production=await tx.selectFrom('buildingLevelProduction').select(['resourceCode','capacity']).where('buildingTypeCode','=',element.type).where('level','=',element.level).execute();
 for(const p of production)if(p.capacity!==null){
  await tx.insertInto('buildingResourceBuffers').values({worldId,villageId,buildingId:id,resourceCode:p.resourceCode,storedAmount:0,remainder:0,productionUpdatedAt:through}).execute();
  if(element.type==='garden')await tx.insertInto('gardenPlots').values(element.cells.map(c=>({worldId,villageId,buildingId:id,cellX:c.cellX,cellY:c.cellY,storedAmount:Math.floor(Number(p.capacity)/3),remainder:0,productionUpdatedAt:through}))).execute();
 }
 return id;
}
async function flatten(tx:Transaction<Database>,worldId:string,villageId:string,cells:readonly {cellX:number;cellY:number}[],height:number){
 await tx.insertInto('worldSpawnTerraces').values(cells.map(c=>({cellX:c.cellX,cellY:c.cellY,worldId,villageId,height}))).execute();
}
export async function installVillage(db:Kysely<Database>,compute:Pick<SpawnCompute,'run'>,accountId:string,slug:string,input:SpawnPoseRequest):Promise<StarterInstallation>{
 if(!input.playerName.trim()||!input.villageName.trim())throw new HttpError(400,'INVALID_NAME','Choisissez un nom de joueur et de village.');
 return db.transaction().execute(async tx=>{
  await sql`set local lock_timeout='60s'`.execute(tx);
  await tx.selectFrom('accounts').select('id').where('id','=',accountId).forUpdate().executeTakeFirstOrThrow();
  const world=await tx.selectFrom('worlds').selectAll().where('slug','=',slug).executeTakeFirst();
  if(!world||!world.isOpen||world.generationStatus!=='ready'||world.generationVersion!==3)fail('WORLD_NOT_READY','Ce monde n’est pas ouvert.');
  const previous=await tx.selectFrom('villageStarterInstallations').selectAll().where('worldId','=',world.id).where('accountId','=',accountId).executeTakeFirst();
  if(previous){if(previous.commandId===input.commandId&&!isDeepStrictEqual(previous.request,input))fail('COMMAND_CONFLICT','Cette commande existe avec un autre projet.');return serialize(previous);}
  if(await tx.selectFrom('villages').select('id').where('worldId','=',world.id).where('ownerAccountId','=',accountId).executeTakeFirst())fail('ALREADY_INSTALLED','Vous possédez déjà un village dans ce monde.');
  if(input.kitVersion!==STARTER_KIT.version)fail('STARTER_CHANGED','Le modèle de départ a changé. Rechargez la préparation.');
  await tx.insertInto('worldMemberships').values({worldId:world.id,accountId,playerName:input.playerName.trim()}).onConflict(c=>c.columns(['accountId','worldId']).doNothing()).execute();
  const villageId=randomUUID();await tx.insertInto('villages').values({id:villageId,worldId:world.id,ownerAccountId:accountId,name:input.villageName.trim(),anchorCellX:input.point.x,anchorCellY:input.point.y}).execute();
  await sql`select pg_advisory_xact_lock(hashtextextended(${'infrastructure:'+world.id},0))`.execute(tx);
  const snapshot=await spawnSnapshot(tx,slug,true);snapshot.map.villages=snapshot.map.villages.filter(v=>v.id!==villageId);
  if(input.artifactChecksum!==snapshot.map.artifactChecksum)fail('SPAWN_MAP_STALE','La carte a changé.');
  const plan=await compute.run({kind:'installation',snapshot,input}) as InstallationPlan;
  if(plan.status!=='planned')fail(plan.status==='terrain-blocked'?'SPAWN_BLOCKED':'SPAWN_RESOURCE_SPACE',plan.status==='terrain-blocked'?'Ce projet rencontre un obstacle. Déplacez-le.':'Pas assez de place pour installer les ressources de départ. Déplacez votre projet.');
  const through=(await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('through')).executeTakeFirstOrThrow()).through;
  const elements=STARTER_KIT.elements.filter(e=>input.mode==='grouped'||e.type==='town-hall');
  const placed=elements.map(e=>poseStarterElement(e,input.point,input.quarterTurns));const cells=placed.flatMap(e=>e.cells);
  if(plan.chunks){
    const existing=await tx.selectFrom('worldChunks').select('worldId').where('worldId','=',world.id).executeTakeFirst();
    if(existing)fail('WORLD_PROJECTION_CONFLICT','La projection jouable de ce monde doit être préparée par son opérateur.');
    for(let i=0;i<plan.chunks.length;i+=16)await tx.insertInto('worldChunks').values(plan.chunks.slice(i,i+16).map(c=>({...c,worldId:world.id}))).execute();
  }
  await persistRc1Resources(tx,world.id,plan.resources,plan.supplements,villageId,through,JSON.parse(snapshot.artifactJSON));
  await removeSpawnTrees(tx,world.id,plan.cleaning.removedTreeIndices,cells,through);
  await flatten(tx,world.id,villageId,cells,plan.cleaning.referenceHeight);
  await tx.updateTable('villages').set({economyActivatedAt:through}).where('worldId','=',world.id).where('id','=',villageId).execute();
  const types=await tx.selectFrom('resourceTypes').select('code').execute();
  await tx.insertInto('villageResources').values(types.map(r=>({worldId:world.id,villageId,resourceCode:r.code,amount:r.code==='wood'?2000:r.code==='carrot'?50:0}))).onConflict(c=>c.columns(['worldId','villageId','resourceCode']).doUpdateSet(eb=>({amount:eb.ref('excluded.amount')}))).execute();
  await tx.insertInto('villageResourceFlows').values({worldId:world.id,villageId,resourceCode:'wood',baseRatePerHour:0,remainder:0,productionUpdatedAt:through}).execute();
  for(const element of placed)await insertElement(tx,world.id,villageId,element,through);
  await tx.insertInto('villageInfrastructure').values({worldId:world.id,villageId,plan:JSON.stringify(emptyInfrastructure())}).execute();
  await tx.insertInto('villagePopulations').values({worldId:world.id,villageId}).execute();
  await tx.insertInto('populationCohorts').values({worldId:world.id,villageId,originVillageId:villageId,memberCount:15,activity:'idle',energy:10,energyProgress:0,energyUpdatedAt:through,restingSince:null,foodUsedSinceRest:0,harvestId:null,extractionId:null}).execute();
  const row=await tx.insertInto('villageStarterInstallations').values({worldId:world.id,villageId,accountId,commandId:input.commandId,request:JSON.stringify(input),kit:JSON.stringify(STARTER_KIT),remaining:JSON.stringify(STARTER_KIT.elements.filter(e=>!elements.includes(e)).map(e=>e.key)),anchorX:input.point.x,anchorY:input.point.y,quarterTurns:input.quarterTurns,referenceHeight:plan.cleaning.referenceHeight}).returningAll().executeTakeFirstOrThrow();
  return serialize(row);
 });
}
export async function poseRemainingStarter(db:Kysely<Database>,compute:Pick<SpawnCompute,'run'>,accountId:string,slug:string,villageId:string,input:StarterPoseRequest):Promise<StarterInstallation>{
 return db.transaction().execute(async tx=>{
  await sql`set local lock_timeout='5s'`.execute(tx);
  const village=await tx.selectFrom('villages').innerJoin('worlds','worlds.id','villages.worldId').select(['villages.worldId','villages.id']).where('worlds.slug','=',slug).where('villages.id','=',villageId).where('villages.ownerAccountId','=',accountId).executeTakeFirst();
  if(!village)throw new HttpError(404,'VILLAGE_NOT_FOUND','Village introuvable.');
  const economy=await beginVillageEconomy(tx,village.worldId,villageId,undefined,[],[],true);
  const row=await tx.selectFrom('villageStarterInstallations').selectAll().where('worldId','=',village.worldId).where('villageId','=',villageId).executeTakeFirstOrThrow();
  const prior=await tx.selectFrom('starterPoseReceipts').selectAll().where('worldId','=',village.worldId).where('villageId','=',villageId).where('commandId','=',input.commandId).executeTakeFirst();
  if(prior){if(!isDeepStrictEqual(prior.request,input))fail('COMMAND_CONFLICT','Cette commande existe avec un autre projet.');return serialize(row);}
  const element=row.kit.elements.find(e=>e.key===input.elementKey);
  if(!element||!row.remaining.includes(element.key)||element.type==='town-hall')fail('STARTER_UNAVAILABLE','Cet élément n’est plus disponible dans le kit.');
  const snapshot=await spawnSnapshot(tx,slug,true);
  const plan=await compute.run({kind:'element',snapshot,input:{element:element as StarterElement,point:input.point,quarterTurns:input.quarterTurns,referenceHeight:row.referenceHeight}}) as ElementPlan;
  if(!plan.valid)fail('SPAWN_BLOCKED','Cette emprise est incompatible avec le terrain ou déjà occupée.');
  const placed=poseStarterElement(element,input.point,input.quarterTurns,false);
  const existing=await tx.selectFrom('worldCellOccupancies').innerJoin('buildings',j=>j.onRef('buildings.id','=','worldCellOccupancies.buildingId').onRef('buildings.worldId','=','worldCellOccupancies.worldId')).select(['cellX','cellY']).where('buildings.worldId','=',village.worldId).where('buildings.villageId','=',villageId).where('status','=','completed').execute();
  const delta=(a:number,b:number,size:number)=>Math.min(Math.abs(a-b),size-Math.abs(a-b));
  if(!placed.cells.every(c=>existing.some(e=>Math.max(delta(c.cellX,e.cellX,512),delta(c.cellY,e.cellY,256))<=5)))fail('OUTSIDE_BUILD_REACH','Posez cet élément à proximité du village.');
  await removeSpawnTrees(tx,village.worldId,plan.cleaning.removedTreeIndices,placed.cells,economy.through);
  await flatten(tx,village.worldId,villageId,placed.cells,row.referenceHeight);
  const buildingId=await insertElement(tx,village.worldId,villageId,placed,economy.through);
  const remaining=row.remaining.filter(k=>k!==element.key);
  await tx.updateTable('villageStarterInstallations').set({remaining:JSON.stringify(remaining)}).where('worldId','=',village.worldId).where('villageId','=',villageId).execute();
  await tx.insertInto('starterPoseReceipts').values({worldId:village.worldId,villageId,commandId:input.commandId,request:JSON.stringify(input),buildingId}).execute();
  return {...serialize(row),remaining};
 });
}
