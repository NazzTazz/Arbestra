import { sql, type Kysely } from 'kysely';

/** Completing a building surveys hundreds of cells into science_places, in
 * batches of 500 while the village is locked; two row triggers per cell made
 * one completion take seconds (beyond the 2 s lock wait of another worker).
 * Plain inserts are now collected once per statement with the same
 * references as 041/054: knowledge science and place, the spatial cell and
 * the features located on it, and the V1 marker. Conflicting rows of an
 * upsert are updates and keep their row triggers. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function bulk_science_places_collect() returns trigger language plpgsql as $$
    declare wid uuid; spatial jsonb;
    begin
      if not exists(select 1 from added) then return null; end if;
      if current_setting('arbestra.sync_published', true) = 'yes' then
        raise exception 'Business change after synchronization publication';
      end if;
      for wid in select distinct world_id from added order by 1 loop
        if not exists(select 1 from worlds where id=wid) then continue; end if;
        insert into game_sync_pending
          select distinct txid_current(),wid,'knowledge',account_id::text,'knowledgeScience','*' from added where world_id=wid
          union select txid_current(),wid,'knowledge',account_id::text,'knowledgePlaces',cell_x::text||','||cell_y::text
            from added where world_id=wid
        on conflict do nothing;
        select jsonb_agg(ref) into spatial from (
          select jsonb_build_object('x',cell_x,'y',cell_y,'component','spatialCells','entity','@cell') as ref
            from added where world_id=wid
          union all select jsonb_build_object('x',p.cell_x,'y',p.cell_y,'component','spatialFeatures','entity',f.feature_id::text)
            from added p cross join lateral (
              select feature_id from world_cell_occupancies where world_id=wid and cell_x=p.cell_x and cell_y=p.cell_y and feature_id is not null
              union select feature_id from stone_deposits where world_id=wid and cell_x=p.cell_x and cell_y=p.cell_y
              union select feature_id from woodland_deposits where world_id=wid and cell_x=p.cell_x and cell_y=p.cell_y) f
            where p.world_id=wid) refs;
        if spatial is not null then perform game_sync_spatial_touch_set(wid,spatial); end if;
        insert into village_sync_changes(world_id,transaction_id) values(wid,txid_current()) on conflict do nothing;
      end loop;
      perform set_config('arbestra.sync_auto_publish','yes',true);
      return null;
    end $$;
    drop trigger game_sync_shared on science_places;
    create trigger game_sync_shared after update or delete on science_places for each row execute function game_sync_shared_change();
    drop trigger village_sync_change on science_places;
    create trigger village_sync_change after update or delete on science_places for each row execute function mark_village_sync_change();
    create trigger bulk_insert_collect after insert on science_places referencing new table as added
      for each statement execute function bulk_science_places_collect();
  `.execute(db);
}
