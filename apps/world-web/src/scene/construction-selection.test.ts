import {previewCells} from './construction-selection';
import { describe, expect, it } from 'vitest';
import type { VillageState } from '@arbestra/contracts';
import { cellKey, cellsAlongSegment, previewArea, rectangleCells, stonemasonRange, type Cell } from './construction-selection';

const world: VillageState['world'] = {
  id: 'world', slug: 'test', name: 'Test', topology: 'torus', widthCells: 2048, heightCells: 1024,
  chunkSize: 32, seed: '1', generationVersion: 2,
};
const at = (cellX: number, cellY: number): Cell => ({ cellX, cellY });

describe('construction selection', () => {
  it('checks interior shared corners even when the legacy centre heights are flat',()=>{
    const range={first:at(10,10),last:at(14,15)},cells=rectangleCells(range,world,true).cells;
    const vertexHeights=Array(42).fill(.25);vertexHeights[14]=.4;
    const state={world,cells:cells.map(c=>({...c,canBuild:true})),region:{originCellX:10,originCellY:10,width:5,height:6,elevations:Array(30).fill(25),vertexHeights}} as VillageState;
    expect(previewArea(state,range,true,undefined,'university').needsLeveling).toBe(true);
    vertexHeights.fill(.25);
    expect(previewArea(state,range,true,undefined,'university').error).toBeNull();
  });
  it('requires leveling for a gently sloping university even when every cell is individually buildable', () => {
    const cells = rectangleCells({ first: at(2046, 1022), last: at(2, 3) }, world, true).cells;
    const state = { world, cells: cells.map(c => ({ ...c, canBuild: true })), region: {
      originCellX: 2046, originCellY: 1022, width: 5, height: 6,
      elevations: cells.map((_, i) => 25 + Math.floor(i / 5)),
    } } as VillageState;
    const area = previewArea(state, { first: at(2046, 1022), last: at(2, 3) }, true, undefined, 'university');
    expect(area.error).toBe('Cette emprise doit être nivelée avant de construire.');
    expect(area.needsLeveling).toBe(true);
    expect(area.obstacleCells).toEqual([]);
    state.region.elevations.fill(25);
    expect(previewArea(state, { first: at(2046, 1022), last: at(2, 3) }, true, undefined, 'university').error).toBeNull();
  });
  it('selects the small rectangle across both torus seams and bounds large selections before allocating', () => {
    const area = rectangleCells({ first: at(2047, 1023), last: at(0, 0) }, world, true);
    expect(area.count).toBe(4);
    expect(new Set(area.cells.map(cellKey))).toEqual(new Set(['2047:1023', '0:1023', '2047:0', '0:0']));
    expect(rectangleCells({ first: at(0, 0), last: at(20, 20) }, world, true)).toMatchObject({ count: 441, cells: [] });
  });

  it('keeps non-spatial buildings on the single last cell even after a drag', () => {
    expect(rectangleCells({ first: at(1, 1), last: at(4, 5) }, world, false))
      .toEqual({ cells: [at(4, 5)], count: 1, error: null });
  });

  it('fills sparse pointer segments in traversal order across a torus seam', () => {
    expect(cellsAlongSegment(at(2047, 4), at(2, 4), world)).toEqual([at(0, 4), at(1, 4), at(2, 4)]);
    expect(cellsAlongSegment(at(4, 4), at(7, 6), world)).toEqual([at(5, 4), at(5, 5), at(6, 5), at(6, 6), at(7, 6)]);
  });

  it('allows adjacency to an active extension, rejects reserved adjacency and occupied rectangles', () => {
    const state = { world, cells: [
      { ...at(0, 0), canBuild: false, footprint: { buildingId: 'garden', buildingType: 'garden', state: 'active' } },
      { ...at(1, 0), canBuild: false, footprint: { buildingId: 'garden', buildingType: 'garden', state: 'active' } },
      { ...at(2, 0), canBuild: false, footprint: { buildingId: 'garden', buildingType: 'garden', state: 'reserved' } },
      { ...at(1, 1), canBuild: true }, { ...at(2, 1), canBuild: true },
    ] } as VillageState;
    expect(previewArea(state, { first: at(1, 1), last: at(2, 1) }, true, 'garden').error).toBeNull();
    expect(previewArea(state, { first: at(2, 1), last: at(2, 1) }, true, 'garden').error).not.toBeNull();
    const tolerant = previewArea(state, { first: at(1, 1), last: at(1, 0) }, true, 'garden');
    expect(tolerant).toMatchObject({ count: 1, error: null, existingCells: [at(1, 0)], newCells: [at(1, 1)] });
    const invalid = previewArea(state, { first: at(1, 0), last: at(2, 0) }, true, 'garden');
    expect(invalid.error).not.toBeNull();
    expect(invalid.obstacleCells).toEqual([at(2, 0)]);
  });
});

it('previews the decorative workshop as four cells around its rotated anchor',()=>{
  for (let turn=0;turn<4;turn++) {
    const range=stonemasonRange({cellX:5,cellY:5},turn);
    const cells=rectangleCells(range,{widthCells:10,heightCells:10},true).cells;
    expect(cells).toHaveLength(4);
    expect(cells).toContainEqual({cellX:5,cellY:5});
  }
});

it('compound preview checks only actual surfaces and identifies the blocking cell',()=>{
 const cells=[{cellX:511,cellY:0},{cellX:0,cellY:0},{cellX:0,cellY:2}];
 expect(previewCells(cells,c=>c.cellY!==2).obstacleCells).toEqual([{cellX:0,cellY:2}]);
 expect(previewCells(cells,()=>true).error).toBeNull();
 expect(previewCells(cells,()=>true,'En attente').error).toBe('En attente');
});
