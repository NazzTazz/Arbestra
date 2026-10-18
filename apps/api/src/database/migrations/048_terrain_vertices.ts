import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>){
 await sql`
  alter table worlds add column terrain_model text not null default 'terraces' check(terrain_model in ('terraces','vertices'));
  create table world_terrain_vertices (
   world_id uuid not null references worlds(id) on delete cascade,
   vertex_x integer not null check(vertex_x>=0), vertex_y integer not null check(vertex_y>=0),
   height double precision not null check(height > '-Infinity'::float8 and height < 'Infinity'::float8),
   primary key(world_id,vertex_x,vertex_y)
  );
  create function terrain_vertex_changed() returns trigger language plpgsql as $$
  declare wid uuid:=coalesce(NEW.world_id,OLD.world_id); p record;
  begin
   if TG_OP='UPDATE' and NEW is not distinct from OLD then return null; end if;
   if not exists(select 1 from worlds where id=wid) then return null; end if;
   for p in select distinct x,y from (values (NEW.vertex_x,NEW.vertex_y),(OLD.vertex_x,OLD.vertex_y)) v(x,y) where x is not null loop
    perform navigation_touch_box(wid,p.x-.5,p.y-.5,1.5);
   end loop;
   insert into village_sync_changes(world_id,transaction_id,navigation_changed) values(wid,txid_current(),true)
    on conflict(world_id,transaction_id) do update set navigation_changed=true;
   return null;
  end $$;
  create trigger terrain_vertex_changed after insert or update or delete on world_terrain_vertices for each row execute function terrain_vertex_changed();
  create function terrain_model_changed() returns trigger language plpgsql as $$
  begin
   if NEW.terrain_model is distinct from OLD.terrain_model then
    insert into navigation_chunk_versions(world_id,chunk_x,chunk_y,transaction_id) values(NEW.id,-1,-1,txid_current()) on conflict do nothing;
    insert into village_sync_changes(world_id,transaction_id,navigation_changed) values(NEW.id,txid_current(),true)
     on conflict(world_id,transaction_id) do update set navigation_changed=true;
   end if;
   return null;
  end $$;
  create trigger terrain_model_changed after update on worlds for each row execute function terrain_model_changed();
 `.execute(db);
}
