import { sql, type Kysely } from 'kysely';

// Staged until all corresponding readers and activation checks are validated.
export const sharedSyncSources = [
  'world_cell_occupancies', 'world_features', 'stone_deposits', 'woodland_deposits', 'world_rc1_resources',
  'world_chunks', 'world_terrain_vertices', 'world_spawn_terraces', 'buildings', 'villages',
  'player_science', 'science_programs', 'science_places', 'science_village_reports', 'science_activities', 'population_cohorts',
  'trade_offers', 'worlds', 'world_factory_settings', 'world_atlas_presentations', 'world_generation_candidates',
] as const;
export const globalCatalogSyncSources = ['resource_types', 'building_types', 'building_type_levels', 'building_level_costs',
  'building_level_production', 'building_variant_costs', 'processing_recipes', 'oracle_market_resources', 'terrain_types', 'world_feature_types'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- Exact immutable-geometry dependencies. A vertex edit must republish
    -- features whose visible points rest on it, even when their interaction
    -- cell lies in another chunk. No deposit/world scan on a vertex update.
    create table game_sync_feature_vertices (
      world_id uuid not null, feature_id uuid not null, vertex_x integer not null, vertex_y integer not null,
      primary key(world_id,feature_id,vertex_x,vertex_y)
    );
    create index game_sync_feature_vertices_lookup on game_sync_feature_vertices(world_id,vertex_x,vertex_y,feature_id);
    create function game_sync_refresh_feature_vertices(wid uuid, fid uuid) returns void language plpgsql as $$
    declare trees jsonb; sites jsonb;
    begin
      delete from game_sync_feature_vertices where world_id=wid and feature_id=fid;
      select c.artifact->'forest'->'trees',c.artifact->'stoneSites' into trees,sites
        from world_generation_candidates c where c.world_id=wid;
      insert into game_sync_feature_vertices(world_id,feature_id,vertex_x,vertex_y)
      select distinct wid,fid,
        ((floor((point->>'x')::numeric+.5)::int+dx)%w.width_cells+w.width_cells)%w.width_cells,
        ((floor((point->>'y')::numeric+.5)::int+dy)%w.height_cells+w.height_cells)%w.height_cells
      from world_rc1_resources r join worlds w on w.id=r.world_id
      cross join lateral (
        select trees->(i.value::int) as point
        from jsonb_array_elements_text(r.tree_indices) i
        where not r.removed_indices @> jsonb_build_array(i.value::int)
        union all
        select rock.value from jsonb_array_elements(coalesce(sites,'[]'::jsonb)) site
        cross join lateral jsonb_array_elements(coalesce(site.value->'rocks','[]'::jsonb)) rock
        where r.source_key='stone:'||(site.value->>'id')
      ) points cross join generate_series(0,1) dx cross join generate_series(0,1) dy
      where r.world_id=wid and r.feature_id=fid and point->>'x' is not null and point->>'y' is not null
      on conflict do nothing;
    end $$;
    -- Initial/replacement substrate: expand each immutable artifact once,
    -- instead of detoasting and walking it separately for every feature.
    create function game_sync_refresh_world_feature_vertices(wid uuid) returns void language plpgsql as $$
    begin
      delete from game_sync_feature_vertices where world_id=wid;
      insert into game_sync_feature_vertices(world_id,feature_id,vertex_x,vertex_y)
      with source as materialized (
        select w.width_cells,w.height_cells,c.artifact->'forest'->'trees' as trees,c.artifact->'stoneSites' as sites
        from worlds w join world_generation_candidates c on c.world_id=w.id where w.id=wid
      ), trees as materialized (
        select (t.ordinality-1)::int as tree_index,(t.value->>'x')::numeric as x,(t.value->>'y')::numeric as y
        from source cross join lateral jsonb_array_elements(coalesce(source.trees,'[]'::jsonb)) with ordinality t
      ), rocks as materialized (
        select 'stone:'||(s.value->>'id') as source_key,(r.value->>'x')::numeric as x,(r.value->>'y')::numeric as y
        from source cross join lateral jsonb_array_elements(coalesce(source.sites,'[]'::jsonb)) s
        cross join lateral jsonb_array_elements(coalesce(s.value->'rocks','[]'::jsonb)) r
      ), selected as (
        select r.feature_id,t.x,t.y from world_rc1_resources r
        cross join lateral jsonb_array_elements_text(r.tree_indices) i
        join trees t on t.tree_index=i.value::int
        where r.world_id=wid and not r.removed_indices @> jsonb_build_array(i.value::int)
        union all
        select r.feature_id,p.x,p.y from world_rc1_resources r join rocks p on p.source_key=r.source_key where r.world_id=wid
      ) select distinct wid,p.feature_id,
        ((floor(p.x+.5)::int+dx)%s.width_cells+s.width_cells)%s.width_cells,
        ((floor(p.y+.5)::int+dy)%s.height_cells+s.height_cells)%s.height_cells
        from selected p cross join source s cross join generate_series(0,1) dx cross join generate_series(0,1) dy
        where p.x is not null and p.y is not null on conflict do nothing;
    end $$;
    do $$ declare resource record; begin
      for resource in select distinct world_id from world_rc1_resources order by world_id loop
        perform game_sync_refresh_world_feature_vertices(resource.world_id);
      end loop;
    end $$;
    create function game_sync_spatial_touch(wid uuid, x integer, y integer, component_name text, entity text)
    returns void language plpgsql as $$
    declare dimensions record; cx integer; cy integer;
    begin
      select width_cells,height_cells,chunk_size into dimensions from worlds where id=wid;
      if not found then return; end if;
      cx:=((x % dimensions.width_cells)+dimensions.width_cells)%dimensions.width_cells;
      cy:=((y % dimensions.height_cells)+dimensions.height_cells)%dimensions.height_cells;
      perform game_sync_touch(wid,'spatial',(cx/dimensions.chunk_size)::text||','||(cy/dimensions.chunk_size)::text,
        component_name,case when entity='@cell' then cx::text||','||cy::text else entity end);
    end $$;
    create function game_sync_visibility_touch(wid uuid, x integer, y integer, radius integer)
    returns void language plpgsql as $$
    declare dx integer; dy integer; feature record; dimensions record;
    begin
      -- Actual coverage dependencies: only cells around the changed owned
      -- footprint/anchor. Work is explicit and proportional to this area.
      select width_cells,height_cells into dimensions from worlds where id=wid;
      if not found then return; end if;
      for dx in -radius..radius loop for dy in -radius..radius loop
        perform game_sync_spatial_touch(wid,x+dx,y+dy,'spatialCells','@cell');
      end loop; end loop;
      for feature in
        select distinct o.feature_id,o.cell_x,o.cell_y from world_cell_occupancies o
          where o.world_id=wid and o.feature_id is not null
            and least(abs(o.cell_x-x),dimensions.width_cells-abs(o.cell_x-x))<=radius
            and least(abs(o.cell_y-y),dimensions.height_cells-abs(o.cell_y-y))<=radius
        union select feature_id,cell_x,cell_y from stone_deposits where world_id=wid
            and least(abs(cell_x-x),dimensions.width_cells-abs(cell_x-x))<=radius
            and least(abs(cell_y-y),dimensions.height_cells-abs(cell_y-y))<=radius
        union select feature_id,cell_x,cell_y from woodland_deposits where world_id=wid
            and least(abs(cell_x-x),dimensions.width_cells-abs(cell_x-x))<=radius
            and least(abs(cell_y-y),dimensions.height_cells-abs(cell_y-y))<=radius
      loop
        perform game_sync_spatial_touch(wid,feature.cell_x,feature.cell_y,'spatialFeatures',feature.feature_id::text);
      end loop;
    end $$;
    create function game_sync_shared_change() returns trigger language plpgsql as $$
    declare item jsonb; wid uuid; owner_id uuid; entity text; location record; dimensions record; dx integer; dy integer;
      coverage_changed boolean;
    begin
      if TG_OP='UPDATE' and to_jsonb(OLD)=to_jsonb(NEW) then return null; end if;
      if TG_TABLE_NAME='villages' and TG_OP='UPDATE' and
        (to_jsonb(OLD)->'name',to_jsonb(OLD)->'owner_account_id',to_jsonb(OLD)->'anchor_cell_x',to_jsonb(OLD)->'anchor_cell_y') is not distinct from
        (to_jsonb(NEW)->'name',to_jsonb(NEW)->'owner_account_id',to_jsonb(NEW)->'anchor_cell_x',to_jsonb(NEW)->'anchor_cell_y') then return null; end if;
      if TG_TABLE_NAME='world_generation_candidates' and TG_OP='UPDATE'
        and to_jsonb(OLD)->'checksum' is not distinct from to_jsonb(NEW)->'checksum' then return null; end if;
      if TG_TABLE_NAME='population_cohorts' and TG_OP='UPDATE'
        and (to_jsonb(OLD)->'cartographer',to_jsonb(OLD)->'member_count',to_jsonb(OLD)->'village_id') is not distinct from
          (to_jsonb(NEW)->'cartographer',to_jsonb(NEW)->'member_count',to_jsonb(NEW)->'village_id') then return null; end if;
      coverage_changed:=TG_OP<>'UPDATE' or
        (to_jsonb(OLD)->'status',to_jsonb(OLD)->'target_level',to_jsonb(OLD)->'village_id',to_jsonb(OLD)->'owner_account_id',
          to_jsonb(OLD)->'anchor_cell_x',to_jsonb(OLD)->'anchor_cell_y',to_jsonb(OLD)->'pending_expansion_id',
          to_jsonb(OLD)->'cell_x',to_jsonb(OLD)->'cell_y',to_jsonb(OLD)->'building_id') is distinct from
        (to_jsonb(NEW)->'status',to_jsonb(NEW)->'target_level',to_jsonb(NEW)->'village_id',to_jsonb(NEW)->'owner_account_id',
          to_jsonb(NEW)->'anchor_cell_x',to_jsonb(NEW)->'anchor_cell_y',to_jsonb(NEW)->'pending_expansion_id',
          to_jsonb(NEW)->'cell_x',to_jsonb(NEW)->'cell_y',to_jsonb(NEW)->'building_id');
      for item in select value from jsonb_array_elements(case TG_OP
        when 'INSERT' then jsonb_build_array(to_jsonb(NEW)) when 'DELETE' then jsonb_build_array(to_jsonb(OLD))
        else jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) end)
      loop
        wid:=(case when TG_TABLE_NAME='worlds' then item->>'id' else item->>'world_id' end)::uuid;
        owner_id:=null;
        if TG_TABLE_NAME in ('player_science','science_programs','science_places','science_village_reports','science_activities') then
          owner_id:=(item->>'account_id')::uuid;
          perform game_sync_touch(wid,'knowledge',owner_id::text,'knowledgeScience','*');
          if TG_TABLE_NAME='science_places' then
            perform game_sync_touch(wid,'knowledge',owner_id::text,'knowledgePlaces',(item->>'cell_x')||','||(item->>'cell_y'));
            perform game_sync_spatial_touch(wid,(item->>'cell_x')::int,(item->>'cell_y')::int,'spatialCells','@cell');
            for location in select feature_id from world_cell_occupancies where world_id=wid
              and cell_x=(item->>'cell_x')::int and cell_y=(item->>'cell_y')::int and feature_id is not null
              union select feature_id from stone_deposits where world_id=wid
                and cell_x=(item->>'cell_x')::int and cell_y=(item->>'cell_y')::int
              union select feature_id from woodland_deposits where world_id=wid
                and cell_x=(item->>'cell_x')::int and cell_y=(item->>'cell_y')::int
            loop perform game_sync_spatial_touch(wid,(item->>'cell_x')::int,(item->>'cell_y')::int,'spatialFeatures',location.feature_id::text); end loop;
          end if;
        elsif TG_TABLE_NAME='population_cohorts' then
          if coalesce((item->>'cartographer')::boolean,false) then
            select owner_account_id into owner_id from villages where world_id=wid and id=(item->>'village_id')::uuid;
            if owner_id is not null then perform game_sync_touch(wid,'knowledge',owner_id::text,'knowledgeScience','*'); end if;
          end if;
        elsif TG_TABLE_NAME='trade_offers' then
          perform game_sync_touch(wid,'offers','all','offerIndex','*');
        elsif TG_TABLE_NAME in ('worlds','world_factory_settings','world_atlas_presentations','world_generation_candidates') then
          perform game_sync_touch(wid,'manifest',wid::text,'gameManifest','*');
          if TG_TABLE_NAME='worlds' and TG_OP='INSERT' then
            perform game_sync_touch(wid,'offers','all','offerIndex','*');
          end if;
          -- Creation/substrate replacement changes the whole world. Ordinary
          -- factory/presentation updates only change the manifest above.
          if TG_TABLE_NAME='world_generation_candidates' or TG_TABLE_NAME='worlds' and
            (TG_OP='INSERT' or TG_OP='UPDATE' and
              (to_jsonb(OLD)->'width_cells',to_jsonb(OLD)->'height_cells',to_jsonb(OLD)->'chunk_size',
                to_jsonb(OLD)->'seed',to_jsonb(OLD)->'generation_version',to_jsonb(OLD)->'terrain_model') is distinct from
              (to_jsonb(NEW)->'width_cells',to_jsonb(NEW)->'height_cells',to_jsonb(NEW)->'chunk_size',
                to_jsonb(NEW)->'seed',to_jsonb(NEW)->'generation_version',to_jsonb(NEW)->'terrain_model')) then
            select width_cells,height_cells,chunk_size into dimensions from worlds where id=wid;
            if found then
              for dx in 0..(dimensions.width_cells-1)/dimensions.chunk_size loop
                for dy in 0..(dimensions.height_cells-1)/dimensions.chunk_size loop
                  perform game_sync_spatial_touch(wid,dx*dimensions.chunk_size,dy*dimensions.chunk_size,'spatialGround','*');
                end loop;
              end loop;
              for location in select feature_id,cell_x,cell_y from world_cell_occupancies where world_id=wid and feature_id is not null
                union select feature_id,cell_x,cell_y from stone_deposits where world_id=wid
                union select feature_id,cell_x,cell_y from woodland_deposits where world_id=wid
              loop perform game_sync_spatial_touch(wid,location.cell_x,location.cell_y,'spatialFeatures',location.feature_id::text); end loop;
            end if;
          end if;
          if TG_TABLE_NAME='worlds' and TG_OP='DELETE' then
            delete from game_sync_feature_vertices where world_id=wid;
          elsif TG_TABLE_NAME='world_generation_candidates' then
            perform game_sync_refresh_world_feature_vertices(wid);
          end if;
        elsif TG_TABLE_NAME='villages' then
          owner_id:=(item->>'owner_account_id')::uuid;
          perform game_sync_touch(wid,'knowledge',owner_id::text,'knowledgeScience','*');
          if coverage_changed then
            perform game_sync_touch(wid,'knowledge',owner_id::text,'knowledgeCoverage','*');
            perform game_sync_visibility_touch(wid,(item->>'anchor_cell_x')::int,(item->>'anchor_cell_y')::int,32);
          end if;
        elsif TG_TABLE_NAME in ('world_chunks','world_terrain_vertices','world_spawn_terraces') then
          select chunk_size into dimensions from worlds where id=wid;
          if not found then continue; end if;
          if TG_TABLE_NAME='world_chunks' then
            for dx in -1..1 loop for dy in -1..1 loop
              perform game_sync_spatial_touch(wid,((item->>'chunk_x')::int+dx)*dimensions.chunk_size,
                ((item->>'chunk_y')::int+dy)*dimensions.chunk_size,'spatialGround','*');
            end loop; end loop;
          else
            for dx in -2..1 loop for dy in -2..1 loop
              perform game_sync_spatial_touch(wid,coalesce(item->>'vertex_x',item->>'cell_x')::int+dx,
                coalesce(item->>'vertex_y',item->>'cell_y')::int+dy,'spatialGround','*');
            end loop; end loop;
            if TG_TABLE_NAME='world_terrain_vertices' then
              for location in
                select distinct affected.feature_id,places.cell_x,places.cell_y
                from game_sync_feature_vertices affected
                cross join lateral (
                  select cell_x,cell_y from world_cell_occupancies where world_id=wid and feature_id=affected.feature_id
                  union select cell_x,cell_y from stone_deposits where world_id=wid and feature_id=affected.feature_id
                  union select cell_x,cell_y from woodland_deposits where world_id=wid and feature_id=affected.feature_id
                ) places
                where affected.world_id=wid and affected.vertex_x=(item->>'vertex_x')::int and affected.vertex_y=(item->>'vertex_y')::int
              loop
                perform game_sync_spatial_touch(wid,location.cell_x,location.cell_y,'spatialFeatures',location.feature_id::text);
              end loop;
            end if;
          end if;
        elsif TG_TABLE_NAME in ('stone_deposits','woodland_deposits') then
          perform game_sync_spatial_touch(wid,(item->>'cell_x')::int,(item->>'cell_y')::int,'spatialFeatures',item->>'feature_id');
          perform game_sync_spatial_touch(wid,(item->>'cell_x')::int,(item->>'cell_y')::int,'spatialCells','@cell');
        elsif TG_TABLE_NAME in ('world_features','world_rc1_resources') then
          entity:=case when TG_TABLE_NAME='world_features' then item->>'id' else item->>'feature_id' end;
          if TG_TABLE_NAME='world_rc1_resources' then
            perform game_sync_refresh_feature_vertices(wid,entity::uuid);
          end if;
          for location in select cell_x,cell_y from world_cell_occupancies where world_id=wid and feature_id=entity::uuid
            union select cell_x,cell_y from stone_deposits where world_id=wid and feature_id=entity::uuid
            union select cell_x,cell_y from woodland_deposits where world_id=wid and feature_id=entity::uuid
          loop
            perform game_sync_spatial_touch(wid,location.cell_x,location.cell_y,'spatialFeatures',entity);
            perform game_sync_spatial_touch(wid,location.cell_x,location.cell_y,'spatialCells','@cell');
          end loop;
        elsif TG_TABLE_NAME='world_cell_occupancies' then
          perform game_sync_spatial_touch(wid,(item->>'cell_x')::int,(item->>'cell_y')::int,'spatialCells','@cell');
          if item->>'feature_id' is not null then
            perform game_sync_spatial_touch(wid,(item->>'cell_x')::int,(item->>'cell_y')::int,'spatialFeatures',item->>'feature_id');
          end if;
          if item->>'building_id' is not null then
            perform game_sync_spatial_touch(wid,(item->>'cell_x')::int,(item->>'cell_y')::int,'spatialExteriors',item->>'building_id');
            select v.owner_account_id into owner_id from buildings b join villages v on v.world_id=b.world_id and v.id=b.village_id
              where b.world_id=wid and b.id=(item->>'building_id')::uuid and (b.status='completed' or b.building_type='town-hall' and b.target_level is not null);
            if coverage_changed and (owner_id is not null or TG_OP='DELETE') then
              if owner_id is not null then perform game_sync_touch(wid,'knowledge',owner_id::text,'knowledgeCoverage','*'); end if;
              perform game_sync_visibility_touch(wid,(item->>'cell_x')::int,(item->>'cell_y')::int,16);
            end if;
          end if;
        elsif TG_TABLE_NAME='buildings' then
          select owner_account_id into owner_id from villages where world_id=wid and id=(item->>'village_id')::uuid;
          if owner_id is not null and item->>'building_type'='university' then
            perform game_sync_touch(wid,'knowledge',owner_id::text,'knowledgeScience','*');
          end if;
          if coverage_changed and owner_id is not null and
            (item->>'status'='completed' or item->>'building_type'='town-hall' and item->>'target_level' is not null) then
            perform game_sync_touch(wid,'knowledge',owner_id::text,'knowledgeCoverage','*');
          end if;
          for location in select cell_x,cell_y from world_cell_occupancies where world_id=wid and building_id=(item->>'id')::uuid loop
            perform game_sync_spatial_touch(wid,location.cell_x,location.cell_y,'spatialExteriors',item->>'id');
            perform game_sync_spatial_touch(wid,location.cell_x,location.cell_y,'spatialCells','@cell');
            if coverage_changed and owner_id is not null and
              (item->>'status'='completed' or item->>'building_type'='town-hall' and item->>'target_level' is not null) then
              perform game_sync_touch(wid,'knowledge',owner_id::text,'knowledgeCoverage','*');
              perform game_sync_visibility_touch(wid,location.cell_x,location.cell_y,16);
            end if;
          end loop;
        end if;
      end loop;
      perform set_config('arbestra.sync_auto_publish','yes',true);
      return null;
    end $$;
    create function game_sync_catalog_change() returns trigger language plpgsql as $$
    declare wid uuid; item jsonb; derived record;
    begin
      if TG_OP='UPDATE' and to_jsonb(OLD)=to_jsonb(NEW) then return null; end if;
      for wid in select id from worlds order by id loop
        perform game_sync_touch(wid,'manifest',wid::text,'gameManifest','*');
      end loop;
      for item in select value from jsonb_array_elements(case TG_OP
        when 'INSERT' then jsonb_build_array(to_jsonb(NEW)) when 'DELETE' then jsonb_build_array(to_jsonb(OLD))
        else jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) end)
      loop
        if TG_TABLE_NAME='resource_types' then
          for derived in select world_id,village_id,resource_code from village_resources where resource_code=item->>'code'
          loop perform game_sync_touch(derived.world_id,'village',derived.village_id::text,'resources',derived.resource_code); end loop;
        elsif TG_TABLE_NAME='building_level_production' then
          for derived in select distinct f.world_id,f.village_id,f.resource_code from village_resource_flows f
            join villages v on v.world_id=f.world_id and v.id=f.village_id
            join buildings b on b.world_id=f.world_id and b.village_id=f.village_id
            where f.resource_code=item->>'resource_code' and f.production_updated_at is not null
              and (f.resource_code<>'wood' or v.economy_activated_at is null)
              and b.building_type=item->>'building_type_code' and b.level=(item->>'level')::int
              and (b.status='completed' or b.target_level is not null)
          loop perform game_sync_touch(derived.world_id,'village',derived.village_id::text,'resources',derived.resource_code); end loop;
          if item->>'resource_code'='carrot' then
            for derived in select g.world_id,g.village_id,g.cell_x,g.cell_y from garden_plots g
              join buildings b on b.world_id=g.world_id and b.id=g.building_id
              where b.building_type=item->>'building_type_code' and b.level=(item->>'level')::int
            loop perform game_sync_touch(derived.world_id,'village',derived.village_id::text,'gardenPlots',derived.cell_x::text||','||derived.cell_y::text); end loop;
          end if;
        end if;
      end loop;
      perform set_config('arbestra.sync_auto_publish','yes',true);
      return null;
    end $$;
  `.execute(db);
  for (const table of sharedSyncSources) await sql`create trigger game_sync_shared after insert or update or delete on ${sql.id(table)}
    for each row execute function game_sync_shared_change()`.execute(db);
  for (const table of globalCatalogSyncSources) await sql`create trigger game_sync_catalog after insert or update or delete on ${sql.id(table)}
    for each row execute function game_sync_catalog_change()`.execute(db);
}
