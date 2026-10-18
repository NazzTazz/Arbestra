import {sql, type Kysely, type QueryExecutorProvider} from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table navigation_chunk_versions (
      world_id uuid not null references worlds(id) on delete cascade,
      chunk_x integer not null, chunk_y integer not null,
      transaction_id bigint not null,
      primary key(world_id,chunk_x,chunk_y,transaction_id)
    );
    create table navigation_chunk_crossings (
      world_id uuid not null references worlds(id) on delete cascade,
      id text not null, namespace text not null, chunk_x integer not null, chunk_y integer not null,
      dependencies jsonb not null, crossing jsonb not null,
      created_at timestamptz not null default statement_timestamp(),
      primary key(world_id,id)
    );
    create index navigation_crossings_lookup on navigation_chunk_crossings(world_id,namespace,chunk_x,chunk_y);
    create table navigation_chunk_meshes (
      world_id uuid not null references worlds(id) on delete cascade, namespace text not null,
      chunk_x integer not null, chunk_y integer not null, dependencies jsonb not null, cells text not null,
      updated_at timestamptz not null default statement_timestamp(),
      primary key(world_id,namespace,chunk_x,chunk_y)
    );
    create table navigation_hall_routes (
      world_id uuid not null references worlds(id) on delete cascade,
      key text not null, namespace text not null, payload jsonb not null,
      last_used_at timestamptz not null default statement_timestamp(),
      primary key(world_id,key)
    );
    create table navigation_route_dependencies (
      world_id uuid not null, route_key text not null, chunk_x integer not null, chunk_y integer not null, revision bigint not null,
      primary key(world_id,route_key,chunk_x,chunk_y),
      foreign key(world_id,route_key) references navigation_hall_routes(world_id,key) on delete cascade
    );
    create index navigation_routes_by_chunk on navigation_route_dependencies(world_id,chunk_x,chunk_y);
  `.execute(db);
  await installNavigationInvalidation(db);
}

/** Kept separate to exercise trigger changes transactionally on the authorized test DB. */
export async function installNavigationInvalidation(db: QueryExecutorProvider): Promise<void> {
  await sql`
    create or replace function navigation_merge_cells(a text,b text) returns text language plpgsql immutable strict as $$
    declare old_bytes bytea:=decode(a,'hex'); new_bytes bytea:=decode(b,'hex'); i integer;
    begin
      if length(old_bytes)<>length(new_bytes) then return b; end if;
      for i in 0..length(old_bytes)-1 loop old_bytes:=set_byte(old_bytes,i,get_byte(old_bytes,i)|get_byte(new_bytes,i)); end loop;
      return encode(old_bytes,'hex');
    end $$;
    create or replace function navigation_touch_box(wid uuid, px double precision, py double precision, radius double precision)
    returns void language plpgsql as $$
    declare w integer; h integer; s integer;
    begin
      select width_cells,height_cells,chunk_size into w,h,s from worlds where id=wid;
      if not found then return; end if;
      insert into navigation_chunk_versions(world_id,chunk_x,chunk_y,transaction_id)
      select distinct wid, floor(((x%w+w)%w)::numeric/s)::integer, floor(((y%h+h)%h)::numeric/s)::integer, txid_current()
      from generate_series(floor(px-radius)::integer,ceil(px+radius)::integer) x,
           generate_series(floor(py-radius)::integer,ceil(py+radius)::integer) y
      order by 2,3
      on conflict(world_id,chunk_x,chunk_y,transaction_id) do nothing;
    end $$;
    create or replace function navigation_invalidate(wid uuid, tab text, a jsonb, b jsonb)
    returns void language plpgsql as $$
    declare row jsonb; item jsonb; p jsonb; previous jsonb; t jsonb; c record;
      x double precision; y double precision; dx double precision; dy double precision; steps integer;
      w integer; h integer; s integer; known boolean:=false;
    begin
      select width_cells,height_cells,chunk_size into w,h,s from worlds where id=wid;
      if not found then return; end if;
      for row in select value from jsonb_array_elements(jsonb_build_array(a,b)) where value<>'null'::jsonb loop
        if tab in ('world_cell_occupancies','world_spawn_terraces','woodland_deposits') then
          -- Footprint/terrace half-width .5, grove offset < .36, trunk and swept width < .25.
          perform navigation_touch_box(wid,(row->>'cell_x')::float8,(row->>'cell_y')::float8,1); known:=true;
          if tab='woodland_deposits' and coalesce((a->>'cleared')::boolean,false) is distinct from coalesce((b->>'cleared')::boolean,false) then
            for t in select candidate.artifact->'forest'->'trees'->(idx.value::integer)
              from world_rc1_resources resource join world_generation_candidates candidate on candidate.world_id=resource.world_id,
                lateral jsonb_array_elements_text(resource.tree_indices) idx
              where resource.world_id=wid and resource.feature_id=(row->>'feature_id')::uuid loop
              perform navigation_touch_box(wid,(t->>'x')::float8,(t->>'y')::float8,
                .19/2.5*(t->>'crown')::float8*(t->>'size')::float8+1.0/8);
            end loop;
          end if;
        elsif tab='world_chunks' then
          perform navigation_touch_box(wid,(row->>'chunk_x')::integer*s+s/2.0,(row->>'chunk_y')::integer*s+s/2.0,s/2.0+1); known:=true;
        elsif tab='buildings' or tab='world_features' then
          for c in select cell_x,cell_y from world_cell_occupancies where world_id=wid
            and (building_id=(row->>'id')::uuid or feature_id=(row->>'id')::uuid) loop
            perform navigation_touch_box(wid,c.cell_x,c.cell_y,1); known:=true;
          end loop;
          -- An unplaced building has no access or footprint. Occupancy triggers cover its placement/removal.
          for c in select cell_x,cell_y from woodland_deposits where world_id=wid and feature_id=(row->>'id')::uuid loop
            perform navigation_touch_box(wid,c.cell_x,c.cell_y,1);
          end loop;
          known:=true;
        elsif tab='world_rc1_resources' then
          -- An empty aggregate is not physical until its woodland/occupancy row is placed.
          known:=true;
          -- Projecting an untouched natural aggregate does not change its already-existing trunks.
          if a is null and jsonb_array_length(coalesce(row->'tree_indices','[]'))>0
            and jsonb_array_length(coalesce(row->'removed_indices','[]'))=0 then continue; end if;
          for t in select artifact->'forest'->'trees'->(idx.value::integer)
            from world_generation_candidates, jsonb_array_elements_text(row->'tree_indices') idx
            where world_id=wid loop
            perform navigation_touch_box(wid,(t->>'x')::float8,(t->>'y')::float8,
              .19/2.5*(t->>'crown')::float8*(t->>'size')::float8+1.0/8); known:=true;
          end loop;
          for c in select cell_x,cell_y from woodland_deposits where world_id=wid and feature_id=(row->>'feature_id')::uuid loop
            perform navigation_touch_box(wid,c.cell_x,c.cell_y,1); known:=true;
          end loop;
        elsif tab='village_infrastructure' then
          for item in select value from jsonb_array_elements(coalesce(row->'plan'->'roads','[]') || coalesce(row->'plan'->'inheritedRoads','[]')) loop
            previous:=null;
            for p in select value from jsonb_array_elements(item->'points') loop
              x:=(p->>'x')::float8/8; y:=(p->>'y')::float8/8;
              if previous is not null then
                dx:=x-(previous->>'x')::float8/8; dy:=y-(previous->>'y')::float8/8;
                dx:=dx-floor((dx+w/2.0)/w)*w; dy:=dy-floor((dy+h/2.0)/h)*h;
                steps:=greatest(1,ceil(abs(dx)+abs(dy))::integer);
                for i in 0..steps loop
                  perform navigation_touch_box(wid,x-dx+dx*i/steps,y-dy+dy*i/steps,1);
                end loop;
              end if;
              previous:=p;
            end loop;
          end loop;
          for p in select value from jsonb_array_elements(coalesce(row->'plan'->'equipment','[]')) loop
            perform navigation_touch_box(wid,(p->>'x')::float8/8,(p->>'y')::float8/8,1);
          end loop;
          known:=true;
        elsif tab in ('world_clearings','world_factory_settings') then
          -- Neither relation is read by the authoritative navigation field.
          -- Their resulting terrain/footprint writes have their own triggers.
          known:=true;
        end if;
      end loop;
      if not known then
        -- Explicit conservative epoch for substrate/policy changes without a local footprint.
        insert into navigation_chunk_versions(world_id,chunk_x,chunk_y,transaction_id) values(wid,-1,-1,txid_current())
        on conflict(world_id,chunk_x,chunk_y,transaction_id) do nothing;
      end if;
    end $$;
    do $$ declare definition text; begin
      select pg_get_functiondef('mark_navigation_change()'::regprocedure) into definition;
      if position('insert into village_sync_changes' in definition)=0 then raise exception 'Missing navigation trigger hook'; end if;
      if position('perform navigation_invalidate' in definition)=0 then
        definition:=replace(definition,'insert into village_sync_changes',
          'perform navigation_invalidate(wid,TG_TABLE_NAME,case when TG_OP=''INSERT'' then null else to_jsonb(OLD) end,case when TG_OP=''DELETE'' then null else to_jsonb(NEW) end); insert into village_sync_changes');
      end if;
      if position('inheritedRoads' in definition)=0 then
        definition:=replace(definition,'a->''plan''->''equipment''','a->''plan''->''equipment'',a->''plan''->''inheritedRoads'',a->''plan''->''inheritedCells''');
        definition:=replace(definition,'b->''plan''->''equipment''','b->''plan''->''equipment'',b->''plan''->''inheritedRoads'',b->''plan''->''inheritedCells''');
      end if;
      execute definition;
    end $$;
  `.execute(db);
}
