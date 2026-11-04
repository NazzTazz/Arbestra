/**
 * Spatial locks of a world, by zone (docs/VERROUS-2026-11-04.md).
 *
 * A zone is a chunk (`chunkSize` cells, 32 on RC1). Every transaction that
 * reads or changes the shared space takes advisory locks on the zones it
 * covers, in one statement, in the canonical order of their 64-bit keys:
 *
 * - shared: the region of a village whose trips it may admit (reconciliation,
 *   worksites, gardens, science), the route of a trade or an expedition;
 * - exclusive: the cells a spatial writer changes, plus a halo of
 *   `SPATIAL_WRITE_HALO` cells for the rules that look at neighbours (shared
 *   vertices, sidewalks, passage width).
 *
 * Two transactions conflict only when their zones meet, as the former single
 * world key made every pair conflict. The world key `infrastructure:<world>`
 * stays for installations and territories (exclusive among themselves) and,
 * with every zone, for the rare whole-world writers (generation, conversions).
 *
 * Order: village rows → world key → zones → deposits → local rows. Nothing
 * takes the world key after a zone, nor a village after either.
 */
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import { normalizeCell } from './coordinates.js';
import { devTime } from '../operations/dev-timing.js';

export interface SpatialGrid {
  worldId: string;
  widthCells: number;
  heightCells: number;
  chunkSize: number;
}
export interface SpatialCell {
  cellX: number;
  cellY: number;
}
/** Write cells are locked with this many neighbouring cells around them. */
export const SPATIAL_WRITE_HALO = 2;
/** Margin around a village's terrain region (itself 16 cells beyond its
 * footprints): stone paths add 8 cells, the pedestrian passage one. */
export const SPATIAL_READ_MARGIN = 16;
/** Installation: the kit, its resources (a path of at most 40 cells) and the
 * cleared trees stay well inside this radius around the chosen point. */
export const INSTALLATION_RADIUS = 64;

export const worldSpatialKey = (worldId: string) => `infrastructure:${worldId}`;
const zoneKey = (worldId: string, zx: number, zy: number) => `infrastructure:${worldId}:${zx}:${zy}`;

