import { sql, type Kysely } from 'kysely';
import {
  desireEdgeBetween,
  overlayRoadCells,
  roadLookup,
  trailLookup,
  travelDuration,
  type DesireEdge,
  type RoadLookup,
  type TrailLookup,
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

/**
 * The visible desire paths under some paths (the beaten track, DESIRE_TRAIL_COST): the edges
 * between consecutive points of a path that lie in two neighbouring cells, read by primary key, and
 * kept when they have `world_desire_visible_passages()` passages. One indexed read, no lock, no
 * write; undefined when none is visible (or the beaten track is off).
 */
export async function pathTrailLookup(
  db: Kysely<Database>,
  world: World,
  paths: ReadonlyArray<readonly TravelCell[]>,
): Promise<TrailLookup | undefined> {
  const wanted = new Map<string, DesireEdge>();
  for (const path of paths)
    for (let i = 1; i < path.length; i++) {
      const edge = desireEdgeBetween(path[i - 1]!, path[i]!, world);
      if (edge) wanted.set(`${edge.cellX}:${edge.cellY}:${edge.direction}`, edge);
    }
  if (!wanted.size || !trailLookup(wanted.values(), world)) return undefined;
  const edges = [...wanted.values()];
  const rows = await db
    .selectFrom('worldDesireEdges')
    .select(['cellX', 'cellY', 'direction'])
    .where('worldId', '=', world.worldId)
    .where(
      sql<boolean>`(cell_x, cell_y, direction) in (select * from unnest(${edges.map((e) => e.cellX)}::integer[], ${edges.map((e) => e.cellY)}::integer[], ${edges.map((e) => e.direction)}::smallint[]))`,
    )
    .where(sql<boolean>`passages >= world_desire_visible_passages()`)
    .execute();
  return trailLookup(
    rows.map((r) => ({ cellX: r.cellX, cellY: r.cellY, direction: r.direction as DesireEdge['direction'] })),
    world,
  );
}

/** travelDuration of a path on the current roads of its world; with `trails`, also on its visible
 * desire paths, as the village search costs a mission path (not a trade convoy's). */
export async function pathTravelDuration(
  db: Kysely<Database>,
  world: World,
  path: readonly TravelCell[],
  options: { trails?: boolean } = {},
): Promise<number> {
  return travelDuration(
    path,
    world,
    await pathRoadLookup(db, world, [path]),
    options.trails ? await pathTrailLookup(db, world, [path]) : undefined,
  );
}

/** The ranges of one axis covering `[origin - 1, origin + size]` on a torus of `world` cells. */
function axisRanges(origin: number, size: number, world: number): Array<[number, number]> {
  if (size + 2 >= world) return [[0, world - 1]];
  const from = wrap(origin - 1, world),
    to = wrap(origin + size, world);
  return from <= to
    ? [[from, to]]
    : [
        [from, world - 1],
        [0, to],
      ];
}

/**
 * The visible desire edges of a village search window (its region, plus the edges that enter it
 * from the cells around): what the search reads as its beaten track (`TravelNetworkState.trails`).
 * One read by ranges of the primary key (world, cell_x, cell_y), at most two per axis on the
 * torus; no lock, no write, no cache.
 */
export async function readVisibleTrails(
  db: Kysely<Database>,
  world: World,
  region: { originCellX: number; originCellY: number; width: number; height: number },
): Promise<DesireEdge[]> {
  const xs = axisRanges(region.originCellX, region.width, world.widthCells),
    ys = axisRanges(region.originCellY, region.height, world.heightCells);
  const rows = await db
    .selectFrom('worldDesireEdges')
    .select(['cellX', 'cellY', 'direction'])
    .where('worldId', '=', world.worldId)
    .where((eb) => eb.or(xs.map(([a, b]) => eb.and([eb('cellX', '>=', a), eb('cellX', '<=', b)]))))
    .where((eb) => eb.or(ys.map(([a, b]) => eb.and([eb('cellY', '>=', a), eb('cellY', '<=', b)]))))
    .where(sql<boolean>`passages >= world_desire_visible_passages()`)
    .orderBy('cellX')
    .orderBy('cellY')
    .orderBy('direction')
    .execute();
  return rows.map((r) => ({ cellX: r.cellX, cellY: r.cellY, direction: r.direction as DesireEdge['direction'] }));
}
