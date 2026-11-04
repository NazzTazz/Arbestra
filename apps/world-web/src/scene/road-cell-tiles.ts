import {
  infrastructureSidewalkSurface,
  overlayRoadCells,
  type RoadCell,
  type RoadCellSurface,
  type RoadPixel,
} from '@arbestra/contracts';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { BuildingGeometry } from './building-geometry';
import { curbStonePiece, masonryPieces } from './infrastructure-renderer';
import { flatRoadGeometry } from './infrastructure-surface-geometry';
import { ROAD_DIRECTIONS, ROAD_EAST, ROAD_NORTH, ROAD_SOUTH, ROAD_WEST } from './road-cell-links';
import { sidewalkPaving } from './sidewalk-paving';
import { WorldSpace } from './world-space';

/**
 * Recipes of the road cell tiles (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4.6, S2c): one geometry per shape ×
 * surface × sidewalks, built once on first use from the same raster, masonry and curb recipes as the stroke renderer,
 * for one canonical cell. A cell uses the tile inferred from its four neighbours, turned by quarter turns. The
 * tiles are no longer drawn as flat thin instances: `road-cell-surfaces.ts` bakes them cell by cell onto the ground,
 * vertex by vertex, so that stone follows the terrain like earth and the automatic roads.
 */
export type RoadTileShape = 'isolated' | 'end' | 'straight' | 'elbow' | 't' | 'crossing';
type Cell = Pick<RoadCell, 'cellX' | 'cellY' | 'surface' | 'sidewalks'>;

export { ROAD_EAST, ROAD_SOUTH, ROAD_WEST, ROAD_NORTH };
const NEIGHBOURS = ROAD_DIRECTIONS;
/** Canonical masks: each shape's tile is generated with these arms. */
const CANONICAL: Record<RoadTileShape, number> = {
  isolated: 0,
  end: ROAD_EAST,
  straight: ROAD_EAST | ROAD_WEST,
  elbow: ROAD_EAST | ROAD_SOUTH,
  t: ROAD_EAST | ROAD_SOUTH | ROAD_WEST,
  crossing: 15,
};
export const ROAD_TILE_SHAPES = Object.keys(CANONICAL) as RoadTileShape[];
/** One quarter turn maps east to south, south to west, west to north. */
const turnMask = (mask: number, turns: number) => {
  let m = mask;
  for (let i = 0; i < turns; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
};
const TILES: Array<{ shape: RoadTileShape; quarterTurns: number }> = Array.from({ length: 16 }, (_, mask) => {
  for (const shape of ROAD_TILE_SHAPES)
    for (let quarterTurns = 0; quarterTurns < 4; quarterTurns++)
      if (turnMask(CANONICAL[shape], quarterTurns) === mask) return { shape, quarterTurns };
  throw new Error(`No road tile for mask ${mask}`);
});
/** The tile and its quarter turns for a cell's neighbour mask. */
export function roadTileFor(mask: number): { shape: RoadTileShape; quarterTurns: number } {
  return TILES[mask & 15]!;
}
const wrap = (value: number, size: number) => ((value % size) + size) % size;
const cellKey = (x: number, y: number) => x + ':' + y;
/** The four-neighbour mask of a cell, across the toric seams. */
export function roadCellMask(
  has: (key: string) => boolean,
  x: number,
  y: number,
  world: { widthCells: number; heightCells: number },
): number {
  let mask = 0;
  for (const [dx, dy, bit] of NEIGHBOURS)
    if (has(cellKey(wrap(x + dx, world.widthCells), wrap(y + dy, world.heightCells)))) mask |= bit;
  return mask;
}

const PAVEMENT_HEIGHT = 0.04,
  CURB_HEIGHT = 0.06;
export interface RoadTileGeometry {
  pavement: VertexData | null;
  curb: VertexData | null;
}
/**
 * The canonical tile's geometry around (0, 0, 0), cell centre on flat ground:
 * the cell's own raster (centre square and arms) and the curb stones whose
 * fragment lies in the cell, computed with its neighbours present so that
 * arms stay open and sidewalks turn the corners as on a continuous road.
 */
export function roadTileGeometry(shape: RoadTileShape, surface: RoadCellSurface, sidewalks: boolean): RoadTileGeometry {
  const world = { widthCells: 8, heightCells: 8 },
    centre = 4,
    space = new WorldSpace(8, 8, { cellX: centre, cellY: centre }),
    mask = CANONICAL[shape];
  const cells: Cell[] = [{ cellX: centre, cellY: centre, surface, sidewalks }];
  for (const [dx, dy, bit] of NEIGHBOURS)
    if (mask & bit) cells.push({ cellX: centre + dx, cellY: centre + dy, surface, sidewalks });
  const raster = new Map<string, RoadPixel>();
  overlayRoadCells(raster, cells, world);
  const inCell = (x: number, y: number) => Math.floor((x + 8) / 16) === centre && Math.floor((y + 8) / 16) === centre;
  const own = new Map([...raster].filter(([, p]) => inCell(p.x, p.y)));
  const flat = () => 0;
  let pavement: VertexData | null = null;
  if (surface === 'earth' || surface === 'rubble') {
    const data = flatRoadGeometry(own, space, flat, false, 0.015, 0.025, own);
    pavement = data.indices?.length ? data : null;
  } else {
    const pieces = masonryPieces(surface, own.values(), own, space, flat, false, PAVEMENT_HEIGHT);
    pavement = pieces.length ? BuildingGeometry.merge(pieces) : null;
  }
  let curb: VertexData | null = null;
  if (sidewalks) {
    // Stones are fragments of one sidewalk pixel: the cell's own pixels give its own stones,
    // laid against the whole raster (open arms, corners turned with the neighbours).
    const own = new Map(
      [...infrastructureSidewalkSurface(raster, world)].filter(([, p]) => inCell(p.x + 0.5, p.y + 0.5)),
    );
    const positions: number[] = [],
      normals: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    for (const stone of sidewalkPaving(raster, own, world)) {
      const data = curbStonePiece(stone, space, flat, false, CURB_HEIGHT)?.data;
      if (!data) continue;
      const offset = positions.length / 3;
      positions.push(...data.positions!);
      normals.push(...data.normals!);
      uvs.push(...data.uvs!);
      for (const i of data.indices!) indices.push(i + offset);
    }
    if (indices.length) {
      curb = new VertexData();
      Object.assign(curb, { positions, normals, uvs, indices });
    }
  }
  return { pavement, curb };
}

const geometries = new Map<string, RoadTileGeometry>();
/** The tile geometry of a shape and style, built once per page on first use. */
export function roadTileGeometryOf(shape: RoadTileShape, surface: RoadCellSurface, sidewalks: boolean) {
  const key = `${shape}:${surface}:${sidewalks ? 1 : 0}`;
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = roadTileGeometry(shape, surface, sidewalks);
    geometries.set(key, geometry);
  }
  return geometry;
}
export const roadTileBuilt = (shape: RoadTileShape, surface: RoadCellSurface, sidewalks: boolean) =>
  geometries.has(`${shape}:${surface}:${sidewalks ? 1 : 0}`);
/** Drops the cached tile geometries (tests). */
export const clearRoadTileGeometries = () => geometries.clear();
