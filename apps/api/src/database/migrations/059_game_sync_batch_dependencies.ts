import { sql, type Kysely } from 'kysely';

/** A batch touching S streams copied its whole dependency vector into each of
 * its S journal rows: O(S²) bytes (150 MB for 1856 streams). Multi-stream
 * batches now store the vector once per world and batch; their rows carry
 * an empty array and a non-null reference. Single-stream batches stay inline
 * (cheaper than a header). Historical rows keep their inline vector: readers
 * accept both forms. Same epochs, revisions and SQL return value. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table game_sync_batches (
      world_id uuid not null, batch_id uuid not null,
      recorded_at timestamptz not null default statement_timestamp(),
      dependencies jsonb not null,
      primary key (world_id, batch_id)
    );
    alter table game_sync_changes add column dependencies_batch_id uuid,
      add constraint game_sync_changes_dependencies_batch check (dependencies_batch_id is null or dependencies_batch_id=batch_id),
      add constraint game_sync_changes_dependencies_batch_fk foreign key (world_id, dependencies_batch_id)
        references game_sync_batches(world_id, batch_id);
    create index game_sync_changes_dependencies_batch on game_sync_changes(world_id, dependencies_batch_id)
      where dependencies_batch_id is not null;
    create or replace function game_sync_publish() returns jsonb language plpgsql as $$
    declare stream record; version record; dependencies jsonb; external boolean;
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
        group by p.world_id,p.stream_kind,p.scope_key,s.epoch,s.revision;
      delete from game_sync_pending where transaction_id=txid_current();
      perform set_config('arbestra.sync_published','yes',true);
      return dependencies;
    end $$;
  `.execute(db);
}
