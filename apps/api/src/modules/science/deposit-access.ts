import { canWalkSpawnSegment, buildingAccesses, spawnDelta, type BuildingAccessState } from '@arbestra/contracts';
import { readRc1Ground } from '../worlds/rc1-ground.js';
import { travelledCells } from '@arbestra/contracts';
import { sql, type Transaction } from 'kysely';
import type { TravelCell } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { sciencePath } from './navigation.js';
import { knownGeography } from './knowledge.js';

/** Recognized access belongs to the player/world, but an engaged route starts
 * at this village. An observed marker alone never grants remote exploitation. */
export async function recognizedDepositRoute(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  target: TravelCell,
): Promise<TravelCell[] | null> {
  const village = await tx
    .selectFrom('villages')
    .innerJoin('worlds', 'worlds.id', 'villages.worldId')
    .select([
      'ownerAccountId',
      'anchorCellX',
      'anchorCellY',
      'widthCells',
      'heightCells',
      'chunkSize',
      'generationVersion',
    ])
    .where('villages.worldId', '=', worldId)
    .where('villages.id', '=', villageId)
    .executeTakeFirstOrThrow();
  const geography = await tx
    .selectFrom('sciencePrograms')
    .select('code')
    .where('worldId', '=', worldId)
    .where('accountId', '=', village.ownerAccountId)
    .where('discipline', '=', 'geography')
    .where('level', '>=', 1)
    .where('acquiredAt', 'is not', null)
    .executeTakeFirst();
  if (!geography) return null;
  const place = await tx
    .selectFrom('sciencePlaces')
    .select('sourceActivityId')
    .where('worldId', '=', worldId)
    .where('accountId', '=', village.ownerAccountId)
    .where('cellX', '=', target.cellX)
    .where('cellY', '=', target.cellY)
    .where('surveyed', '=', true)
    .executeTakeFirst();
  if (!place?.sourceActivityId) return null;
  const journey = await tx
    .selectFrom('scienceActivities')
    .select(['pathCells', 'villageId'])
    .where('worldId', '=', worldId)
    .where('accountId', '=', village.ownerAccountId)
    .where('id', '=', place.sourceActivityId)
    .where('status', '=', 'completed')
    .executeTakeFirst();
  if (!journey) return null;
  const astronomy = await tx
    .selectFrom('sciencePrograms')
    .select('code')
    .where('worldId', '=', worldId)
    .where('accountId', '=', village.ownerAccountId)
    .where('code', '=', 'astronomy-1')
    .where('acquiredAt', 'is not', null)
    .executeTakeFirst();
  const from = { cellX: village.anchorCellX, cellY: village.anchorCellY };
  if (!astronomy && journey.villageId === villageId) {
    const index = journey.pathCells.findIndex((p) => p.cellX === target.cellX && p.cellY === target.cellY);
    if (index < 0) return null;
    if (
      village.generationVersion === 3 &&
      journey.pathCells.some((p) => !Number.isInteger(p.cellX) || !Number.isInteger(p.cellY))
    ) {
      const path = journey.pathCells.slice(0, index + 1),
        ground = await readRc1Ground(tx, worldId);
      const occupied = await tx
        .selectFrom('worldCellOccupancies')
        .leftJoin('buildings', (j) =>
          j
            .onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId')
            .onRef('buildings.id', '=', 'worldCellOccupancies.buildingId'),
        )
        .select([
          'worldCellOccupancies.cellX',
          'worldCellOccupancies.cellY',
          'role',
          'buildings.id',
          'buildings.villageId',
          'buildingType',
          'visualLayout',
          'quarterTurns',
        ])
        .where('worldCellOccupancies.worldId', '=', worldId)
        .where('buildingId', 'is not', null)
        .execute();
      const hall = occupied.find(
        (c) => c.villageId === villageId && c.buildingType === 'town-hall' && c.role === 'anchor',
      );
      if (!hall) return null;
      const state = {
        world: village,
        cells: occupied.map((c) => ({
          ...c,
          footprint: { buildingId: c.id! },
          building:
            c.role === 'anchor'
              ? {
                  id: c.id!,
                  type: c.buildingType!,
                  visualLayout: c.visualLayout,
                  quarterTurns: c.visualLayout?.quarterTurns ?? c.quarterTurns!,
                }
              : null,
        })),
      } as BuildingAccessState;
      const equal = (a: TravelCell, b: TravelCell) =>
        Math.abs(spawnDelta(a.cellX, b.cellX, village.widthCells)) +
          Math.abs(spawnDelta(a.cellY, b.cellY, village.heightCells)) <
        1e-6;
      const access = buildingAccesses(state, hall.id!).find(
        (a) => path[0] && path[1] && equal(a.position, path[0]) && equal(a.outside, path[1]),
      );
      if (!access) return null;
      const owners = new Map(occupied.map((c) => [c.cellX + ':' + c.cellY, c.id]));
      const plans = await tx
          .selectFrom('villageInfrastructure')
          .select('plan')
          .where('worldId', '=', worldId)
          .execute(),
        equipment = plans.flatMap((r) => r.plan.equipment);
      for (let i = 1; i < path.length; i++) {
        const field = {
          ...ground.navigation,
          sample(x: number, y: number) {
            const base = ground.navigation.sample(x, y),
              cx = ((Math.floor(x + 0.5) % village.widthCells) + village.widthCells) % village.widthCells,
              cy = ((Math.floor(y + 0.5) % village.heightCells) + village.heightCells) % village.heightCells,
              owner = owners.get(cx + ':' + cy);
            return {
              ...base,
              blocked:
                base.blocked ||
                Boolean(owner && !(i === 1 && owner === hall.id)) ||
                equipment.some(
                  (e) =>
                    Math.abs(spawnDelta(e.x / 8, x, village.widthCells)) < 0.125 &&
                    Math.abs(spawnDelta(e.y / 8, y, village.heightCells)) < 0.125,
                ),
            };
          },
        };
        if (
          !canWalkSpawnSegment(
            field,
            { x: path[i - 1]!.cellX, y: path[i - 1]!.cellY },
            { x: path[i]!.cellX, y: path[i]!.cellY },
          )
        )
          return null;
      }
      return path; // Preserve the reported fine passage, instead of inventing a coarse remote tail.
    }
    try {
      return await sciencePath(
        tx,
        { id: worldId, ...village },
        from,
        target,
        new Set(travelledCells(journey.pathCells.slice(0, index + 1), village).map((p) => `${p.cellX}:${p.cellY}`)),
      );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'SURVEY_ROUTE_UNAVAILABLE') return null;
      throw error;
    }
  }
  const known = await knownGeography(tx, worldId, village.ownerAccountId, village.widthCells, village.heightCells);
  // The historical perimeter plus returned journeys form the recognized graph.
  for (const v of known.villages)
    for (let y = -32; y < 32; y++)
      for (let x = -32; x < 32; x++) {
        const cx = (((v.anchorCellX + x) % village.widthCells) + village.widthCells) % village.widthCells;
        const cy = (((v.anchorCellY + y) % village.heightCells) + village.heightCells) % village.heightCells;
        known.cells.add(`${cx}:${cy}`);
      }
  try {
    return await sciencePath(tx, { id: worldId, ...village }, from, target, known.cells);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'SURVEY_ROUTE_UNAVAILABLE') return null;
    throw error;
  }
}

export async function hasRecognizedDepositAccess(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  target: TravelCell,
) {
  // The full path is checked by the command's existing pathReachable contract.
  const row = await sql<{ allowed: boolean }>`select exists(
    select 1 from science_places p join villages v on v.world_id=p.world_id and v.owner_account_id=p.account_id
    join science_programs s on s.world_id=p.world_id and s.account_id=p.account_id and s.discipline='geography' and s.acquired_at is not null
    where p.world_id=${worldId} and v.id=${villageId} and p.cell_x=${target.cellX} and p.cell_y=${target.cellY}
      and p.surveyed and p.source_activity_id is not null) as allowed`.execute(tx);
  return row.rows[0]?.allowed === true;
}
