import { sql, type Kysely } from 'kysely';

/** Retain the original target and command bound independently of journal
 * retention. Historical starts lack a provable order identity: leave NULL. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table processing_command_receipts
    add column order_id uuid,
    add column command_time timestamptz;
    update processing_command_receipts set order_id=(request->>'orderId')::uuid
      where request->>'action' in ('pause','resume','cancel')
        and request->>'orderId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  `.execute(db);
}
