import type { Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import type { ScheduledTask } from '../../jobs/scheduled-tasks.js';
import { beginVillageEconomy } from '../villages/reconcile-economy.js';
import { admitScience } from './service.js';

export async function wakeScience(tx: Transaction<Database>, task: ScheduledTask) {
  if (typeof task.payload.villageId !== 'string') return;
  const village = await tx.selectFrom('villages').select('id').where('worldId', '=', task.worldId).where('id', '=', task.payload.villageId).executeTakeFirst();
  if (!village) return;
  const economy = await beginVillageEconomy(tx, task.worldId, village.id);
  await admitScience(tx, economy);
}
