import { sql, type Transaction } from 'kysely';
import type { TravelCell } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { sciencePath } from './navigation.js';
import { knownGeography } from './knowledge.js';

/** Recognized access belongs to the player/world, but an engaged route starts
 * at this village. An observed marker alone never grants remote exploitation. */
export async function recognizedDepositRoute(tx: Transaction<Database>, worldId: string, villageId: string, target: TravelCell): Promise<TravelCell[] | null> {
  const village = await tx.selectFrom('villages').innerJoin('worlds', 'worlds.id', 'villages.worldId')
    .select(['ownerAccountId', 'anchorCellX', 'anchorCellY', 'widthCells', 'heightCells', 'chunkSize']).where('villages.worldId', '=', worldId).where('villages.id', '=', villageId).executeTakeFirstOrThrow();
  const geography = await tx.selectFrom('sciencePrograms').select('code').where('worldId', '=', worldId).where('accountId', '=', village.ownerAccountId)
    .where('discipline', '=', 'geography').where('level', '>=', 1).where('acquiredAt', 'is not', null).executeTakeFirst();
  if (!geography) return null;
  const place = await tx.selectFrom('sciencePlaces').select('sourceActivityId').where('worldId', '=', worldId).where('accountId', '=', village.ownerAccountId)
    .where('cellX', '=', target.cellX).where('cellY', '=', target.cellY).where('surveyed', '=', true).executeTakeFirst();
  if (!place?.sourceActivityId) return null;
  const journey = await tx.selectFrom('scienceActivities').select(['pathCells', 'villageId']).where('worldId', '=', worldId)
    .where('accountId', '=', village.ownerAccountId).where('id', '=', place.sourceActivityId).where('status', '=', 'completed').executeTakeFirst();
  if (!journey) return null;
  const astronomy = await tx.selectFrom('sciencePrograms').select('code').where('worldId', '=', worldId).where('accountId', '=', village.ownerAccountId)
    .where('code', '=', 'astronomy-1').where('acquiredAt', 'is not', null).executeTakeFirst();
  const from = { cellX: village.anchorCellX, cellY: village.anchorCellY };
  if (!astronomy && journey.villageId === villageId) {
    const index = journey.pathCells.findIndex(p => p.cellX === target.cellX && p.cellY === target.cellY);
    if (index < 0) return null;
    try { return await sciencePath(tx, { id: worldId, ...village }, from, target,
      new Set(journey.pathCells.slice(0, index + 1).map(p => `${p.cellX}:${p.cellY}`))); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'SURVEY_ROUTE_UNAVAILABLE') return null; throw error; }
  }
  const known = await knownGeography(tx, worldId, village.ownerAccountId, village.widthCells, village.heightCells);
  // The historical perimeter plus returned journeys form the recognized graph.
  for (const v of known.villages) for (let y = -32; y < 32; y++) for (let x = -32; x < 32; x++) {
    const cx = ((v.anchorCellX + x) % village.widthCells + village.widthCells) % village.widthCells;
    const cy = ((v.anchorCellY + y) % village.heightCells + village.heightCells) % village.heightCells;
    known.cells.add(`${cx}:${cy}`);
  }
  try { return await sciencePath(tx, { id: worldId, ...village }, from, target, known.cells); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'SURVEY_ROUTE_UNAVAILABLE') return null; throw error; }
}

export async function hasRecognizedDepositAccess(tx: Transaction<Database>, worldId: string, villageId: string, target: TravelCell) {
  // The full path is checked by the command's existing pathReachable contract.
  const row = await sql<{ allowed: boolean }>`select exists(
    select 1 from science_places p join villages v on v.world_id=p.world_id and v.owner_account_id=p.account_id
    join science_programs s on s.world_id=p.world_id and s.account_id=p.account_id and s.discipline='geography' and s.acquired_at is not null
    where p.world_id=${worldId} and v.id=${villageId} and p.cell_x=${target.cellX} and p.cell_y=${target.cellY}
      and p.surveyed and p.source_activity_id is not null) as allowed`.execute(tx);
  return row.rows[0]?.allowed === true;
}
