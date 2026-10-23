import { sql, type Kysely } from 'kysely';

/** Durable continuation of economy work, never a pending player command. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table village_economy_catchups (
    world_id uuid not null, village_id uuid not null, generation uuid not null,
    target_through timestamptz not null, completed_through timestamptz, last_transition_at timestamptz,
    transitions bigint not null default 0 check(transitions>=0),
    status text not null check(status in ('active','complete')),
    updated_at timestamptz not null default statement_timestamp(),
    primary key(world_id,village_id),
    foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
  )`.execute(db);
}
