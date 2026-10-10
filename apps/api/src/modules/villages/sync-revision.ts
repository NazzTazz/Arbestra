import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';

export async function villageSyncRevision(db: Kysely<Database>, worldId: string) {
  const row = (await sql<{ revision: string; others: string }>`
    select count(*)::text as revision,
      count(*) filter(where transaction_id is distinct from txid_current_if_assigned())::text as others
    from village_sync_changes where world_id = ${worldId}::uuid
  `.execute(db)).rows[0]!;
  const revision = Number(row.revision), others = Number(row.others);
  if (!Number.isSafeInteger(revision)) throw Error('Village revision exhausted');
  return { revision, others };
}
