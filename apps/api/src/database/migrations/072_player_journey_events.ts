import { sql, type Kysely } from 'kysely';

/** Player journey journal (docs/DESIGN-OBSERVABILITE-PARCOURS.md, sub-slice A):
 * one row per village command as the server answered it, written outside the
 * business transaction by a bounded in-memory buffer. A replay of the same
 * commandId increments `attempts` on the same row. Rows are kept 90 days
 * (bounded purge) and follow their account, world and village by cascade.
 * Additive: a new table, no existing row is read or changed. Presence minutes
 * (sub-slice B) come with their own migration. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table player_journey_events (
      id uuid primary key,
      world_id uuid not null references worlds(id) on delete cascade,
      village_id uuid not null references villages(id) on delete cascade,
      account_id uuid not null references accounts(id) on delete cascade,
      source text not null check (source in ('command','client')),
      type text not null check (type ~ '^[a-z][a-z0-9.-]{0,63}$'),
      occurred_at timestamptz not null,
      client_at timestamptz,
      command_id uuid,
      intent_id uuid,
      outcome text not null check (outcome in ('accepted','pending','rejected','error','interrupted','observed')),
      code text check (code ~ '^[A-Za-z0-9_-]{1,64}$'),
      status_code smallint check (status_code between 100 and 599),
      subject text check (subject ~ '^[a-z0-9-]{1,40}$'),
      tool text check (tool ~ '^[a-z-]{1,32}$'),
      attempts integer not null default 1 check (attempts >= 1)
    );
    create unique index player_journey_command on player_journey_events (world_id,village_id,type,command_id)
      where source='command' and command_id is not null;
    create index player_journey_account_time on player_journey_events (account_id,occurred_at desc);
    create index player_journey_village_time on player_journey_events (village_id,occurred_at desc);
    create index player_journey_time on player_journey_events (occurred_at);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table player_journey_events`.execute(db);
}
