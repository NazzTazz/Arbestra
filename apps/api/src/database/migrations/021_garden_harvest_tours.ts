import {sql,type Kysely} from 'kysely';

/** Existing per-plot missions keep their deadlines, workers and receipts. */
export async function up(db:Kysely<unknown>){
  await sql`alter table garden_harvests
    add column stops jsonb not null default '[]'::jsonb check (jsonb_typeof(stops) = 'array'),
    add column return_path_cells jsonb check (return_path_cells is null or jsonb_typeof(return_path_cells) = 'array')`.execute(db);
}
