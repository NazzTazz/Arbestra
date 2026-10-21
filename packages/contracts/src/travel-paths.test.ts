import { describe, expect, it } from 'vitest';

import type { VillageState } from './villages.js';
import { buildTravelNetwork, travelDuration } from './travel-paths.js';

describe('travel network', () => {
  it('bounds the coarse search to cells that can still reach the goal within its existing detour limit', () => {
    const state = { world: { id: 'blocked-distant-goal', widthCells: 256, heightCells: 128 },
      village: { anchorCellX: 64, anchorCellY: 64 },
      region: { originCellX: 0, originCellY: 0, width: 256, height: 128, terrainCodes: Array(256 * 128).fill(1), features: [] },
      cells: [
        { cellX: 140, cellY: 64, building: { id: 'destination', type: 'dwelling' } },
        ...[[139,64],[141,64],[140,63],[140,65]].map(([cellX,cellY]) => ({ cellX, cellY,
          footprint: { buildingId: 'barrier', state: 'completed' }, building: null })),
      ] } as unknown as Parameters<typeof buildTravelNetwork>[0];
    let visits = 0;
    const routes = buildTravelNetwork(state, [], undefined, () => {
      if (++visits > 10000) throw Error('Coarse search explored paths that cannot fit the detour limit');
    });
    expect(routes).toEqual([]);
    expect(visits).toBeGreaterThan(100); // A real failed search, not an empty target or cache hit.
  });
  it('uses the RC1 sampled slope and does not reuse a route across changed terrain',()=>{
    const state={world:{id:'rc1',widthCells:9,heightCells:9},village:{anchorCellX:2,anchorCellY:4},region:{originCellX:0,originCellY:0,width:9,height:9,terrainCodes:Array(81).fill(1),features:[]},cells:[{cellX:4,cellY:4,building:{id:'house',type:'dwelling'}}]} as unknown as Pick<VillageState,'world'|'village'|'region'|'cells'>;
    const flat={width:9,height:9,revision:'flat',sample:()=>({elevation:1,dry:true,blocked:false})};expect(buildTravelNetwork(state,[],flat)).toHaveLength(1);
    const cliff={...flat,revision:'cliff',sample:(x:number)=>({elevation:x>=3?2:1,dry:true,blocked:false})};expect(buildTravelNetwork(state,[],cliff)).toEqual([]);
    const flooded={...flat,revision:'subcell-water',sample:(x:number)=>({elevation:1,dry:Math.abs(x-2.5)>.08&&Math.abs(x-8.5)>.08,blocked:false})};expect(buildTravelNetwork(state,[],flooded)).toEqual([]);
  });
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
