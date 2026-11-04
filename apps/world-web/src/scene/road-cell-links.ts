import { coarseTravelPath, type TravelRoute, type VillageState } from '@arbestra/contracts';
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
        if (!bit) continue;
        masks.set(road, (masks.get(road) ?? 0) | bit);
        stubs.set(start + '>' + road, {
          ...route,
          id: `${route.id}:link:${start}>${road}`,
          cells: [from, to],
          destination: to,
        });
      }
  }
  return masks.size ? { masks, stubs: [...stubs.values()] } : NO_ROAD_LINKS;
}
const delta = (value: number, origin: number, size: number) => {
  const direct = value - origin;
  return direct > size / 2 ? direct - size : direct < -size / 2 ? direct + size : direct;
};
