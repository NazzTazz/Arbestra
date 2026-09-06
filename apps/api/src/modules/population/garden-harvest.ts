import { sql, type Transaction } from 'kysely';

import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { materializeBuildingBuffer } from '../villages/economy.js';
import { assignWorkers, eligibleWorkers, materializeCohorts, releaseWorkers } from './work.js';

export const COMPLETE_GARDEN_HARVEST_TASK = 'garden.harvest.complete';
const HARVEST_MS = 60_000;

/** Caller holds the village lock and passes its post-lock economic bound. */
export async function startGardenHarvest(
  tx: Transaction<Database>, worldId: string, villageId: string, buildingId: string, commandId: string, through: Date,
) {
  const repeated = await tx.selectFrom('gardenHarvests').select(['id', 'buildingId']).where('worldId', '=', worldId)
    .where('villageId', '=', villageId).where('commandId', '=', commandId).executeTakeFirst();
  if (repeated) {
    if (repeated.buildingId !== buildingId)
      throw new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette intention a déjà été utilisée pour un autre Jardin.');
    return repeated.id;
  }
  const activeHarvest = await tx.selectFrom('gardenHarvests').select('id').where('worldId', '=', worldId)
    .where('buildingId', '=', buildingId).where('status', '=', 'in-progress').executeTakeFirst();
  if (activeHarvest) throw new HttpError(409, 'GARDEN_HARVEST_IN_PROGRESS', 'Une récolte est déjà en cours.');
  const building = await tx.selectFrom('buildings').select(['id', 'status', 'buildingType']).where('worldId', '=', worldId)
    .where('villageId', '=', villageId).where('id', '=', buildingId).forUpdate().executeTakeFirst();
  if (!building || building.buildingType !== 'garden' || building.status !== 'completed')
    throw new HttpError(404, 'GARDEN_NOT_READY', 'Jardin récoltable introuvable.');
  const active = await tx.selectFrom('worldCellOccupancies').select(sql<number>`count(*)::integer`.as('count'))
    .where('worldId', '=', worldId).where('buildingId', '=', buildingId).where('pendingExpansionId', 'is', null).executeTakeFirstOrThrow();
  const cohorts = await materializeCohorts(tx, worldId, villageId, through);
  const needed = active.count;
  const selected = eligibleWorkers(cohorts, HARVEST_MS);
  if (selected.reduce((count, cohort) => count + cohort.memberCount, 0) < needed)
    throw new HttpError(409, 'HARVESTERS_UNAVAILABLE', 'Habitants disponibles et reposés insuffisants.');
  const buffer = await materializeBuildingBuffer(tx, worldId, buildingId, 'carrot', through);
  if (buffer.amount === 0) throw new HttpError(409, 'GARDEN_EMPTY', 'Le Jardin ne contient aucune carotte à récolter.');
  const harvest = await tx.insertInto('gardenHarvests').values({ worldId, villageId, buildingId, commandId,
    status: 'in-progress', startedAt: through, completesAt: new Date(through.getTime() + HARVEST_MS),
    completedAt: null, workerCount: needed, reservedCarrots: buffer.amount }).returning('id').executeTakeFirstOrThrow();
  await assignWorkers(tx, selected, needed, { harvestId: harvest.id, extractionId: null });
  await tx.updateTable('buildingResourceBuffers').set({ storedAmount: 0, productionUpdatedAt: through })
    .where('worldId', '=', worldId).where('buildingId', '=', buildingId).where('resourceCode', '=', 'carrot').execute();
  const dueAt = new Date(through.getTime() + HARVEST_MS);
  await tx.insertInto('scheduledTasks').values({ worldId, taskType: COMPLETE_GARDEN_HARVEST_TASK, subjectId: harvest.id,
    payload: {}, dueAt, availableAt: dueAt, lastError: null, completedAt: null }).execute();
  return harvest.id;
}

/** Called by the shared village reconciliation while its village lock is held. */
export async function completeGardenHarvestAt(tx: Transaction<Database>, worldId: string, villageId: string, harvestId: string, through: Date) {
  const harvest = await tx.selectFrom('gardenHarvests').selectAll().where('worldId', '=', worldId)
    .where('villageId', '=', villageId).where('id', '=', harvestId).forUpdate().executeTakeFirst();
  if (!harvest || harvest.status !== 'in-progress' || harvest.completesAt.getTime() !== through.getTime()) return;
  const cohorts = await materializeCohorts(tx, worldId, villageId, through);
  await releaseWorkers(tx, cohorts.filter((cohort) => cohort.harvestId === harvestId), harvest.workerCount, through);
  await tx.updateTable('villageResources').set({ amount: sql`amount + ${harvest.reservedCarrots}::bigint` })
    .where('worldId', '=', worldId).where('villageId', '=', villageId).where('resourceCode', '=', 'carrot').execute();
  await tx.updateTable('gardenHarvests').set({ status: 'completed', completedAt: through })
    .where('id', '=', harvestId).execute();
}
