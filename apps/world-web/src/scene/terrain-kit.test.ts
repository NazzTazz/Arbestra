import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { createTerrainKit, terrainKitGeometry } from './terrain-kit';

describe('terrain kit',()=>{
  it('keeps the eight flat treads within 5 x 2 cells and a quarter-cell rise',()=>{
    const data=terrainKitGeometry('stairs','earth');
    const xs=data.positions.filter((_,i)=>i%3===0), ys=data.positions.filter((_,i)=>i%3===1), zs=data.positions.filter((_,i)=>i%3===2);
    expect(Math.max(...xs)-Math.min(...xs)).toBe(5);
    expect(Math.max(...zs)-Math.min(...zs)).toBe(2);
    expect(Math.max(...ys)).toBe(.25);
    const topHeights=new Set<number>();
    for(let i=0;i<data.positions.length;i+=12){
      const y=data.positions[i+1]!;
      if([4,7,10].every(offset=>data.positions[i+offset]===y)){topHeights.add(y);expect(data.normals[i+1]).toBeGreaterThan(.99);}
    }
    expect([...topHeights].sort((a,b)=>a-b)).toEqual(Array.from({length:8},(_,i)=>(i+1)/32));
    expect(data.normals.every(Number.isFinite)).toBe(true);
  });
  it('keeps corner surfaces complementary and variant boundaries identical',()=>{
    const highArea=(piece:'inner-corner'|'outer-corner')=>{
      const d=terrainKitGeometry(piece,'earth');let area=0;
      for(let i=0;i<d.positions.length;i+=12)if([1,4,7,10].every(o=>d.positions[i+o]===.25))area++;
      return area;
    };
    expect(highArea('outer-corner')).toBe(1);expect(highArea('inner-corner')).toBe(3);
  });
  it('shares sources, keeps active instances visible and releases owned resources',()=>{
    const engine=new NullEngine(),scene=new Scene(engine),kit=createTerrainKit(scene);
    const a=kit.instantiate('flat','rock'),b=kit.instantiate('flat','rock');
    expect(a.sourceMesh).toBe(b.sourceMesh);expect(a.isVisible).toBe(true);expect(a.sourceMesh.isVisible).toBe(false);
    expect(a.metadata.terrainPiece).toBe('flat');expect(scene.textures).toHaveLength(0);
    a.dispose();expect(b.isDisposed()).toBe(false);
    b.dispose();kit.dispose();
    expect(scene.meshes).toHaveLength(0);expect(scene.materials).toHaveLength(0);expect(scene.textures).toHaveLength(0);
    scene.dispose();engine.dispose();
  });
});
