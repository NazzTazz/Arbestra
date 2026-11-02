import { sql, type Kysely } from 'kysely';

/** SYNC_V2_WAKE_CHANNEL of sync-v2-wakeups.ts, frozen here. */
const channel = 'arbestra_sync_v2';

/** NOTIFY wakes the V2 streams after commit (spec §8.4); the journal stays the
 * durable authority, read by the woken streams. game_sync_publish() is the one
 * publication point (commands, worker, deferred auto-publication at COMMIT):
 * it now also queues one notification per world and transaction, which
 * PostgreSQL delivers only once the transaction has committed (never on
 * rollback). Payload: identifiers only, {"w": world, "s": [[kind, key], ...]},
 * in the vector's canonical order. Beyond 7 000 bytes (PostgreSQL refuses
 * 8 000) the list is dropped and the whole world is woken: {"w": world}.
 * Same journal rows, revisions, batches and return value as 059, whose body
 * is repeated below; `down` restores it. */
const publish = (declarations: string, notify: string) =>
  sql.raw(`
    create or replace function game_sync_publish() returns jsonb language plpgsql as $$
    declare stream record; version record; dependencies jsonb; external boolean;${declarations}
      batch uuid := gen_random_uuid();
    begin
      if current_setting('arbestra.sync_published', true) = 'yes' then
        raise exception 'Synchronization already published';
      end if;
      -- Canonical ordering also covers first creation: an insert conflict can
      -- wait for the preceding publisher before its counter exists in our view.
      for stream in select * from (select distinct world_id,stream_kind,scope_key from game_sync_pending
        where transaction_id=txid_current()) affected order by world_id,stream_kind collate "C",scope_key collate "C"
      loop
        insert into game_sync_streams(world_id,stream_kind,scope_key)
          values(stream.world_id,stream.stream_kind,stream.scope_key) on conflict do nothing;
        update game_sync_streams set revision=revision+1
          where world_id=stream.world_id and stream_kind=stream.stream_kind and scope_key=stream.scope_key
          returning epoch,revision into version;
      end loop;
      -- One aggregation, in the same canonical order as the returned vector.
      select coalesce(jsonb_agg(jsonb_build_object('worldId',s.world_id,'kind',s.stream_kind,'key',s.scope_key,
          'epoch',s.epoch,'revision',s.revision::text) order by s.world_id,s.stream_kind collate "C",s.scope_key collate "C"),'[]'::jsonb)
        into dependencies
        from game_sync_streams s join (select distinct world_id,stream_kind,scope_key from game_sync_pending
          where transaction_id=txid_current()) affected using (world_id,stream_kind,scope_key);
      external := jsonb_array_length(dependencies) > 1;
      if external then
        insert into game_sync_batches(world_id,batch_id,dependencies)
          select world_id,batch,jsonb_agg(value order by ordinality) from (
            select (element.value->>'worldId')::uuid as world_id,element.value,element.ordinality
            from jsonb_array_elements(dependencies) with ordinality element(value,ordinality)) items
          group by world_id;
      end if;
      insert into game_sync_changes(world_id,stream_kind,scope_key,epoch,revision,batch_id,changes,dependencies,dependencies_batch_id)
        select p.world_id,p.stream_kind,p.scope_key,s.epoch,s.revision,batch,
          jsonb_agg(jsonb_build_object('component',p.component,'key',p.entity_key) order by p.component,p.entity_key),
          case when external then '[]'::jsonb else dependencies end,case when external then batch end
        from game_sync_pending p join game_sync_streams s using (world_id,stream_kind,scope_key)
        where p.transaction_id=txid_current()
        group by p.world_id,p.stream_kind,p.scope_key,s.epoch,s.revision;${notify}
      delete from game_sync_pending where transaction_id=txid_current();
      perform set_config('arbestra.sync_published','yes',true);
      return dependencies;
    end $$;
  `);

export async function up(db: Kysely<unknown>): Promise<void> {
  await publish(
    ' wake record; payload text;',
    `
      -- Queued now, delivered by PostgreSQL after COMMIT (080).
      for wake in select item.value->>'worldId' as world_id,
          jsonb_agg(jsonb_build_array(item.value->>'kind',item.value->>'key') order by item.ordinality) as streams
        from jsonb_array_elements(dependencies) with ordinality item(value,ordinality)
        group by item.value->>'worldId' order by 1
      loop
        payload := jsonb_build_object('w',wake.world_id,'s',wake.streams)::text;
        if octet_length(payload) > 7000 then
          payload := jsonb_build_object('w',wake.world_id)::text;
        end if;
        perform pg_notify('${channel}',payload);
      end loop;`,
  ).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await publish('', '').execute(db);
}
