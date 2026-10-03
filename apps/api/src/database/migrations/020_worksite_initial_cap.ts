import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table extraction_worksites add column requested_worker_cap integer`.execute(db);
  await sql`update extraction_worksites set requested_worker_cap=worker_cap`.execute(db);
  await sql`alter table extraction_worksites alter column requested_worker_cap set not null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error('Worksite initial cap migration is intentionally forward-only.');
}
