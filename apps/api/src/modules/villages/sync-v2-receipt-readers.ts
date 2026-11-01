import { sql, type RawBuilder, type Transaction } from 'kysely';
import { pendingHarvestReceipt, type SyncV2Change } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { VillageEconomy } from './reconcile-economy.js';
import type { SyncEntityReference } from './sync-v2-readers.js';

/** Receipts of the intent workflows on the private V2 stream (migration 079).
 *
 * A snapshot lists, for one village: the expeditions still pending, plus the
 * newest {@link RECENT_RECEIPTS} submissions of the last {@link RECEIPT_WINDOW}
 * (the client keeps up to 68 entries and shows the latest outcomes); the
 * harvest gestures are the newest {@link RECENT_RECEIPTS} of the same window,
 * pending ones included (a gesture is processed within seconds, so a pending
 * one is always among the newest). A receipt that leaves the window stays in
 * the client's state until its next snapshot; a client holding a gesture whose
 * receipt it cannot find asks the server again (idempotent by command).
 * Bounds: 4 pending expeditions per village (quota) + 32 recent, 32 gestures,
 * well under the 1024 of each component's schema. A receipt belongs to the
 * account that sent it: after a change of owner it no longer reaches the
 * village's stream. */
export const RECENT_RECEIPTS = 32;
export const RECEIPT_WINDOW = '24 hours';

export function receiptReferenceQueries(context: VillageEconomy): RawBuilder<SyncEntityReference>[] {
  const { worldId, villageId, through } = context;
  const owner = sql`exists(select 1 from villages v where v.world_id=s.world_id and v.id=s.village_id
    and v.owner_account_id=s.account_id)`;
  return [
    sql<SyncEntityReference>`select 'expeditionReceipts'::text as component, command_id::text as key from (
      select s.command_id from expedition_submissions s
        where s.world_id=${worldId} and s.village_id=${villageId} and s.receipt->>'status'='pending' and ${owner}
      union
      (select s.command_id from expedition_submissions s
        where s.world_id=${worldId} and s.village_id=${villageId}
          and s.created_at > ${through}::timestamptz - ${sql.lit(RECEIPT_WINDOW)}::interval and ${owner}
        order by s.received_order desc limit ${sql.lit(RECENT_RECEIPTS)})) refs`,
    sql<SyncEntityReference>`select 'harvestReceipts'::text as component, command_id::text as key from (
      select s.command_id from harvest_submissions s
        where s.world_id=${worldId} and s.village_id=${villageId}
          and s.created_at > ${through}::timestamptz - ${sql.lit(RECEIPT_WINDOW)}::interval and ${owner}
        order by s.created_at desc limit ${sql.lit(RECENT_RECEIPTS)}) refs`,
  ];
}

const COMMAND_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function commandIds(ids: readonly string[]): string[] {
  if (ids.length > 1024) throw new RangeError('Too many receipt ids');
  for (const id of ids) if (!COMMAND_ID.test(id)) throw Error('Invalid receipt key');
  return ids.map((id) => id.toLowerCase());
}

type ExpeditionChange = Extract<SyncV2Change, { component: 'expeditionReceipts' }>;
type HarvestChange = Extract<SyncV2Change, { component: 'harvestReceipts' }>;

/** Keys the village's owner sent; any other (absent, or another village's) is a removal. */
export async function readExpeditionReceiptChange(
  tx: Transaction<Database>,
  { worldId, villageId }: VillageEconomy,
  keys: readonly string[],
): Promise<ExpeditionChange> {
  const ids = commandIds(keys);
  const rows = await tx
    .selectFrom('expeditionSubmissions as s')
    .innerJoin('villages as v', (join) => join.onRef('v.worldId', '=', 's.worldId').onRef('v.id', '=', 's.villageId'))
    .select(['s.commandId', 's.receipt'])
    .where('s.worldId', '=', worldId)
    .where('s.villageId', '=', villageId)
    .whereRef('s.accountId', '=', 'v.ownerAccountId')
    .where('s.commandId', 'in', ids)
    .orderBy('s.commandId')
    .execute();
  return {
    component: 'expeditionReceipts',
    upsert: rows.map((row) => ({ id: row.commandId, receipt: row.receipt })),
    remove: ids.filter((id) => !rows.some((row) => row.commandId === id)),
  };
}

export async function readHarvestReceiptChange(
  tx: Transaction<Database>,
  { worldId, villageId }: VillageEconomy,
  keys: readonly string[],
): Promise<HarvestChange> {
  const ids = commandIds(keys);
  const rows = await tx
    .selectFrom('harvestSubmissions as s')
    .innerJoin('villages as v', (join) => join.onRef('v.worldId', '=', 's.worldId').onRef('v.id', '=', 's.villageId'))
    .select(['s.commandId', 's.receipt'])
    .where('s.worldId', '=', worldId)
    .where('s.villageId', '=', villageId)
    .whereRef('s.accountId', '=', 'v.ownerAccountId')
    .where('s.commandId', 'in', ids)
    .orderBy('s.commandId')
    .execute();
  return {
    component: 'harvestReceipts',
    // No stored receipt yet: the gesture waits for the worker.
    upsert: rows.map((row) => ({ id: row.commandId, receipt: row.receipt ?? pendingHarvestReceipt(row.commandId) })),
    remove: ids.filter((id) => !rows.some((row) => row.commandId === id)),
  };
}
