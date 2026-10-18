import { devTime } from '../operations/dev-timing.js';
import type { Kysely } from 'kysely';
import { withinDepositRange, type TravelCell } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { wrappedDelta } from '../worlds/coordinates.js';

export async function knownGeography(db: Kysely<Database>, worldId: string, accountId: string, width: number, height: number) {
  return devTime('knowledge', async () => {
  const [places, villages, footprints] = await Promise.all([
    db.selectFrom('sciencePlaces').select(['cellX', 'cellY', 'surveyed', 'terrainCode', 'elevation']).where('worldId', '=', worldId).where('accountId', '=', accountId).execute(),
    db.selectFrom('villages').select(['id', 'anchorCellX', 'anchorCellY']).where('worldId', '=', worldId).where('ownerAccountId', '=', accountId).execute(),
    db.selectFrom('worldCellOccupancies as o')
      .innerJoin('buildings as b',j=>j.onRef('b.worldId','=','o.worldId').onRef('b.id','=','o.buildingId'))
      .innerJoin('villages as v',j=>j.onRef('v.worldId','=','b.worldId').onRef('v.id','=','b.villageId'))
      .select(['o.cellX','o.cellY']).where('o.worldId','=',worldId).where('v.ownerAccountId','=',accountId)
      .where('o.pendingExpansionId','is',null)
      .where(eb=>eb.or([eb('b.status','=','completed'),eb.and([eb('b.buildingType','=','town-hall'),eb('b.targetLevel','is not',null)])])).execute(),
  ]);
  const cells = new Set(places.map(p => `${p.cellX}:${p.cellY}`));
  // Read-only fallback allows the streamer to race the first village snapshot.
  const initial = (p: TravelCell) => villages.some(v => {
    const dx = wrappedDelta(p.cellX, v.anchorCellX, width), dy = wrappedDelta(p.cellY, v.anchorCellY, height);
    return dx >= -32 && dx < 32 && dy >= -32 && dy < 32;
  });
  return { places, villages, cells, known: (p: TravelCell) => cells.has(`${p.cellX}:${p.cellY}`) || initial(p)
    || withinDepositRange(footprints,p,{widthCells:width,heightCells:height}) };
  });
}
