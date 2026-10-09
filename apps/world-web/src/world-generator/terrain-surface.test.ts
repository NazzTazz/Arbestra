import {expect,it} from 'vitest';
import {terrainSurfaceColor,terrainWaterColor} from './terrain-surface';
const world={width:256,height:128,seed:42};
const vertex={x:0,y:34,z:.04,surface:0,rock:0,slope:.01};
it('keeps low dry plains green, wet banks distinct, and colours continuous at water level',()=>{
 const dry=terrainSurfaceColor(world,vertex),wet=terrainSurfaceColor(world,{...vertex,z:0});
 expect(dry[1]!-dry[0]!).toBeGreaterThan(.10);expect(wet[1]!-wet[0]!).toBeLessThan(.05);
 const a=terrainSurfaceColor(world,{...vertex,z:-1e-6}),b=terrainSurfaceColor(world,{...vertex,z:1e-6});
 expect(Math.max(...a.map((v,i)=>Math.abs(v-b[i]!)))).toBeLessThan(1e-6);
});
it('uses continuous periodic rock colour, independent of tessellation and build order',()=>{
 const v={...vertex,rock:1,z:1};
 expect(terrainSurfaceColor(world,v)).toEqual(terrainSurfaceColor(world,{...v,x:256,y:162}));
 const a=terrainSurfaceColor(world,{...v,x:12}),b=terrainSurfaceColor(world,{...v,x:12.01});
 expect(Math.max(...a.map((v,i)=>Math.abs(v-b[i]!)))).toBeLessThan(.001);
});

it('distinguishes shallow water from the bed of the channel without transparency',()=>{
 const bank=terrainWaterColor(0),deep=terrainWaterColor(.6);
 expect(bank[0]).toBeGreaterThan(deep[0]!);expect(bank[2]).toBeLessThan(deep[2]!);
 expect(bank[3]).toBe(1);expect(deep[3]).toBe(1);
 for(let depth=0;depth<=1;depth+=.001){const a=terrainWaterColor(depth),b=terrainWaterColor(depth+.001);expect(Math.max(...a.map((v,i)=>Math.abs(v-b[i]!)))).toBeLessThan(.004);}
});

it('does not paint an entire dry lake terrace as a wet bank in r10',()=>{
 const color=terrainSurfaceColor({...world,circulation:{version:1}},{...vertex,z:1.035,surface:1,slope:.5});
 expect(color[1]!-color[0]!).toBeGreaterThan(.10);
});
