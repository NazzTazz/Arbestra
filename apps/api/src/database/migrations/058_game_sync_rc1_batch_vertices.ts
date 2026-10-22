import { sql, type Kysely } from 'kysely';

/** RC1 installation inserts its ~2000 resource groups in a few statements.
 * The generic row trigger re-expanded the whole world artifact (several MB of
 * JSON) once per group, about 50 ms each. Inserts now expand it once per
 * statement and world, for the inserted features only; updates and deletes
 * keep the per-row path of 054, minus the expansion for a removed group.
 * Same journal references as before. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function game_sync_rc1_inserted() returns trigger language plpgsql as $$
    declare wid uuid; location record;
    begin
      if not exists(select 1 from added) then return null; end if;
      for wid in select distinct world_id from added order by 1 loop
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
          select r.feature_id,t.x,t.y from added r
          cross join lateral jsonb_array_elements_text(r.tree_indices) i
          join trees t on t.tree_index=i.value::int
          where r.world_id=wid and not r.removed_indices @> jsonb_build_array(i.value::int)
          union all
          select r.feature_id,p.x,p.y from added r join rocks p on p.source_key=r.source_key where r.world_id=wid
        ) select distinct wid,p.feature_id,
          ((floor(p.x+.5)::int+dx)%s.width_cells+s.width_cells)%s.width_cells,
          ((floor(p.y+.5)::int+dy)%s.height_cells+s.height_cells)%s.height_cells
          from selected p cross join source s cross join generate_series(0,1) dx cross join generate_series(0,1) dy
          where p.x is not null and p.y is not null on conflict do nothing;
        for location in
          select o.feature_id,o.cell_x,o.cell_y from added r join world_cell_occupancies o on o.world_id=wid and o.feature_id=r.feature_id
            where r.world_id=wid
          union select d.feature_id,d.cell_x,d.cell_y from added r join stone_deposits d on d.world_id=wid and d.feature_id=r.feature_id
            where r.world_id=wid
          union select d.feature_id,d.cell_x,d.cell_y from added r join woodland_deposits d on d.world_id=wid and d.feature_id=r.feature_id
            where r.world_id=wid
          order by 1,2,3
        loop
          perform game_sync_spatial_touch(wid,location.cell_x,location.cell_y,'spatialFeatures',location.feature_id::text);
          perform game_sync_spatial_touch(wid,location.cell_x,location.cell_y,'spatialCells','@cell');
        end loop;
      end loop;
      perform set_config('arbestra.sync_auto_publish','yes',true);
      return null;
    end $$;
    -- Same refresh as 054, but a removed group (world deletion cascades one
    -- row at a time) no longer expands the artifact only to find nothing.
    create or replace function game_sync_refresh_feature_vertices(wid uuid, fid uuid) returns void language plpgsql as $$
    declare trees jsonb; sites jsonb;
    begin
      delete from game_sync_feature_vertices where world_id=wid and feature_id=fid;
      if not exists(select 1 from world_rc1_resources where world_id=wid and feature_id=fid) then return; end if;
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
    drop trigger game_sync_shared on world_rc1_resources;
    create trigger game_sync_shared after update or delete on world_rc1_resources
      for each row execute function game_sync_shared_change();
    create trigger game_sync_rc1_inserted after insert on world_rc1_resources
      referencing new table as added for each statement execute function game_sync_rc1_inserted();
  `.execute(db);
}
