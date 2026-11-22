import './formats.js';
import { Type } from '@sinclair/typebox';

/** Desire lines observed (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §4.3 and §17,
 * slice T3b). The `desire` stream kind is keyed per canonical chunk ("cx,cy",
 * chunk units, like `spatial`) and carries one component. Counts and
 * timestamps of `world_desire_edges` never leave the server (decision 15):
 * a cell appears here only once one of its four edges is visible (the
 * threshold lives in the database, `world_desire_visible_passages()`), and it
 * says nothing beyond which of the four edges are. The ground owns the data:
 * every village of the world reads the same cells (decision 4). */
export const SYNC_V2_DESIRE_COMPONENTS = ['desirePaths'] as const;

const cellKey = Type.String({ pattern: '^[0-9]+,[0-9]+$' });
/** One cell whose east edge (towards cell x + 1), south edge (towards cell
 * y + 1), south-east edge (towards x + 1, y + 1) or south-west edge (towards
 * x - 1, y + 1) is visible. `id` is the canonical cell, "x,y".
 *
 * The diagonal flags (slice R2a of docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md)
 * are optional and the server writes them only when true: a cell without a
 * visible diagonal is the entity of T3b byte for byte, which a client built
 * before them still accepts. Only a cell with a diagonal is refused there (a
 * resynchronization, until the tab reloads); before the 8-direction search
 * (R1) a diagonal only comes from a legacy path that steps through the corner
 * two cells share, or a sparse unit jump. A client reads an absent flag as
 * false. */
export const SyncV2DesireCellSchema = Type.Object(
  {
    id: cellKey,
    cellX: Type.Integer({ minimum: 0 }),
    cellY: Type.Integer({ minimum: 0 }),
    east: Type.Boolean(),
    south: Type.Boolean(),
    southEast: Type.Optional(Type.Literal(true)),
    southWest: Type.Optional(Type.Literal(true)),
  },
  { additionalProperties: false },
);
// A chunk holds at most 32 x 32 = 1024 cells, the bound of the other
// chunk-keyed components.
export const SyncV2DesireChangeSchema = Type.Object(
  {
    component: Type.Literal('desirePaths'),
    upsert: Type.Array(SyncV2DesireCellSchema, { maxItems: 1024 }),
    remove: Type.Array(cellKey, { maxItems: 1024 }),
  },
  { additionalProperties: false },
);

/** Largest number of desire chunk scopes one subscription asks for. A
 * capture holds at most 64 scopes; the private stream and the four shared
 * ones (knowledge, manifest, traffic, offers) take 5, and 3 stay free. */
export const SYNC_V2_DESIRE_MAX_SCOPES = 56;

/** Chunks of one axis crossed by a window of the torus: the window sampled
 * every chunk length, plus its last cell, reaches every chunk it touches
 * (the same rule as the presentation's terrain window). Sorted. */
function chunkAxis(origin: number, size: number, cells: number, chunk: number): number[] {
  const count = Math.ceil(cells / chunk);
  if (size >= cells) return Array.from({ length: count }, (_, i) => i);
  const indexes = new Set<number>();
  for (const cell of [
    ...Array.from({ length: Math.ceil(size / chunk) }, (_, i) => origin + i * chunk),
    origin + size - 1,
  ])
    indexes.add(Math.floor((((cell % cells) + cells) % cells) / chunk));
  return [...indexes].sort((a, b) => a - b);
}
/** Distance between two chunk indexes of an axis of `count` chunks, on the torus. */
const wrapped = (a: number, b: number, count: number) => Math.min(Math.abs(a - b), count - Math.abs(a - b));

/** The desire scopes ("cx,cy") of the chunks a village's terrain window
 * covers, wrapped on the torus. Beyond `limit` chunks (a window larger than
 * the cap), the ones nearest the window's centre are kept; ties go to the
 * smaller key. Pure: the server resolves a bootstrap with it (the client does
 * not know its window before its first snapshot); a client can also check the
 * chunks of a session against a window that has changed. */
export function desireScopeKeys(
  region: { originCellX: number; originCellY: number; width: number; height: number },
  world: { widthCells: number; heightCells: number; chunkSize: number },
  limit = SYNC_V2_DESIRE_MAX_SCOPES,
): string[] {
  const { widthCells, heightCells, chunkSize } = world;
  const xs = chunkAxis(region.originCellX, region.width, widthCells, chunkSize),
    ys = chunkAxis(region.originCellY, region.height, heightCells, chunkSize);
  const countX = Math.ceil(widthCells / chunkSize),
    countY = Math.ceil(heightCells / chunkSize);
  const centre = (origin: number, size: number, cells: number) =>
      Math.floor(((((origin + Math.floor(size / 2)) % cells) + cells) % cells) / chunkSize),
    middleX = centre(region.originCellX, region.width, widthCells),
    middleY = centre(region.originCellY, region.height, heightCells);
  return ys
    .flatMap((y) =>
      xs.map((x) => ({
        key: `${x},${y}`,
        distance: wrapped(x, middleX, countX) ** 2 + wrapped(y, middleY, countY) ** 2,
      })),
    )
    .sort((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, Math.max(0, limit))
    .map((chunk) => chunk.key)
    .sort((a, b) => {
      const [ax, ay] = a.split(',').map(Number) as [number, number],
        [bx, by] = b.split(',').map(Number) as [number, number];
      return ay - by || ax - bx;
    });
}

/** The chunks a village's session should subscribe to, when they are not the ones it holds. The
 * server resolves them once, at a bootstrap, from the footprints it knows then (`desireScopeKeys`
 * over the same window rule); a window that grows later (a building placed beyond the chunks it
 * covered) needs another bootstrap, because a chunk added to a session has no cursor and would
 * turn every stream of the capture into a snapshot. `subscribed` is `SyncV2State.subscribedScopes`.
 * Returns the wanted chunk keys, sorted as strings, or null when the held set is the wanted one.
 * Pure. */
export function desireChunkDrift(
  subscribed: ReadonlySet<string> | undefined,
  region: { originCellX: number; originCellY: number; width: number; height: number },
  world: { widthCells: number; heightCells: number; chunkSize: number },
  limit = SYNC_V2_DESIRE_MAX_SCOPES,
): string[] | null {
  const wanted = desireScopeKeys(region, world, limit).sort(),
    held = [...(subscribed ?? [])]
      .filter((scope) => scope.startsWith('desire:'))
      .map((scope) => scope.slice('desire:'.length))
      .sort();
  return wanted.length === held.length && wanted.every((key, i) => key === held[i]) ? null : wanted;
}
