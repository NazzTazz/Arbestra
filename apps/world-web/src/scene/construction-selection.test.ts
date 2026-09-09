import { describe, expect, it } from 'vitest';
import type { VillageState } from '@arbestra/contracts';
import { cellKey, cellsAlongSegment, previewArea, rectangleCells, type Cell } from './construction-selection';

const world: VillageState['world'] = {
  id: 'world', slug: 'test', name: 'Test', topology: 'torus', widthCells: 2048, heightCells: 1024,
  chunkSize: 32, seed: '1', generationVersion: 2,
};
const at = (cellX: number, cellY: number): Cell => ({ cellX, cellY });

describe('construction selection', () => {
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
    expect(cellsAlongSegment(at(4, 4), at(7, 6), world)).toEqual([at(5, 5), at(6, 5), at(7, 6)]);
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
