import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { describe, expect, it } from 'vitest';
import type { TerrainChunk } from '@arbestra/contracts';
import { buildTerrainUnit } from './terrain-unit';
import { WorldSpace } from './world-space';

describe('bounded terrain geometry', () => {
  it('excavates the actual ground under a road and restores it when the road is removed', () => {
    const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial('test', scene);
    try {
      const chunk: TerrainChunk = { chunkX:0,chunkY:0,originCellX:0,originCellY:0,
        terrainCodes:Array(34**2).fill(1),elevations:Array(34**2).fill(0),features:[],occupiedCells:[] };
      const space = new WorldSpace(2048,1024,{cellX:0,cellY:0});
      const cut = buildTerrainUnit(scene,chunk,0,0,space,material,material,new Map([['0:0',5]]))[0]!;
      const p = cut.getVerticesData('position')!;
      // The central quad itself is below ground, not an overlay hidden under an intact tile.
      const floors: number[] = [];
      for (let i=0;i<p.length;i+=12) {
        const xs=[p[i]!,p[i+3]!,p[i+6]!,p[i+9]!], zs=[p[i+2]!,p[i+5]!,p[i+8]!,p[i+11]!];
        if (Math.min(...xs)<0 && Math.max(...xs)>0 && Math.min(...zs)<0 && Math.max(...zs)>0) floors.push(p[i+1]!);
      }
      expect(floors).toHaveLength(1); expect(floors[0]).toBeCloseTo(-.06);
      const restored = buildTerrainUnit(scene,chunk,0,0,space,material,material)[0]!;
      expect(restored.getVerticesData('position')!.filter((_,i)=>i%3===1).every(y=>y===0)).toBe(true);
    } finally { scene.dispose(); engine.dispose(); }
  });
  it('renders only the interior and uses halo corners for shores across the torus', () => {
    const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial('test', scene);
    try {
      const chunk: TerrainChunk = { chunkX: 63, chunkY: 31, originCellX: 2016, originCellY: 992,
        terrainCodes: Array(34 ** 2).fill(1), elevations: Array(34 ** 2).fill(0), features: [], occupiedCells: [] };
      // A northern halo and a diagonal-only coastline both affect the interior.
      chunk.terrainCodes[0] = 2; chunk.terrainCodes[1] = 2;
      const space = new WorldSpace(2048, 1024, { cellX: 0, cellY: 0 });
      const withHalo = buildTerrainUnit(scene, chunk, 0, 0, space, material, material);
      const positions = withHalo[0]!.getVerticesData('position')!;
      expect(Math.min(...positions.filter((_, i) => i % 3 === 1))).toBeLessThan(-0.75);
      expect(Math.min(...positions.filter((_, i) => i % 3 === 0))).toBeGreaterThanOrEqual(-81.25);
      expect(Math.max(...positions.filter((_, i) => i % 3 === 0))).toBeLessThanOrEqual(-71.25);
      chunk.terrainCodes.fill(1);
      const flat = buildTerrainUnit(scene, chunk, 0, 0, space, material, material);
      expect(flat[0]!.getTotalVertices()).toBe(16 * 4);
      expect(withHalo[0]!.getTotalVertices()).toBeGreaterThan(flat[0]!.getTotalVertices());
      const opposite = new WorldSpace(2048, 1024, { cellX: 1000, cellY: 500 });
      const nearCut = buildTerrainUnit(scene, chunk, 28, 28, opposite, material, material)[0]!;
      const xs = nearCut.getVerticesData('position')!.filter((_, i) => i % 3 === 0);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(10);
    } finally { scene.dispose(); engine.dispose(); }
  });
});

it('lights RC1 ground from above and preserves terrace heights in the streamed scene',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),material=new StandardMaterial('test',scene);
 try{const chunk:TerrainChunk={chunkX:0,chunkY:0,originCellX:0,originCellY:0,terrainCodes:Array(34**2).fill(1),elevations:Array(34**2).fill(25),features:[],occupiedCells:[],rc1:{stride:65,heights:Array(65**2).fill(.25),water:Array(65**2).fill(-1),terraces:[]}};
 const ground=buildTerrainUnit(scene,chunk,0,0,new WorldSpace(512,256,{cellX:0,cellY:0}),material,material)[0]!;
 expect(ground.getVerticesData('normal')!.filter((_,i)=>i%3===1).every(y=>y>.99)).toBe(true);
 expect(ground.getVerticesData('position')!.filter((_,i)=>i%3===1).every(y=>Math.abs(y-.625)<1e-6)).toBe(true);
 }finally{scene.dispose();engine.dispose();}
});
