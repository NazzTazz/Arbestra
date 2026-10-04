import type { Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import { admitWorksites } from '../deposits/worksites.js';
import type { VillageEconomy } from './reconcile-economy.js';
import { stoneTravelPath } from './service.js';
import { admitExploitationGardens } from './exploitation-budget.js';

/** Worker entry point; the village was already reconciled under its lock. */
export async function admitVillageWorksites(tx: Transaction<Database>, economy: VillageEconomy): Promise<void> {
  const village = await tx.selectFrom('villages').innerJoin('worlds', 'worlds.id', 'villages.worldId')
    .select(['worlds.id as worldId', 'worlds.slug as worldSlug', 'worlds.name as worldName',
      'worlds.topology', 'worlds.widthCells', 'worlds.heightCells', 'worlds.chunkSize',
      'worlds.seed', 'worlds.generationVersion', 'villages.id as villageId',
      'villages.name as villageName', 'villages.anchorCellX', 'villages.anchorCellY'])
    .where('villages.worldId', '=', economy.worldId).where('villages.id', '=', economy.villageId)
    .executeTakeFirstOrThrow();
  await admitExploitationGardens(tx, economy);
  await admitWorksites(tx, economy, village, featureId => stoneTravelPath(tx, village, featureId));
}
