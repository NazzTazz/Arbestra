import type { Transaction } from 'kysely';

import type { Database } from '../../database/schema.js';
import type { ScheduledTask } from '../../jobs/scheduled-tasks.js';
import { beginVillageEconomy } from './reconcile-economy.js';
import { COMPLETE_GARDEN_HARVEST_TASK } from '../population/garden-harvest.js';
import { COMPLETE_STONE_EXTRACTION_TASK } from '../deposits/stone-extractions.js';
import { WAKE_EXTRACTION_WORKSITE_TASK } from '../deposits/worksites.js';
import { admitVillageWorksites } from './worksite-admission.js';

export const COMPLETE_CONSTRUCTION_TASK = 'building.complete';
export const COMPLETE_EXPANSION_TASK = 'building-expansion.complete';
export { COMPLETE_GARDEN_HARVEST_TASK };
export { COMPLETE_STONE_EXTRACTION_TASK };
export { WAKE_EXTRACTION_WORKSITE_TASK };

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

export async function completeGardenHarvest(
  transaction: Transaction<Database>, task: ScheduledTask,
): Promise<void> {
  const harvest = await transaction.selectFrom('gardenHarvests').select('villageId')
    .where('worldId', '=', task.worldId).where('id', '=', task.subjectId).executeTakeFirst();
  if (harvest) {
    const economy = await beginVillageEconomy(transaction, task.worldId, harvest.villageId);
    await admitVillageWorksites(transaction, economy);
  }
}

export async function completeStoneExtraction(
  transaction: Transaction<Database>, task: ScheduledTask,
): Promise<void> {
  const extraction = await transaction.selectFrom('depositExtractions').select('villageId')
    .where('worldId', '=', task.worldId).where('id', '=', task.subjectId).executeTakeFirst();
  if (extraction) {
    const economy = await beginVillageEconomy(transaction, task.worldId, extraction.villageId);
    await admitVillageWorksites(transaction, economy);
  }
}

export async function wakeExtractionWorksite(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  const worksiteId = task.payload.worksiteId;
  const version = task.payload.version;
  if (typeof worksiteId !== 'string' || typeof version !== 'number') return;
  const site = await transaction.selectFrom('extractionWorksites').select(['villageId', 'wakeVersion', 'status'])
    .where('worldId', '=', task.worldId).where('id', '=', worksiteId).executeTakeFirst();
  if (!site || site.status !== 'running' || site.wakeVersion !== version) return;
  const economy = await beginVillageEconomy(transaction, task.worldId, site.villageId);
  await admitVillageWorksites(transaction, economy);
}
