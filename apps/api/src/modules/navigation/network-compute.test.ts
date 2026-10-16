import {expect,it,vi} from 'vitest';
import {Worker} from 'node:worker_threads';
import {buildTravelNetwork,ROUTE_POLICY_VERSION,type TravelNetworkState,type RouteQuery} from '@arbestra/contracts';
import {NavigationCompute} from './compute.js';
import {networkState} from './network-job.js';

const state:TravelNetworkState={world:{id:'world',widthCells:16,heightCells:16},
 village:{anchorCellX:2,anchorCellY:3,townHallBuildingId:'hall'},
 region:{originCellX:0,originCellY:0,width:16,height:16,terrainCodes:Array(256).fill(1),features:[]},
 cells:[{cellX:3,cellY:3,footprint:{buildingId:'obstacle'},building:null},
  {cellX:4,cellY:3,footprint:{buildingId:'house'},building:{id:'house',type:'dwelling',quarterTurns:0,visualLayout:null,accesses:[]}}]};
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return{promise,release};}
async function bounded<T>(work:Promise<T>){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Test barrier expired')),15000);})]);}finally{clearTimeout(timer);}}
const routeQuery:RouteQuery={worldId:'world',contextId:'legacy',policyVersion:ROUTE_POLICY_VERSION,movementProfileId:'pedestrian-v1',traversalConstraintsId:'none',
 starts:[{kind:'point',cellX:2,cellY:2}],goals:[{kind:'point',cellX:4,cellY:2}],limits:{maxNodes:1000,maxDurationMs:1000}};
const routeJob={query:routeQuery,data:{worldId:'world',contextId:'legacy',traversalConstraintsId:'none',width:16,height:16,sourceId:'legacy',
 terraces:[],treeEdits:[],occupancies:[],accesses:[],plans:[],legacy:{chunkSize:16,chunks:[{chunkX:0,chunkY:0,terrainCodes:Array(256).fill(1),elevations:Array(256).fill(1)}]}}};

it('runs the same detour in the shared worker and reuses it without leaking result mutations',async()=>{
 const compute=new NavigationCompute();
 try{
  const expected=buildTravelNetwork(state);expect(expected).toHaveLength(1);expect(expected[0]!.cells).not.toContainEqual({cellX:3,cellY:3});
  const first=await compute.network(async()=>({state}));expect(first).toEqual(expected);first[0]!.cells.length=0;
  expect(await compute.network(async()=>({state}))).toEqual(expected);
  expect((await compute.run(async()=>routeJob)).kind).toBe('found');
 }finally{await compute.close();}
});

it('bounds waiting projections before loading SQL and shares lanes with expedition calculations',async()=>{
 const compute=new NavigationCompute(1,{waiting:2,waitMs:15000,computeMs:30000}),entered=gate(),release=gate();
 const jobs:Promise<unknown>[]=[];
 try{
  await compute.start();
  const expedition=compute.run(async()=>{entered.release();await release.promise;return routeJob;});jobs.push(expedition);
  await bounded(entered.promise);
  const load=vi.fn(async()=>({state}));
  const a=compute.network(load),b=compute.network(load);jobs.push(a,b);
  await expect(compute.network(load)).rejects.toMatchObject({statusCode:503,code:'NAVIGATION_BUSY'});
  expect(load).not.toHaveBeenCalled();expect(compute.observation).toMatchObject({active:1,waiting:2});
  release.release();expect((await expedition).kind).toBe('found');
  expect(await a).toEqual(buildTravelNetwork(state));expect(await b).toEqual(buildTravelNetwork(state));
  expect(load).toHaveBeenCalledTimes(2);
 }finally{release.release();await Promise.allSettled(jobs);await compute.close();}
});

it('expires queued reads without calling their loader and allows a later retry',async()=>{
 const compute=new NavigationCompute(1,{waiting:1,waitMs:25,computeMs:30000}),entered=gate(),release=gate();
 const jobs:Promise<unknown>[]=[];
 try{
  await compute.start();
  const held=compute.network(async()=>{entered.release();await release.promise;return{state};});jobs.push(held);await bounded(entered.promise);
  const load=vi.fn(async()=>({state}));await expect(compute.network(load)).rejects.toMatchObject({code:'NAVIGATION_BUSY'});
  expect(load).not.toHaveBeenCalled();release.release();await held;
  expect(await compute.network(load)).toEqual(buildTravelNetwork(state));
 }finally{release.release();await Promise.allSettled(jobs);await compute.close();}
});

it('reports an invalid worker input without an inline fallback, then recovers',async()=>{
 const compute=new NavigationCompute();
 try{
  await expect(compute.network(async()=>({state,ground:{sourceId:'invalid',artifact:'{}',
   edits:{worldId:'other-world',width:16,height:16,terraces:[],absent:[],groves:[]}}}))).rejects.toMatchObject({statusCode:503,code:'NAVIGATION_UNAVAILABLE'});
  expect(await compute.network(async()=>({state}))).toEqual(buildTravelNetwork(state));
 }finally{await compute.close();}
});

it('terminates a non-answering worker at its deadline and reboots the shared lane',async()=>{
 const compute=new NavigationCompute(1,{waiting:2,waitMs:15000,computeMs:100});
 await compute.start();
 // Deliberately swallow the dispatch after startup. A missing reply must not
 // keep the lane occupied indefinitely or trigger a synchronous calculation.
 const post=vi.spyOn(Worker.prototype,'postMessage').mockImplementationOnce(()=>{});
 try{
  await expect(compute.network(async()=>({state}))).rejects.toMatchObject({code:'NAVIGATION_UNAVAILABLE'});
  expect(compute.observation.lastErrorAt).not.toBeNull();post.mockRestore();
  expect((await compute.run(async()=>routeJob)).kind).toBe('found');
 }finally{post.mockRestore();await compute.close();}
});

it('rejects queued work at shutdown and never starts its loader',async()=>{
 const compute=new NavigationCompute(),entered=gate(),release=gate();
 await compute.start();
 const held=compute.network(async()=>{entered.release();await release.promise;return{state};});
 const heldOutcome=Promise.allSettled([held]);await bounded(entered.promise);
 const load=vi.fn(async()=>({state})),queued=compute.network(load),outcome=Promise.allSettled([queued]);
 try{await compute.close();release.release();expect((await outcome)[0]).toMatchObject({status:'rejected'});
  expect((await heldOutcome)[0]).toMatchObject({status:'rejected'});expect(load).not.toHaveBeenCalled();
 }finally{release.release();await heldOutcome;await outcome;await compute.close();}
});

it('transfers spatial fields without economic or support data',()=>{
 const rich={...state,world:{...state.world,secret:'not-spatial'},village:{...state.village,wood:123,ownerAccountId:'private'},
  science:{programs:['private']},region:{...state.region,features:[{id:'stone',type:'stone_outcrop',cellX:1,cellY:1,
   deposit:{state:'available',blocksCell:true,cleared:false,remainingAmount:500}}]}} as unknown as TravelNetworkState;
 const projected=networkState(rich);
 expect(projected.village).toEqual(state.village);expect(projected.world).toEqual(state.world);
 expect(JSON.stringify(projected)).not.toMatch(/private|remainingAmount|wood|science|secret/);
});