export function zoneColumns(grid: SpatialGrid) {
  return { columns: Math.ceil(grid.widthCells / grid.chunkSize), rows: Math.ceil(grid.heightCells / grid.chunkSize) };
}
/** Zone index (row-major) of a canonical or wrapped cell. */
export function zoneOf(grid: SpatialGrid, cellX: number, cellY: number): number {
  const { columns } = zoneColumns(grid);
  const zx = Math.floor(normalizeCell(Math.floor(cellX), grid.widthCells) / grid.chunkSize),
    zy = Math.floor(normalizeCell(Math.floor(cellY), grid.heightCells) / grid.chunkSize);
  return zy * columns + zx;
}
/** Zones along one axis covering the wrapped interval [start, start + length). */
export function axisZones(start: number, length: number, period: number, chunkSize: number): number[] {
  const count = Math.ceil(period / chunkSize);
  if (length >= period) return Array.from({ length: count }, (_, i) => i);
  const found = new Set<number>();
  const first = Math.floor(start);
  for (let cell = first; cell < first + length; ) {
    const canonical = normalizeCell(cell, period),
      zone = Math.floor(canonical / chunkSize);
    found.add(zone);
    // Jump to the next zone boundary (or the seam).
    const next = Math.min((zone + 1) * chunkSize, period);
    cell += next - canonical;
  }
  return [...found].sort((a, b) => a - b);
}
/** Zones of the cells, each with `halo` cells around it (torus). */
export function cellZones(grid: SpatialGrid, cells: Iterable<SpatialCell>, halo = 0): Set<number> {
  const { columns } = zoneColumns(grid);
  const zones = new Set<number>();
  for (const c of cells) {
    if (!Number.isFinite(c.cellX) || !Number.isFinite(c.cellY)) continue;
    const xs = axisZones(Math.floor(c.cellX) - halo, 2 * halo + 1, grid.widthCells, grid.chunkSize),
      ys = axisZones(Math.floor(c.cellY) - halo, 2 * halo + 1, grid.heightCells, grid.chunkSize);
    for (const y of ys) for (const x of xs) zones.add(y * columns + x);
  }
  return zones;
}
/** Zones of a wrapped box, widened by `margin` cells on each side. */
export function boxZones(
  grid: SpatialGrid,
  box: { originCellX: number; originCellY: number; width: number; height: number },
  margin = 0,
): Set<number> {
  const { columns } = zoneColumns(grid);
  const xs = axisZones(box.originCellX - margin, box.width + 2 * margin, grid.widthCells, grid.chunkSize),
    ys = axisZones(box.originCellY - margin, box.height + 2 * margin, grid.heightCells, grid.chunkSize);
  const zones = new Set<number>();
  for (const y of ys) for (const x of xs) zones.add(y * columns + x);
  return zones;
}
export function allZones(grid: SpatialGrid): Set<number> {
  const { columns, rows } = zoneColumns(grid);
  return new Set(Array.from({ length: columns * rows }, (_, i) => i));
}
/** Smallest wrapped interval holding every value (the widest gap is left out). */
export function wrappedSpan(values: readonly number[], period: number): { origin: number; size: number } {
  const points = [...new Set(values.map((v) => normalizeCell(Math.floor(v), period)))].sort((a, b) => a - b);
  if (!points.length) return { origin: 0, size: 0 };
  let gap = -1,
    start = points[0]!;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length]!;
    const distance = i + 1 === points.length ? next + period - points[i]! : next - points[i]!;
    if (distance > gap) {
      gap = distance;
      start = next;
    }
  }
  return { origin: start, size: Math.min(period, period - gap + 1) };
}

type Mode = 'shared' | 'exclusive';
interface Held {
  grid: SpatialGrid;
  zones: Map<number, Mode>;
  world: Mode | null;
  /** The village regions already covered (a later begin adds nothing). */
  regions: Set<string>;
}
/** What this transaction holds, as an acquisition cache; pg_locks stays the truth. */
const held = new WeakMap<object, Held>();
const grids = new Map<string, SpatialGrid>();

/** World dimensions never change: read once per process. */
export async function spatialGrid(db: Kysely<Database>, worldId: string): Promise<SpatialGrid> {
  const known = grids.get(worldId);
  if (known) return known;
  const world = await db
    .selectFrom('worlds')
    .select(['widthCells', 'heightCells', 'chunkSize'])
    .where('id', '=', worldId)
    .executeTakeFirstOrThrow();
  const grid = { worldId, ...world };
  if (grids.size > 256) grids.clear();
  grids.set(worldId, grid);
  return grid;
}

function entry(tx: object, grid: SpatialGrid): Held {
  let value = held.get(tx);
  if (!value || value.grid.worldId !== grid.worldId) {
    if (value) throw Error('One transaction locks the space of a single world');
    value = { grid, zones: new Map(), world: null, regions: new Set() };
    held.set(tx, value);
  }
  return value;
}
export function heldRegion(tx: object, villageId: string): boolean {
  return held.get(tx)?.regions.has(villageId) ?? false;
}

/**
 * Takes the world key (optional) then the zones, in one statement, ordered by
 * their 64-bit keys. A zone wanted both ways is taken exclusive. Zones already
 * held in a sufficient mode are skipped; a shared zone asked exclusive is upgraded in place (a
 * caller asks for every exclusive zone in its first acquisition).
 */
