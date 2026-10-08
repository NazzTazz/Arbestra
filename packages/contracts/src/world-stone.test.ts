import {expect,it} from 'vitest';
import {generateGeographicLandscape,createWorldGeography,sampleWorldGeography,DEFAULT_GEOGRAPHY_PARAMETERS as p} from './world-geography.js';
import {generateWorldStoneSites} from './world-stone.js';
import {forestDistanceSquared} from './world-forest.js';
it('persists deterministic dry stone clusters at both low and high altitudes without economic stocks',()=>{
 const d=generateGeographicLandscape(42,128,64,p,8),g=d.geography!;
 const sites=generateWorldStoneSites(JSON.parse(JSON.stringify(g)) as typeof g,(x,y)=>sampleWorldGeography(g,x,y));
 expect(sites).toEqual(d.stoneSites);expect(sites.length).toBeGreaterThan(5);
 expect(sites.flatMap(s=>s.rocks).some(r=>r.elevation<.5)).toBe(true);
 for(const site of sites){
  expect(site.rocks.length).toBeGreaterThanOrEqual(3);
  for(const r of site.rocks){expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x).toBeLessThan(g.width);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.y).toBeLessThan(g.height);expect(sampleWorldGeography(g,r.x,r.y).depth).toBe(0);expect(r.width).not.toBe(r.depth);}
  for(const t of d.forest!.trees)expect(forestDistanceSquared(site.x,site.y,t.x,t.y,g.width,g.height)).toBeGreaterThanOrEqual(30);
  expect(site).not.toHaveProperty('remainingAmount');
 }
 expect(d.walkable.every(v=>v===0)).toBe(true);
 const sea=createWorldGeography(42,64,64,{...p,waterPercent:100},8);
 expect(generateWorldStoneSites(sea,(x,y)=>sampleWorldGeography(sea,x,y))).toEqual([]);
});
