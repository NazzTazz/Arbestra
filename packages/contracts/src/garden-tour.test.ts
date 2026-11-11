import { describe, expect, it } from 'vitest';
import { gardenTourLegKey, gardenTourLegs, planGardenTour, planGardenTourByLegs } from './garden-tour.js';
import { emptyInfrastructure } from './infrastructure.js';
import { planVillageLeg, travelDuration, type TravelNetworkState } from './travel-paths.js';
import type { TravelCell, TravelRoute } from './travel-paths.js';
const c = (x: number, y = 0): TravelCell => ({ cellX: x, cellY: y });
const route = (cells: TravelCell[]): TravelRoute => ({
  id: 'route',
  kind: 'garden',
  destination: cells[cells.length - 1]!,
  cells,
});
it('visits the selected plots in order with sixty seconds each and one final return', () => {
  const plan = planGardenTour([route([c(0), c(1), c(2)]), route([c(0), c(1), c(1, 1)])], c(0), [c(2), c(1, 1)])!;
  expect(plan.stops.map((s) => s.path)).toEqual([
    [c(0), c(1), c(2)],
    [c(2), c(1), c(1, 1)],
  ]);
  expect(plan.stops.map((s) => [s.arrivesAfterMs, s.workEndsAfterMs])).toEqual([
    [2000, 62000],
    [64000, 124000],
  ]);
  expect(plan.returnPath).toEqual([c(1, 1), c(1), c(0)]);
  expect(plan.durationMs).toBe(126000);
});
it('counts a canonical torus seam as one step and rejects a disconnected target', () => {
  const routes = [route([c(7), c(0), c(1)])];
  expect(planGardenTour(routes, c(7), [c(0)])?.durationMs).toBe(62000);
  expect(planGardenTour(routes, c(7), [c(2)])).toBeNull();
});
it('chooses legs as the network does: another garden is not a road, the plots of the leg ends are', () => {
  // The union of routes offers a 4-step leg across plot (1,1) of garden g3
  // and the network's own 6-step way around it.
  const routes: TravelRoute[] = [
    { id: 'g3:1:1', kind: 'garden', destination: c(1, 1), cells: [c(0), c(0, 1), c(1, 1)] },
    { id: 'a:2:2', kind: 'garden', destination: c(2, 2), cells: [c(0), c(1), c(2), c(3), c(3, 1), c(3, 2), c(2, 2)] },
    { id: 'shed', kind: 'building', destination: c(2, 1), cells: [c(1, 1), c(2, 1), c(2, 2)] },
  ];
  const around = planGardenTour(routes, c(0), [c(2, 2)])!;
  expect(around.stops[0]!.path).not.toContainEqual(c(1, 1));
  expect(around.stops[0]!.arrivesAfterMs).toBe(6000);
  // Harvesting g3 first, the next leg may leave g3 through its own plot.
  const both = planGardenTour(routes, c(0), [c(1, 1), c(2, 2)])!;
  expect(both.stops[1]!.path).toEqual([c(1, 1), c(2, 1), c(2, 2)]);
  expect(both.stops[1]!.arrivesAfterMs - both.stops[0]!.workEndsAfterMs).toBe(2000);
});
it('crosses adjacent selected plots directly, including a torus seam, without shortcutting other land', () => {
  const routes = [route([c(3), c(2), c(1), c(0)]), route([c(3), c(4), c(5), c(6), c(7)])];
  const plan = planGardenTour(routes, c(3), [c(0), c(7)], { widthCells: 8, heightCells: 4 })!;
  expect(plan.stops[1]!.path).toEqual([c(0), c(7)]);
  expect(plan.stops[1]!.arrivesAfterMs - plan.stops[0]!.workEndsAfterMs).toBe(1000);
  expect(planGardenTour(routes, c(3), [c(0), c(7)])!.stops[1]!.path).toHaveLength(8);
});

