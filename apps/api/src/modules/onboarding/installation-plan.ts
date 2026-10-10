import {projectRc1Chunks,type Rc1ChunkProjection} from './rc1-chunks.js';
import {createSpawnTerrainInspector,createSpawnSurfaceIndex,buildSpawnAccessNetwork,canWalkSpawnSegment,planSpawnResources,planSpawnCleaning,spawnSurfacesAt,spawnDelta,starterElementSurfaces,type SpawnAccessRoute,type SpawnPoseRequest,type SpawnResourceSupplement,type SpawnCleaningPlan,type SpawnTerrainResult,type SpawnNaturalResource,type SpawnMap} from '@arbestra/contracts';
import {STARTER_KIT} from './starter-kit.js';
import {starterTownHallExits} from './spawn-resource-calculation.js';
import {rc1ResourceGroups,editedRc1Field,type Rc1ResourceState} from './rc1-field.js';
import type {createSpawnTerrainField} from '@arbestra/contracts';
import type {SpawnSnapshot} from './spawn-compute-protocol.js';
export interface InstallationPlan {chunks?:Rc1ChunkProjection[];terrain:SpawnTerrainResult;cleaning:SpawnCleaningPlan;supplements:SpawnResourceSupplement[];resources:Rc1ResourceState[];poorInResources:boolean;status:'planned'|'incomplete'|'terrain-blocked'}
export function planInstallation(map:SpawnMap,input:SpawnPoseRequest,spatial:SpawnSnapshot['spatial'],base:ReturnType<typeof createSpawnTerrainField>,resources?:Rc1ResourceState[],includeProjection=true):InstallationPlan{
 const actual=STARTER_KIT.elements.filter(e=>input.mode==='grouped'||e.type==='town-hall').flatMap(e=>starterElementSurfaces(e));
 const field=editedRc1Field(map.landscape,base,map.terraces??[],map.removedTreeIndices??[]);
 const terrain=createSpawnTerrainInspector(map.landscape,field)(input.point,actual,input.quarterTurns,map.villages,false,spatial.protectedSurfaces,map.territories);
 const cleaning=planSpawnCleaning(map.landscape,input.point,actual,input.quarterTurns,field);
 const resourceStates=resources??rc1ResourceGroups(map.landscape,base).map(g=>({...g,remainingAmount:g.amount,reservedAmount:0,cleared:false,removedIndices:[]}));
 const result={terrain,cleaning,resources:resourceStates,poorInResources:false};
 if(!terrain.terrainCompatible)return {...result,status:'terrain-blocked',supplements:[]};
 const reference=spawnSurfacesAt(map.surfaces,input.point,input.quarterTurns),posed=spawnSurfacesAt(actual,input.point,input.quarterTurns);
 const blocked=createSpawnSurfaceIndex([...spatial.walkBlockedSurfaces,...posed],512,256),under=createSpawnSurfaceIndex(posed,512,256),exclude=createSpawnSurfaceIndex([...reference,...spatial.protectedSurfaces],512,256);
 const samples=new Map<string,ReturnType<typeof sample>>();
 function sample(x:number,y:number):{elevation:number;dry:boolean;blocked:boolean}{const v=field.sample(x,y),s={x,y,halfWidth:0,halfHeight:0};return{elevation:under(s)?terrain.referenceHeight:v.elevation,dry:v.elevation>Math.max(0,v.surface)+1e-6,blocked:blocked(s)||field.intersectsRock(s)};}
 const walking={width:512,height:256,sample:(x:number,y:number)=>{const k=`${x}:${y}`,old=samples.get(k);if(old)return old;const v=sample(x,y);samples.set(k,v);return v;}};
 let stoneKnown=false;
 const potentialStone=resourceStates.some(g=>g.kind==='stone'&&!g.cleared&&g.remainingAmount>g.reservedAmount&&Math.hypot(spawnDelta(g.cellX,input.point.x,512),spawnDelta(g.cellY,input.point.y,256))<=40.5625);
 const evaluate=(walkRoutes:readonly SpawnAccessRoute[],complete:boolean)=>{
 const routes=new Map(walkRoutes.map(r=>[`${r.point.x}:${r.point.y}`,r]));
 const natural:SpawnNaturalResource[]=resourceStates.filter(g=>!g.sourceKey.startsWith('starter:')).map(g=>{
  const route=routes.get(`${g.cellX}:${g.cellY}`),last=route?.path.at(-2);
  const treeIds=new Set([...g.removedIndices,...cleaning.removedTreeIndices]);
  const trees=g.treeIndices.filter(i=>!treeIds.has(i)).map(i=>map.landscape.forest!.trees[i]!);
  let access=null;
  if(route&&last){const dx=spawnDelta(g.cellX,last.x,512),dy=spawnDelta(g.cellY,last.y,256),outside={x:g.cellX-Math.sign(dx)*.5625,y:g.cellY-Math.sign(dy)*.5625};
   if(canWalkSpawnSegment(walking,last,outside))access={path:[...route.path.slice(0,-1),outside]};}
  return {kind:g.kind,state:g.cleared?'depleted':'available',remainingAmount:g.remainingAmount,reservedAmount:g.reservedAmount,cleared:g.cleared,trees,access};
 });
 const candidates=walkRoutes.flatMap(route=>{
  const surface={...route.point,halfWidth:.5,halfHeight:.5},last=route.path.at(-2);
  if(!last||exclude(surface)||field.surfaceReason(surface,null,.125)||field.intersectsTree(surface))return [];
  const dx=spawnDelta(route.point.x,last.x,512),dy=spawnDelta(route.point.y,last.y,256);
  if(Math.abs(dx)+Math.abs(dy)<.5625)return [];
  return [{surface,access:{path:[...route.path.slice(0,-1),{x:route.point.x-Math.sign(dx)*.5625,y:route.point.y-Math.sign(dy)*.5625}]}}];
 });
 const plan=planSpawnResources({width:512,height:256,townHall:input.point,referenceSurfaces:reference,posedSurfaces:posed,protectedSurfaces:spatial.protectedSurfaces,naturalResources:natural,candidates,candidatesComplete:complete,maxVisited:10000});

  stoneKnown=natural.some(r=>r.kind==='stone'&&r.access&&r.remainingAmount>r.reservedAmount&&!r.cleared);return plan;
 };
 let early:ReturnType<typeof planSpawnResources>|undefined;
 const network=buildSpawnAccessNetwork(walking,starterTownHallExits(input.point,input.quarterTurns),40.5625,6000,walkRoutes=>{
  if(walkRoutes.length%512||walkRoutes.at(-1)!.length<=20)return false;
  if(potentialStone&&!walkRoutes.some(r=>resourceStates.some(g=>g.kind==='stone'&&!g.cleared&&g.remainingAmount>g.reservedAmount&&g.cellX===r.point.x&&g.cellY===r.point.y)))return false;
  const candidatePlan=evaluate(walkRoutes,false);
  if(candidatePlan.status==='planned'&&(!potentialStone||stoneKnown)){early=candidatePlan;return true;}return false;
 });
 const plan=early??evaluate(network.routes,network.complete);
 return {...result,...(!resources&&includeProjection&&plan.status==='planned'?{chunks:projectRc1Chunks(base)}:{}),poorInResources:plan.poorInResources,status:plan.status==='planned'?'planned':'incomplete',supplements:plan.supplements};
}
