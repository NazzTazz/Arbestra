import {sql,type Kysely} from 'kysely';

/** Decorative introduction only: no price, production, skills or public construction. */
export async function up(db:Kysely<unknown>){
  await sql`insert into building_types
    (code,display_name,progression_mode,production_mode,instance_limit_per_village,visual_key,buildable)
    values ('stonemason','Tailleur de pierres','fixed-footprint','none',1,'stonemason',false)`.execute(db);
  await sql`insert into building_type_levels
    (building_type_code,level,construction_duration_seconds,additional_cells_required,visual_variant)
    values ('stonemason',1,0,0,'stonemason-1')`.execute(db);
}
