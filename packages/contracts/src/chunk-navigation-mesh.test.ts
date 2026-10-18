import {expect, it} from 'vitest';
import {ChunkNavigationCache} from './chunk-navigation-mesh.js';
import type {RouteField} from './route-planner.js';

function fixture() {
  let reads=0;
  const field:RouteField={worldId:'w',contextId:'c',width:70,height:35,traversalConstraintsId:'none',accesses:[],connector:()=>false,
    sample(x,y){reads++;return{elevation:1,dry:true,blocked:x>8.4&&x<8.6&&y<10};}};
  return{field,reads:()=>reads};
}
it('restores certified and blocked edges without sampling, including a seam and partial chunk',()=>{
  const f=fixture(),cache=new ChunkNavigationCache(f.field,16);
  const edges=[{a:{cellX:69,cellY:5},b:{cellX:0,cellY:5},valid:true},{a:{cellX:8,cellY:5},b:{cellX:9,cellY:5},valid:false}];
  for(const e of edges)expect(cache.walk(e.a,e.b)).toBe(e.valid);
  const before=f.reads(),restored=new ChunkNavigationCache(f.field,16,cache.changed());
  for(const e of edges){expect(restored.walk(e.a,e.b)).toBe(e.valid);expect(restored.walk(e.b,e.a)).toBe(e.valid);}
  expect(f.reads()).toBe(before);expect(restored.hits).toBe(4);expect(restored.changed()).toEqual([]);
});
it('keeps subcell certification and unknown edges physical',()=>{
  const f=fixture(),cache=new ChunkNavigationCache(f.field,16);
  expect(cache.walk({cellX:8,cellY:5},{cellX:8.5,cellY:5})).toBe(false);
  expect(cache.changed()).toEqual([]);
  expect(cache.walk({cellX:1,cellY:1},{cellX:2,cellY:1})).toBe(true);
  expect(cache.checks).toBe(1);expect(f.reads()).toBeGreaterThan(0);
});
