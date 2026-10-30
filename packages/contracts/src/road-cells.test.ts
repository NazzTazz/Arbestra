import { describe, expect, it } from 'vitest';
import { emptyInfrastructure, infrastructurePlanSurface } from './infrastructure.js';
import { roadCellStoneCost } from './road-cells.js';
import { buildTravelNetwork, type TravelRoute } from './travel-paths.js';
import type { VillageState } from './villages.js';

const world = { id: 'w', widthCells: 64, heightCells: 64 };
const cell = (cellX: number, cellY: number, surface: 'earth' | 'stone-1' = 'earth') => ({
  cellX,
  cellY,
  surface,
  sidewalks: false,
});
const state = (roadCells?: ReturnType<typeof cell>[]) =>
  ({
    world,
    village: { anchorCellX: 10, anchorCellY: 10 },
    region: {
      originCellX: 0,
      originCellY: 0,
      width: 64,
      height: 64,
      terrainCodes: Array(4096).fill(1),
      features: [{ id: 'rock', type: 'stone_outcrop', cellX: 17, cellY: 17, deposit: { state: 'available' } }],
    },
    cells: [
      {
        cellX: 10,
        cellY: 10,
        footprint: { buildingId: 'hall', state: 'active' },
        building: { id: 'hall', type: 'town-hall', quarterTurns: 0 },
      },
    ],
    travelRoutes: [],
    infrastructure: { ...emptyInfrastructure(), ...(roadCells ? { roadCells } : {}) },
  }) as unknown as VillageState;

describe('road cell barème (validated 30 October: no refund)', () => {
  it('charges a new road, pays only the difference of a dearer style and refunds nothing', () => {
    expect(roadCellStoneCost(null, { surface: 'earth', sidewalks: false })).toBe(0);
    expect(roadCellStoneCost(null, { surface: 'rubble', sidewalks: true })).toBe(2);
    expect(roadCellStoneCost(null, { surface: 'stone-1', sidewalks: false })).toBe(4);
    expect(roadCellStoneCost(null, { surface: 'stone-2', sidewalks: true })).toBe(6);
    expect(roadCellStoneCost({ surface: 'earth', sidewalks: false }, { surface: 'stone-1', sidewalks: true })).toBe(6);
    expect(roadCellStoneCost({ surface: 'stone-1', sidewalks: false }, { surface: 'stone-2', sidewalks: false })).toBe(
      0,
    );
    expect(roadCellStoneCost({ surface: 'stone-1', sidewalks: true }, { surface: 'earth', sidewalks: false })).toBe(0);
    expect(roadCellStoneCost({ surface: 'stone-1', sidewalks: false }, { surface: 'earth', sidewalks: true })).toBe(0);
  });
});

describe('road cells in navigation', () => {
  it('rasterizes a centred chemin: centre square and arms towards neighbouring road cells only', () => {
    const surface = infrastructurePlanSurface(
      { ...emptyInfrastructure(), roadCells: [cell(5, 5), cell(6, 5), cell(20, 20)] },
      world,
    );
    const manual = (x: number, y: number) => surface.get(`${x}:${y}`)?.manual === true;
    // Centre square of (5,5): pixels [76, 84) on both axes (1/16 of a cell).
    expect(manual(80, 80) && manual(76, 76) && manual(83, 83)).toBe(true);
    // Arm east joins (6,5) without a gap; no arm west, north or south.
    for (let x = 76; x < 100; x++) expect(manual(x, 80)).toBe(true);
    expect(manual(75, 80) || manual(80, 75) || manual(80, 84)).toBe(false);
    // Isolated cell: only its centre square, half a cell wide.
    expect([...surface.values()].filter((p) => Math.abs(p.x - 320) <= 8 && Math.abs(p.y - 320) <= 8).length).toBe(64);
    // The style travels with the pixels.
    expect(surface.get('80:80')).toMatchObject({ material: 'earth', border: false, manual: true });
  });

  it('prefers a line of road cells as it prefers a manual road (×0.7 in the fine search)', () => {
    // A wall (y = 15, x = 4..16) forces a detour longer than the coarse
    // allowance: the fine search decides, where roads cost 0.7 a step.
    // Without roads the route turns right (x = 17); a road on the left (x = 3)
    // of the same length draws it there.
    const wall = Array.from({ length: 13 }, (_, i) => ({
      cellX: 4 + i,
      cellY: 15,
      footprint: { buildingId: 'wall', buildingType: 'dwelling', state: 'active' },
      building: null,
    }));
    const scene = (roadCells?: ReturnType<typeof cell>[]) => {
      const s = state(roadCells) as unknown as { cells: unknown[]; region: { features: unknown[] } };
      s.cells.push(...wall);
      s.region.features = [
        { id: 'rock', type: 'stone_outcrop', cellX: 10, cellY: 20, deposit: { state: 'available' } },
      ];
      return s as unknown as VillageState;
    };
    const side = (x: number) => {
      const d = Math.sign(x - 10),
        n = Math.abs(x - 10);
      return [
        ...Array.from({ length: n }, (_, i) => cell(10 + d * (i + 1), 11)),
        ...Array.from({ length: 9 }, (_, i) => cell(x, 12 + i)),
        ...Array.from({ length: n - 1 }, (_, i) => cell(x - d * (i + 1), 20)),
      ];
    };
    const rock = (s: VillageState) => buildTravelNetwork(s).find((r) => r.id === 'rock')!;
    const onRoad = (route: TravelRoute, roads: ReturnType<typeof cell>[]) => {
      const keys = new Set(roads.map((c) => `${c.cellX}:${c.cellY}`));
      return (
        route.cells.filter((p) => keys.has(`${Math.round(p.cellX)}:${Math.round(p.cellY)}`)).length / route.cells.length
      );
    };
    const plain = rock(scene());
    expect(plain.cells.some((p) => p.cellX >= 16)).toBe(true);
    expect(plain.cells.some((p) => p.cellX <= 4)).toBe(false);
    const left = side(3),
      paved = rock(scene(left));
    expect(paved.cells.some((p) => p.cellX <= 4)).toBe(true);
    expect(paved.cells.some((p) => p.cellX >= 16)).toBe(false);
    expect(onRoad(paved, left)).toBeGreaterThan(0.9);
    // A road on the default side keeps the route there.
    expect(rock(scene(side(17))).cells.every((p) => p.cellX >= 9.9)).toBe(true);
  });
});
