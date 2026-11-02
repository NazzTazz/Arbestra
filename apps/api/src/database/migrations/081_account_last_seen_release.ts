import { sql, type Kysely } from 'kysely';

/** RELEASE_BASELINE_ID of packages/contracts/src/releases.ts, frozen here. */
const baseline = 'alpha-2026.11.01.1';

/** The release notes the Oracle presents at the load of the village
 * (docs/SPEC-NOUVEAUTES-ORACLE.md): the last version each account acknowledged.
 * Every account that exists now is credited with the alpha before the first
 * entry, so the players already on the alpha read it; later accounts get the
 * current version at registration, and a row left NULL (created outside the
 * registration route) is filled by the client without any dialog. Additive:
 * one nullable column, no index (read through the primary key only). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table accounts add column last_seen_release text
      check (last_seen_release is null or length(last_seen_release) between 1 and 40);
  `.execute(db);
  await sql`update accounts set last_seen_release = ${baseline}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table accounts drop column last_seen_release`.execute(db);
}
