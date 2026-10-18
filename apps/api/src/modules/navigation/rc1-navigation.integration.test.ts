import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {buildSpawnAccessNetwork,canWalkSpawnSegment,planHierarchicalRoute,ROUTE_POLICY_VERSION,spawnDelta,type GeneratedLandscape,type RouteQuery} from '@arbestra/contracts';
import {createDatabase} from '../../database/connection.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {migrateToLatest} from '../../database/migrate.js';
import {RC1_CANONICAL_CHECKSUM} from '../onboarding/spawn-compute-protocol.js';
import {readRc1Ground} from '../worlds/rc1-ground.js';
import {loadNavigationContext} from './context.js';
import {NavigationCompute} from './compute.js';
const url=testDatabaseUrl(),db=createDatabase(url),account=randomUUID(),world=randomUUID();
const artifact=JSON.parse(readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json',import.meta.url),'utf8')) as GeneratedLandscape;
const compute=new NavigationCompute();
beforeAll(async()=>{
 await migrateToLatest(url);
 await db.insertInto('accounts').values({id:account,email:account+'@routes.test',passwordHash:'fixture'}).execute();
 await db.insertInto('worlds').values({id:world,slug:'routes-'+world,name:'Private RC1 routes',topology:'torus',widthCells:512,heightCells:256,chunkSize:32,seed:artifact.seed,generationVersion:3,generationStatus:'ready',isOpen:true,generatedAt:new Date()}).execute();
 await db.insertInto('worldGenerationCandidates').values({worldId:world,commandId:randomUUID(),ownerAccountId:account,parameters:artifact.geography!.parameters,status:'ready',checksum:RC1_CANONICAL_CHECKSUM,artifact}).execute();
},60000);
afterAll(async()=>{await compute.close();await db.deleteFrom('worlds').where('id','=',world).execute();await db.deleteFrom('accounts').where('id','=',account).execute();await db.destroy();},60000);
it('reaches a distant RC1 destination and certifies every segment against current authoritative ground',async()=>{
 const ground=await readRc1Ground(db,world);
 let witness:ReturnType<typeof buildSpawnAccessNetwork>['routes'][number]|undefined,origin:{x:number;y:number}|undefined;
 for(const p of [{x:140,y:20},{x:220,y:180},{x:100,y:100},{x:300,y:100},{x:400,y:160},{x:160,y:80}]){
  if(!canWalkSpawnSegment(ground.navigation,p,p))continue;
  const network=buildSpawnAccessNetwork(ground.navigation,[[p]],60,4000);
  witness=network.routes.find(r=>Math.abs(spawnDelta(r.point.x,p.x,512))+Math.abs(spawnDelta(r.point.y,p.y,256))>34);
  if(witness){origin=p;break;}
 }
 expect(witness,'RC1 corpus must contain a known reachable distant goal').toBeDefined();
 const start=origin!,goal=witness!.point,timings:number[]=[];
 for(let i=0;i<4;i++){
  const began=performance.now();
  const result=await compute.run(async known=>{const c=await loadNavigationContext(db,world,known.sources,known.contexts);
   const query:RouteQuery={worldId:world,contextId:c.contextId,policyVersion:ROUTE_POLICY_VERSION,movementProfileId:'pedestrian-v1',traversalConstraintsId:'none',starts:[{kind:'point',cellX:start.x,cellY:start.y}],goals:[{kind:'point',cellX:goal.x,cellY:goal.y}],limits:{maxNodes:262144,maxDurationMs:5000}};
   return{query,...(c.data?{data:c.data}:{})};});
  timings.push(performance.now()-began);
  expect(result.kind).toBe('found');if(result.kind!=='found')continue;
  expect(result.path.at(-1)).toEqual({cellX:goal.x,cellY:goal.y});
  for(let j=1;j<result.path.length;j++)expect(canWalkSpawnSegment(ground.navigation,{x:result.path[j-1]!.cellX,y:result.path[j-1]!.cellY},{x:result.path[j]!.cellX,y:result.path[j]!.cellY})).toBe(true);
 }
 console.info(JSON.stringify({rc1Route:{start,goal,coldMs:timings[0],warmMs:timings.slice(1)}}));
},120000);

it('measures a hierarchical route on the authoritative RC1 substrate',async()=>{
 const ground=await readRc1Ground(db,world);
 const field={...ground.navigation,worldId:world,contextId:'benchmark',traversalConstraintsId:'none',accesses:[],connector:()=>false};
 const start={x:140,y:20};
 const network=buildSpawnAccessNetwork(ground.navigation,[[start]],60,4000);
 const witness=network.routes.find(r=>Math.abs(spawnDelta(r.point.x,start.x,512))+Math.abs(spawnDelta(r.point.y,start.y,256))>34);
 expect(witness).toBeDefined();
 const q:RouteQuery={worldId:world,contextId:'benchmark',policyVersion:ROUTE_POLICY_VERSION,movementProfileId:'pedestrian-v1',traversalConstraintsId:'none',
  starts:[{kind:'point',cellX:start.x,cellY:start.y}],goals:[{kind:'point',cellX:witness!.point.x,cellY:witness!.point.y}],coarseFirst:true,limits:{maxNodes:262144,maxDurationMs:30000}};
 const began=performance.now(),out=planHierarchicalRoute(field,q,32);
 console.info(JSON.stringify({hierarchicalRC1:{ms:performance.now()-began,kind:out.result.kind,visited:out.result.visited,...out.stats}}));
 expect(out.result.kind).toBe('found');
 if(out.result.kind==='found')for(let i=1;i<out.result.path.length;i++)expect(canWalkSpawnSegment(ground.navigation,{x:out.result.path[i-1]!.cellX,y:out.result.path[i-1]!.cellY},{x:out.result.path[i]!.cellX,y:out.result.path[i]!.cellY})).toBe(true);
},120000);
