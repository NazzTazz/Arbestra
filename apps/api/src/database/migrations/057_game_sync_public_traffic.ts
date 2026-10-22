import { sql, type Kysely } from 'kysely';

/** Convoys are public, observable entities of the world (future escort,
 * interception and attack rely on it), not only private data of their two
 * villages. A per-world public stream journals their observable journey;
 * offers and cargo stay outside it. Additive: existing streams keep their
 * epochs and revisions. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table game_sync_streams drop constraint game_sync_streams_stream_kind_check;
    alter table game_sync_streams add constraint game_sync_streams_stream_kind_check
      check (stream_kind in ('village','knowledge','spatial','offers','manifest','traffic'));
    create or replace function game_sync_touch(wid uuid, kind text, scope text, component_name text, entity text)
    returns void language plpgsql as $$
    begin
      if current_setting('arbestra.sync_published', true) = 'yes' then
        raise exception 'Business change after synchronization publication';
      end if;
      if kind not in ('village','knowledge','spatial','offers','manifest','traffic')
        or length(scope) not between 1 and 128 or length(entity) not between 1 and 256
        or length(component_name) not between 1 and 64 then
        raise exception 'Invalid synchronization reference';
      end if;
      insert into game_sync_pending values(txid_current(),wid,kind,scope,component_name,entity)
        on conflict do nothing;
    end $$;
    create function game_sync_collect_traffic() returns trigger language plpgsql as $$
    declare journey record;
    begin
      if TG_OP = 'DELETE' then journey := old; else journey := new; end if;
      perform game_sync_touch(journey.world_id,'traffic',journey.world_id::text,'convoys',journey.id::text);
      perform set_config('arbestra.sync_auto_publish','yes',true);
      return null;
    end $$;
    create trigger game_sync_traffic after insert or update or delete on trade_journeys
      for each row execute function game_sync_collect_traffic();
    -- A world without any convoy yet still offers an initialized empty stream.
    create function game_sync_init_traffic() returns trigger language plpgsql as $$
    begin
      insert into game_sync_streams(world_id,stream_kind,scope_key) values(new.id,'traffic',new.id::text)
        on conflict do nothing;
      return null;
    end $$;
    create trigger game_sync_world_traffic after insert on worlds
      for each row execute function game_sync_init_traffic();
    insert into game_sync_streams(world_id,stream_kind,scope_key)
      select id,'traffic',id::text from worlds order by 1
      on conflict do nothing;
  `.execute(db);
}
