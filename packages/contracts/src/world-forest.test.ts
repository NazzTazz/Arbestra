import { describe,expect,it } from 'vitest';
import { buildExposureField } from './world-climate.js';
import { DEFAULT_GENERATOR_PARAMETERS as p } from './world-generator.js';
import { createWorldGeography,generateGeographicLandscape,sampleWorldGeography } from './world-geography.js';
import { forestDistanceSquared,forestPotential,generateWorldForest } from './world-forest.js';
const field=buildExposureField();
const flat=(x:number,y:number)=>({base:.3,elevation:.3,surface:0,depth:x<8&&y<8?.1:0,rock:0});
const g=createWorldGeography(42,64,64,{...p,waterPercent:0});
describe('continuous forest colonisation',()=>{
 it('persists deterministic populations independently of cell/chunk traversal',()=>{
  const a=generateWorldForest(g,field,flat),b=generateWorldForest(JSON.parse(JSON.stringify(g)) as typeof g,field,flat);
  expect(a).toEqual(b);expect(a.forest.trees.length).toBeGreaterThan(100);
  const {trees}=a.forest;expect(trees.every(t=>t.x>=0&&t.x<64&&t.y>=0&&t.y<64&&flat(t.x,t.y).depth===0)).toBe(true);
  expect(new Set(trees.map(t=>Math.floor(t.y)*64+Math.floor(t.x))).size).toBeLessThan(trees.length);
  expect(Math.max(...trees.map(t=>t.size))-Math.min(...trees.map(t=>t.size))).toBeGreaterThan(.5);
  const chunks=(order:number[])=>order.flatMap(i=>trees.filter(t=>Math.floor(t.x/32)+2*Math.floor(t.y/32)===i)).sort((a,b)=>a.x-b.x||a.y-b.y);
  expect(chunks([3,0,2,1])).toEqual(chunks([0,1,2,3]));
 });
 it('forms contiguous habitat instead of an independent cell lottery, with bounded coverage',()=>{
  const {forest,woodland}=generateWorldForest(g,field,flat);
  expect(forest.coverage).toBeCloseTo(30,0);
  let adjacent=0,wooded=0;for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(woodland[y*64+x]){wooded++;adjacent+=woodland[y*64+(x+1)%64]!;}
  expect(adjacent/wooded).toBeGreaterThan(.75);
  for(const t of forest.trees)expect(forestPotential(g,field,t.x,t.y)).toBeGreaterThanOrEqual(forest.threshold);
 });
 it('competes across periodic seams with the physical torus metric',()=>{
  const trees=generateWorldForest(g,field,flat).forest.trees;
  let minimum=Infinity;
  for(let i=0;i<trees.length;i++)for(let j=0;j<i;j++){
   const a=trees[i]!,b=trees[j]!,radius=.28*(a.size*a.crown+b.size*b.crown);
   minimum=Math.min(minimum,forestDistanceSquared(a.x,a.y,b.x,b.y,64,64)/(radius*radius));
  }
  expect(minimum).toBeGreaterThanOrEqual(1-1e-10);
  expect(forestDistanceSquared(.1,0,63.9,0,64,64)).toBeCloseTo((.2*1.4)**2,10);
  expect(forestDistanceSquared(10,.1,10,63.9,64,64)).toBeCloseTo(.04,10);
  expect(forestDistanceSquared(0,32,1,32,64,64)).toBeCloseTo(3.4**2,10);
  expect(forestPotential(g,field,-.01,64.3)).toBeCloseTo(forestPotential(g,field,63.99,.3),10);
 });
 it('handles no forest, ocean and excessive slopes without filling them to meet a quota',()=>{
  expect(generateWorldForest({...g,parameters:{...p,treePercent:0}},field,flat).forest.trees).toEqual([]);
  expect(generateWorldForest(g,field,()=>({...flat(20,20),depth:1})).forest.trees).toEqual([]);
  expect(generateWorldForest(g,field,(x,y)=>({...flat(x,y),elevation:x*10})).forest.trees).toEqual([]);
 });
 it('versions new forests while preserving r6 geography and never grants gameplay permissions',()=>{
  const old=generateGeographicLandscape(7,64,64,p,6),next=generateGeographicLandscape(7,64,64,p,7);
  expect(old.forest).toBeUndefined();expect(next.forest?.version).toBe(1);expect(next.geography).toEqual(old.geography);
  expect(next.elevations).toEqual(old.elevations);expect(next.walkable.every(v=>v===0)).toBe(true);
  for(const t of next.forest!.trees){const s=sampleWorldGeography(next.geography!,t.x,t.y);expect(s.depth).toBe(0);expect(s.elevation).toBe(t.elevation);}
 });
});
