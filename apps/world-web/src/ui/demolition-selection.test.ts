import { describe, expect, it } from 'vitest';
import { emptyInfrastructure, type VillageState } from '@arbestra/contracts';
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
const state = {
  world,
  cells: [
    cell(1, 1, 'hall', 'town-hall'),
    cell(2, 1, 'hall', 'town-hall'),
    cell(3, 1, 'house'),
    cell(4, 1, 'garden', 'garden'),
    cell(5, 1, 'garden', 'garden'),
  ],
  infrastructure: {
    ...emptyInfrastructure(),
    revision: 2,
    roads: [
      {
        id: 'a',
        points: [
          { x: 48, y: 8 },
          { x: 80, y: 8 },
        ],
        width: 4,
        material: 'earth',
        border: false,
        operation: 'paint',
      },
      {
        id: 'b',
        points: [
          { x: 72, y: 8 },
          { x: 80, y: 8 },
        ],
        width: 4,
        material: 'none',
        border: false,
        operation: 'remove',
      },
    ],
    equipment: [{ id: 'brazier', x: 56, y: 8, quarterTurns: 0, version: 1 }],
  },
} as unknown as VillageState;

function counted(index: DemolitionIndex) {
  const calls = { value: 0 };
  return {
    calls,
    index: {
      world: index.world,
      building: (k: string) => (calls.value++, index.building(k)),
      road: (k: string) => (calls.value++, index.road(k)),
      equipment: (k: string) => (calls.value++, index.equipment(k)),
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
    expect([...selection.buildings].sort()).toEqual(['garden', 'house']);
    // The road spans cells 6-10; the later stroke removes cell 10 and half of cell 9.
    expect([...selection.roadCells].sort()).toEqual(['6:1', '7:1', '8:1', '9:1']);
    expect([...selection.equipment]).toEqual(['brazier']);
    expect(added).toHaveLength(selection.size);
    expect(selection.mark(demolitionIndex(state), [{ cellX: 3, cellY: 1 }])).toBe(0);
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
    expect(calls.value).toBe(cells.length * 3);
    calls.value = 0;
    const far = sweptCells({ cellX: 0, cellY: 0 }, { cellX: 31, cellY: 15 }, world);
    expect(far.length).toBeLessThanOrEqual(MAX_SWEEP_CELLS);
    selection.mark(index, far);
    expect(calls.value).toBeLessThanOrEqual(MAX_SWEEP_CELLS * 3);
  });
});
