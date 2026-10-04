import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table building_command_receipts (
      world_id uuid not null,
      village_id uuid not null,
      command_id uuid not null,
      command_type text not null check(command_type in ('construct','upgrade','expand')),
      request jsonb not null,
      building_id uuid,
      created_at timestamptz not null default statement_timestamp(),
      primary key(world_id,village_id,command_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    )
  `.execute(db);
}

export async function down(): Promise<never> {
  throw new Error('Building command receipts are intentionally forward-only.');
}