describe('tour by legs (refonte des trajets T2)', () => {
  const world = { widthCells: 8, heightCells: 4 };
  it('searches k + 1 legs at most, joins plots sharing a side directly and walks the hall leg back', () => {
    const tour = [c(1), c(2), c(5), c(5, 1)];
    expect(gardenTourLegs(tour, world)).toEqual([
      { from: null, to: c(1) },
      { from: c(2), to: c(5) },
      { from: null, to: c(5, 1) },
    ]);
    // Across the seam of the torus, 7 and 0 share a side.
    expect(gardenTourLegs([c(7), c(0)], world)).toEqual([
      { from: null, to: c(7) },
      { from: null, to: c(0) },
    ]);
    const searched: string[] = [];
    const plan = planGardenTourByLegs(
      tour,
      (leg) => {
        searched.push(gardenTourLegKey(leg));
        const start = leg.from ?? c(0);
        const path = [start];
        while (path.at(-1)!.cellX !== leg.to.cellX) path.push(c(path.at(-1)!.cellX + 1, start.cellY));
        if (path.at(-1)!.cellY !== leg.to.cellY) path.push(leg.to);
        return path;
      },
      (path) => (path.length - 1) * 1000,
      world,
    )!;
    expect(searched).toEqual(['hall>1:0', '2:0>5:0', 'hall>5:1']);
    expect(plan.stops.map((s) => s.arrivesAfterMs)).toEqual([1000, 62000, 125000, 186000]);
    expect(plan.stops[1]!.path).toEqual([c(1), c(2)]);
    expect(plan.returnPath).toEqual([c(5, 1), c(5), c(4), c(3), c(2), c(1), c(0)]);
    expect(plan.durationMs).toBe(246000 + 6000);
  });
  it('fails the whole tour when one leg has no path', () => {
    expect(
      planGardenTourByLegs(
        [c(1), c(4)],
        (leg) => (leg.to.cellX === 4 ? null : [c(0), leg.to]),
        () => 0,
      ),
    ).toBeNull();
  });
});

describe('planVillageLeg', () => {
  // A hall at (1,1), a garden west (plots x 3..4) and another east (x 6), on 10 × 4.
  const plot = (cellX: number, cellY: number, garden: string) => ({
    cellX,
    cellY,
    footprint: { buildingId: garden, buildingType: 'garden' as const, state: 'active' as const },
    building: null,
  });
  const state: TravelNetworkState = {
    world: { id: 'w', widthCells: 12, heightCells: 5 },
    village: { anchorCellX: 1, anchorCellY: 2, townHallBuildingId: 'hall' },
    region: { originCellX: 0, originCellY: 0, width: 12, height: 5, terrainCodes: Array(60).fill(1), features: [] },
    infrastructure: emptyInfrastructure(),
    cells: [
      {
        cellX: 1,
        cellY: 2,
        footprint: { buildingId: 'hall' },
        building: { id: 'hall', type: 'town-hall', quarterTurns: 0 },
      },
      ...[0, 1, 2, 3, 4].map((y) => plot(4, y, 'west')),
      plot(7, 2, 'east'),
    ],
  };
  it('starts from a plot, crosses its own gardens freely and walks around the others', () => {
    // From the west garden to the east plot: crossing west costs nothing.
    const across = planVillageLeg(state, c(4, 2), c(7, 2))!;
    expect(across[0]).toEqual(c(4, 2));
    expect(across.at(-1)).toEqual(c(7, 2));
    expect(travelDuration(across)).toBe(3000);
    // From the hall to the east plot, the west garden (a wall of plots) is crossed
    // only at its crossing cost; the torus lets the leg go around it instead.
    const fromHall = planVillageLeg(state, null, c(7, 2))!;
    expect(fromHall.at(-1)).toEqual(c(7, 2));
    expect(fromHall.some((p) => Math.round(p.cellX) === 4)).toBe(false);
  });
  it('returns null when the destination cannot be reached', () => {
    const walled = {
      ...state,
      region: {
        ...state.region,
        terrainCodes: state.region.terrainCodes.map((code, i) => (i % 12 === 9 || i % 12 === 11 ? 2 : code)),
      },
    };
    expect(planVillageLeg(walled, null, c(10, 2))).toBeNull();
  });
});
