import { describe, expect, it } from 'vitest';
import { buildingAccesses } from './building-access.js';
import { emptyInfrastructure } from './infrastructure.js';
import { canWalkSpawnSegment } from './spawn-access.js';
import { travelDuration, type TravelCell, type TravelGround, type TravelNetworkState } from './travel-paths.js';
import { planVillageLeg, planVillageRoute, searchVillagePath, villageSearchBound } from './village-search.js';

const c = (cellX: number, cellY: number): TravelCell => ({ cellX, cellY });
const add = (s: TravelNetworkState, ...cells: TravelNetworkState['cells'][number][]) => {
  s.cells = [...s.cells, ...cells];
};
const size = 64;
function village(id: string, hall = c(10, 10)): TravelNetworkState {
  return {
    world: { id, widthCells: size, heightCells: size },
    village: { anchorCellX: hall.cellX, anchorCellY: hall.cellY, townHallBuildingId: 'hall' },
    region: {
      originCellX: 0,
      originCellY: 0,
      width: size,
      height: size,
      terrainCodes: Array(size * size).fill(1),
      features: [],
    },
    cells: [
      { ...hall, footprint: { buildingId: 'hall' }, building: { id: 'hall', type: 'town-hall', quarterTurns: 0 } },
    ],
    infrastructure: emptyInfrastructure(),
  };
}
function ground(revision: string, blocked: (x: number, y: number) => boolean = () => false): TravelGround {
  return {
    width: size,
    height: size,
    revision,
    sample: (x, y) => ({ elevation: 1, dry: true, blocked: blocked(x, y) }),
  };
}
/** Row y = 10, and the ring around the hall (its door). */
const corridor = (x: number, y: number) => y === 10 || (Math.abs(x - 10) <= 1 && Math.abs(y - 10) <= 1);
const found = (outcome: ReturnType<typeof searchVillagePath>) => {
  expect(outcome.kind).toBe('found');
  return outcome.kind === 'found' ? outcome.path : [];
};
const delta = (a: number, b: number) => {
  const d = b - a;
  return d > size / 2 ? d - size : d < -size / 2 ? d + size : d;
};
function walkable(path: readonly TravelCell[], field: TravelGround) {
  for (let i = 1; i < path.length; i++)
    expect(
      canWalkSpawnSegment(
        field,
        { x: path[i - 1]!.cellX, y: path[i - 1]!.cellY },
        { x: path[i]!.cellX, y: path[i]!.cellY },
      ),
    ).toBe(true);
}

