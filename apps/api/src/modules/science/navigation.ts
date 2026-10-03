import type { Transaction } from 'kysely';
import type { TravelCell } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { normalizeCell, toroidalManhattan } from '../worlds/coordinates.js';
import { HttpError } from '../../errors.js';

export interface ScienceWorld { id: string; widthCells: number; heightCells: number; chunkSize: number }
const key = (p: TravelCell) => `${p.cellX}:${p.cellY}`;

/** Bounded A* over real terrain, with lazy chunk reads. Its budget is a server
 * work limit, not a new scientific exploitation radius. No straight water crossing. */
export async function sciencePath(tx: Transaction<Database>, world: ScienceWorld, from: TravelCell, target: TravelCell,
  allowed?: Set<string>): Promise<TravelCell[]> {
  const chunks = new Map<string, { codes: number[]; blocked: Set<string> }>();
  async function passable(p: TravelCell) {
    if (key(p) === key(from)) return true;
    if (allowed && !allowed.has(key(p))) return false;
    const cx = Math.floor(p.cellX / world.chunkSize), cy = Math.floor(p.cellY / world.chunkSize), ck = `${cx}:${cy}`;
    let chunk = chunks.get(ck);
    if (!chunk) {
      const row = await tx.selectFrom('worldChunks').select('terrainCodes').where('worldId', '=', world.id)
        .where('chunkX', '=', cx).where('chunkY', '=', cy).executeTakeFirstOrThrow();
      const occupied = await tx.selectFrom('worldCellOccupancies').select(['cellX', 'cellY', 'buildingId'])
        .where('worldId', '=', world.id).where('cellX', '>=', cx * world.chunkSize).where('cellX', '<', (cx + 1) * world.chunkSize)
        .where('cellY', '>=', cy * world.chunkSize).where('cellY', '<', (cy + 1) * world.chunkSize).where('buildingId', 'is not', null).execute();
      chunk = { codes: row.terrainCodes, blocked: new Set(occupied.map(key)) }; chunks.set(ck, chunk);
    }
    return chunk.codes[(p.cellY % world.chunkSize) * world.chunkSize + p.cellX % world.chunkSize] !== 2
      && (key(p) === key(target) || !chunk.blocked.has(key(p)));
  }
  const distance = (p: TravelCell) => toroidalManhattan(p.cellX, p.cellY, target.cellX, target.cellY, world.widthCells, world.heightCells);
  const open = new Map<string, TravelCell>([[key(from), from]]), done = new Set<string>(), costs = new Map([[key(from), 0]]), previous = new Map<string, TravelCell>();
  for (let visited = 0; visited < 8192 && open.size; visited++) {
    let current = from, best = Infinity;
    for (const p of open.values()) { const score = costs.get(key(p))! + distance(p); if (score < best) { best = score; current = p; } }
    const ck = key(current); open.delete(ck);
    if (ck === key(target)) {
      const result = [current]; while (previous.has(key(result[0]!))) result.unshift(previous.get(key(result[0]!))!);
      return result;
    }
    done.add(ck);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const next = { cellX: normalizeCell(current.cellX + dx!, world.widthCells), cellY: normalizeCell(current.cellY + dy!, world.heightCells) };
      const nk = key(next), cost = costs.get(ck)! + 1;
      if (done.has(nk) || cost >= (costs.get(nk) ?? Infinity) || !await passable(next)) continue;
      previous.set(nk, current); costs.set(nk, cost); open.set(nk, next);
    }
  }
  throw new HttpError(409, 'SURVEY_ROUTE_UNAVAILABLE', 'Aucun itinéraire praticable dans le budget de calcul. Choisis un objectif intermédiaire.');
}
