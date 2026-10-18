import {sql,type Kysely,type Transaction} from 'kysely';
import {convertTerraces,footprintVertices,vertexCells,vertexKey,terrainHeightPrecision,editedRc1Field,infrastructurePlanSurface,spawnSurfacesOverlap,buildingAccesses,canWalkSpawnSegment,type BuildingAccessState} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {HttpError} from '../../errors.js';
import {readRc1Ground} from './rc1-ground.js';
import {readRc1Source} from './rc1-source.js';
import {spawnSpatialState} from '../onboarding/spawn-state.js';
import {rc1NetworkGround} from '../navigation/rc1-network-ground.js';

/** Conservative command boundary shared by initial installation and subsequent starter poses. */
export async function flattenVertexTerrain(tx:Transaction<Database>,worldId:string,cells:readonly {cellX:number;cellY:number}[],height:number){
 const world=await tx.selectFrom('worlds').select(['terrainModel','widthCells','heightCells']).where('id','=',worldId).executeTakeFirstOrThrow();
 if(world.terrainModel!=='vertices')return false;
 const ground=await readRc1Ground(tx,worldId),vertices=footprintVertices(cells,world).map(p=>({...p,height:terrainHeightPrecision(height)}));
 const changed=vertices.filter(p=>Math.abs(ground.field.geometry!.height(p.vertexX,p.vertexY)-p.height)>1e-6);
 const affected=vertexCells(changed,world),keys=new Set(affected.map(c=>`${c.cellX}:${c.cellY}`));
 const protection=await spawnSpatialState(tx,worldId);
 if(affected.some(c=>protection.protectedSurfaces.some(p=>spawnSurfacesOverlap({x:c.cellX,y:c.cellY,halfWidth:.5,halfHeight:.5},p,world.widthCells,world.heightCells))))
  throw new HttpError(409,'SPAWN_BLOCKED','Le raccord toucherait une emprise ou un passage protégé.');
 const occupied=await tx.selectFrom('worldCellOccupancies').select(['cellX','cellY']).where('worldId','=',worldId).execute();
 if(occupied.some(c=>keys.has(`${c.cellX}:${c.cellY}`)))throw new HttpError(409,'SPAWN_BLOCKED','Le raccord du terrain toucherait une emprise occupée.');
 const plans=await tx.selectFrom('villageInfrastructure').select('plan').where('worldId','=',worldId).execute();
 for(const {plan} of plans)for(const p of infrastructurePlanSurface(plan,world).values()){
  const x=(Math.floor(p.x/16+.5)+world.widthCells)%world.widthCells,y=(Math.floor(p.y/16+.5)+world.heightCells)%world.heightCells;
  if(keys.has(`${x}:${y}`))throw new HttpError(409,'SPAWN_BLOCKED','Le raccord du terrain toucherait un accès aménagé.');
 }
 const source=await readRc1Source(tx,worldId),changedKeys=new Set(vertices.map(vertexKey));
 const future=editedRc1Field(source.data,source.field,[],[],[...(ground.navigationEdits.vertices??[]).filter(p=>!changedKeys.has(vertexKey(p))),...vertices]);
 for(const c of affected){
  const surface={x:c.cellX,y:c.cellY,halfWidth:.5,halfHeight:.5};
  if(future.surfaceReason(surface,null,.125))throw new HttpError(409,'SPAWN_BLOCKED','Le raccord rencontre de l’eau ou un rocher.');
 }
 if(vertices.length)await tx.insertInto('worldTerrainVertices').values(vertices.map(v=>({...v,worldId})))
  .onConflict(c=>c.columns(['worldId','vertexX','vertexY']).doUpdateSet(e=>({height:e.ref('excluded.height')}))).execute();
 return true;
}

