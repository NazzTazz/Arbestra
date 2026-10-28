import { sql, type Kysely } from 'kysely';

/** Last computed travel network of each village, keyed by the fingerprint of
 * the planner's input. A restarted API (deployment, memory pressure) reuses it
 * instead of recomputing for seconds. A cache, not game state: no journal
 * trigger, and any row may be dropped. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table village_travel_networks (
      world_id uuid not null,
      village_id uuid not null,
      fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
      routes bytea not null,
      computed_at timestamptz not null default now(),
      primary key(world_id,village_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table village_travel_networks`.execute(db);
}
