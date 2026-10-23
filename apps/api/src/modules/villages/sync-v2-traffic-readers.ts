import type { Transaction } from 'kysely';
import type { SyncV2Change } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { VillageEconomy } from './reconcile-economy.js';
import type { SyncEntityReference } from './sync-v2-readers.js';

type Context = VillageEconomy & { accountId: string };
type Convoy = Extract<SyncV2Change, { component: 'convoys' }>['upsert'][number];

/** Single visibility point of the public traffic. Every active convoy of the
 * world is observable today, as in the historical snapshot; future knowledge
 * or sight rules filter here, never by omitting journal references. */
function visibleConvoys(_context: Context, convoys: Convoy[]): Convoy[] {
  return convoys;
}

/** Active convoys only: a returned convoy leaves the public projection. */
export async function readTrafficScopeSnapshot(tx: Transaction<Database>, context: Context): Promise<SyncV2Change[]> {
  const rows = await tx
    .selectFrom('tradeJourneys')
    .select('id')
    .where('worldId', '=', context.worldId)
    .where('returnsAt', '>', context.through)
    .orderBy('id')
    .limit(1025)
    .execute();
  if (rows.length > 1024) throw new RangeError('Traffic snapshot requires pagination');
  const changes = await readTrafficChanges(
    tx,
    context,
    rows.map((row) => ({ component: 'convoys', key: row.id })),
  );
  return changes.length
    ? changes.map((change) => ({ ...change, remove: [] }))
    : [{ component: 'convoys', upsert: [], remove: [] }];
}

export async function readTrafficChanges(
  tx: Transaction<Database>,
  context: Context,
  references: readonly SyncEntityReference[],
): Promise<SyncV2Change[]> {
  if (!references.length) return [];
  if (references.some((reference) => reference.component !== 'convoys')) throw Error('Component outside traffic scope');
  const ids = [...new Set(references.map((reference) => reference.key))].sort();
  if (ids.length > 1024) throw new RangeError('Too many convoy ids');
  const rows = await tx
    .selectFrom('tradeJourneys')
    .selectAll()
    .where('worldId', '=', context.worldId)
    .where('id', 'in', ids)
    .where('returnsAt', '>', context.through)
    .orderBy('id')
    .execute();
  // Only the observable journey: never the offer or the delivered cargo.
  const upsert = visibleConvoys(
    context,
    rows.map((row) => ({
      id: row.id,
      villageId: row.villageId,
      destinationVillageId: row.destinationVillageId,
      workerCount: row.workerCount,
      path: row.path,
      startedAt: row.startedAt.toISOString(),
      arrivesAt: row.arrivesAt.toISOString(),
      returnsAt: row.returnsAt.toISOString(),
    })),
  );
  return [{ component: 'convoys', upsert, remove: ids.filter((id) => !upsert.some((row) => row.id === id)) }];
}
