import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table garden_harvests add column transport_ms integer not null default 0,
    add column path_cells jsonb`.execute(db);
  await sql`alter table deposit_extractions add column transport_ms integer not null default 0,
    add column path_cells jsonb`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table deposit_extractions drop column path_cells, drop column transport_ms`.execute(db);
  await sql`alter table garden_harvests drop column path_cells, drop column transport_ms`.execute(db);
}
