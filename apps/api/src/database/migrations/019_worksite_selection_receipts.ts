import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table extraction_worksites add column requested_feature_ids uuid[] not null default '{}'::uuid[]`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error('Worksite selection receipt migration is intentionally forward-only.');
}
