import {sql,type Kysely} from 'kysely';
/** Visual/catalog introduction only. No invented price, duration, soldiers or production. */
export async function up(db:Kysely<unknown>){
  await sql`insert into building_types
    (code,display_name,progression_mode,production_mode,instance_limit_per_village,visual_key,buildable)
    values ('barracks','Caserne','fixed-footprint','none',null,'barracks',false)`.execute(db);
}
