import {parentPort} from 'node:worker_threads';
import {canWalkSpawnSegment,createSpawnTerrainField,editedRc1Field,woodlandTrees,woodlandPassage,infrastructurePlanSurface,
 planRoute,routeLength,spawnDelta,buildTravelNetwork,type TravelGround,type RouteField,type GeneratedLandscape,type WoodlandTree,type RouteQuery} from '@arbestra/contracts';
import {artifactChecksum} from '../world-generator/artifact.js';
import type {NavigationData} from './context.js';
import type {NetworkJob} from './network-job.js';
import {rc1NetworkGround} from './rc1-network-ground.js';
const sources=new Map<string,{data:GeneratedLandscape;field:ReturnType<typeof createSpawnTerrainField>}>();
const networkGrounds=new Map<string,TravelGround>();
function sourceFor(sourceId:string,artifact:string|undefined,width:number,height:number,stage:(name:string)=>void){
 let source=sources.get(sourceId);
 if(!source){
  if(!artifact)throw Error('Source indisponible');if(Buffer.byteLength(artifact)>256*1024*1024)throw Error('Source trop grande');
  stage('parse');const data=JSON.parse(artifact) as GeneratedLandscape;
  stage('checksum');if(!sourceId.startsWith(artifactChecksum(data)+':'+data.seed+':')||data.width!==width||data.height!==height)throw Error('Source invalide');
  stage('field');source={data,field:createSpawnTerrainField(data)};sources.set(sourceId,source);
  while(sources.size>2)sources.delete(sources.keys().next().value!);
 }
 if(source.data.width!==width||source.data.height!==height)throw Error('Dimensions invalides');
 return source;
}
type NavigationField=RouteField&{forGoals?:(goals:RouteQuery['goals'])=>RouteField};
const contexts=new Map<string,NavigationField>();
const routes=new Map<string,Extract<ReturnType<typeof planRoute>,{kind:'found'}>>();
function build(data:NavigationData,stage:(name:string)=>void):NavigationField{
 const world={widthCells:data.width,heightCells:data.height},wrap=(x:number,n:number)=>(x%n+n)%n;
 let terrain:(x:number,y:number)=>{elevation:number;dry:boolean;blocked:boolean};
 if(data.legacy){
  const chunks=new Map(data.legacy.chunks.map(c=>[c.chunkX+':'+c.chunkY,c])),size=data.legacy.chunkSize;
  terrain=(x,y)=>{const cx=wrap(Math.floor(x+.5),data.width),cy=wrap(Math.floor(y+.5),data.height),c=chunks.get(Math.floor(cx/size)+':'+Math.floor(cy/size)),i=cy%size*size+cx%size;
   if(!c||typeof c.terrainCodes[i]!=='number')throw Error('Terrain incomplet');return{elevation:1,dry:c.terrainCodes[i]!==2,blocked:false};};
 }else{
  const source=sourceFor(data.sourceId,data.artifact,data.width,data.height,stage);
  const absent=new Set(data.treeEdits.flatMap(e=>e.removed));
  const trees:WoodlandTree[]=(source.data.forest?.trees??[]).flatMap((t,i)=>absent.has(i)?[]:[{x:t.x,y:t.y,scale:t.crown*t.size,heightScale:t.size,rotation:0}]);
  for(const e of data.treeEdits)if(e.grove)trees.push(...woodlandTrees({cellX:e.cellX,cellY:e.cellY,variantSeed:e.variantSeed,rc1:{trees:[],rocks:[]},deposit:{remainingAmount:e.initialAmount,initialAmount:e.initialAmount,cleared:false}}));
  const field=editedRc1Field(source.data,source.field,data.terraces,[...absent]),trunks=woodlandPassage(trees,world);
  terrain=(x,y)=>{const s=field.sample(x,y);return{elevation:s.elevation,dry:s.elevation>Math.max(0,s.surface)+1e-6,blocked:field.intersectsRock({x,y,halfWidth:0,halfHeight:0})||trunks.blocked(x,y)};};
 }
 const occupancy=new Map(data.occupancies.map(c=>[c.cellX+':'+c.cellY,c.buildingId]));
 const equipment=data.plans.flatMap(p=>p.equipment),surface=new Map(data.plans.flatMap(p=>[...infrastructurePlanSurface(p,world)]));
 const sampleCache=new Map<string,{elevation:number;dry:boolean;blocked:boolean}>();
 const sample=(x:number,y:number,exempt?:string,goals?:ReadonlySet<string>)=>{
  const cx=wrap(Math.floor(x+.5),data.width),cy=wrap(Math.floor(y+.5),data.height),owner=occupancy.get(cx+':'+cy);
  const s=terrain(x,y);
  return{...s,blocked:s.blocked||Boolean(owner&&owner!==exempt&&!goals?.has(cx+':'+cy))||equipment.some(e=>Math.abs(spawnDelta(e.x/8,x,data.width))<.125&&Math.abs(spawnDelta(e.y/8,y,data.height))<.125)};
 };
 const field:NavigationField={worldId:data.worldId,contextId:data.contextId,traversalConstraintsId:data.traversalConstraintsId,width:data.width,height:data.height,accesses:data.accesses,minimumCost:[...surface.values()].some(p=>p.manual)?.7:1,
  sample(x,y){const key=x+':'+y,cached=sampleCache.get(key);if(cached)return cached;const s=sample(x,y);if(sampleCache.size>=32768)sampleCache.clear();sampleCache.set(key,s);return s;},
  connector(access){const actual=data.accesses.find(a=>a.id===access.id);if(!actual)return false;const f={width:data.width,height:data.height,sample:(x:number,y:number)=>sample(x,y,actual.buildingId)};
   for(let i=1;i<actual.path.length;i++)if(!canWalkSpawnSegment(f,{x:actual.path[i-1]!.cellX,y:actual.path[i-1]!.cellY},{x:actual.path[i]!.cellX,y:actual.path[i]!.cellY}))return false;return true;},
  cost(a,b){const x=wrap(Math.floor((a.cellX+spawnDelta(b.cellX,a.cellX,data.width)/2)*16),data.width*16),y=wrap(Math.floor((a.cellY+spawnDelta(b.cellY,a.cellY,data.height)/2)*16),data.height*16);
   return routeLength([a,b],{width:data.width,height:data.height})*(surface.get(x+':'+y)?.manual?.7:1);}
 };
 // Historical science allowed its occupied target cell; preserve that ground
 // policy per query. RC1 continues to require a physically certified endpoint.
 if(data.legacy)field.forGoals=goals=>{const cells=new Set(goals.flatMap(g=>g.kind==='point'?[wrap(Math.floor(g.cellX+.5),data.width)+':'+wrap(Math.floor(g.cellY+.5),data.height)]:[]));return{...field,sample:(x,y)=>sample(x,y,undefined,cells)};};
 return field;
}
parentPort!.on('message',(job:{id:string;query?:RouteQuery;data?:NavigationData;network?:NetworkJob;observation?:SharedArrayBuffer})=>{
 try{
  const began=performance.now(),stage=(name:string)=>parentPort!.postMessage({id:job.id,stage:name});stage('inputs');
  if(job.network){
   const beganSearch=performance.now(),cancel=job.observation?new Int32Array(job.observation):undefined;
   const checkpoint=()=>{if(cancel&&(Atomics.load(cancel,0)!==0||performance.now()-beganSearch>1000))throw Error('OBSERVATION_BUSY');};checkpoint();
   const {state,ground:input}=job.network;let ground:TravelGround|undefined;
   if(input){
    // Never parse/build a cold geography for a low-priority diagnostic read.
    if(cancel&&!sources.has(input.sourceId))throw Error('OBSERVATION_BUSY');
    const edits=input.edits;
    if(edits.worldId!==state.world.id||edits.width!==state.world.widthCells||edits.height!==state.world.heightCells)throw Error('Contexte réseau incohérent');
    const source=sourceFor(input.sourceId,input.artifact,edits.width,edits.height,stage);
    const key=JSON.stringify([input.sourceId,edits]);ground=networkGrounds.get(key);
    if(!ground&&cancel)throw Error('OBSERVATION_BUSY');
    if(!ground){stage('network-ground');ground=rc1NetworkGround(source.data,source.field,edits);
     if(key.length<=131072){networkGrounds.set(key,ground);while(networkGrounds.size>4)networkGrounds.delete(networkGrounds.keys().next().value!);}}
   }
   checkpoint();stage('network-search');const network=buildTravelNetwork(state,[],ground,checkpoint);
   while(sources.size>2)sources.delete(sources.keys().next().value!);
   parentPort!.postMessage({id:job.id,network,contexts:[...contexts.keys()],sources:[...sources.keys()]});return;
  }
  if(job.data){const field=build(job.data,stage);contexts.set(job.data.contextId,field);while(contexts.size>2)contexts.delete(contexts.keys().next().value!);}
  stage('search');const q=job.query!;if(!q)throw Error('Requête navigation manquante');const key=JSON.stringify([q.worldId,q.contextId,q.policyVersion,q.movementProfileId,q.traversalConstraintsId,q.starts,q.goals]);
  const base=contexts.get(q.contextId),field=base?.forGoals?.(q.goals)??base,cached=routes.get(key);
  const result=field?(cached?{...cached,visited:0}:planRoute(field,{...q,limits:{...q.limits,maxDurationMs:Math.max(0,Math.min(q.limits.maxDurationMs,5000)-(performance.now()-began))}})):{kind:'context-unavailable' as const,visited:0};
  if(result.kind==='found'){routes.set(key,result);while(routes.size>64||[...routes.values()].reduce((n,r)=>n+r.path.length,0)>65536)routes.delete(routes.keys().next().value!);}
  for(const [k,r]of routes)if(!contexts.has(r.contextId))routes.delete(k);
  while(sources.size>2)sources.delete(sources.keys().next().value!);
  parentPort!.postMessage({id:job.id,result,contexts:[...contexts.keys()],sources:[...sources.keys()]});
 }catch(error){parentPort!.postMessage({id:job.id,error:error instanceof Error?error.message:'Navigation interrompue',contexts:[...contexts.keys()],sources:[...sources.keys()]});}
});

parentPort!.postMessage({ready:true});
