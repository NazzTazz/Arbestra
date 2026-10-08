import { describe,expect,it } from 'vitest';
import { createRockSurface,rockSurfaceVertex,rockPreviewElevation,type RockSurfaceOptions } from './rock-surface';
const base:RockSurfaceOptions={x:-2,z:-2,width:4,depth:4,seed:42,elevation:(x,z)=>rockPreviewElevation(x,z,42)};
function triangles(data:ReturnType<typeof createRockSurface>){
  return Array.from({length:data.indices.length/3},(_,i)=>data.indices.slice(i*3,i*3+3)
    .flatMap(v=>[...data.positions.slice(v*3,v*3+3),...data.normals.slice(v*3,v*3+3),...data.colors.slice(v*4,v*4+4)]).join(',')).sort();
}
describe('world-coordinate organic rock',()=>{
  it('is exactly deterministic and depends on the world seed',()=>{
    expect(createRockSurface(base)).toEqual(createRockSurface(base));
    expect(createRockSurface({...base,seed:43}).positions).not.toEqual(createRockSurface(base).positions);
  });
  it('is exactly identical when assembled cell by cell, including negative coordinates',()=>{
    const whole=triangles(createRockSurface(base)),parts:string[]=[];
    for(let z=-2;z<2;z++)for(let x=-2;x<2;x++)parts.push(...triangles(createRockSurface({...base,x,z,width:1,depth:1})));
    expect(parts.sort()).toEqual(whole);
  });
  it('shares all boundary positions across two independent patches',()=>{
    const left=createRockSurface({...base,x:-1,z:0,width:1,depth:1});
    const right=createRockSurface({...base,x:0,z:0,width:1,depth:1});
    for(let iz=0;iz<=4;iz++){
      const vertex=rockSurfaceVertex(0,iz,base);
      for(const mesh of [left,right])expect(mesh.positions.some((v,i)=>i%3===0&&v===vertex[0]&&mesh.positions[i+1]===vertex[1]&&mesh.positions[i+2]===vertex[2])).toBe(true);
    }
  });
  it('has exact periodic height and matching displaced torus edges',()=>{
    const options={...base,periodX:8,periodZ:6,elevation:undefined};
    for(let i=-8;i<12;i++){
      const a=rockSurfaceVertex(0,i,options),b=rockSurfaceVertex(32,i,options);
      expect(b[0]).toBe(a[0]!+8);expect(b[1]).toBe(a[1]);expect(b[2]).toBe(a[2]);
      const c=rockSurfaceVertex(i,0,options),d=rockSurfaceVertex(i,24,options);
      expect(d[0]).toBe(c[0]);expect(d[1]).toBe(c[1]);expect(d[2]).toBe(c[2]!+6);
    }
  });
  it('has irregular angled facets without inverted triangles or horizontal caps',()=>{
    const data=createRockSurface(base);
    expect(data.normals.every(Number.isFinite)).toBe(true);
    for(let i=1;i<data.normals.length;i+=3)expect(data.normals[i]).toBeGreaterThan(0);
    const ys=data.positions.filter((_,i)=>i%3===1);
    expect(Math.max(...ys)-Math.min(...ys)).toBeGreaterThan(.5);
    expect(new Set(ys.map(y=>y.toFixed(4))).size).toBeGreaterThan(100);
    expect(data.positions.some((v,i)=>i%3===0&&Math.abs(v*4-Math.round(v*4))>.01)).toBe(true);
  });
});
