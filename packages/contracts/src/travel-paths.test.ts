import { describe, expect, it } from 'vitest';

import type { VillageState } from './villages.js';
import { buildTravelNetwork, travelDuration } from './travel-paths.js';

describe('travel network', () => {
  it('counts physical length on long territorial legs and wrapped fine segments', () => {
    const world={widthCells:2048,heightCells:1024};
    expect(travelDuration([{cellX:0,cellY:5},{cellX:150,cellY:5}],world)).toBe(150_000);
    expect(travelDuration([{cellX:2047.875,cellY:5},{cellX:0.125,cellY:5}],world)).toBe(250);
    expect(travelDuration([{cellX:2047,cellY:5},{cellX:0,cellY:5}])).toBe(1000);
  });
  it('routes only requested woodlands and traverses reclaimed cells using the exact server flag', () => {
    const state = {
      world: { widthCells: 9, heightCells: 9 }, village: { anchorCellX: 2, anchorCellY: 4 },
      region: { originCellX: 0, originCellY: 0, width: 9, height: 9, terrainCodes: Array(81).fill(1),
        features: [
          { id: 'reclaimed', type: 'woodland', cellX: 3, cellY: 4, deposit: { state: 'available', blocksCell: false } },
          { id: 'target', type: 'woodland', cellX: 4, cellY: 4, deposit: { state: 'available', blocksCell: true } },
        ] }, cells: [],
    } as unknown as Pick<VillageState, 'world' | 'village' | 'region' | 'cells'>;
    expect(buildTravelNetwork(state)).toHaveLength(0);
    expect(buildTravelNetwork(state, ['target'])).toMatchObject([{ id: 'target', kind: 'wood',
      cells: [{ cellX: 2, cellY: 4 }, { cellX: 3, cellY: 4 }, { cellX: 4, cellY: 4 }] }]);
    state.region.features[0]!.deposit!.blocksCell = true;
    const detour = buildTravelNetwork(state, ['target'])[0]!;
    expect(detour.cells).not.toContainEqual({ cellX: 3, cellY: 4 });
  });
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
