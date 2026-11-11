import { sql, type Kysely } from 'kysely';

/** Wakes a worksite target has already spent on a search that reached its node
 * budget (refonte des trajets T2b, §4.2 and decision §8.8, validated on
 * 10 November): after three, the target is abandoned with reason `budget`
 * instead of waiting forever. Reset to 0 when the target is admitted.
 * Additive: one column with a default, no backfill, no index. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table extraction_worksite_targets add column budget_wakes smallint not null default 0
      check (budget_wakes >= 0);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table extraction_worksite_targets drop column budget_wakes`.execute(db);
}
