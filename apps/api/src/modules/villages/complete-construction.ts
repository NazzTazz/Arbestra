import type { Transaction } from 'kysely';

import type { Database } from '../../database/schema.js';
import type { ScheduledTask } from '../../jobs/scheduled-tasks.js';
import { beginVillageEconomy } from './reconcile-economy.js';

export async function wakeTrade(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  const offer = await transaction
    .selectFrom('tradeOffers')
    .select('villageId')
    .where('worldId', '=', task.worldId)
    .where('id', '=', task.subjectId)
    .executeTakeFirst();
  const delivery = offer
    ? undefined
    : await transaction
        .selectFrom('tradeDeliveries')
        .select('villageId')
        .where('worldId', '=', task.worldId)
        .where('id', '=', task.subjectId)
        .executeTakeFirst();
  const villageId = offer?.villageId ?? delivery?.villageId;
  if (villageId) await beginVillageEconomy(transaction, task.worldId, villageId);
}
import { COMPLETE_GARDEN_HARVEST_TASK } from '../population/garden-harvest.js';
import { COMPLETE_STONE_EXTRACTION_TASK } from '../deposits/stone-extractions.js';
import { WAKE_EXTRACTION_WORKSITE_TASK } from '../deposits/worksites.js';
import { admitVillageWorksites } from './worksite-admission.js';
import { admitScience } from '../science/service.js';
import { POPULATION_ENERGY_TASK, cohortRestEnded, reconcileRestHousing } from '../population/work.js';

export const COMPLETE_CONSTRUCTION_TASK = 'building.complete';
export async function arrivePopulation(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  const village = await transaction
    .selectFrom('villages')
    .select('id')
    .where('worldId', '=', task.worldId)
    .where('id', '=', task.subjectId)
    .executeTakeFirst();
  if (!village) return;
  await beginVillageEconomy(transaction, task.worldId, village.id);
}
export const COMPLETE_EXPANSION_TASK = 'building-expansion.complete';
export async function deliverMarket(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  const exchange = await transaction
    .selectFrom('marketExchanges')
    .select('villageId')
    .where('worldId', '=', task.worldId)
    .where('id', '=', task.subjectId)
    .executeTakeFirst();
  if (exchange) await beginVillageEconomy(transaction, task.worldId, exchange.villageId);
}
export async function completeProcessing(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  const lot = await transaction
    .selectFrom('processingLots')
    .select('villageId')
    .where('worldId', '=', task.worldId)
    .where('id', '=', task.subjectId)
    .executeTakeFirst();
  if (lot) await beginVillageEconomy(transaction, task.worldId, lot.villageId);
}
export { COMPLETE_GARDEN_HARVEST_TASK };
export { COMPLETE_STONE_EXTRACTION_TASK };
export { WAKE_EXTRACTION_WORKSITE_TASK };

export async function completeConstruction(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  const building = await transaction
    .selectFrom('buildings')
    .select('villageId')
    .where('worldId', '=', task.worldId)
    .where('id', '=', task.subjectId)
    .executeTakeFirst();
  if (building) {
    const economy = await beginVillageEconomy(transaction, task.worldId, building.villageId);
    await admitScience(transaction, economy);
  }
}

export async function completeExpansion(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  const expansion = await transaction
    .selectFrom('buildingExpansions')
    .select('villageId')
    .where('worldId', '=', task.worldId)
    .where('id', '=', task.subjectId)
    .executeTakeFirst();
  if (expansion) await beginVillageEconomy(transaction, task.worldId, expansion.villageId);
}

export async function completeGardenHarvest(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  const harvest = await transaction
    .selectFrom('gardenHarvests')
    .select('villageId')
    .where('worldId', '=', task.worldId)
    .where('id', '=', task.subjectId)
    .executeTakeFirst();
  if (harvest) {
    const economy = await beginVillageEconomy(transaction, task.worldId, harvest.villageId);
    await admitVillageWorksites(transaction, economy);
  }
}

export async function completeStoneExtraction(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  const extraction = await transaction
    .selectFrom('depositExtractions')
    .select('villageId')
    .where('worldId', '=', task.worldId)
    .where('id', '=', task.subjectId)
    .executeTakeFirst();
  if (extraction) {
    const economy = await beginVillageEconomy(transaction, task.worldId, extraction.villageId);
    await admitVillageWorksites(transaction, economy);
  }
}

export async function wakeExtractionWorksite(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  if (typeof task.payload.exploitationOrderId === 'string') {
    const order = await transaction
      .selectFrom('exploitationOrders')
      .select('villageId')
      .where('worldId', '=', task.worldId)
      .where('id', '=', task.payload.exploitationOrderId)
      .executeTakeFirst();
    if (order)
      await admitVillageWorksites(transaction, await beginVillageEconomy(transaction, task.worldId, order.villageId));
    return;
  }
  const worksiteId = task.payload.worksiteId;
  const version = task.payload.version;
  if (typeof worksiteId !== 'string' || typeof version !== 'number') return;
  const site = await transaction
    .selectFrom('extractionWorksites')
    .select(['villageId', 'wakeVersion', 'status'])
    .where('worldId', '=', task.worldId)
    .where('id', '=', worksiteId)
    .executeTakeFirst();
  if (!site || site.status !== 'running' || site.wakeVersion !== version) return;
  const economy = await beginVillageEconomy(transaction, task.worldId, site.villageId);
  await admitVillageWorksites(transaction, economy);
}

export { POPULATION_ENERGY_TASK };
/** An inhabitant without work tires or wakes at a time no completion notifies.
 * The deadline runs what a client read used to trigger for it, with no client:
 * economy at H, admissions when a rest ended (inhabitants available again; an
 * exhaustion frees nobody and other admissions keep their own wakes), then the
 * activities and beds at H. Village first, then the economic locks; the
 * successor is scheduled before the scheduler acknowledges this notification,
 * and no other notification is read for update, modified or acknowledged. */
export async function wakePopulationEnergy(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  const village = await transaction
    .selectFrom('villages')
    .select('id')
    .where('worldId', '=', task.worldId)
    .where('id', '=', task.subjectId)
    .executeTakeFirst();
  if (!village) return;
  const economy = await beginVillageEconomy(transaction, task.worldId, village.id);
  if (await cohortRestEnded(transaction, task.worldId, village.id, economy.through)) {
    await admitVillageWorksites(transaction, economy);
    await admitScience(transaction, economy);
  }
  await reconcileRestHousing(transaction, task.worldId, village.id, economy.through, task.id);
}

export async function completeLeveling(transaction: Transaction<Database>, task: ScheduledTask): Promise<void> {
  const job = await transaction
    .selectFrom('levelingJobs')
    .select('villageId')
    .where('worldId', '=', task.worldId)
    .where('id', '=', task.subjectId)
    .executeTakeFirst();
  if (job) await beginVillageEconomy(transaction, task.worldId, job.villageId, undefined, [], [], true);
}
