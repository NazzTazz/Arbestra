import { describe, expect, it } from 'vitest';
import { emptyInfrastructure } from './infrastructure.js';
import {
  buildTravelNetwork,
  refineTravelRoute,
  travelDuration,
  type TravelCell,
  type TravelGround,
  type TravelRoute,
} from './travel-paths.js';
import type { VillageState } from './villages.js';

// Tristan, 29 October: an active garden is not an ordinary road. A route goes
// around a garden whenever an ordinary passage exists; only the plots of its
// own destination garden keep the ordinary cost; an enclosed garden stays
// reachable, at a high price.
const world = { widthCells: 64, heightCells: 64 };
type Cells = VillageState['cells'];
let worlds = 0;
function village(refined: boolean, extra: Cells) {
  const s = {
    world: { ...world, id: `gardens-${refined}-${++worlds}` },
    village: { anchorCellX: 10, anchorCellY: 10, townHallBuildingId: 'hall' },
    region: { originCellX: 0, originCellY: 0, width: 64, height: 64, terrainCodes: Array(4096).fill(1), features: [] },
    cells: [
      {
        cellX: 10,
        cellY: 10,
        footprint: { buildingId: 'hall', state: 'active' },
        building: { id: 'hall', type: 'town-hall', quarterTurns: 0 },
      },
      ...extra,
    ],
    travelRoutes: [],
    infrastructure: emptyInfrastructure(),
  } as unknown as VillageState;
  if (!refined) delete (s as Partial<VillageState>).infrastructure;
  return s;
}
const rect = (x0: number, x1: number, y0: number, y1: number): TravelCell[] => {
  const cells: TravelCell[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push({ cellX: x, cellY: y });
  return cells;
};
function garden(id: string, plots: TravelCell[]): Cells {
  return plots.map((p, i) => ({
    ...p,
    footprint: { buildingId: id, buildingType: 'garden', state: 'active' },
    building: i === 0 ? { id, type: 'garden', quarterTurns: 0, garden: { plots } } : null,
  })) as unknown as Cells;
}
/** A dwelling whose door faces the hall (south of it, +y). */
const house = (id: string, cellX: number, cellY: number) =>
  ({
    cellX,
    cellY,
    footprint: { buildingId: id, buildingType: 'dwelling', state: 'active' },
    building: {
      id,
      type: 'dwelling',
      quarterTurns: 0,
      accesses: [{ id: 'main', x: 0, y: 0.336, dx: 0, dy: 1, width: 0.224, principal: true }],
    },
  }) as unknown as Cells[number];
/** Cells of `plots` whose interior the route enters (a cell edge is shared, not entered). */
function entered(route: TravelRoute, plots: readonly TravelCell[]): string[] {
  const hit = new Set<string>();
  const visit = (x: number, y: number) => {
    for (const p of plots)
      if (Math.abs(x - p.cellX) < 0.5 && Math.abs(y - p.cellY) < 0.5) hit.add(`${p.cellX}:${p.cellY}`);
  };
  route.cells.forEach((b, i) => {
    const a = route.cells[i - 1] ?? b,
      n = Math.max(1, Math.round((Math.abs(b.cellX - a.cellX) + Math.abs(b.cellY - a.cellY)) * 16));
    for (let k = 0; k <= n; k++)
      visit(a.cellX + ((b.cellX - a.cellX) * k) / n, a.cellY + ((b.cellY - a.cellY) * k) / n);
  });
  return [...hit].sort();
}
const to = (routes: TravelRoute[], kind: TravelRoute['kind'], cellX: number, cellY: number) =>
  routes.find((r) => r.kind === kind && r.destination.cellX === cellX && r.destination.cellY === cellY);
const variants = [
  ['refined', true],
  ['coarse', false],
] as const;

describe('gardens are not roads', () => {
  it.each(variants)('a route between two buildings goes around a garden (%s)', (_, refined) => {
    const plots = rect(9, 11, 5, 7);
    const s = village(refined, [house('house', 10, 3), ...garden('garden', plots)]);
    const route = to(buildTravelNetwork(s), 'building', 10, 3)!;
    expect(route).toBeDefined();
    expect(entered(route, plots)).toEqual([]);
  });

  it.each(variants)('reaches an enclosed plot through the other plots of its own garden (%s)', (_, refined) => {
    // The target (10, 2) is four plots deep from the hall's side and one plot
    // from the far side: its own plots are ordinary ground, so no detour.
    const plots = rect(9, 11, 1, 6);
    const s = village(refined, garden('garden', plots));
    const route = to(buildTravelNetwork(s), 'garden', 10, 2)!;
    expect(route).toBeDefined();
    // Straight in from the hall's side, never around to the far side.
    expect(route.cells.every((p) => p.cellY > 1.5)).toBe(true);
    expect(travelDuration(route.cells, world)).toBeLessThanOrEqual(9_000);
  });

  it.each(variants)('keeps a garden ringed by another garden reachable, across one plot only (%s)', (_, refined) => {
    const ring = rect(9, 11, 4, 6).filter((p) => p.cellX !== 10 || p.cellY !== 5);
    const s = village(refined, [...garden('ring', ring), ...garden('inner', [{ cellX: 10, cellY: 5 }])]);
    const routes = buildTravelNetwork(s);
    const inner = to(routes, 'garden', 10, 5)!;
    expect(inner).toBeDefined();
    expect(entered(inner, ring)).toHaveLength(1);
    // The far plot of the ring is reached through the ring's own plots, never
    // through the inner garden that lies on the straight line.
    const far = to(routes, 'garden', 10, 4)!;
    expect(far).toBeDefined();
    expect(entered(far, [{ cellX: 10, cellY: 5 }])).toEqual([]);
  });

  it('makes the bounded witness of a distant plot go around a foreign garden too', () => {
    // 22 cells away on an RC1 ground: the refinement certifies a planRoute
    // witness (coarse lattice first) before any village-wide fine search.
    const near = rect(8, 12, 0, 2);
    const s = village(true, [...garden('near', near), ...garden('far', [{ cellX: 10, cellY: 52 }])]);
    const ground: TravelGround = {
      width: 64,
      height: 64,
      revision: s.world.id,
      sample: () => ({ elevation: 1, dry: true, blocked: false }),
    };
    const destination = { cellX: 10, cellY: 52 };
    const route = refineTravelRoute(
      s,
      { id: 'far:10:52', kind: 'garden', destination, cells: [{ cellX: 10, cellY: 10 }, destination] },
      undefined,
      undefined,
      ground,
    )!;
    expect(route).not.toBeNull();
    expect(route.cells.at(-1)).toEqual(destination);
    expect(entered(route, near)).toEqual([]);
  });

  it.each([
    ['refined', true, 21_000],
    ['coarse', false, 7_000],
  ] as const)('bounds the search when every route must cross a garden (%s)', (_, refined, bound) => {
    // The hall is ringed by a garden and eight houses are each ringed by their
    // own: no ordinary passage exists, so each search spends its whole bounded
    // detour before paying for one plot. Checkpoints count the visited nodes:
    // 19 009 refined and 6 401 coarse, against 8 697 and 2 823 when gardens
    // were roads. The detour bounds of the searches cap this worst case.
    const ring = (cx: number, cy: number, r: number) =>
      rect(cx - r, cx + r, cy - r, cy + r).filter(
        (p) => Math.max(Math.abs(p.cellX - cx), Math.abs(p.cellY - cy)) === r,
      );
    const houses = Array.from({ length: 8 }, (_, i) => ({
      cellX: 10 + Math.round(Math.cos((i * Math.PI) / 4) * 8),
      cellY: 10 + Math.round(Math.sin((i * Math.PI) / 4) * 8),
    }));
    const s = village(refined, [
      ...garden('hall-garden', ring(10, 10, 2)),
      ...houses.flatMap((h, i) => [
        house('house-' + i, h.cellX, h.cellY),
        ...garden('garden-' + i, ring(h.cellX, h.cellY, 1)),
      ]),
    ]);
    let visits = 0;
    const routes = buildTravelNetwork(s, [], undefined, () => visits++);
    for (const h of houses) expect(to(routes, 'building', h.cellX, h.cellY)).toBeDefined();
    expect(visits).toBeLessThanOrEqual(bound);
  });

  it.each(variants)('does not cross a neighbouring garden to reach its target garden (%s)', (_, refined) => {
    const near = rect(9, 11, 5, 7),
      far = rect(9, 11, 2, 3);
    const s = village(refined, [...garden('near', near), ...garden('far', far)]);
    const routes = buildTravelNetwork(s);
    for (const plot of far) {
      const route = to(routes, 'garden', plot.cellX, plot.cellY)!;
      expect(route).toBeDefined();
      expect(entered(route, near)).toEqual([]);
    }
  });
});
