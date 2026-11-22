import type { VillageState } from './villages.js';
import { coarseTravelPath } from './travel-paths.js';
import {
  AUTOMATIC_ROAD_STYLE,
  infrastructurePlanSurface,
  subCellKey,
  wrapCoordinate,
  wrappedDistance,
  type SubPoint,
} from './infrastructure.js';
export interface AutomaticBrazier {
  id: string;
  position: SubPoint;
  cellX: number;
  cellY: number;
}
/** Direction bits of a node: the four cardinal arms (as before diagonals), then the diagonal ones. */
const EAST = 1,
  WEST = 2,
  SOUTH = 4,
  NORTH = 8;
const diagonalBit = (sx: number, sy: number) => (sy > 0 ? (sx > 0 ? 16 : 32) : sx > 0 ? 64 : 128);
const armBit = (dx: number, dy: number) =>
  dx && dy ? diagonalBit(dx, dy) : dx > 0 ? EAST : dx < 0 ? WEST : dy > 0 ? SOUTH : NORTH;
const QUADRANTS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];
/**
 * The quadrants `[sx, sy]` lit around a node of an automatic route (docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md
 * §3.4): none on a straight line or a simple bend (two arms); at a crossing (three arms or more), each quadrant
 * that no diagonal arm crosses and that has an arm on both of its sides (its cardinal one, or the diagonal one
 * beyond it), which for cardinal arms is the quadrant between two perpendicular arms, as before diagonals; at an
 * end (one arm), or at a crossing that lights nothing by that rule, the one quadrant facing away from its arms.
 * Ids and positions depend only on the node and the quadrant, so a fire keeps its id while its node lights it.
 */
export function brazierQuadrants(mask: number): Array<readonly [number, number]> {
  let arms = 0,
    sumX = 0,
    sumY = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if ((dx || dy) && mask & armBit(dx, dy)) {
        arms++;
        sumX += dx;
        sumY += dy;
      }
  if (arms === 0 || arms === 2) return [];
  const free = QUADRANTS.filter(([sx, sy]) => !(mask & diagonalBit(sx, sy)));
  if (arms >= 3) {
    const lit = free.filter(
      ([sx, sy]) =>
        Boolean(mask & ((sx > 0 ? EAST : WEST) | diagonalBit(sx, -sy))) &&
        Boolean(mask & ((sy > 0 ? SOUTH : NORTH) | diagonalBit(-sx, sy))),
    );
    if (lit.length) return lit;
  }
  let best: readonly [number, number] | null = null,
    score = -Infinity;
  for (const q of free)
    if (-(q[0] * sumX + q[1] * sumY) > score) {
      best = q;
      score = -(q[0] * sumX + q[1] * sumY);
    }
  return best ? [best] : [];
}
/** Canonical decorative topology shared by picking, rendering and the operator's start report
 * (desire-start). The fires of automatic routes follow `brazierQuadrants`; those of painted strokes
 * keep their rule (a fire in each quadrant between two perpendicular arms). A building, a road
 * cell or a painted road is not a node of an automatic route: the route stops at its side, and the
 * arm towards it still counts for its neighbour, as the way goes on there. */
