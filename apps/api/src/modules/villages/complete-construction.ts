import type { Transaction } from 'kysely';

import type { Database } from '../../database/schema.js';
import type { ScheduledTask } from '../../jobs/scheduled-tasks.js';
import { beginVillageEconomy } from './reconcile-economy.js';

export const COMPLETE_CONSTRUCTION_TASK = 'building.complete';
export const COMPLETE_EXPANSION_TASK = 'building-expansion.complete';

export async function completeConstruction(
  transaction: Transaction<Database>,
  task: ScheduledTask,
): Promise<void> {
  const building = await transaction.selectFrom('buildings').select('villageId')
    .where('worldId', '=', task.worldId).where('id', '=', task.subjectId).executeTakeFirst();
  if (building) await beginVillageEconomy(transaction, task.worldId, building.villageId);
}

export async function completeExpansion(
  transaction: Transaction<Database>, task: ScheduledTask,
): Promise<void> {
  const expansion = await transaction.selectFrom('buildingExpansions').select('villageId')
    .where('worldId', '=', task.worldId).where('id', '=', task.subjectId).executeTakeFirst();
  if (expansion) await beginVillageEconomy(transaction, task.worldId, expansion.villageId);
}
