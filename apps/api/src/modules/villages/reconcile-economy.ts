import { sql, type Transaction } from 'kysely';

import type { Database } from '../../database/schema.js';
import { materializeBuildingBuffer, materializeVillageResource } from './economy.js';

export interface VillageEconomy {
  worldId: string;
  villageId: string;
  through: Date;
}

type DueTransition =
  | { id: string; through: Date; type: 'construction' }
  | { id: string; through: Date; type: 'expansion' };

/** The village row serializes all economic mutations for that village. */
export async function beginVillageEconomy(
  transaction: Transaction<Database>, worldId: string, villageId: string,
): Promise<VillageEconomy> {
  await transaction.selectFrom('villages').select('id')
    .where('worldId', '=', worldId).where('id', '=', villageId)
    .forUpdate().executeTakeFirstOrThrow();
  // Read after waiting for the village lock: transaction_timestamp may be stale.
  const through = (await transaction.selectNoFrom(sql<Date>`statement_timestamp()`.as('through'))
    .executeTakeFirstOrThrow()).through;
  const economy = { worldId, villageId, through };
  await reconcileVillageEconomy(transaction, economy);
  return economy;
}

/** Requires the village lock and a context retained within this same transaction. */
export async function reconcileVillageEconomy(
  transaction: Transaction<Database>, economy: VillageEconomy,
): Promise<void> {
  const [constructions, expansions] = await Promise.all([
    transaction.selectFrom('buildings').select(['id', 'constructionCompletesAt'])
      .where('worldId', '=', economy.worldId).where('villageId', '=', economy.villageId)
      .where('status', '=', 'under-construction').where('constructionCompletesAt', '<=', economy.through).execute(),
    transaction.selectFrom('buildingExpansions').select(['id', 'completesAt'])
      .where('worldId', '=', economy.worldId).where('villageId', '=', economy.villageId)
      .where('status', '=', 'under-construction').where('completesAt', '<=', economy.through).execute(),
  ]);
  const due: DueTransition[] = [
    ...constructions.flatMap((building) => building.constructionCompletesAt
      ? [{ id: building.id, through: building.constructionCompletesAt, type: 'construction' as const }] : []),
    ...expansions.map((expansion) => ({ id: expansion.id, through: expansion.completesAt, type: 'expansion' as const })),
  ].sort((left, right) => left.through.getTime() - right.through.getTime()
    || left.id.localeCompare(right.id) || left.type.localeCompare(right.type));
  for (const transition of due) {
    if (transition.type === 'construction')
      await completeConstructionAt(transaction, economy, transition.id, transition.through);
    else
      await completeExpansionAt(transaction, economy, transition.id, transition.through);
  }
}

async function completeConstructionAt(
  transaction: Transaction<Database>, economy: VillageEconomy, buildingId: string, through: Date,
): Promise<void> {
  const building = await transaction.selectFrom('buildings').select(['id', 'status', 'constructionCompletesAt'])
    .where('worldId', '=', economy.worldId).where('villageId', '=', economy.villageId)
    .where('id', '=', buildingId).forUpdate().executeTakeFirst();
  if (!building || building.status !== 'under-construction' || !building.constructionCompletesAt
    || building.constructionCompletesAt.getTime() !== through.getTime() || building.constructionCompletesAt > economy.through) return;
  const directResources = await transaction.selectFrom('villageResourceFlows').select('resourceCode')
    .where('worldId', '=', economy.worldId).where('villageId', '=', economy.villageId).orderBy('resourceCode').execute();
  for (const resource of directResources)
    await materializeVillageResource(transaction, economy.worldId, economy.villageId, resource.resourceCode, through);
  const buffers = await transaction.selectFrom('buildingResourceBuffers').select('resourceCode')
    .where('worldId', '=', economy.worldId).where('buildingId', '=', building.id).orderBy('resourceCode').execute();
  for (const buffer of buffers)
    await materializeBuildingBuffer(transaction, economy.worldId, building.id, buffer.resourceCode, through);
  await transaction.updateTable('buildings').set({
    level: sql`coalesce(target_level, level)`, targetLevel: null, status: 'completed', completedAt: sql.ref('constructionCompletesAt'),
  }).where('id', '=', building.id).where('status', '=', 'under-construction').executeTakeFirstOrThrow();
}

async function completeExpansionAt(
  transaction: Transaction<Database>, economy: VillageEconomy, expansionId: string, through: Date,
): Promise<void> {
  const expansion = await transaction.selectFrom('buildingExpansions').selectAll()
    .where('worldId', '=', economy.worldId).where('villageId', '=', economy.villageId)
    .where('id', '=', expansionId).forUpdate().executeTakeFirst();
  if (!expansion || expansion.status !== 'under-construction'
    || expansion.completesAt.getTime() !== through.getTime() || expansion.completesAt > economy.through) return;
  const buffers = await transaction.selectFrom('buildingResourceBuffers').select('resourceCode')
    .where('worldId', '=', economy.worldId).where('buildingId', '=', expansion.buildingId).orderBy('resourceCode').execute();
  for (const buffer of buffers)
    await materializeBuildingBuffer(transaction, economy.worldId, expansion.buildingId, buffer.resourceCode, through);
  await transaction.updateTable('worldCellOccupancies').set({ pendingExpansionId: null })
    .where('worldId', '=', economy.worldId).where('pendingExpansionId', '=', expansion.id).execute();
  await transaction.updateTable('buildingExpansions').set({ status: 'completed', completedAt: through })
    .where('worldId', '=', economy.worldId).where('id', '=', expansion.id)
    .where('status', '=', 'under-construction').execute();
}
