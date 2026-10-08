import { sql, type Kysely } from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
  // Zero identifies historical unversioned candidates; their stored artifacts/checksums stay unchanged.
  await sql`alter table world_generation_candidates add column recipe_revision integer not null default 0 check(recipe_revision>=0)`.execute(db);
}
