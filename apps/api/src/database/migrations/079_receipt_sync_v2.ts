import { sql, type Kysely } from 'kysely';

/** Expedition and harvest receipts reach the private V2 journal (inventory of
 * lot I, decision 3 of 1 November 2026): the player's client reads them from
 * the V2 stream, at the instant the worker writes them, instead of polling.
 * Both tables go through the generic private writer of 053, keyed by the
 * command (`expeditionReceipts`, `harvestReceipts`). 053 left these workflows
 * on their own transport "until their command family migrates"; the V1
 * `arbestra_expeditions` notification (042) stays for the V1 stream until its
 * removal. Additive only. */
export const expeditionReceiptSyncSource = ['expedition_submissions', 'expeditionReceipts', 'command_id'] as const;
export const harvestReceiptSyncSource = ['harvest_submissions', 'harvestReceipts', 'command_id'] as const;

export async function installReceiptSync(db: Kysely<unknown>): Promise<void> {
  const [expeditions, expeditionComponent, expeditionKey] = expeditionReceiptSyncSource;
  // The worker renews a lease every 3 s while it computes a route, and takes
  // one per attempt: only a change of the receipt itself is a change to publish.
  await sql`create trigger ${sql.id('game_sync_' + expeditionComponent)} after insert or delete on ${sql.id(expeditions)}
    for each row execute function game_sync_private_change(${sql.lit(expeditionComponent)}, ${sql.lit(expeditionKey)})`.execute(
    db,
  );
  await sql`create trigger ${sql.id('game_sync_' + expeditionComponent + '_update')} after update on ${sql.id(expeditions)}
    for each row when (old.receipt is distinct from new.receipt)
    execute function game_sync_private_change(${sql.lit(expeditionComponent)}, ${sql.lit(expeditionKey)})`.execute(db);
  const [harvests, harvestComponent, harvestKey] = harvestReceiptSyncSource;
  await sql`create trigger ${sql.id('game_sync_' + harvestComponent)} after insert or update or delete on ${sql.id(harvests)}
    for each row execute function game_sync_private_change(${sql.lit(harvestComponent)}, ${sql.lit(harvestKey)})`.execute(
    db,
  );
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await installReceiptSync(db);
  // A snapshot lists the newest submissions of one village within a day.
  await sql`create index harvest_submissions_recent on harvest_submissions(world_id, village_id, created_at desc)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index harvest_submissions_recent`.execute(db);
  await sql`drop trigger ${sql.id('game_sync_harvestReceipts')} on harvest_submissions`.execute(db);
  await sql`drop trigger ${sql.id('game_sync_expeditionReceipts_update')} on expedition_submissions`.execute(db);
  await sql`drop trigger ${sql.id('game_sync_expeditionReceipts')} on expedition_submissions`.execute(db);
}
