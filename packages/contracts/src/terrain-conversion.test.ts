import { expect, it } from 'vitest';
import { preserveTerrainCentres } from './terrain-conversion.js';
import { vertexSurface } from './terrain-vertices.js';

const world = { widthCells: 512, heightCells: 256 };
it('preserves every building support centre and existing terrace corners without separating neighbours', () => {
  const cells = [{cellX:10,cellY:10,height:1.2},{cellX:11,cellY:11,height:1.3},{cellX:12,cellY:12,height:1.4}];
  const pinned = [{vertexX:10,vertexY:10,height:1.1},{vertexX:10,vertexY:11,height:1.1}];
  const result = preserveTerrainCentres(cells, world, pinned, () => 1);
  expect(result.conflicts).toEqual([]);
  const surface = vertexSurface(world, () => 1, result.vertices);
  for (const c of cells) expect(surface.sample(c.cellX,c.cellY)).toBeCloseTo(c.height,6);
  for (const v of pinned) expect(surface.height(v.vertexX,v.vertexY)).toBe(v.height);
  expect(surface.sample(10.5,10.5)).toBe(surface.height(11,11));
});
it('selects the least displaced solution on an unpinned component', () => {
  const result = preserveTerrainCentres([{cellX:0,cellY:0,height:1}],world,[],(x)=>x===0?0:1);
  expect(result.vertices).toEqual([{vertexX:0,vertexY:0,height:.5},{vertexX:1,vertexY:1,height:1.5}]);
});
it('preserves centres across the torus seam', () => {
  const result = preserveTerrainCentres([{cellX:511,cellY:255,height:2},{cellX:0,cellY:0,height:3}],world,[{vertexX:0,vertexY:0,height:2.5}],()=>0);
  expect(result.conflicts).toEqual([]);
  const surface = vertexSurface(world,()=>0,result.vertices);
  expect(surface.sample(-1,-1)).toBe(2); expect(surface.sample(0,0)).toBe(3);
});
it('reports incompatible fixed foundations instead of averaging them', () => {
  const result = preserveTerrainCentres([{cellX:0,cellY:0,height:2}],world,[{vertexX:0,vertexY:0,height:1},{vertexX:1,vertexY:1,height:1}],()=>1);
  expect(result.conflicts.length).toBeGreaterThan(0);
});
it('detects incompatible constraints on a closed toroidal diagonal', () => {
  const result = preserveTerrainCentres([{cellX:0,cellY:0,height:1},{cellX:1,cellY:1,height:2}],{widthCells:2,heightCells:2},[],()=>0);
  expect(result.conflicts.length).toBeGreaterThan(0);
});
