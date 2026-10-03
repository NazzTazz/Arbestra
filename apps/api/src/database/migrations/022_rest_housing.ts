import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>){
  await sql`alter table population_cohorts add column rest_building_id uuid,
    add constraint population_rest_building_fk foreign key(world_id,rest_building_id) references buildings(world_id,id),
    add constraint population_rest_building_activity check(rest_building_id is null or (activity='resting' and harvest_id is null and extraction_id is null))`.execute(db);
  await sql`create index population_rest_building_idx on population_cohorts(world_id,village_id,rest_building_id) where rest_building_id is not null`.execute(db);
}
