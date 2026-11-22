import {
  AUTOMATIC_ROAD_STYLE,
  coarseTravelPath,
  type RoadStroke,
  type TravelRoute,
  type VillageState,
} from '@arbestra/contracts';
import { roadKey } from './road-profile';

/** Neighbour bits: east (+x) 1, south (+y) 2, west 4, north 8. */
export const ROAD_EAST = 1,
  ROAD_SOUTH = 2,
  ROAD_WEST = 4,
  ROAD_NORTH = 8;
export const ROAD_DIRECTIONS = [
  [1, 0, ROAD_EAST],
  [0, 1, ROAD_SOUTH],
  [-1, 0, ROAD_WEST],
  [0, -1, ROAD_NORTH],
] as const;

type LinkState = Pick<VillageState, 'travelRoutes' | 'cells' | 'world' | 'roadCells'>;
export interface RoadCellLinks {
  /** Par case de route (`x:y`), les côtés par lesquels une route automatique y entre (bits `ROAD_*`). */
  masks: ReadonlyMap<string, number>;
  /** Un tronçon `[case automatique, case de route]` par jonction, pour que la route automatique ouvre son bras. */
  stubs: TravelRoute[];
}
export const NO_ROAD_LINKS: RoadCellLinks = { masks: new Map(), stubs: [] };

/**
 * Les jonctions entre une route automatique et une case de route tracée à la main (docs/SPEC-INFRASTRUCTURE-
 * CASES-ET-PLACES.md §4.6). La route automatique est masquée sous les cases de route (`villageRoadDisplayRoutes`) :
 * elle s'arrête au centre de la case voisine, qui n'a pas de bras vers elle. Chaque jonction rend les deux
 * bras : celui de la case de route (`masks`) et celui de la case automatique (`stubs`).
 * Linéaire dans les cases des trajets ; à calculer une fois par état dérivé, jamais par image.
 */
export function roadCellLinks(state: LinkState): RoadCellLinks {
  const roadCells = state.roadCells ?? [];
  if (!roadCells.length) return NO_ROAD_LINKS;
  const roads = new Set(roadCells.map(roadKey)),
    occupied = new Set(state.cells.filter((c) => c.footprint || c.building).map(roadKey));
  const masks = new Map<string, number>(),
    stubs = new Map<string, TravelRoute>();
  for (const route of state.travelRoutes) {
    const path = coarseTravelPath(route.cells, state.world);
    for (let i = 1; i < path.length; i++)
      for (const [from, to] of [
        [path[i - 1]!, path[i]!],
        [path[i]!, path[i - 1]!],
      ] as const) {
        const road = roadKey(to),
          start = roadKey(from);
        if (!roads.has(road) || roads.has(start) || occupied.has(start)) continue;
        const dx = delta(from.cellX, to.cellX, state.world.widthCells),
          dy = delta(from.cellY, to.cellY, state.world.heightCells);
        const bit = ROAD_DIRECTIONS.find(([x, y]) => x === dx && y === dy)?.[2];
        // A diagonal path reaches the road cell at its corner: the cell keeps its square tile (no
        // arm), the path's own arm and its spur into the corner (`roadCellSpurs`) close the gap.
        if (!bit && (Math.abs(dx) !== 1 || Math.abs(dy) !== 1)) continue;
        if (bit) masks.set(road, (masks.get(road) ?? 0) | bit);
        stubs.set(start + '>' + road, {
          ...route,
          id: `${route.id}:link:${start}>${road}`,
          cells: [from, to],
          destination: to,
        });
      }
  }
  return stubs.size ? { masks, stubs: [...stubs.values()] } : NO_ROAD_LINKS;
}

/**
 * The spur of each diagonal junction (`stubs` whose two cells are diagonal neighbours): a short
 * earth stroke that carries the path from the shared corner into the road cell, as far as its
 * centre band (a quarter cell from its centre), cut square at both ends so that it covers only the
 * corner of the road cell, never its other neighbours. Sub-cell points, as `automaticRoadStrokes`.
 */
export function roadCellSpurs(
  stubs: readonly TravelRoute[],
  world: { widthCells: number; heightCells: number },
): RoadStroke[] {
  const spurs: RoadStroke[] = [];
  for (const stub of stubs) {
    const [from, to] = stub.cells;
    if (!from || !to) continue;
    const dx = delta(to.cellX, from.cellX, world.widthCells),
      dy = delta(to.cellY, from.cellY, world.heightCells);
    if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) continue;
    const at = (back: number) => ({
      x: wrap(to.cellX * 8 - dx * back, world.widthCells * 8),
      y: wrap(to.cellY * 8 - dy * back, world.heightCells * 8),
    });
    // From the road side (one eighth short of its centre band's corner) to the corner: a stroke
    // that does not start at a cell centre has no rounded cap.
    spurs.push({ id: `${stub.id}:spur`, points: [at(1), at(4)], ...AUTOMATIC_ROAD_STYLE });
  }
  return spurs;
}
const wrap = (value: number, size: number) => ((value % size) + size) % size;
const delta = (value: number, origin: number, size: number) => {
  const direct = value - origin;
  return direct > size / 2 ? direct - size : direct < -size / 2 ? direct + size : direct;
};
