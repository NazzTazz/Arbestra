import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { insideTerritory, simpleTerritory, territoriesOverlap, unwrapTerritory } from './spawn-atlas.js';
import { createSpawnTerrainInspector,planSpawnCleaning,spawnDistance } from './spawn-map.js';
import type { GeneratedLandscape } from './world-generator.js';
const square=[{x:-5,y:-5},{x:5,y:-5},{x:5,y:5},{x:-5,y:5}];
function flat(){const data=JSON.parse(readFileSync(new URL('../../../apps/world-web/public/studies/t1-alpha512-rc1.json',import.meta.url),'utf8')) as GeneratedLandscape;
  delete data.geography!.geology;data.geography!.study={id:'t1',base:.75,chains:[],hollows:[]};data.stoneSites=[];return data;}
describe('atlas territories and bounded cleaning',()=>{
  it('includes the frontier and wraps both seams without covering the middle of the map',()=>{
    const canonical=square.map(p=>({x:(p.x+512)%512,y:(p.y+256)%256})),points=unwrapTerritory(canonical,{x:0,y:0},512,256);
    expect(points).toEqual(square);for(const p of [{x:0,y:0},{x:511,y:255},{x:5,y:5}])expect(insideTerritory(p,points,512,256)).toBe(true);
    expect(insideTerritory({x:256,y:128},points,512,256)).toBe(false);
  });
  it('rejects self-intersection, zero area and repeated edges',()=>{
    expect(simpleTerritory(square)).toBe(true);expect(simpleTerritory([square[0]!,square[2]!,square[1]!,square[3]!])).toBe(false);
    expect(simpleTerritory([{x:0,y:0},{x:1,y:1},{x:2,y:2}])).toBe(false);expect(simpleTerritory([...square,square[0]!])).toBe(false);
  });
  it('detects edge crossings and nesting as well as overlap through a seam',()=>{
    expect(territoriesOverlap(square,square.map(p=>({x:p.x+512,y:p.y+256})),512,256)).toBe(true);
    expect(territoriesOverlap(square,square.map(p=>({x:p.x+10,y:p.y})),512,256)).toBe(true);
    expect(territoriesOverlap(square,square.map(p=>({x:p.x+11,y:p.y})),512,256)).toBe(false);
    expect(territoriesOverlap(square,square.map(p=>({x:p.x/2,y:p.y/2})),512,256)).toBe(true);
  });
  it('checks the current territory independently of hall distance and limits diagnostic cells to radius 8',()=>{
    const data=flat();data.geography!.study!.hollows=[{name:'lake',x:2,y:0,rx:15,ry:15,depth:1}];
    const inspect=createSpawnTerrainInspector(data),point={x:0,y:0};
    const blocked=inspect(point,[{x:0,y:0,halfWidth:.5,halfHeight:.5}],0,[],true,[],[{villageId:'v',points:square}]);
    expect(blocked.reasons).toContain('territory');expect(blocked.incompatible.length).toBeGreaterThan(0);
    expect(blocked.incompatible.every(p=>spawnDistance(p,point,512,256)<=8)).toBe(true);
    expect(inspect(point,[],0,[],false).reasons).not.toContain('territory');
  });
  it('removes only trees in rotated footprints through a seam without editing source or granting wood',()=>{
    const data=flat(),tree={elevation:.75,size:1,crown:1,shade:1};data.forest={version:1,coverage:1,threshold:1,trees:[{...tree,x:0,y:255},{...tree,x:0,y:253},{...tree,x:1,y:0}]};
    const before=JSON.stringify(data),plan=planSpawnCleaning(data,{x:0,y:0},[{x:-1,y:0,halfWidth:.5,halfHeight:.5}],1);
    expect(plan.removedTreeIndices).toEqual([0]);expect(plan.woodCredit).toBe(0);expect(plan.referenceHeight).toBe(.75);
    expect(plan.surfaces).toEqual([{x:0,y:-1,halfWidth:.5,halfHeight:.5}]);expect(JSON.stringify(data)).toBe(before);
  });
});