export async function lockSpatial(
  tx: Transaction<Database>,
  grid: SpatialGrid,
  request: { exclusive?: Iterable<number>; shared?: Iterable<number>; world?: Mode; regionOf?: string[] },
): Promise<void> {
  const state = entry(tx, grid);
  const wanted = new Map<number, Mode>();
  for (const zone of request.shared ?? []) wanted.set(zone, 'shared');
  for (const zone of request.exclusive ?? []) wanted.set(zone, 'exclusive');
  const keys: string[] = [],
    modes: boolean[] = [];
  for (const [zone, mode] of wanted) {
    const current = state.zones.get(zone);
    if (current === 'exclusive' || current === mode) continue;
    // A shared zone asked again exclusive is taken in place (both modes held).
    // Commands never do it: each declares its writes in its first acquisition.
    // Only fixtures that chain a read and a write in one transaction do; a
    // cycle there would be an ordinary deadlock, detected by PostgreSQL.
    const { columns } = zoneColumns(grid);
    keys.push(zoneKey(grid.worldId, zone % columns, Math.floor(zone / columns)));
    modes.push(mode === 'exclusive');
  }
  const world = request.world && state.world !== 'exclusive' && state.world !== request.world ? request.world : null;
  if (world === 'exclusive' && state.world === 'shared') throw Error('World spatial lock upgrade refused');
  if (state.zones.size && world) throw Error('The world spatial key precedes every zone');
  if (keys.length || world)
    await devTime('navigation_lock', async () => {
      if (world === 'exclusive')
        await sql`select pg_advisory_xact_lock(hashtextextended(${worldSpatialKey(grid.worldId)},0))`.execute(tx);
      else if (world === 'shared')
        await sql`select pg_advisory_xact_lock_shared(hashtextextended(${worldSpatialKey(grid.worldId)},0))`.execute(
          tx,
        );
      // A sorted subquery is never pulled up: its rows reach the locking
      // projection in key order, so two transactions never wait in a cycle.
      if (keys.length)
        await sql`select count(l) from (
          select case when z.x then pg_advisory_xact_lock(z.h)::text else pg_advisory_xact_lock_shared(z.h)::text end as l
          from (select hashtextextended(u.k,0) as h, u.x from unnest(${keys}::text[], ${modes}::boolean[]) as u(k,x) order by 1) z
        ) locked`.execute(tx);
    });
  if (world) state.world = world;
  for (const [zone, mode] of wanted) if (state.zones.get(zone) !== 'exclusive') state.zones.set(zone, mode);
  for (const id of request.regionOf ?? []) state.regions.add(id);
}

/** Whole-world writers (generation, conversions, operator scripts): the world
 * key and every zone, exclusive. Waits for every spatial reader and writer. */
export async function lockWholeWorld(tx: Transaction<Database>, worldId: string): Promise<void> {
  const grid = await spatialGrid(tx, worldId);
  // Always issued, never skipped from the cache: a caller may roll back to a
  // savepoint (which releases these locks) and take them again.
  held.delete(tx);
  await lockSpatial(tx, grid, { world: 'exclusive', exclusive: allZones(grid) });
}

/**
 * Shared zones of a village's region: its footprints and town hall, the
 * 16-cell terrain margin of `villageTerrainRegion`, then
 * `SPATIAL_READ_MARGIN`. Every trip the village admits (worksites, gardens,
 * science, stone paths) stays inside. Read after the village lock.
 */