describe('village search on cells, eight directions (R1)', () => {
  it('walks in diagonal from the real door, at √2 per diagonal step', () => {
    const s = village('diagonal'),
      field = ground('diagonal'),
      path = found(searchVillagePath(s, c(20, 20), field));
    expect(path[0]).toEqual(buildingAccesses(s, 'hall')[0]!.position);
    expect(path.at(-1)).toEqual(c(20, 20));
    walkable(path, field);
    const diagonal = path.filter(
      (p, i) =>
        i && Math.abs(delta(path[i - 1]!.cellX, p.cellX)) === 1 && Math.abs(delta(path[i - 1]!.cellY, p.cellY)) === 1,
    );
    expect(diagonal.length).toBeGreaterThan(5);
    // The door faces north: from (10, 9) the octile distance is 10√2 + 1, against
    // 21 cells for the Manhattan walk of the former cardinal search.
    expect(travelDuration(path, s.world)).toBeLessThan(Math.round((10 * Math.SQRT2 + 1 + 1.25) * 1000));
    // Few changes of direction: a diagonal run, then a straight one at most.
    let turns = 0;
    for (let i = 2; i < path.length; i++) {
      const u = [
          Math.sign(delta(path[i - 2]!.cellX, path[i - 1]!.cellX)),
          Math.sign(delta(path[i - 2]!.cellY, path[i - 1]!.cellY)),
        ],
        v = [
          Math.sign(delta(path[i - 1]!.cellX, path[i]!.cellX)),
          Math.sign(delta(path[i - 1]!.cellY, path[i]!.cellY)),
        ];
      if (u[0] !== v[0] || u[1] !== v[1]) turns++;
    }
    expect(turns).toBeLessThanOrEqual(4);
  });
  it('never passes between two corners of footprints', () => {
    const s = village('corners');
    // A diagonal wall of houses from (12,18) up to (18,12): touching only by their corners.
    for (let i = 0; i <= 6; i++)
      add(s, { cellX: 12 + i, cellY: 18 - i, footprint: { buildingId: 'house-' + i }, building: null });
    const blocked = new Set(s.cells.map((cell) => `${cell.cellX}:${cell.cellY}`));
    const path = found(searchVillagePath(s, c(19, 19), ground('corners')));
    expect(path.at(-1)).toEqual(c(19, 19));
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!,
        b = path[i]!;
      if (
        !Number.isInteger(a.cellX) ||
        !Number.isInteger(b.cellX) ||
        !Number.isInteger(a.cellY) ||
        !Number.isInteger(b.cellY)
      )
        continue;
      if (Math.abs(b.cellX - a.cellX) === 1 && Math.abs(b.cellY - a.cellY) === 1) {
        expect(blocked.has(`${b.cellX}:${a.cellY}`)).toBe(false);
        expect(blocked.has(`${a.cellX}:${b.cellY}`)).toBe(false);
      }
    }
    // The wall is closed by corners only: the path walks around its end.
    expect(path.some((p) => p.cellX >= 19 || p.cellY >= 19 || p.cellX <= 11 || p.cellY <= 11)).toBe(true);
  });
  it('certifies each edge once: a warm mesh tests nothing, visits stay within the domain', () => {
    const s = village('warm'),
      field = ground('warm', (x, y) => Math.hypot(x - 15, y - 14.5) < 0.6);
    const cold = { visited: 0, certified: 0 },
      warm = { visited: 0, certified: 0 };
    const first = found(searchVillagePath(s, c(22, 18), field, { stats: cold }));
    const second = found(searchVillagePath(s, c(22, 18), field, { stats: warm }));
    expect(second).toEqual(first);
    expect(cold.certified).toBeGreaterThan(0);
    expect(cold.certified).toBeLessThanOrEqual(8 * cold.visited);
    expect(warm.certified).toBe(0);
    expect(warm.visited).toBe(cold.visited);
    expect(cold.visited).toBeLessThanOrEqual(villageSearchBound(s.region));
    // A path in open land visits few cells beyond its own.
    expect(cold.visited).toBeLessThan(first.length * 4);
  });
  it('proves unreachable inside the domain, and ends in budget at a lower node bound', () => {
    const s = village('moat');
    s.region.terrainCodes = s.region.terrainCodes.map((code, i) =>
      Math.max(Math.abs((i % size) - 10), Math.abs(Math.floor(i / size) - 10)) === 3 ? 2 : code,
    );
    const stats = { visited: 0, certified: 0 };
    expect(searchVillagePath(s, c(30, 30), ground('moat'), { stats })).toEqual({ kind: 'unreachable' });
    expect(stats.visited).toBeLessThanOrEqual(villageSearchBound(s.region));
    const open = village('bounded');
    expect(searchVillagePath(open, c(30, 30), ground('bounded'), { maxVisited: 3 })).toEqual({ kind: 'budget' });
    expect(searchVillagePath(open, c(30, 30), ground('bounded')).kind).toBe('found');
  });
  it('reaches a destination outside the region through its coarse cells, never calling it unreachable', () => {
    const s = village('outside');
    s.region = { ...s.region, width: 32, height: 32, terrainCodes: Array(32 * 32).fill(1) };
    const coarse = Array.from({ length: 41 }, (_, i) => c(10 + i, 10));
    const outcome = planVillageRoute(s, { cells: coarse, destination: c(50, 10) }, ground('outside'));
    expect(outcome.kind).toBe('found');
    if (outcome.kind === 'found') {
      expect(outcome.path.at(-1)).toEqual(c(50, 10));
      expect(outcome.path).toContainEqual(c(32, 10));
    }
    s.region.terrainCodes = s.region.terrainCodes.map((code, i) => (i % 32 === 20 ? 2 : code));
    expect(planVillageRoute(s, { cells: coarse, destination: c(50, 10) }, ground('outside-walled'))).toEqual({
      kind: 'budget',
    });
  });
  it('steps around a trunk on a cell centre and stops inside a grove whose centre is covered', () => {
    const trunks = [c(14, 10), c(18, 10)];
    const field = ground('trunks', (x, y) => trunks.some((t) => Math.hypot(x - t.cellX, y - t.cellY) < 0.2));
    const s = village('trunks');
    // A corridor one cell wide (y = 10) from the hall to the grove at (18,10).
    s.region.terrainCodes = s.region.terrainCodes.map((code, i) =>
      corridor(i % size, Math.floor(i / size)) ? code : 2,
    );
    const path = found(searchVillagePath(s, c(18, 10), field));
    walkable(path, field);
    const end = path.at(-1)!;
    expect(Math.round(end.cellX)).toBe(18);
    expect(Math.abs(end.cellX - 18)).toBeLessThanOrEqual(3 / 8);
    expect(Math.abs(end.cellY - 10)).toBeLessThanOrEqual(3 / 8);
    expect(field.sample(end.cellX, end.cellY).blocked).toBe(false);
    // The trunk at (14,10) is passed inside its cell, never through it.
    expect(path.some((p) => Math.round(p.cellX) === 14)).toBe(true);
    expect(path.every((p) => Math.hypot(p.cellX - 14, p.cellY - 10) >= 0.2)).toBe(true);
  });
  it('detours around a thin obstacle on a one-cell corridor inside the two cells of the step', () => {
    const field = ground('thin', (x, y) => Math.abs(x - 15.5) < 0.04 && Math.abs(y - 10) < 0.04);
    const s = village('thin');
    s.region.terrainCodes = s.region.terrainCodes.map((code, i) =>
      corridor(i % size, Math.floor(i / size)) ? code : 2,
    );
    const path = found(searchVillagePath(s, c(20, 10), field));
    walkable(path, field);
    expect(path.at(-1)).toEqual(c(20, 10));
    expect(path.some((p) => p.cellX > 15 && p.cellX < 16 && p.cellY !== 10)).toBe(true);
  });
  it('blocks an accessory on the door connector and a flooded ground', () => {
    const s = village('door');
    expect(searchVillagePath(s, c(10, 4), ground('door')).kind).toBe('found');
    const outside = buildingAccesses(s, 'hall')[0]!.outside;
    s.infrastructure!.equipment = [
      { id: 'lamp', quarterTurns: 0, version: 1, x: outside.cellX * 8, y: outside.cellY * 8 },
    ];
    expect(searchVillagePath(s, c(10, 4), ground('door')).kind).toBe('unreachable');
    s.infrastructure!.equipment = [];
    const flooded: TravelGround = {
      ...ground('flooded'),
      sample: () => ({ elevation: 0, dry: false, blocked: false }),
    };
    expect(searchVillagePath(s, c(10, 4), flooded).kind).toBe('unreachable');
  });
  it('crosses the torus seam', () => {
    const s = village('seam', c(1, 10)),
      path = found(searchVillagePath(s, c(60, 12), ground('seam')));
    expect(path.at(-1)).toEqual(c(60, 12));
    expect(path.some((p) => p.cellX >= 60) && path.some((p) => p.cellX <= 1)).toBe(true);
    // Five cells west through the seam, three south from the door: 2 + 3√2, plus the door.
    expect(travelDuration(path, s.world)).toBeLessThan(Math.round((2 + 3 * Math.SQRT2 + 1.25) * 1000));
  });
  it('crosses its own gardens freely and walks around the others', () => {
    const s = village('gardens');
    const plot = (cellX: number, cellY: number, garden: string) => ({
      cellX,
      cellY,
      footprint: { buildingId: garden, buildingType: 'garden' as const, state: 'active' as const },
      building: null,
    });
    // A wall of plots of the west garden at x = 14, from y = 0 to 30; the east plot at (18,10).
    for (let y = 0; y <= 30; y++) add(s, plot(14, y, 'west'));
    add(s, plot(18, 10, 'east'));
    const fromHall = planVillageLeg(s, null, c(18, 10), ground('gardens'))!;
    expect(fromHall.at(-1)).toEqual(c(18, 10));
    expect(fromHall.some((p) => Math.round(p.cellX) === 14 && Math.round(p.cellY) <= 30)).toBe(false);
    const across = planVillageLeg(s, c(14, 10), c(18, 10), ground('gardens'))!;
    expect(across[0]).toEqual(c(14, 10));
    expect(travelDuration(across, s.world)).toBe(4000);
  });
});

describe('travelDuration in Euclidean length (decision 23)', () => {
  const world = { widthCells: 512, heightCells: 256 };
  it('keeps a cardinal path to the millisecond and counts √2 per diagonal step', () => {
    const cardinal = [c(10, 10), c(10.5, 10), c(10.5, 10.375), c(13, 10.375), c(13, 12), c(511, 12)];
    // The former rule: |dx| + |dy| per segment, seams wrapped.
    expect(travelDuration(cardinal, world)).toBe(Math.round((0.5 + 0.375 + 2.5 + 1.625 + 14) * 1000));
    expect(travelDuration([c(0, 0), c(1, 1)], world)).toBe(1414);
    expect(travelDuration([c(0, 0), c(1, 1), c(2, 2), c(3, 2)], world)).toBe(Math.round((2 * Math.SQRT2 + 1) * 1000));
    expect(travelDuration([c(511, 255), c(0, 0)], world)).toBe(1414);
  });
});
