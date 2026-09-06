import { sql, type Kysely } from 'kysely';

/** Persists the Oracle's village journal and adopts previously claimed supplies. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table village_accomplishments (
      world_id uuid not null,
      village_id uuid not null,
      code text not null check (code ~ '^[a-z][a-z0-9-]*$'),
      completed_at timestamptz not null,
      primary key (world_id, village_id, code),
      foreign key (world_id, village_id) references villages(world_id, id) on delete cascade
    );

    insert into village_accomplishments (world_id, village_id, code, completed_at)
      select world_id, village_id, 'town-hall-supplies', claimed_at
      from building_hidden_supplies
      where claimed_at is not null;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table village_accomplishments`.execute(db);
}
