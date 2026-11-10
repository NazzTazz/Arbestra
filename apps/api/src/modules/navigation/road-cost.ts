import { sql, type Kysely } from 'kysely';
import {
  overlayRoadCells,
  roadLookup,
  travelDuration,
  type RoadLookup,
  type RoadPixel,
  type TravelCell,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';

type World = { worldId: string; widthCells: number; heightCells: number };

const wrap = (value: number, size: number) => ((value % size) + size) % size;

/**
 * The roads under some paths, as travelDuration reads them (decision 8,
 * 10 November): the road cells touched by a point of a path, with their four
 * neighbours so that each touched cell draws its arms exactly. One indexed
 * read; undefined when no path touches a road, so the duration is the
 * historical length. Whoever laid the road, it counts.
 */
export async function pathRoadLookup(
  db: Kysely<Database>,
  world: World,
  paths: ReadonlyArray<readonly TravelCell[]>,
): Promise<RoadLookup | undefined> {
  const keys = new Set<string>();
  for (const path of paths)
    for (const p of path) {
      const x = wrap(Math.round(p.cellX), world.widthCells),
        y = wrap(Math.round(p.cellY), world.heightCells);
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        keys.add(wrap(x + dx, world.widthCells) + ':' + wrap(y + dy, world.heightCells));
    }
  if (!keys.size) return undefined;
  const xs: number[] = [],
    ys: number[] = [];
  for (const key of keys) {
    const [x, y] = key.split(':');
    xs.push(Number(x));
    ys.push(Number(y));
  }
  const rows = await db
    .selectFrom('roadCells')
    .select(['cellX', 'cellY', 'surface', 'sidewalks'])
    .where('worldId', '=', world.worldId)
    .where(sql<boolean>`(cell_x, cell_y) in (select * from unnest(${xs}::integer[], ${ys}::integer[]))`)
    .orderBy('cellX')
    .orderBy('cellY')
    .execute();
  if (!rows.length) return undefined;
  const surface = new Map<string, RoadPixel>();
  overlayRoadCells(surface, rows, world);
  return roadLookup(surface);
}

/** travelDuration of a path on the current roads of its world. */
export async function pathTravelDuration(
  db: Kysely<Database>,
  world: World,
  path: readonly TravelCell[],
): Promise<number> {
  return travelDuration(path, world, await pathRoadLookup(db, world, [path]));
}
