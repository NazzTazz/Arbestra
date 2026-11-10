import { sql, type Kysely } from 'kysely';

/** The one-way duration of a survey or exploration, fixed at its admission
 * (navigation T1, docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §3). Since roads
 * shorten travel (decision 8), a duration can no longer be recomputed from the
 * path alone: the rule and the roads may have changed since the admission. A
 * recall spreads this engaged duration along the path, and the client
 * animates with it instead of recomputing one. Rows admitted before keep NULL:
 * their duration is read from their dates ((completes - start - work) / 2).
 * Additive: one nullable column, no backfill, no index. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table science_activities add column transport_ms integer
      check (transport_ms is null or transport_ms >= 0);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table science_activities drop column transport_ms`.execute(db);
}
