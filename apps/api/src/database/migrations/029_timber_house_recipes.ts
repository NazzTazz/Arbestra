import {sql,type Kysely} from 'kysely';

/** Extend the existing JSON recipe constraint; no building or resource is rewritten. */
export async function up(db:Kysely<unknown>) {
  await sql`alter table buildings drop constraint building_visual_layout_valid,
    add constraint building_visual_layout_valid check (visual_layout is null or
      (jsonb_typeof(visual_layout)='object' and visual_layout ?& array['recipe','version','quarterTurns','entranceFace','offset']
       and visual_layout->>'recipe' in ('town-hall','stone-house','log-house','beam-house') and visual_layout->>'version'='1'
       and visual_layout->>'quarterTurns' in ('0','1','2','3') and visual_layout->>'entranceFace' in ('-x','+x','-z','+z')
       and jsonb_typeof(visual_layout->'offset')='array' and jsonb_array_length(visual_layout->'offset')=2))`.execute(db);
}
