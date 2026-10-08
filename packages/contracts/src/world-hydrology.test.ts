import { carveMeanderingRivers } from './world-hydrology-meanders.js';
import type { Hydrology } from './world-hydrology.js';
import { describe,it,expect } from 'vitest';
import { generateLandscape,landscapeMetrics,landscapeNeighbors } from './world-landscape.js';
import { addHydrology,basinTide,waterLevel,waterCurrent,DRY_MARGIN } from './world-hydrology.js';
import { DEFAULT_GENERATOR_PARAMETERS as defaults, type GeneratedLandscape } from './world-generator.js';

function saddle(width:number):GeneratedLandscape {
 const n=64*64,d:GeneratedLandscape={version:3,recipeRevision:2,width:64,height:64,seed:3,altitudeCellRatio:.25,
 elevations:new Array(n).fill(1),terrainCodes:new Array(n).fill(1),woodland:new Array(n).fill(0),
 exposure:new Array(n).fill(.25),humidity:new Array(n).fill(.6),walkable:new Array(n).fill(1),components:new Array(n).fill(0),stairs:[],metrics:{} as GeneratedLandscape['metrics']};
 for(let y=20;y<40;y++)for(let x=0;x<64;x++)if(x>=8&&x<16||x>=24&&x<32){const i=y*64+x;d.elevations[i]=-2;d.terrainCodes[i]=2;d.walkable[i]=0;}
 d.metrics=landscapeMetrics(d);return addHydrology(d,{...defaults,channelWidth:width,treePercent:0});
}
describe('hydrology recipes',()=>{
 it('routes curved river beds instead of straight rectangular corridors',()=>{
  const d=generateLandscape(42,256,128,defaults),h=d.hydrology!;
  let curved=0,sources=0;
  for(const source of h.reaches.filter(r=>r.kind==='lake'&&r.surface>0&&r.downstream!==null)){
   sources++;const centers:Array<[number,number]>=[];let r=h.reaches[source.downstream!]!;
   while(r.kind==='river'){
    const anchor=r.cells[0]!,wrap=(v:number,size:number)=>((v+size*1.5)%size)-size/2;
    centers.push([anchor%d.width+r.cells.reduce((v,i)=>v+wrap(i%d.width-anchor%d.width,d.width),0)/r.cells.length,
     Math.floor(anchor/d.width)+r.cells.reduce((v,i)=>v+wrap(Math.floor(i/d.width)-Math.floor(anchor/d.width),d.height),0)/r.cells.length]);
    if(r.downstream===null)break;r=h.reaches[r.downstream]!;
   }
   for(let k=1;k<centers.length;k++)for(const axis of [0,1]){
    const size=axis?d.height:d.width;centers[k]![axis]=centers[k-1]![axis]!+((centers[k]![axis]!-centers[k-1]![axis]!+size*1.5)%size)-size/2;
   }
   const range=(axis:number)=>Math.max(...centers.map(c=>c[axis]!))-Math.min(...centers.map(c=>c[axis]!));
   const first=centers[0]!,last=centers.at(-1)!,dx=last[0]-first[0],dy=last[1]-first[1];
   const deviation=Math.max(...centers.map(c=>Math.abs(dx*(c[1]-first[1])-dy*(c[0]-first[0]))/(Math.hypot(dx,dy)||1)));
   if(centers.length>=12&&Math.min(range(0),range(1))>=3&&deviation>=1.5)curved++;
  }
  expect(sources).toBeGreaterThan(0);expect(curved).toBeGreaterThanOrEqual(Math.ceil(sources/2));
 },60000);

 it('excavates broad rivers and equally broad fed waterfall fronts',()=>{
  const d=generateLandscape(42,256,128,defaults),h=d.hydrology!;
  expect(h.metrics.sources).toBeGreaterThan(0);
  expect(h.waterfalls.length).toBeGreaterThan(0);
  for(const r of h.reaches.filter(r=>r.kind==='river')){
   expect(r.width).toBeGreaterThanOrEqual(5);expect(r.width).toBeLessThanOrEqual(8);
   expect(r.cells.length).toBe(r.width);
   if(r.flowTo){
    expect(r.flowTo).toHaveLength(r.cells.length);
    for(let k=0;k<r.cells.length;k++){
     const cell=r.cells[k]!,next=r.flowTo[k]!;
     expect(landscapeNeighbors(cell,d.width,d.height)).toContain(next);
     expect(h.surface[next]).not.toBeNull();expect(h.surface[next]!).toBeLessThanOrEqual(r.surface);
     const seen=new Set<number>();let cursor=cell;
     while(h.reachByCell[cursor]===r.id){
      expect(seen.has(cursor)).toBe(false);seen.add(cursor);cursor=r.flowTo[r.cells.indexOf(cursor)]!;
     }
     expect(h.reachByCell[cursor]).toBe(r.downstream);
    }
   }

  }
  const fronts=new Set<string>();
  for(const f of h.waterfalls){
   expect(f.width).toBeGreaterThanOrEqual(5);expect(f.width).toBeLessThanOrEqual(8);
   const lanes=f.lanes!;expect(lanes).toHaveLength(f.width);
   for(let k=0;k<lanes.length;k++){
    const lane=lanes[k]!;fronts.add(lane.cell+':'+lane.nextCell);
    if(k)expect(landscapeNeighbors(lanes[k-1]!.cell,d.width,d.height)).toContain(lane.cell);
    expect(landscapeNeighbors(lane.cell,d.width,d.height)).toContain(lane.nextCell);
    expect(h.surface[lane.cell]).toBe(f.top);expect(h.surface[lane.nextCell]).toBe(f.bottom);
    expect(d.terrainCodes[lane.cell]).toBe(2);expect(d.terrainCodes[lane.nextCell]).toBe(2);
   }
  }
  let edges=0;
  for(let i=0;i<d.terrainCodes.length;i++)if(h.surface[i]!==null)for(const j of landscapeNeighbors(i,d.width,d.height))if(h.surface[j]!==null&&h.surface[i]!>h.surface[j]!){
   edges++;expect(fronts.has(i+':'+j)).toBe(true);
  }
  expect(fronts.size).toBe(edges);
 },60000);

 it('preserves r2 and generates deterministic persisted hydrology',()=>{
  const old=generateLandscape(42,64,64,defaults,2),a=generateLandscape(42,64,64,defaults);
  expect(old.recipeRevision).toBe(2);expect(old.hydrology).toBeUndefined();
  expect(a.recipeRevision).toBe(5);expect(a.hydrology).toBeDefined();
  expect(a).toEqual(generateLandscape(42,64,64,{...defaults}));
 });
 it('uses the requested channel width in its actual excavation',()=>{
  const narrow=saddle(2),wide=saddle(6);
  expect(narrow.hydrology!.channels.length).toBeGreaterThan(0);expect(wide.hydrology!.channels.length).toBeGreaterThan(0);
  expect(wide.metrics.waterPercent).toBeGreaterThan(narrow.metrics.waterPercent);
  expect(wide.hydrology!.channels.every(c=>c.width===6)).toBe(true);
  expect(wide.hydrology!.metrics.lakeBasins).toBe(0);
  expect(wide.metrics.isolatedZones).toBe(0);
 });
 it('connects water across the torus seam without a duplicate basin or a tide seam',()=>{
  const d=saddle(2);d.terrainCodes.fill(1);d.elevations.fill(1);d.walkable.fill(1);delete d.hydrology;
  for(const x of [0,63])for(let y=10;y<20;y++){d.terrainCodes[y*64+x]=2;d.elevations[y*64+x]=-1;d.walkable[y*64+x]=0;}
  addHydrology(d,{...defaults,treePercent:0});
  expect(d.hydrology!.metrics.marineBasins).toBe(1);
  for(const phase of [0,.3,2,6.283185307179586])expect(waterLevel(d,10*64,phase)).toBe(waterLevel(d,10*64+63,phase));
 });
 it.each([3,4,5])('keeps fed falls, perched lakes, dry access and acyclic descending drainage r%s',(revision)=>{
  const d=generateLandscape(42,256,128,defaults,revision),h=d.hydrology!;
  expect(h.waterfalls.length).toBeGreaterThan(0);
  if(revision===3){expect(h.metrics.falls1).toBe(10);expect(h.metrics.falls2).toBe(1);expect(h.metrics.sources).toBe(4);}
  if(revision===4){expect(h.metrics.falls1).toBe(6);expect(h.metrics.falls2).toBe(0);expect(h.metrics.riverCells).toBe(883);}
  expect(h.reaches.some(r=>r.kind==='lake'&&r.surface>0&&r.downstream!==null)).toBe(true);
  for(const r of h.reaches){
   const seen=new Set<number>();let current=r;
   while(current.downstream!==null){
    expect(seen.has(current.id)).toBe(false);seen.add(current.id);
    const next=h.reaches[current.downstream]!;expect(next.surface).toBeLessThanOrEqual(current.surface);current=next;
   }
   for(const outlet of r.outlets??[]){expect(h.reaches[outlet]!.surface).toBeLessThan(r.surface);expect(h.reaches[outlet]!.upstream).toContain(r.id);}
   for(const i of r.cells){expect(d.elevations[i]).toBeLessThan(r.surface);expect(d.walkable[i]).toBe(0);}
  }
  for(const f of h.waterfalls){
   expect(landscapeNeighbors(f.cell,d.width,d.height)).toContain(f.nextCell);
   expect([h.reaches[f.from]!.downstream,...(h.reaches[f.from]!.outlets??[])]).toContain(f.to);
   expect(f.top-f.bottom).toBe(f.drop);expect([1,2]).toContain(f.drop);
   expect(h.reachByCell[f.cell]).toBe(f.from);expect(h.reachByCell[f.nextCell]).toBe(f.to);
   for(const phase of [0,1,2,3,4,5])expect(waterLevel(d,f.cell,phase)!-waterLevel(d,f.nextCell,phase)!).toBeGreaterThan(0);
  }
  for(let i=0;i<d.walkable.length;i++)if(d.terrainCodes[i]===1){
   expect(h.highWater[i]).toBeNull();
   for(const j of landscapeNeighbors(i,d.width,d.height))if(h.highWater[j]!==null)expect(d.elevations[i]!).toBeGreaterThanOrEqual(h.highWater[j]!+DRY_MARGIN);
  }
  expect(d.metrics.isolatedZones).toBe(0);expect(d.metrics.landsWithoutAccess).toBe(0);
  expect(Math.abs(d.metrics.treePercent-defaults.treePercent)).toBeLessThan(1);
 },30000);
 it('bounds and repeats solar tide without reversing permanent river drainage',()=>{
  const d=generateLandscape(42,256,128,defaults),h=d.hydrology!,sea=h.reaches.find(r=>r.kind==='sea')!;
  const levels=Array.from({length:65},(_,i)=>basinTide(d,sea,i/64*Math.PI*2));
  expect(Math.max(...levels)).toBeLessThanOrEqual(.25);expect(Math.min(...levels)).toBeGreaterThanOrEqual(-.25);
  expect(Math.max(...levels)-Math.min(...levels)).toBeGreaterThan(.1);
  expect(levels[0]).toBeCloseTo(levels.at(-1)!,10);
  for(const r of h.reaches.filter(r=>r.kind==='river'&&r.surface>0)){
   expect(basinTide(d,r,1)).toBe(0);
   expect(waterCurrent(d,r.cells[0]!,0)).toEqual(waterCurrent(d,r.cells[0]!,3));
  }
  const frozen=[...d.walkable];for(let i=0;i<64;i++)waterLevel(d,sea.anchor,i/64*Math.PI*2);
  expect(d.walkable).toEqual(frozen);
 },30000);
 it.each([[1,64,64],[2,64,64],[1,256,128],[2,256,128],[42,512,256]])('keeps final dry access at seed %s / %s x %s',(seed,w,h)=>{
  const d=generateLandscape(seed,w,h,defaults),hydro=d.hydrology!;
  expect(d.metrics.isolatedZones).toBe(0);expect(d.metrics.landsWithoutAccess).toBe(0);
  expect(hydro.surface.length).toBe(w*h);expect(hydro.highWater.length).toBe(w*h);
  let invalid=0;
  for(let i=0;i<w*h;i++){
   if(d.walkable[i]&&hydro.highWater[i]!==null)invalid++;
   if(d.terrainCodes[i]===2&&(hydro.surface[i]===null||hydro.surface[i]!<=d.elevations[i]!))invalid++;
   if(d.terrainCodes[i]===1)for(const j of landscapeNeighbors(i,w,h))if(hydro.highWater[j]!==null&&d.elevations[i]!<hydro.highWater[j]!+DRY_MARGIN)invalid++;
  }
  expect(invalid).toBe(0);
  expect(Math.abs(d.metrics.treePercent-defaults.treePercent)).toBeLessThan(1);
 },60000);
 it('routes a broad curved river across the torus seam without a broken flow edge',()=>{
  const w=128,h=64,n=w*h,d:GeneratedLandscape={version:3,width:w,height:h,seed:42,altitudeCellRatio:.25,
   elevations:new Array(n).fill(2),terrainCodes:new Array(n).fill(1),woodland:new Array(n).fill(0),exposure:new Array(n).fill(.25),
   humidity:new Array(n).fill(.6),walkable:new Array(n).fill(1),components:new Array(n).fill(0),stairs:[],metrics:{} as GeneratedLandscape['metrics']};
  for(let y=0;y<h;y++)for(let x=16;x<32;x++){const i=y*w+x;d.elevations[i]=-1;d.terrainCodes[i]=2;d.walkable[i]=0;}
  const sea=d.terrainCodes.flatMap((t,i)=>t===2?[i]:[]),protectedCells=new Uint8Array(n);
  for(let y=0;y<h;y++)protectedCells[y*w+32]=1; // Reserve the east shore: route west across x=0.
  const hydro:Hydrology={revision:1,tideAmplitude:.25,dryMargin:.25,
   reaches:[{id:0,kind:'sea',cells:sea,surface:0,bedMin:-1,width:0,downstream:null,upstream:[],anchor:sea[0]!}],
   reachByCell:d.terrainCodes.map(t=>t===2?0:-1),surface:d.terrainCodes.map(t=>t===2?0:null),highWater:d.terrainCodes.map(t=>t===2?.25:null),
   waterfalls:[],channels:[],metrics:{waterLowPercent:0,waterHighPercent:0,marineBasins:1,lakeBasins:0,riverCells:0,sources:0,falls1:0,falls2:0,rejectedChannels:0,rejectedRivers:0}};
  d.hydrology=hydro;
  const result=carveMeanderingRivers(d,hydro,protectedCells,beds=>{
   for(const [i,z]of beds){d.elevations[i]=z;d.terrainCodes[i]=2;d.walkable[i]=0;}return true;
  });
  expect(result.sources.length).toBeGreaterThan(0);d.metrics=landscapeMetrics(d);
  let crossed=false;
  for(const r of d.hydrology!.reaches)for(let k=0;k<(r.flowTo?.length??0);k++){
   const i=r.cells[k]!,j=r.flowTo![k]!;expect(landscapeNeighbors(i,w,h)).toContain(j);
   if(i%w===0&&j%w===w-1||i%w===w-1&&j%w===0)crossed=true;
  }
  expect(crossed,JSON.stringify({metrics:d.hydrology!.metrics,sources:d.hydrology!.reaches.filter(r=>r.surface>0&&r.kind==='lake').map(r=>r.anchor)})).toBe(true);expect(d.metrics.isolatedZones).toBe(0);
 },30000);
 it('reports dry and fully flooded worlds without inventing sources or falls',()=>{
  for(const waterPercent of [0,100]){
   const d=generateLandscape(7,64,64,{...defaults,waterPercent});
   expect(d.hydrology!.waterfalls).toHaveLength(0);
   expect(d.hydrology!.metrics.sources).toBe(0);
   if(waterPercent===0)expect(d.hydrology!.reaches).toHaveLength(0);
   else expect(d.walkable.some(Boolean)).toBe(false);
  }
 });
});
