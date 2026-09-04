import { sql, type Transaction } from 'kysely';

import type { Database } from '../../database/schema.js';
import type { ScheduledTask } from '../../jobs/scheduled-tasks.js';
import { materializeBuildingBuffer, materializeVillageResource } from './economy.js';

export const COMPLETE_CONSTRUCTION_TASK = 'building.complete';

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
