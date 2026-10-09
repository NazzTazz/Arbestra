import {expect,it} from 'vitest';
import {createWorldOceans,oceanCenter,oceanField,inspectOceanConnections} from './world-oceans.js';
import {generateGeographicLandscape,DEFAULT_GEOGRAPHY_PARAMETERS as p,createWorldGeography,sampleWorldGeography,geographicWaterCurrent} from './world-geography.js';
it('keeps two lobes and periodic coast fields independent of sampling order',()=>{
 const o=createWorldOceans(42,4,128);
 expect(oceanCenter(o,o.phase)).toBeCloseTo(0);expect(oceanCenter(o,o.phase+.5)).toBeCloseTo(.5);
 for(const [u,v]of [[.1,.3],[0,0],[.99,.7]])expect(oceanField(o,42,u!,v!)).toBeCloseTo(oceanField(o,42,u!+1,v!-1),10);
 const g=createWorldGeography(42,128,64,p,11),copy=JSON.parse(JSON.stringify(g));
 for(const [x,y]of [[0,0],[32,32],[127.99,63.99]])expect(sampleWorldGeography(g,x!,y!)).toEqual(sampleWorldGeography(copy,x!,y!));
 expect(createWorldGeography(42,64,64,p,10).oceans).toBeUndefined();
});
it('detects a blocked marine corridor and excludes isolated land instead of granting gameplay access',()=>{
 const o=createWorldOceans(42,4,64);
 const inspect=inspectOceanConnections(64,64,o,(x,y)=>{
  const land=x>=10&&x<25&&y>=10&&y<25||x>=40&&x<55&&y>=40&&y<55;
  return {elevation:land?.5:-.01,surface:0,depth:land?0:.01};
 });
 expect(inspect.marineLoop).toBe(false);expect(inspect.landComponents).toBe(2);
 expect(inspect.mainLandCells).toBe(13*13);expect(inspect.plateaus.length).toBeGreaterThan(0);
});
it.each([42,7])('generates connected oceans and level sites on one dry land component (seed %i)',seed=>{
 const d=generateGeographicLandscape(seed,256,128,p,11),g=d.geography!,c=g.connections!;
 expect(c.marineLoop).toBe(true);expect(c.plateaus.length).toBeGreaterThanOrEqual(2);
 expect(c.mainLandCells).toBeGreaterThan(d.width*d.height*.35);
 for(const site of c.plateaus){expect(c.mainLand[Math.floor(site.y)*d.width+Math.floor(site.x)]).toBe(1);expect(site.elevation).toBeGreaterThan(c.highTide);}
 for(const river of g.rivers)for(let k=1;k<river.points.length;k++)expect(river.points[k]![2]).toBeLessThanOrEqual(river.points[k-1]![2]+1e-12);
 for(let k=0;k<16;k++){const u=k/16,flow=geographicWaterCurrent(g,u*d.width,oceanCenter(g.oceans!,u)*d.height,1);expect(flow[0]).toBeGreaterThan(0);}
 expect(d.walkable.every(v=>v===0)).toBe(true);
 expect(d.metrics.waterPercent).toBeGreaterThan(23);expect(d.metrics.waterPercent).toBeLessThan(27);
});

it('reports incompatible all-sea and all-land inspection rather than inventing connections',()=>{
 const o=createWorldOceans(1,4,64);
 const sea=inspectOceanConnections(64,64,o,()=>({elevation:-1,surface:0,depth:1}));
 expect(sea.marineLoop).toBe(true);expect(sea.mainLandCells).toBe(0);expect(sea.plateaus).toHaveLength(0);
 const land=inspectOceanConnections(64,64,o,()=>({elevation:.5,surface:0,depth:0}));
 expect(land.marineLoop).toBe(false);expect(land.mainLandCells).toBe(4096);
});