export async function villageRegionZones(
  tx: Kysely<Database>,
  grid: SpatialGrid,
  villageId: string,
): Promise<Set<number>> {
  const row = await sql<{ ax: number; ay: number; xs: number[]; ys: number[] }>`select
      v.anchor_cell_x as ax, v.anchor_cell_y as ay,
      array(select distinct o.cell_x from world_cell_occupancies o join buildings b on b.world_id=o.world_id and b.id=o.building_id
        where b.world_id=v.world_id and b.village_id=v.id) as xs,
      array(select distinct o.cell_y from world_cell_occupancies o join buildings b on b.world_id=o.world_id and b.id=o.building_id
        where b.world_id=v.world_id and b.village_id=v.id) as ys
    from villages v where v.world_id=${grid.worldId}::uuid and v.id=${villageId}::uuid`.execute(tx);
  const village = row.rows[0];
  if (!village) return new Set();
  // Same anchor neighbourhood and padding as villageTerrainRegion.
  const x = wrappedSpan([village.ax - 16, village.ax, village.ax + 15, ...village.xs], grid.widthCells),
    y = wrappedSpan([village.ay - 16, village.ay, village.ay + 15, ...village.ys], grid.heightCells);
  const pad = 16 + SPATIAL_READ_MARGIN;
  return boxZones(grid, { originCellX: x.origin, originCellY: y.origin, width: x.size, height: y.size }, pad);
}

/** Cells of a vertex's four corner cells. */
export const vertexCells = (v: { vertexX: number; vertexY: number }): SpatialCell[] => [
  { cellX: v.vertexX - 1, cellY: v.vertexY - 1 },
  { cellX: v.vertexX, cellY: v.vertexY - 1 },
  { cellX: v.vertexX - 1, cellY: v.vertexY },
  { cellX: v.vertexX, cellY: v.vertexY },
];

const strict = () => Boolean(process.env.VITEST) || process.env.ARBESTRA_SPATIAL_GUARD === 'strict';

/**
 * Checks that this transaction holds the zones of `cells` (± halo): shared or
 * exclusive for a trip it admits, exclusive for a spatial write. A miss is a
 * programming error: thrown under tests, logged and locked late otherwise
 * (correct for the write itself, with a residual window documented in
 * docs/VERROUS-2026-11-04.md).
 */
export async function assertSpatialCoverage(
  tx: Transaction<Database>,
  worldId: string,
  cells: Iterable<SpatialCell>,
  mode: Mode,
  halo = 0,
  what = 'spatial access',
): Promise<void> {
  const grid = await spatialGrid(tx, worldId);
  const zones = cellZones(grid, cells, halo);
  if (!zones.size) return;
  const state = held.get(tx);
  if (state?.world === 'exclusive') return;
  let missing = [...zones].filter((z) => {
    const m = state?.grid.worldId === worldId ? state.zones.get(z) : undefined;
    return !(m === 'exclusive' || (m === mode && mode === 'shared'));
  });
  if (!missing.length) return;
  // The cache can miss (another transaction object): ask PostgreSQL.
  const { columns } = zoneColumns(grid);
  const keys = missing.map((z) => zoneKey(worldId, z % columns, Math.floor(z / columns)));
  const rows = await sql<{ k: string }>`select u.k from unnest(${keys}::text[]) as u(k)
    where not exists (select 1 from pg_locks l where l.pid=pg_backend_pid() and l.locktype='advisory' and l.granted
      and l.objsubid=1 and l.objid::bigint=(hashtextextended(u.k,0) & 4294967295)
      and l.classid::bigint=((hashtextextended(u.k,0) >> 32) & 4294967295)
      and (l.mode='ExclusiveLock' or ${mode === 'shared'}))`.execute(tx);
  const absent = new Set(rows.rows.map((r) => r.k));
  missing = missing.filter((z) => absent.has(zoneKey(worldId, z % columns, Math.floor(z / columns))));
  if (!missing.length) return;
  const message = `${what}: ${missing.length} zone(s) not held ${mode} in world ${worldId}`;
  // Under tests, a transaction that took zones and still misses some reveals
  // an underestimated region or write set: thrown. A transaction that took no
  // zone at all is a test fixture calling an admission directly (no
  // beginVillageEconomy): its zones are taken here, as in production.
  if (strict() && state?.grid.worldId === worldId && state.zones.size) throw Error(message);
  if (!strict() || state) console.error(message);
  console.error(message);
  await lockSpatial(tx, grid, mode === 'exclusive' ? { exclusive: missing } : { shared: missing });
}
