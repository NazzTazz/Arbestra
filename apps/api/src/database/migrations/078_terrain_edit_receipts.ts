import { sql, type Kysely } from 'kysely';

/** Terrain edit receipts (docs/SPEC-TERRAFORMATION-INSTANTANEE.md): edits are instant,
 * so a command leaves only its idempotency receipt. The written heights reach the
 * V2 journal through the existing ground writers. Additive only. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table terrain_edit_receipts(
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
  await sql`drop table terrain_edit_receipts;`.execute(db);
}