export function automaticBraziers(
  state: Pick<VillageState, 'world' | 'cells' | 'region' | 'travelRoutes' | 'infrastructure'> &
    Partial<Pick<VillageState, 'roadCells'>>,
): AutomaticBrazier[] {
  const { world, infrastructure: plan } = state,
    w = world.widthCells * 8,
    h = world.heightCells * 8;
  const surface = infrastructurePlanSurface(
      plan ?? { revision: 0, roads: [], equipment: [], manualLighting: [], suppressedBraziers: [], stoneReserve: 0 },
      world,
    ),
    edited = new Set(
      [...surface.values()].map(
        (p) => `${Math.floor((p.x + 8) / 16) % world.widthCells}:${Math.floor((p.y + 8) / 16) % world.heightCells}`,
      ),
    );
  const occupied = new Set(state.cells.filter((c) => c.footprint || c.building).map((c) => `${c.cellX}:${c.cellY}`));
  const roadCells = new Set((state.roadCells ?? []).map((c) => `${c.cellX}:${c.cellY}`));
  const nodes = new Map<string, { p: SubPoint; mask: number; width: number; legacy: boolean }>();
  const arm = (p: SubPoint, bit: number, width: number, legacy: boolean) => {
    const key = `${p.x}:${p.y}`,
      node = nodes.get(key) ?? { p, mask: 0, width, legacy };
    node.mask |= bit;
    node.width = Math.max(node.width, width);
    nodes.set(key, node);
  };
  const line = (a: SubPoint, b: SubPoint, width: number, legacy: boolean) => {
    const dx = wrappedDistance(b.x, a.x, w),
      dy = wrappedDistance(b.y, a.y, h);
    // Painted strokes are axis-aligned; an automatic route also steps diagonally, one cell at a time.
    if (dx && dy && (!legacy || Math.abs(dx) !== 8 || Math.abs(dy) !== 8)) return;
    const step = legacy ? 8 : 1,
      n = Math.max(Math.abs(dx), Math.abs(dy)) / step;
    if (n > 512) return;
    const bit = armBit(Math.sign(dx), Math.sign(dy)),
      opposite = armBit(-Math.sign(dx), -Math.sign(dy));
    for (let i = 0; i <= n; i++) {
      const p = {
          x: wrapCoordinate(a.x + Math.sign(dx) * i * step, w),
          y: wrapCoordinate(a.y + Math.sign(dy) * i * step, h),
        },
        cell = subCellKey(p, world);
      if (legacy && (occupied.has(cell) || edited.has(cell))) continue;
      arm(p, (i < n ? bit : 0) | (i > 0 ? opposite : 0), width, legacy);
    }
  };
  for (const route of state.travelRoutes) {
    const cells = coarseTravelPath(route.cells, world).map((p) => ({ x: p.cellX * 8, y: p.cellY * 8 }));
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1]!,
        b = cells[i]!;
      // Match the visible road runs: an excluded endpoint (a building, a road cell, a painted road)
      // removes the arm's node there. The route goes on into it: the free end keeps its arm, so a
      // path that reaches a door or a road is not an end, and a bend towards it stays a bend.
      const hidden = (p: SubPoint) => {
        const cell = subCellKey(p, world);
        return occupied.has(cell) || edited.has(cell) || roadCells.has(cell);
      };
      const hiddenA = hidden(a),
        hiddenB = hidden(b);
      if (hiddenA || hiddenB) {
        const dx = Math.sign(wrappedDistance(b.x, a.x, w)),
          dy = Math.sign(wrappedDistance(b.y, a.y, h));
        if (!hiddenA) arm(a, armBit(dx, dy), AUTOMATIC_ROAD_STYLE.width, true);
        if (!hiddenB) arm(b, armBit(-dx, -dy), AUTOMATIC_ROAD_STYLE.width, true);
        continue;
      }
      line(a, b, AUTOMATIC_ROAD_STYLE.width, true);
    }
  }
  for (const road of [...(plan?.inheritedRoads ?? []), ...(plan?.roads ?? [])])
    if (road.operation === 'paint' && road.material !== 'none')
      for (let i = 1; i < road.points.length; i++) line(road.points[i - 1]!, road.points[i]!, road.width, false);
  // History describes edits, not today's topology. Removed arms cannot generate fires.
  for (const node of nodes.values())
    if (!node.legacy) {
      const painted = (dx: number, dy: number) => {
        const p = surface.get(
          `${wrapCoordinate(node.p.x * 2 + dx, w * 2)}:${wrapCoordinate(node.p.y * 2 + dy, h * 2)}`,
        );
        return p?.manual && p.material !== 'none';
      };
      if (!painted(0, 0) && !painted(-1, -1)) {
        node.mask = 0;
        continue;
      }
      for (const [bit, dx, dy] of [
        [1, 1, 0],
        [2, -1, 0],
        [4, 0, 1],
        [8, 0, -1],
      ])
        if (!painted(dx!, dy!)) node.mask &= ~bit!;
      const horizontal = (node.mask & 3) !== 0;
      let radius = 0;
      for (let i = 0; i < 8; i++)
        if (
          painted(horizontal ? 0 : i, horizontal ? i : 0) ||
          painted(horizontal ? 0 : -i - 1, horizontal ? -i - 1 : 0)
        )
          radius = i + 1;
      node.width = Math.max(2, radius);
    }
  const result: AutomaticBrazier[] = [];
  for (const node of nodes.values())
    for (const [sx, sy] of node.legacy
      ? brazierQuadrants(node.mask)
      : QUADRANTS.filter(([sx, sy]) => node.mask & (sx > 0 ? EAST : WEST) && node.mask & (sy > 0 ? SOUTH : NORTH))) {
      const offset = node.legacy ? 3 : Math.ceil(node.width / 2 + 1),
        position = { x: wrapCoordinate(node.p.x + sx * offset, w), y: wrapCoordinate(node.p.y + sy * offset, h) };
      const cellX = wrapCoordinate(Math.floor((position.x + 4) / 8), world.widthCells),
        cellY = wrapCoordinate(Math.floor((position.y + 4) / 8), world.heightCells),
        cell = `${cellX}:${cellY}`;
      const id = node.legacy
        ? `auto:${node.p.x / 8}:${node.p.y / 8}:${sx}:${sy}`
        : `auto:${cell}:sub:${node.p.x}:${node.p.y}:${sx}:${sy}`;
      if (plan?.manualLighting.includes(cell) || plan?.suppressedBraziers.includes(id) || occupied.has(cell)) continue;
      const x = wrapCoordinate(cellX - state.region.originCellX, world.widthCells),
        y = wrapCoordinate(cellY - state.region.originCellY, world.heightCells);
      if (
        x >= state.region.width ||
        y >= state.region.height ||
        state.region.terrainCodes[y * state.region.width + x] !== 1
      )
        continue;
      if (surface.get(`${position.x * 2}:${position.y * 2}`)?.manual) continue;
      if (
        state.region.features.some(
          (f) =>
            f.cellX === cellX &&
            f.cellY === cellY &&
            f.deposit?.blocksCell !== false &&
            !f.deposit?.cleared &&
            f.deposit?.state !== 'depleted',
        )
      )
        continue;
      if (!result.some((e) => e.position.x === position.x && e.position.y === position.y))
        result.push({ id, position, cellX, cellY });
    }
  return result;
}
