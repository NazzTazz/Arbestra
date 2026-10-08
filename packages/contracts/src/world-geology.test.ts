import {generateGeologicalStoneSites} from './world-stone.js';
import {generateLandscape} from './world-landscape.js';
import {expect,it} from 'vitest';
import {createGeologySampler,geologyMaterialAt} from './world-geology.js';
import {createWorldGeography,sampleWorldGeography,sampleWorldTopography,sampleWorldGeology,DEFAULT_GEOGRAPHY_PARAMETERS as p} from './world-geography.js';
import {forestDistanceSquared} from './world-forest.js';
const top=(z:number)=>({elevation:z,base:z,surface:0,depth:0,rock:0});
it('exposes slopes and convex breaks while preserving soil on a flat plateau at the same altitude',()=>{
 const g={width:128,height:64,seed:42};
 const flat=createGeologySampler(g,()=>top(3))(32,32);
 const slope=createGeologySampler(g,(x)=>top(3+(x-32)*.6))(32,32);
 const ridge=createGeologySampler(g,(x)=>top(3-Math.abs(x-32)*.35))(32,32);
 expect(flat.exposure).toBe(0);expect(flat.soilDepth).toBeGreaterThan(.2);
 expect(slope.exposure).toBeGreaterThan(.9);expect(ridge.exposure).toBeGreaterThan(.9);
 expect(slope.elevation).toBeLessThanOrEqual(3);expect(slope.elevation).toBeGreaterThan(2.6);
 expect(geologyMaterialAt(flat,flat.elevation+.01)).toBe('air');
 expect(geologyMaterialAt(flat,flat.elevation-.01)).toBe('soil');
 expect(geologyMaterialAt(flat,flat.bedrockElevation-.01)).toBe('bedrock');
});
it('reconstructs stratigraphy deterministically in any query order across both torus seams',()=>{
 const g=createWorldGeography(42,128,64,p,9),copy=JSON.parse(JSON.stringify(g)) as typeof g;
 const points=[[-.01,32],[0,0],[.01,63.99],[127.9,32],[31.99,32.01]];
 const forward=points.map(([x,y])=>sampleWorldGeology(g,x!,y!));
 const reverse=[...points].reverse().map(([x,y])=>sampleWorldGeology(copy,x!,y!)).reverse();
 expect(forward).toEqual(reverse);
 for(const [x,y]of points){const a=sampleWorldGeology(g,x!,y!),b=sampleWorldGeology(g,x!+128,y!-64);for(const key of Object.keys(a) as (keyof typeof a)[])expect(a[key]).toBeCloseTo(b[key],9);}
 // Smooth limits, not only equivalent wrapped coordinates.
 for(const y of [0,16,32,48])expect(Math.abs(sampleWorldGeology(g,-1e-6,y).elevation-sampleWorldGeology(g,1e-6,y).elevation)).toBeLessThan(1e-4);
 expect(g).toEqual(copy);
});
it('derives detached blocks and talus from exposed uphill formations, with no economic stock or isolated decorative sites',()=>{
 const d=generateLandscape(42,128,64,p,9),g=d.geography!;
 expect(d.stoneSites!.length).toBeGreaterThan(3);
 const copy=JSON.parse(JSON.stringify(g)) as typeof g;expect(generateGeologicalStoneSites(copy,(x,y)=>sampleWorldGeography(copy,x,y))).toEqual(d.stoneSites);
 const rocks=d.stoneSites!.flatMap(s=>s.rocks);expect(rocks.some(r=>r.kind==='block')).toBe(true);expect(rocks.some(r=>r.kind==='talus')).toBe(true);
 for(const site of d.stoneSites!){
  const source=sampleWorldGeography(g,site.x,site.y);expect(source.rock).toBeGreaterThanOrEqual(.6);expect(site.kind).toBe('formation');
  for(const r of site.rocks){expect(r.sourceX).toBe(site.x);expect(r.sourceY).toBe(site.y);expect(r.elevation).toBeLessThan(r.sourceElevation!);expect(sampleWorldGeography(g,r.x,r.y).depth).toBe(0);expect(forestDistanceSquared(r.x,r.y,site.x,site.y,g.width,g.height)).toBeLessThan(110);}
  expect(site).not.toHaveProperty('remainingAmount');
 }
 const exposed:number[]=[],covered:number[]=[];
 for(let y=0;y<64;y+=2)for(let x=0;x<128;x+=2){const a=sampleWorldGeography(g,x,y),b=sampleWorldTopography(g,x,y);expect(a.surface).toBe(b.surface);expect(a.depth>0).toBe(b.depth>0);expect(a.elevation).toBeLessThanOrEqual(b.elevation);if(a.depth===0)(a.rock>.6?exposed:covered).push(a.geology!.slope+a.geology!.ridge);}
 expect(exposed.length).toBeGreaterThan(20);expect(covered.length).toBeGreaterThan(20);
 const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;expect(mean(exposed)).toBeGreaterThan(mean(covered)*1.8);
 for(const t of d.forest!.trees)expect(sampleWorldGeography(g,t.x,t.y).rock).toBeLessThan(.45);
 expect(d.walkable.every(v=>v===0)).toBe(true);
 const legacy=createWorldGeography(42,64,64,p,8);expect(legacy.geology).toBeUndefined();expect(sampleWorldGeography(legacy,8,17)).toEqual(sampleWorldTopography(legacy,8,17));
});
