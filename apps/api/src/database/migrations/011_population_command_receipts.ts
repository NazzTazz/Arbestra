import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table population_command_receipts (
      world_id uuid not null,
      village_id uuid not null,
      command_id uuid not null,
      command_type text not null check (command_type in ('feed', 'rest')),
      member_count integer not null check (member_count > 0),
      created_at timestamptz not null default transaction_timestamp(),
      primary key (world_id, village_id, command_id),
      foreign key (world_id, village_id) references villages(world_id, id) on delete cascade
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error('Population command receipts are intentionally forward-only.');
}
