import type { Kysely } from 'kysely';
import type { TravelCell } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { wrappedDelta } from '../worlds/coordinates.js';

export async function knownGeography(db: Kysely<Database>, worldId: string, accountId: string, width: number, height: number) {
  const [places, villages] = await Promise.all([
    db.selectFrom('sciencePlaces').select(['cellX', 'cellY', 'surveyed', 'terrainCode', 'elevation']).where('worldId', '=', worldId).where('accountId', '=', accountId).execute(),
    db.selectFrom('villages').select(['id', 'anchorCellX', 'anchorCellY']).where('worldId', '=', worldId).where('ownerAccountId', '=', accountId).execute(),
  ]);
  const cells = new Set(places.map(p => `${p.cellX}:${p.cellY}`));
  // Read-only fallback allows the streamer to race the first village snapshot.
  const initial = (p: TravelCell) => villages.some(v => {
    const dx = wrappedDelta(p.cellX, v.anchorCellX, width), dy = wrappedDelta(p.cellY, v.anchorCellY, height);
    return dx >= -32 && dx < 32 && dy >= -32 && dy < 32;
  });
  return { places, villages, cells, known: (p: TravelCell) => cells.has(`${p.cellX}:${p.cellY}`) || initial(p) };
}
