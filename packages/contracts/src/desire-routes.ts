import type { DesireEdge, TravelCell, TravelRoute } from './travel-paths.js';

/** A cell with at least one of its four edges (east, south, south-east, south-west) visible as a
 * desire path: the shape of a `desirePaths` entity of the V2 stream
 * (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §17, T3b; docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md,
 * R2a). A diagonal flag is present only when true: a cell without a diagonal keeps the shape it
 * had before them, on the wire and here. */
export interface DesireCell {
  cellX: number;
  cellY: number;
  east: boolean;
  south: boolean;
  /** Towards cell (x + 1, y + 1). */
  southEast?: boolean;
  /** Towards cell (x - 1, y + 1). */
  southWest?: boolean;
}

/** Prefix of the route ids `desireRoutes` makes; no server route carries it. */
export const DESIRE_ROUTE_PREFIX = 'desire:';

/** The desire cells that carry `edges` (canonical edges, named by their origin), in the order of
 * the cells. The inverse of what `desireRoutes` reads. */
export function desireCellsFromEdges(edges: readonly DesireEdge[]): DesireCell[] {
  const cells = new Map<string, DesireCell>();
  for (const edge of edges) {
    const key = `${edge.cellX},${edge.cellY}`,
      cell = cells.get(key) ?? { cellX: edge.cellX, cellY: edge.cellY, east: false, south: false };
    if (edge.direction === 0) cell.east = true;
    else if (edge.direction === 1) cell.south = true;
    else if (edge.direction === 2) cell.southEast = true;
    else cell.southWest = true;
    cells.set(key, cell);
  }
  return [...cells.values()].sort((a, b) => a.cellY - b.cellY || a.cellX - b.cellX);
}

const wrap = (value: number, size: number) => ((value % size) + size) % size;

/**
 * The desire paths as the segments every consumer of `VillageState.travelRoutes` reads (display and
 * masking, road edges, brazier and stroke derivation, road-cell links, worker widths, the debug
 * overlay): one two-cell route per visible edge, from its origin to its eastern, southern,
 * south-eastern or south-western neighbour, wrapped on the torus. `kind` is `wood`: every desire
 * path is earth and none paves (decision 3, §8; `roadEdges` paves only `building` routes). Each
 * route's destination is its second cell. Deterministic: cells by (cellY, cellX), then east, south,
 * south-east, south-west, so equal edges give equal routes, ids included (`desire:x:y:east`,
 * `desire:x:y:south-east`).
 *
 * A diagonal route is a two-cell segment that is not cardinal. Since R2b the consumers draw and
 * walk it: strokes (an arm to the shared corner), braziers, road-cell links (a spur into the corner
 * of a road cell) and leisure walks; only the inner corners and the paved profiles of the legacy
 * road profile take cardinal steps.
 *
 * Brazier ids and positions (`auto:X:Y:sx:sy`) belong to the node cell, not to the route a node
 * was reached by, so they stay the same for the same edges. The stroke ids of a joint
 * (`auto:cell:joint:i:j`) follow the order the arms of a cell were met in, which depends on the
 * order of the edges: arm strokes are identical, joints can be numbered differently.
 *
 * Linear in the cells; the caller keeps the result while the cells do not change.
 */
export function desireRoutes(
  cells: Iterable<DesireCell>,
  world: { widthCells: number; heightCells: number },
): TravelRoute[] {
  const sorted = [...cells].sort((a, b) => a.cellY - b.cellY || a.cellX - b.cellX);
  const routes: TravelRoute[] = [];
  for (const cell of sorted) {
    const from: TravelCell = { cellX: wrap(cell.cellX, world.widthCells), cellY: wrap(cell.cellY, world.heightCells) };
    for (const [direction, present, dx, dy] of [
      ['east', cell.east, 1, 0],
      ['south', cell.south, 0, 1],
      ['south-east', cell.southEast === true, 1, 1],
      ['south-west', cell.southWest === true, -1, 1],
    ] as const) {
      if (!present) continue;
      const to: TravelCell = {
        cellX: wrap(from.cellX + dx, world.widthCells),
        cellY: wrap(from.cellY + dy, world.heightCells),
      };
      routes.push({
        id: `${DESIRE_ROUTE_PREFIX}${from.cellX}:${from.cellY}:${direction}`,
        kind: 'wood',
        destination: { cellX: to.cellX, cellY: to.cellY },
        cells: [from, to],
      });
    }
  }
  return routes;
}
