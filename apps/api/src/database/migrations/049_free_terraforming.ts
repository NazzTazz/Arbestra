import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>){
  await sql`alter table leveling_jobs drop constraint leveling_jobs_worker_count_check;
    alter table leveling_jobs add constraint leveling_jobs_worker_count_check check(worker_count between 1 and 50)`.execute(db);
}