/** Read-only audit: incompatible platforms are reported, never averaged. */
export async function auditTerrainVertices(db:Kysely<Database>,worldId:string){
 const source=await readRc1Source(db,worldId),ground=await readRc1Ground(db,worldId);
 const result=convertTerraces(ground.terraces,source.world),issues:string[]=[];
 if(result.conflicts.length)issues.push(`${result.conflicts.length} sommets contraints à plusieurs hauteurs`);
 const future=editedRc1Field(source.data,source.field,[],[],result.vertices);
 const foundations=await db.selectFrom('worldCellOccupancies').select(['cellX','cellY']).where('worldId','=',worldId).where('buildingId','is not',null).execute();
 for(const c of foundations){
  if([-0.5,0,.5].some(dx=>[-.5,0,.5].some(dy=>Math.abs(ground.field.sample(c.cellX+dx,c.cellY+dy).elevation-future.sample(c.cellX+dx,c.cellY+dy).elevation)>1e-6)))
   issues.push(`Fondation modifiée en ${c.cellX},${c.cellY}`);
  if(future.surfaceReason({x:c.cellX,y:c.cellY,halfWidth:.5,halfHeight:.5},null,.125)==='water')issues.push(`Fondation inondée en ${c.cellX},${c.cellY}`);
 }
 const buildings=await db.selectFrom('worldCellOccupancies as o').innerJoin('buildings as b',j=>j.onRef('b.worldId','=','o.worldId').onRef('b.id','=','o.buildingId'))
  .select(['o.cellX','o.cellY','o.role','b.id','b.buildingType','b.visualLayout','b.quarterTurns']).where('o.worldId','=',worldId).execute();
 const state:BuildingAccessState={world:source.world,cells:buildings.map(b=>({...b,footprint:{buildingId:b.id},building:b.role==='anchor'?{id:b.id,type:b.buildingType,visualLayout:b.visualLayout,quarterTurns:b.quarterTurns}:null}))};
 const futureNavigation=rc1NetworkGround(source.data,source.field,{...ground.navigationEdits,vertices:result.vertices},future);
 for(const id of new Set(buildings.map(b=>b.id)))for(const access of buildingAccesses(state,id)){
  const a={x:access.position.cellX,y:access.position.cellY},b={x:access.outside.cellX,y:access.outside.cellY};
  if(canWalkSpawnSegment(ground.navigation,a,b)&&!canWalkSpawnSegment(futureNavigation,a,b))issues.push(`Accès impraticable : ${id}/${access.id}`);
 }
 const plans=await db.selectFrom('villageInfrastructure').select('plan').where('worldId','=',worldId).execute();
 for(const {plan} of plans)for(const p of infrastructurePlanSurface(plan,source.world).values()){
  const after=future.sample(p.x/16,p.y/16);
  if(Math.abs(ground.field.sample(p.x/16,p.y/16).elevation-after.elevation)>1e-6||after.elevation<=Math.max(0,after.surface)+1e-6){issues.push('Relief d’un accès aménagé modifié');break;}
 }
 // Persisted contracts must finish under the model which quoted them.
 for(const table of ['levelingJobs','tradeDeliveries','gardenHarvests','depositExtractions','scienceActivities'] as const){
  const active=await db.selectFrom(table).select('id').where('worldId','=',worldId).where('completedAt','is',null).limit(1).executeTakeFirst();
  if(active)issues.push(`Activité en cours : ${table}`);
 }
 if(await db.selectFrom('exploitationOrders').select('id').where('worldId','=',worldId).where('gardenStatus','in',['pending','active']).limit(1).executeTakeFirst())issues.push('Tournée de jardins engagée');
 return {...result,issues,model:source.world.terrainModel};
}

/** Operator-only activation, all village locks precede the shared spatial lock. */
export async function activateTerrainVertices(db:Kysely<Database>,worldId:string){
 return db.transaction().execute(async tx=>{
  await tx.selectFrom('villages').select('id').where('worldId','=',worldId).orderBy('id').forUpdate().execute();
  await sql`select pg_advisory_xact_lock(hashtextextended(${'infrastructure:'+worldId},0))`.execute(tx);
  await tx.selectFrom('worlds').select('id').where('id','=',worldId).forNoKeyUpdate().executeTakeFirstOrThrow();
  const audit=await auditTerrainVertices(tx,worldId);
  if(audit.model==='vertices')return audit;
  if(audit.issues.length)throw new HttpError(409,'TERRAIN_CONVERSION_BLOCKED',audit.issues.join('; '));
  if(audit.vertices.length)await tx.insertInto('worldTerrainVertices').values(audit.vertices.map(v=>({...v,worldId}))).execute();
  await tx.updateTable('worlds').set({terrainModel:'vertices'}).where('id','=',worldId).execute();
  return audit;
 });
}
