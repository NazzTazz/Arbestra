import { sql, type Kysely } from 'kysely';

/** Demolition receipts (docs/SPEC-DEMOLITION.md §9): demolition is immediate,
 * so a command leaves only its idempotency receipt. The deleted rows reach the
 * private V2 journal through the existing writers. Additive only. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table demolition_receipts(
      world_id uuid not null,
      village_id uuid not null,
      command_id uuid not null,
      request jsonb not null,
      result jsonb not null,
      created_at timestamptz not null,
      primary key(world_id,village_id,command_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table demolition_receipts;`.execute(db);
}
