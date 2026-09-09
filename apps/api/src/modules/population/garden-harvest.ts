import { sql, type Transaction } from 'kysely';

import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { materializeGardenPlot } from '../villages/economy.js';
import { assignWorkers, eligibleWorkers, materializeCohorts, releaseWorkers } from './work.js';

export const COMPLETE_GARDEN_HARVEST_TASK = 'garden.harvest.complete';
const HARVEST_MS = 60_000;

/** Caller holds the village lock and passes its post-lock economic bound. */
export async function startGardenHarvest(
  tx: Transaction<Database>, worldId: string, villageId: string, buildingId: string,
  cellX: number, cellY: number, commandId: string, through: Date,
) {
  const repeated = await tx.selectFrom('gardenHarvests').select(['id', 'plotCellX', 'plotCellY'])
    .where('worldId', '=', worldId).where('villageId', '=', villageId)
    .where('commandId', '=', commandId).executeTakeFirst();
  if (repeated) {
    if (repeated.plotCellX !== cellX || repeated.plotCellY !== cellY)
      throw new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette intention a déjà été utilisée pour une autre parcelle.');
    return repeated.id;
  }
  const building = await tx.selectFrom('buildings').select(['id', 'status', 'buildingType']).where('worldId', '=', worldId)
    .where('villageId', '=', villageId).where('id', '=', buildingId).forUpdate().executeTakeFirst();
  if (!building || building.buildingType !== 'garden' || building.status !== 'completed')
    throw new HttpError(404, 'GARDEN_NOT_READY', 'Jardin récoltable introuvable.');
  const plot = await tx.selectFrom('gardenPlots').select('buildingId').where('worldId', '=', worldId)
    .where('villageId', '=', villageId).where('cellX', '=', cellX).where('cellY', '=', cellY)
    .forUpdate().executeTakeFirst();
  if (!plot || plot.buildingId !== buildingId)
    throw new HttpError(404, 'GARDEN_PLOT_NOT_READY', 'Parcelle de Jardin récoltable introuvable.');
  const activeHarvest = await tx.selectFrom('gardenHarvests').select('id').where('worldId', '=', worldId)
    .where('plotCellX', '=', cellX).where('plotCellY', '=', cellY).where('status', '=', 'in-progress').executeTakeFirst();
  if (activeHarvest) throw new HttpError(409, 'GARDEN_HARVEST_IN_PROGRESS', 'Une récolte est déjà en cours sur cette parcelle.');
  const legacyHarvest = await tx.selectFrom('gardenHarvests').select('id').where('worldId', '=', worldId)
    .where('buildingId', '=', buildingId).where('plotCellX', 'is', null).where('status', '=', 'in-progress').executeTakeFirst();
  if (legacyHarvest) throw new HttpError(409, 'GARDEN_HARVEST_IN_PROGRESS', 'Une récolte existante est encore en cours sur ce Jardin.');
  const cohorts = await materializeCohorts(tx, worldId, villageId, through);
  const selected = eligibleWorkers(cohorts, HARVEST_MS);
  if (selected.reduce((count, cohort) => count + cohort.memberCount, 0) < 1)
    throw new HttpError(409, 'HARVESTERS_UNAVAILABLE', 'Aucun habitant disponible et reposé.');
  const buffer = await materializeGardenPlot(tx, worldId, cellX, cellY, through);
  if (buffer.amount === 0) throw new HttpError(409, 'GARDEN_EMPTY', 'Cette parcelle ne contient aucune carotte à récolter.');
  const completesAt = new Date(through.getTime() + HARVEST_MS);
  const harvest = await tx.insertInto('gardenHarvests').values({ worldId, villageId, buildingId, commandId,
    plotCellX: cellX, plotCellY: cellY, status: 'in-progress', startedAt: through, completesAt,
    completedAt: null, workerCount: 1, reservedCarrots: buffer.amount }).returning('id').executeTakeFirstOrThrow();
  await assignWorkers(tx, selected, 1, { harvestId: harvest.id, extractionId: null });
  await tx.updateTable('gardenPlots').set({ storedAmount: 0, productionUpdatedAt: through })
    .where('worldId', '=', worldId).where('cellX', '=', cellX).where('cellY', '=', cellY).execute();
  await tx.insertInto('scheduledTasks').values({ worldId, taskType: COMPLETE_GARDEN_HARVEST_TASK, subjectId: harvest.id,
    payload: {}, dueAt: completesAt, availableAt: completesAt, lastError: null, completedAt: null }).execute();
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
