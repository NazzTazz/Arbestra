import { sql, type Transaction } from 'kysely';

import type { Database } from '../../database/schema.js';
import type { ScheduledTask } from '../../jobs/scheduled-tasks.js';
import { materializeBuildingBuffer, materializeVillageResource } from './economy.js';

export const COMPLETE_CONSTRUCTION_TASK = 'building.complete';
export const COMPLETE_EXPANSION_TASK = 'building-expansion.complete';

export async function settleDueConstructionsForVillage(
  transaction: Transaction<Database>,
  worldId: string,
  villageId: string,
): Promise<void> {
  const dueBuildings = await transaction.selectFrom('buildings')
    .select('id')
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .where('status', '=', 'under-construction')
    .where('constructionCompletesAt', '<=', sql<Date>`transaction_timestamp()`)
    .execute();
  for (const building of dueBuildings) await completeConstructionById(transaction, worldId, building.id);
}

export async function settleDueExpansionsForVillage(
  transaction: Transaction<Database>, worldId: string, villageId: string,
): Promise<void> {
  const due = await transaction.selectFrom('buildingExpansions')
    .select('id').where('worldId', '=', worldId).where('villageId', '=', villageId)
    .where('status', '=', 'under-construction')
    .where('completesAt', '<=', sql<Date>`transaction_timestamp()`).execute();
  for (const expansion of due) await completeExpansionById(transaction, worldId, expansion.id);
}

export async function completeExpansionById(
  transaction: Transaction<Database>, worldId: string, expansionId: string,
): Promise<void> {
  const expansion = await transaction.selectFrom('buildingExpansions').selectAll()
    .where('worldId', '=', worldId).where('id', '=', expansionId).forUpdate().executeTakeFirst();
  if (!expansion || expansion.status !== 'under-construction') return;

  const buffers = await transaction.selectFrom('buildingResourceBuffers').select('resourceCode')
    .where('worldId', '=', worldId).where('buildingId', '=', expansion.buildingId).execute();
  for (const buffer of buffers)
    await materializeBuildingBuffer(transaction, worldId, expansion.buildingId, buffer.resourceCode, expansion.completesAt);

  await transaction.updateTable('worldCellOccupancies').set({ pendingExpansionId: null })
    .where('worldId', '=', worldId).where('pendingExpansionId', '=', expansion.id).execute();
  await transaction.updateTable('buildingExpansions').set({ status: 'completed', completedAt: expansion.completesAt })
    .where('worldId', '=', worldId).where('id', '=', expansion.id)
    .where('status', '=', 'under-construction').execute();
}

export async function completeConstructionById(
  transaction: Transaction<Database>,
  worldId: string,
  buildingId: string,
): Promise<void> {
  const building = await transaction.selectFrom('buildings')
    .select(['id', 'villageId', 'status', 'constructionCompletesAt'])
    .where('id', '=', buildingId)
    .where('worldId', '=', worldId)
    .forUpdate()
    .executeTakeFirst();
  if (!building || building.status !== 'under-construction' || !building.constructionCompletesAt) return;

  const directResources = await transaction.selectFrom('villageResourceFlows')
    .select('resourceCode')
    .where('worldId', '=', worldId)
    .where('villageId', '=', building.villageId)
    .orderBy('resourceCode')
    .execute();
  for (const resource of directResources) {
    await materializeVillageResource(
      transaction, worldId, building.villageId, resource.resourceCode, building.constructionCompletesAt,
    );
  }

  const buffers = await transaction.selectFrom('buildingResourceBuffers')
    .select('resourceCode')
    .where('worldId', '=', worldId)
    .where('buildingId', '=', building.id)
    .orderBy('resourceCode')
    .execute();
  for (const buffer of buffers) {
    await materializeBuildingBuffer(
      transaction, worldId, building.id, buffer.resourceCode, building.constructionCompletesAt,
    );
  }

  await transaction.updateTable('buildings').set({
    level: sql`coalesce(target_level, level)`, targetLevel: null, status: 'completed',
    completedAt: sql.ref('constructionCompletesAt'),
  }).where('id', '=', building.id).where('status', '=', 'under-construction').executeTakeFirstOrThrow();
}

export async function completeConstruction(
  transaction: Transaction<Database>,
  task: ScheduledTask,
): Promise<void> {
  await completeConstructionById(transaction, task.worldId, task.subjectId);
}

export async function completeExpansion(
  transaction: Transaction<Database>, task: ScheduledTask,
): Promise<void> {
  await completeExpansionById(transaction, task.worldId, task.subjectId);
}
