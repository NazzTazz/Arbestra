import { describe, expect, it } from 'vitest';
import type { VillageState } from '@arbestra/contracts';
import {
  DemolitionSelection,
  MAX_SWEEP_CELLS,
  demolitionIndex,
  subPointCell,
  sweptCells,
  type DemolitionIndex,
} from './demolition-selection';

const world = { widthCells: 64, heightCells: 32 };
const cell = (cellX: number, cellY: number, buildingId: string | null, buildingType = 'dwelling') => ({
  id: `${cellX}:${cellY}`,
  cellX,
  cellY,
  x: 0,
  z: 0,
  building: null,
  footprint: buildingId ? { buildingId, buildingType, role: 'anchor', state: 'active' } : null,
  canBuild: false,
});
const road = (cellX: number, cellY: number) => ({
  id: `${cellX},${cellY}`,
  cellX,
  cellY,
  surface: 'earth',
  sidewalks: false,
  gauge: 'chemin',
  revision: 1,
});
const state = {
  world,
  cells: [
    cell(1, 1, 'hall', 'town-hall'),
    cell(2, 1, 'hall', 'town-hall'),
    cell(3, 1, 'house'),
    cell(4, 1, 'garden', 'garden'),
    cell(5, 1, 'garden', 'garden'),
  ],
  // A road from 6 to 9 on row 1, (9, 0) and (10, 0) above its end: the vertices
  // (9, 1) and (10, 1) each touch three road cells, two automatic corners.
  roadCells: [road(6, 1), road(7, 1), road(8, 1), road(9, 1), road(9, 0), road(10, 0)],
  roadAnchors: [{ vertexX: 7, vertexY: 1, accessory: 'brazier', revision: 1 }],
} as unknown as VillageState;

function counted(index: DemolitionIndex) {
  const calls = { value: 0 };
  return {
    calls,
    index: {
      world: index.world,
      building: (k: string) => (calls.value++, index.building(k)),
      garden: (k: string) => (calls.value++, index.garden(k)),
      road: (k: string) => (calls.value++, index.road(k)),
      braziers: (k: string) => (calls.value++, index.braziers(k)),
    } satisfies DemolitionIndex,
  };
}

describe('demolition selection', () => {
  it('designates buildings, gardens, manual roads and braziers, never the town hall', () => {
    const selection = new DemolitionSelection(),
      added: string[] = [];
    selection.mark(
      demolitionIndex(state),
      sweptCells({ cellX: 0, cellY: 1 }, { cellX: 12, cellY: 1 }, world),
      (k, id) => added.push(`${k}:${id}`),
    );
    // Gardens by cell, other buildings by id, the town hall spared.
    expect([...selection.buildings]).toEqual(['house']);
    expect([...selection.gardenCells]).toEqual(['4:1', '5:1']);
    expect([...selection.roadCells].sort()).toEqual(['6:1', '7:1', '8:1', '9:1']);
    // The manual brazier and both automatic corners, at corners of swept cells.
    expect([...selection.braziers].sort()).toEqual(['10:1', '7:1', '9:1']);
    expect(added).toHaveLength(selection.size);
    expect(selection.mark(demolitionIndex(state), [{ cellX: 3, cellY: 1 }])).toBe(0);
  });

  it('names the command targets: buildings by id, gardens and roads by cell, braziers by vertex', () => {
    const selection = new DemolitionSelection();
    selection.mark(demolitionIndex(state), [
      { cellX: 3, cellY: 1 },
      { cellX: 4, cellY: 1 },
      { cellX: 7, cellY: 1 },
    ]);
    expect(selection.request('c')).toEqual({
      commandId: 'c',
      buildings: [{ id: 'house' }],
      gardenCells: [{ cellX: 4, cellY: 1 }],
      roadCells: [{ cellX: 7, cellY: 1 }],
      braziers: [{ vertexX: 7, vertexY: 1 }],
    });
  });

  it('covers every cell between two samples and wraps across the torus seam', () => {
    expect(sweptCells({ cellX: 62, cellY: 0 }, { cellX: 1, cellY: 0 }, world).map((c) => c.cellX)).toEqual([63, 0, 1]);
    expect(subPointCell({ x: 64 * 8 - 3, y: 3 }, world)).toEqual({ cellX: 0, cellY: 0 });
  });

  it('bounds the lookups of one pointer sample, however fast the swipe', () => {
    const { index, calls } = counted(demolitionIndex(state)),
      selection = new DemolitionSelection();
    const cells = sweptCells({ cellX: 0, cellY: 0 }, { cellX: 30, cellY: 15 }, world, 8);
    expect(cells.length).toBeLessThanOrEqual(8);
    selection.mark(index, cells);
    expect(calls.value).toBe(cells.length * 4);
    calls.value = 0;
    const far = sweptCells({ cellX: 0, cellY: 0 }, { cellX: 31, cellY: 15 }, world);
    expect(far.length).toBeLessThanOrEqual(MAX_SWEEP_CELLS);
    selection.mark(index, far);
    expect(calls.value).toBeLessThanOrEqual(MAX_SWEEP_CELLS * 4);
  });
});
