import { sql, type Transaction } from 'kysely';
import { desireScopeKeys, type SyncV2Change } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { OwnedVillage } from './service.js';
import { villageTerrainRegion } from './terrain-region.js';
import type { SyncEntityReference } from './sync-v2-readers.js';

/** Desire lines observed, stream kind `desire` (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md
 * §4.3 and §17, slice T3b). A scope is one canonical chunk of the world; its
 * single component, `desirePaths`, has one entity per cell of the chunk with at
 * least one visible edge: its east and south flags, and its south-east and
 * south-west flags written only when true (migration 087, slice R2a; an entity
 * without a diagonal is the one of T3b, byte for byte). Visible means
 * `passages >= world_desire_visible_passages()` (migration 086, the only place
 * that holds the threshold). Counts and `last_passage_at` are never selected
 * into a payload. The ground owns the data: no village or account filter, only
 * the world (decision 4). */
export interface DesireReadContext {
  worldId: string;
  widthCells: number;
  heightCells: number;
  chunkSize: number;
  chunkX: number;
  chunkY: number;
}
type Cell = Extract<SyncV2Change, { component: 'desirePaths' }>['upsert'][number];
/** Cells of a chunk, at most (the bound of the component's schema). */
const MAX_CELLS = 1024;

function area(context: DesireReadContext) {
  const { widthCells: width, heightCells: height, chunkSize: size, chunkX, chunkY } = context;
  if (
    ![width, height, size, chunkX, chunkY].every(Number.isSafeInteger) ||
    size < 1 ||
    width % size ||
    height % size ||
    chunkX < 0 ||
    chunkY < 0 ||
    chunkX >= width / size ||
    chunkY >= height / size
  )
    throw Error('Non-canonical desire scope');
  return { minX: chunkX * size, maxX: (chunkX + 1) * size, minY: chunkY * size, maxY: (chunkY + 1) * size };
}
type Row = { cellX: number; cellY: number; east: boolean; south: boolean; southEast: boolean; southWest: boolean };
const toCell = (row: Row): Cell => ({
  id: `${row.cellX},${row.cellY}`,
  cellX: row.cellX,
  cellY: row.cellY,
  east: row.east,
  south: row.south,
  ...(row.southEast ? { southEast: true as const } : {}),
  ...(row.southWest ? { southWest: true as const } : {}),
});

/** Every cell of the chunk with a visible edge. A snapshot carries values,
 * never tombstones, and lists its whole registry. */
export async function readDesireScopeSnapshot(
  tx: Transaction<Database>,
  context: DesireReadContext,
): Promise<SyncV2Change[]> {
  const { minX, maxX, minY, maxY } = area(context);
  const rows = await sql<Row>`
    select cell_x,cell_y,bool_or(direction=0) as east,bool_or(direction=1) as south,
      bool_or(direction=2) as south_east,bool_or(direction=3) as south_west
    from world_desire_edges
    where world_id=${context.worldId} and cell_x>=${minX} and cell_x<${maxX} and cell_y>=${minY} and cell_y<${maxY}
      and passages>=world_desire_visible_passages()
    group by cell_x,cell_y order by cell_y,cell_x limit ${MAX_CELLS + 1}`.execute(tx);
  if (rows.rows.length > MAX_CELLS) throw new RangeError('Desire snapshot requires pagination');
  return [{ component: 'desirePaths', upsert: rows.rows.map(toCell), remove: [] }];
}

/** The listed cells of the chunk, read as they are now: a cell with no visible
 * edge left (or never) is removed. Keys outside the chunk are refused. */
export async function readDesireChanges(
  tx: Transaction<Database>,
  context: DesireReadContext,
  references: readonly SyncEntityReference[],
): Promise<SyncV2Change[]> {
  if (!references.length) return [];
  const { minX, maxX, minY, maxY } = area(context);
  const keys = new Set<string>();
  for (const reference of references) {
    if (reference.component !== 'desirePaths') throw Error('Unknown desire component');
    keys.add(reference.key);
  }
  if (keys.size > MAX_CELLS) throw new RangeError('Desire selection too large');
  const cells = [...keys].sort().map((key) => {
    if (!/^[0-9]+,[0-9]+$/.test(key)) throw Error('Invalid desire cell key');
    const [x, y] = key.split(',').map(Number) as [number, number];
    if (x < minX || x >= maxX || y < minY || y >= maxY) throw Error('Cell outside desire scope');
    return { x, y, key };
  });
  const rows = (
    await sql<Row>`
    select e.cell_x,e.cell_y,bool_or(e.direction=0) as east,bool_or(e.direction=1) as south,
      bool_or(e.direction=2) as south_east,bool_or(e.direction=3) as south_west
    from world_desire_edges e
    join jsonb_to_recordset(${JSON.stringify(cells.map(({ x, y }) => ({ x, y })))}::jsonb) c(x integer,y integer)
      on e.cell_x=c.x and e.cell_y=c.y
    where e.world_id=${context.worldId} and e.passages>=world_desire_visible_passages()
    group by e.cell_x,e.cell_y order by e.cell_y,e.cell_x`.execute(tx)
  ).rows;
  const upsert = rows.map(toCell),
    present = new Set(upsert.map((cell) => cell.id));
  return [
    { component: 'desirePaths', upsert, remove: cells.map((cell) => cell.key).filter((key) => !present.has(key)) },
  ];
}

/** The desire scopes a bootstrap subscribes to: the chunks that the village's
 * terrain window covers (the presentation's own rule, `villageTerrainRegion`
 * over the persisted footprints), at most SYNC_V2_DESIRE_MAX_SCOPES. The client
 * does not know its window before its first snapshot, and asking for the
 * scopes afterwards would cost a second full capture (coverage is one per
 * batch), so the server resolves them. A chunk without a stream row (a database
 * not yet at 086, a stream removed by hand) is left out instead of failing the
 * whole capture. */
export async function desireScopesOfVillage(
  tx: Transaction<Database>,
  village: Pick<
    OwnedVillage,
    'worldId' | 'villageId' | 'anchorCellX' | 'anchorCellY' | 'widthCells' | 'heightCells' | 'chunkSize'
  >,
): Promise<Array<{ kind: 'desire'; key: string }>> {
  const footprints = await tx
    .selectFrom('worldCellOccupancies as o')
    .innerJoin('buildings as b', (join) => join.onRef('b.worldId', '=', 'o.worldId').onRef('b.id', '=', 'o.buildingId'))
    .select(['o.cellX', 'o.cellY'])
    .where('o.worldId', '=', village.worldId)
    .where('b.villageId', '=', village.villageId)
    .execute();
  const keys = desireScopeKeys(villageTerrainRegion(village, footprints), village);
  if (!keys.length) return [];
  const existing = new Set(
    (
      await sql<{ key: string }>`select scope_key as key from game_sync_streams
      where world_id=${village.worldId} and stream_kind='desire' and scope_key=any(${keys}::text[])`.execute(tx)
    ).rows.map((row) => row.key),
  );
  return keys.filter((key) => existing.has(key)).map((key) => ({ kind: 'desire' as const, key }));
}
