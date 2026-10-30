import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { emptyInfrastructure, infrastructurePlanSurface } from './infrastructure.js';
import { roadCellStoneCost, uniqueRoadCells } from './road-cells.js';
import { buildTravelNetwork, travelDuration, type TravelRoute } from './travel-paths.js';
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

describe('road cell gestures', () => {
  it('counts a cell named twice once, in first-seen order (validated 30 October)', () => {
    const a = { cellX: 3, cellY: 4 },
      b = { cellX: 4, cellY: 3 };
    expect(uniqueRoadCells([a, b, { ...a }, b, a])).toEqual([a, b]);
    expect(uniqueRoadCells([b])).toEqual([b]);
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

// S2a (Tristan, 30 October): roads draw villagers off their desire lines. The
// coarse search counts a road edge at ROAD_STEP_COST (0.7), so a parallel road
// within the coarse detour allowance (+8 steps) draws the whole route, which
// the refinement then follows; a farther road changes nothing.
describe('roads attract routes in open terrain (S2a)', () => {
  let worlds = 0;
  const house = {
    cellX: 32,
    cellY: 20,
    footprint: { buildingId: 'house', buildingType: 'dwelling', state: 'active' },
    building: {
      id: 'house',
      type: 'dwelling',
      quarterTurns: 0,
      accesses: [{ id: 'main', x: 0, y: 0.336, dx: 0, dy: 1, width: 0.224, principal: true }],
    },
  };
  const scene = (target: 'house' | 'rock', roadCells: ReturnType<typeof cell>[] = [], refined = true) => {
    const s = {
      world: { ...world, id: `attract-${++worlds}` },
      village: { anchorCellX: 32, anchorCellY: 50, townHallBuildingId: 'hall' },
      region: {
        originCellX: 0,
        originCellY: 0,
        width: 64,
        height: 64,
        terrainCodes: Array(4096).fill(1),
        features:
          target === 'rock'
            ? [{ id: 'rock', type: 'stone_outcrop', cellX: 32, cellY: 20, deposit: { state: 'available' } }]
            : [],
      },
      cells: [
        {
          cellX: 32,
          cellY: 50,
          footprint: { buildingId: 'hall', state: 'active' },
          building: { id: 'hall', type: 'town-hall', quarterTurns: 0 },
        },
        ...(target === 'house' ? [house] : []),
      ],
      travelRoutes: [],
      infrastructure: { ...emptyInfrastructure(), roadCells },
    } as unknown as VillageState;
    if (!refined) delete (s as Partial<VillageState>).infrastructure;
    return s;
  };
  /** A column of road cells x = column, from the hall's row to the target's. */
  const column = (x: number) => Array.from({ length: 31 }, (_, i) => cell(x, 20 + i));
  const route = (s: VillageState, id: string) => buildTravelNetwork(s).find((r) => r.id === id)!;
  const onRoad = (r: TravelRoute, roads: ReturnType<typeof cell>[]) => {
    const keys = new Set(roads.map((c) => `${c.cellX}:${c.cellY}`));
    return r.cells.filter((p) => keys.has(`${Math.round(p.cellX)}:${Math.round(p.cellY)}`)).length / r.cells.length;
  };
  const widest = (r: TravelRoute) => Math.max(...r.cells.map((p) => Math.abs(p.cellX - 32)));

  it.each([
    ['house', 'house'],
    ['rock', 'rock'],
  ] as const)('a parallel road two to four cells aside draws the route to the %s', (target, id) => {
    const plain = route(scene(target), id);
    expect(widest(plain)).toBeLessThanOrEqual(1);
    for (const x of [34, 35, 36, 30, 29]) {
      const roads = column(x),
        paved = route(scene(target, roads), id);
      expect(onRoad(paved, roads), `road x=${x}`).toBeGreaterThan(0.75);
      // Durations still follow the real length (one cell per second).
      expect(travelDuration(paved.cells, world)).toBeGreaterThan(travelDuration(plain.cells, world));
    }
  });

  it.each([
    ['house', 'house'],
    ['rock', 'rock'],
  ] as const)(
    'a road five or more cells aside, beyond the detour allowance, leaves the %s route alone',
    (target, id) => {
      const plain = route(scene(target), id);
      for (const x of [37, 38, 27]) {
        const paved = route(scene(target, column(x)), id);
        expect(widest(paved), `road x=${x}`).toBeLessThanOrEqual(1);
        expect(paved.cells).toEqual(plain.cells);
      }
    },
  );
});

// Without any road, the network is exactly the one of 69bb451 (before S2a):
// hashes captured from that commit's planner on the same scene. With a dense
// road grid, the coarse search stays bounded (hot path, AGENTS.md).
describe('road attraction: parity without roads and bounded searches (S2a)', () => {
  const parityScene = (refined: boolean, id: string, roadCells: ReturnType<typeof cell>[] = []) => {
    const cells: unknown[] = [
      {
        cellX: 32,
        cellY: 32,
        footprint: { buildingId: 'hall', state: 'active' },
        building: { id: 'hall', type: 'town-hall', quarterTurns: 0 },
      },
    ];
    for (let i = 0; i < 8; i++)
      cells.push({
        cellX: 32 + Math.round(Math.cos((i * Math.PI) / 4) * 9),
        cellY: 32 + Math.round(Math.sin((i * Math.PI) / 4) * 9),
        footprint: { buildingId: 'house-' + i, buildingType: 'dwelling', state: 'active' },
        building: {
          id: 'house-' + i,
          type: 'dwelling',
          quarterTurns: i % 4,
          accesses: [{ id: 'main', x: 0, y: 0.336, dx: 0, dy: 1, width: 0.224, principal: true }],
        },
      });
    const plots: Array<{ cellX: number; cellY: number }> = [];
    for (let y = 24; y <= 26; y++) for (let x = 35; x <= 37; x++) plots.push({ cellX: x, cellY: y });
    plots.forEach((p, i) =>
      cells.push({
        ...p,
        footprint: { buildingId: 'garden', buildingType: 'garden', state: 'active' },
        building: i === 0 ? { id: 'garden', type: 'garden', quarterTurns: 0, garden: { plots } } : null,
      }),
    );
    const s = {
      world: { id, widthCells: 64, heightCells: 64 },
      village: { anchorCellX: 32, anchorCellY: 32, townHallBuildingId: 'hall' },
      region: {
        originCellX: 0,
        originCellY: 0,
        width: 64,
        height: 64,
        terrainCodes: Array(4096).fill(1),
        features: [
          { id: 'rock-near', type: 'stone_outcrop', cellX: 28, cellY: 40, deposit: { state: 'available' } },
          { id: 'rock-far', type: 'stone_outcrop', cellX: 56, cellY: 12, deposit: { state: 'available' } },
        ],
      },
      cells,
      travelRoutes: [],
      infrastructure: { ...emptyInfrastructure(), ...(roadCells.length ? { roadCells } : {}) },
    } as unknown as VillageState;
    if (!refined) delete (s as Partial<VillageState>).infrastructure;
    return s;
  };
  const hash = (routes: TravelRoute[]) =>
    createHash('sha256')
      .update(JSON.stringify(routes.map((r) => [r.id, r.kind, r.cells])))
      .digest('hex')
      .slice(0, 16);

  it('keeps every route of a network without roads identical to before S2a', () => {
    const refined = buildTravelNetwork(parityScene(true, 'parity-refined')),
      coarse = buildTravelNetwork(parityScene(false, 'parity-coarse'));
    expect([refined.length, hash(refined)]).toEqual([20, '4540272ed86a57bc']);
    expect([coarse.length, hash(coarse)]).toEqual([20, '23d56443cf752f01']);
  });

  it('bounds the visited nodes on a dense road grid', () => {
    // Road cells on every third row and column, outside footprints: every
    // route has roads within reach. Checkpoints count the visited nodes of all
    // searches (coarse and refinement). Measured (30 October): 6 416 without
    // roads (as before S2a), 22 170 on the grid, against 25 060 when the coarse
    // search ignored roads (S1): drawn routes stay in their coarse corridor.
    const occupied = new Set(
      (parityScene(true, 'grid-cells').cells as Array<{ cellX: number; cellY: number }>).map(
        (c) => c.cellX + ':' + c.cellY,
      ),
    );
    const grid: ReturnType<typeof cell>[] = [];
    for (let y = 2; y < 62; y++)
      for (let x = 2; x < 62; x++)
        if ((x % 3 === 0 || y % 3 === 0) && !occupied.has(x + ':' + y)) grid.push(cell(x, y));
    let plain = 0,
      paved = 0;
    buildTravelNetwork(parityScene(true, 'grid-plain'), [], undefined, () => plain++);
    const routes = buildTravelNetwork(parityScene(true, 'grid-paved', grid), [], undefined, () => paved++);
    expect(routes).toHaveLength(20);
    expect(plain).toBe(6416);
    expect(paved).toBeLessThanOrEqual(24_000);
  });
});
