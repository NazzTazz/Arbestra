import type { TravelCell, TravelRoute } from '@arbestra/contracts';
import {coarseTravelPath} from '@arbestra/contracts';
import { delta } from './world-space';

export type RoadKind = 'paved' | 'earth';
export const roadKey = (c: TravelCell) => `${c.cellX}:${c.cellY}`;
export const ROAD_DEPTH = .06;
export const ROAD_HALF_WIDTH = .47;

/** Trim building access from decoration only; never bridge across an occupied cell. */
export function roadDisplayRoutes(routes: readonly TravelRoute[], occupied: ReadonlySet<string>, world?:{widthCells:number;heightCells:number}): TravelRoute[] {
  return routes.flatMap(route => {
    const runs: TravelCell[][] = []; let run: TravelCell[] = [];
    const coarse=world?coarseTravelPath(route.cells,world):route.cells;
    for (const cell of coarse) {
      if (occupied.has(roadKey(cell))) {
        if (run.length > 1) runs.push(run);
        run = [];
      } else run.push(cell);
    }
    if (run.length > 1) runs.push(run);
    return runs.map((cells,index) => ({...route,id:`${route.id}:display:${index}`,cells}));
  });
}

/** A re-entrant corner is the grass quadrant between two perpendicular road arms. */
export function roadInnerCorners(routes: readonly TravelRoute[], width: number, height: number) {
  const nodes = new Map<string, {cell: TravelCell; mask: number}>();
  for (const edge of roadEdges(routes)) for (const [a,b] of [[edge.from,edge.to],[edge.to,edge.from]] as const) {
    const node=nodes.get(roadKey(a)) ?? {cell:a,mask:0};
    const x=delta(b.cellX,a.cellX,width), y=delta(b.cellY,a.cellY,height);
    node.mask |= x>0?1:x<0?2:y>0?4:8;
    nodes.set(roadKey(a),node);
  }
  return [...nodes.values()].flatMap(({cell,mask}) => [-1,1].flatMap(sx => [-1,1]
    .filter(sz => Boolean(mask & (sx>0?1:2)) && Boolean(mask & (sz>0?4:8)))
    .map(sz => ({cell,sx,sz}))));
}
export function roadEdges(routes: readonly TravelRoute[]) {
  const edges = new Map<string, { from: TravelCell; to: TravelCell; kind: RoadKind }>();
  for (const route of routes) for (let i = 1; i < route.cells.length; i++) {
    const a = route.cells[i - 1]!, b = route.cells[i]!;
    const [from, to] = roadKey(a) < roadKey(b) ? [a, b] : [b, a];
    const id = `${roadKey(from)}|${roadKey(to)}`, kind = route.kind === 'building' ? 'paved' : 'earth';
    if (edges.get(id)?.kind !== 'paved') edges.set(id, { from, to, kind });
  }
  return [...edges.values()];
}

/** E/W/S/N arms, shared by excavation and its visible pavement. */
export function pavedProfiles(routes: readonly TravelRoute[], width: number, height: number): Map<string, number> {
  const result = new Map<string, number>(), edges = roadEdges(routes);
  for (const edge of edges) if (edge.kind === 'paved') {
    result.set(roadKey(edge.from), 0); result.set(roadKey(edge.to), 0);
  }
  for (const edge of edges) for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]] as const) {
    if (!result.has(roadKey(a))) continue;
    const x = delta(b.cellX, a.cellX, width), y = delta(b.cellY, a.cellY, height);
    const bit = x > 0 ? 1 : x < 0 ? 2 : y > 0 ? 4 : 8;
    result.set(roadKey(a), result.get(roadKey(a))! | bit);
  }
  return result;
}

export function roadTileRects(mask: number) {
  const bounds = [-1.25, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 1.25];
  return Array.from({ length: 9 }, (_, i) => {
    const x = i % 3, z = Math.floor(i / 3);
    const dug = x === 1 && z === 1 || z === 1 && Boolean(mask & (x === 2 ? 1 : 2))
      || x === 1 && Boolean(mask & (z === 2 ? 4 : 8));
    return { x0: bounds[x]!, x1: bounds[x+1]!, z0: bounds[z]!, z1: bounds[z+1]!, dug };
  });
}

/** Boundary against grass only; openings at the tile edge continue into the next tile. */
export function roadTileBorders(mask: number) {
  const rects = roadTileRects(mask);
  return rects.flatMap((r, i) => {
    if (!r.dug) return [];
    const x = i % 3, z = Math.floor(i / 3);
    return [
      { neighbor: x < 2 ? i+1 : -1, x0:r.x1, z0:r.z0, x1:r.x1, z1:r.z1, nx:1, nz:0 },
      { neighbor: x > 0 ? i-1 : -1, x0:r.x0, z0:r.z1, x1:r.x0, z1:r.z0, nx:-1, nz:0 },
      { neighbor: z < 2 ? i+3 : -1, x0:r.x1, z0:r.z1, x1:r.x0, z1:r.z1, nx:0, nz:1 },
      { neighbor: z > 0 ? i-3 : -1, x0:r.x0, z0:r.z0, x1:r.x1, z1:r.z0, nx:0, nz:-1 },
    ].filter(e => e.neighbor >= 0 && !rects[e.neighbor]!.dug);
  });
}
