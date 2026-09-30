import { describe, expect, it } from 'vitest';

import type { VillageState } from './villages.js';
import { buildTravelNetwork } from './travel-paths.js';

describe('travel network', () => {
  it('detours around an occupied cell using only cardinal steps', () => {
    const world = { widthCells: 7, heightCells: 7 };
    const state = {
      world,
      village: { anchorCellX: 2, anchorCellY: 3 },
      region: { originCellX: 0, originCellY: 0, width: 7, height: 7,
        terrainCodes: Array(49).fill(1), features: [] },
      cells: [
        { cellX: 3, cellY: 3, footprint: { state: 'completed' } },
        { cellX: 4, cellY: 3, building: { id: 'destination', type: 'dwelling' } },
      ],
    } as unknown as Pick<VillageState, 'world' | 'village' | 'region' | 'cells'>;
    const route = buildTravelNetwork(state).find((item) => item.id === 'destination');
    expect(route).toBeDefined();
    expect(route!.cells[0]).toEqual({ cellX: 2, cellY: 3 });
    expect(route!.cells.at(-1)).toEqual({ cellX: 4, cellY: 3 });
    expect(route!.cells).not.toContainEqual({ cellX: 3, cellY: 3 });
    expect(route!.cells.length).toBeGreaterThan(3);
    for (let i = 1; i < route!.cells.length; i++) {
      const a = route!.cells[i - 1]!, b = route!.cells[i]!;
      const dx = Math.min(Math.abs(a.cellX - b.cellX), world.widthCells - Math.abs(a.cellX - b.cellX));
      const dy = Math.min(Math.abs(a.cellY - b.cellY), world.heightCells - Math.abs(a.cellY - b.cellY));
      expect(dx + dy).toBe(1);
    }
  });
});
