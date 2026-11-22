import { describe, expect, it } from 'vitest';
import { emptyInfrastructure } from './infrastructure.js';
import {
  DESIRE_TRAIL_COST,
  desireEdgeBetween,
  desireEdges,
  trailLookup,
  travelDuration,
  type DesireEdge,
  type TravelCell,
  type TravelGround,
  type TravelNetworkState,
} from './travel-paths.js';
import { searchVillagePath } from './village-search.js';

// The beaten track (docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md §3.4, R2b): a step along a
// visible desire path costs DESIRE_TRAIL_COST, in the search and in travelDuration alike.
const c = (cellX: number, cellY: number): TravelCell => ({ cellX, cellY });
const size = 64,
  world = { widthCells: size, heightCells: size };
const east = (x: number, y: number, n: number): DesireEdge[] =>
  Array.from({ length: n }, (_, i) => ({ cellX: (x + i) % size, cellY: y, direction: 0 as const }));

describe('the beaten track in durations', () => {
  it('is on by default at 0.9', () => {
    expect(DESIRE_TRAIL_COST).toBe(0.9);
  });

  it('names an edge as world_desire_edges does, wrapped, and only between neighbours', () => {
    for (const path of [
      [c(4, 4), c(5, 4)],
      [c(5, 4), c(4, 4)],
      [c(4, 4), c(4, 5)],
      [c(4, 4), c(5, 5)],
      [c(5, 5), c(4, 4)],
      [c(4, 4), c(3, 5)],
      [c(63, 0), c(0, 63)],
      [c(63, 10), c(0, 10)],
    ])
      expect(desireEdgeBetween(path[0]!, path[1]!, world)).toEqual(desireEdges([path], world)[0]);
    expect(desireEdgeBetween(c(4, 4), c(4, 4), world)).toBeNull();
    expect(desireEdgeBetween(c(4, 4), c(6, 4), world)).toBeNull();
    // Points off the centres round to their cells.
    expect(desireEdgeBetween(c(4.25, 4), c(4.625, 4), world)).toEqual({ cellX: 4, cellY: 4, direction: 0 });
  });

  it('shortens a step along a visible path to 0.9, cardinal and diagonal, across the seam', () => {
    const trails = trailLookup(
      [...east(0, 0, 5), { cellX: 0, cellY: 2, direction: 2 }, { cellX: 63, cellY: 8, direction: 0 }],
      world,
    );
    const along = [c(0, 0), c(1, 0), c(2, 0), c(3, 0), c(4, 0), c(5, 0)];
    expect(travelDuration(along, world)).toBe(5000);
    expect(travelDuration(along, world, undefined, trails)).toBe(4500);
    // Half of it on the path.
    expect(travelDuration([c(3, 0), c(4, 0), c(5, 0), c(6, 0), c(7, 0)], world, undefined, trails)).toBe(3800);
    expect(travelDuration([c(0, 2), c(1, 3)], world, undefined, trails)).toBe(Math.round(Math.SQRT2 * 900));
    expect(travelDuration([c(63, 8), c(0, 8)], world, undefined, trails)).toBe(900);
    // A segment inside a cell (a door connector) is on no path; a reversed walk is the same edge.
    expect(travelDuration([c(0.25, 0), c(0, 0)], world, undefined, trails)).toBe(250);
    expect(travelDuration([...along].reverse(), world, undefined, trails)).toBe(4500);
  });

  it('never multiplies with a road: a road pixel keeps 0.7', () => {
    const trails = trailLookup(east(0, 0, 5), world),
      everywhere = () => true;
    const along = [c(0, 0), c(1, 0), c(2, 0)];
    expect(travelDuration(along, world, everywhere, trails)).toBe(travelDuration(along, world, everywhere));
    expect(travelDuration(along, world, everywhere)).toBe(1400);
  });

  it('leaves every duration as it was without visible paths', () => {
    expect(trailLookup([], world)).toBeUndefined();
    expect(trailLookup(undefined, world)).toBeUndefined();
    const path = [c(0, 0), c(1, 1), c(2, 1), c(2.5, 1.25)];
    expect(travelDuration(path, world, undefined, trailLookup([], world))).toBe(travelDuration(path, world));
  });
});

describe('the beaten track in the village search', () => {
  function village(trails?: DesireEdge[]): TravelNetworkState {
    return {
      world: { id: 'trails', widthCells: size, heightCells: size },
      village: { anchorCellX: 40, anchorCellY: 40, townHallBuildingId: 'hall' },
      region: {
        originCellX: 0,
        originCellY: 0,
        width: size,
        height: size,
        terrainCodes: Array(size * size).fill(1),
        features: [],
      },
      cells: [{ cellX: 40, cellY: 40, footprint: { buildingId: 'hall' }, building: { id: 'hall', type: 'town-hall' } }],
      infrastructure: emptyInfrastructure(),
      ...(trails ? { trails } : {}),
    };
  }
  const field: TravelGround = {
    width: size,
    height: size,
    revision: 'trails',
    sample: () => ({ elevation: 1, dry: true, blocked: false }),
  };
  // A parallel path one row south of the straight line from (5, 5) to (15, 5): down a diagonal, east
  // along row 6, back up a diagonal. (2√2 + 8) × 0.9 = 9.75 < 10.
  const beside: DesireEdge[] = [
    { cellX: 5, cellY: 5, direction: 2 },
    ...east(6, 6, 8),
    { cellX: 15, cellY: 5, direction: 3 },
  ];
  const search = (trails?: DesireEdge[]) => {
    const outcome = searchVillagePath(village(trails), c(15, 5), field, { from: c(5, 5) });
    expect(outcome.kind).toBe('found');
    return outcome.kind === 'found' ? outcome.path : [];
  };

  it('goes straight without a path, and joins a path beside it when walking it is cheaper', () => {
    const straight = search();
    expect(straight.every((p) => p.cellY === 5)).toBe(true);
    expect(travelDuration(straight, world)).toBe(10_000);
    const gathered = search(beside);
    expect(gathered.map((p) => `${p.cellX}:${p.cellY}`)).toEqual([
      '5:5',
      '6:6',
      '7:6',
      '8:6',
      '9:6',
      '10:6',
      '11:6',
      '12:6',
      '13:6',
      '14:6',
      '15:5',
    ]);
    // Cost = duration (decision 8): the duration of the path on the same trails is what was minimised.
    const duration = travelDuration(gathered, world, undefined, trailLookup(beside, world));
    expect(duration).toBe(Math.round((2 * Math.SQRT2 + 8) * 900));
    expect(duration).toBeLessThan(10_000);
  });

  it('keeps the straight line when the path beside it is not worth the detour', () => {
    // Only the row, without its diagonals: (2√2 + 8 × 0.9) = 10.03 > 10.
    expect(search(east(6, 6, 8)).every((p) => p.cellY === 5)).toBe(true);
  });
});
