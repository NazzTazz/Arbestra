import { sql, type Kysely } from 'kysely';

// Additive foundation, not an activation switch. Streams remain unused until
// writer/reader coverage is installed. No foreign key here can reacquire a
// business-row lock during terminal publication.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table game_sync_streams (
      world_id uuid not null,
      stream_kind text not null check (stream_kind in ('village','knowledge','spatial','offers','manifest')),
      scope_key text not null,
      epoch uuid not null default gen_random_uuid(),
      revision bigint not null default 0 check (revision >= 0),
      retained_from bigint not null default 0 check (retained_from >= 0 and retained_from <= revision),
      primary key (world_id, stream_kind, scope_key)
    );
    create table game_sync_pending (
      transaction_id bigint not null,
      world_id uuid not null, stream_kind text not null, scope_key text not null,
      component text not null, entity_key text not null,
      primary key (transaction_id, world_id, stream_kind, scope_key, component, entity_key)
    );
    create table game_sync_changes (
      world_id uuid not null, stream_kind text not null, scope_key text not null,
      epoch uuid not null, revision bigint not null,
      batch_id uuid not null, recorded_at timestamptz not null default statement_timestamp(),
      changes jsonb not null, dependencies jsonb not null,
      primary key (world_id, stream_kind, scope_key, epoch, revision),
      foreign key (world_id, stream_kind, scope_key)
        references game_sync_streams(world_id, stream_kind, scope_key) on delete cascade
    );
    create function game_sync_assert_published() returns trigger language plpgsql as $$
    begin
      if exists(select 1 from game_sync_pending where transaction_id=txid_current()) then
        raise exception 'Synchronization changes were not published';
      end if;
      return null;
    end $$;
    create constraint trigger game_sync_requires_publish after insert on game_sync_pending
      deferrable initially deferred for each row execute function game_sync_assert_published();
    create function game_sync_touch(wid uuid, kind text, scope text, component_name text, entity text)
    returns void language plpgsql as $$
    begin
      if current_setting('arbestra.sync_published', true) = 'yes' then
        raise exception 'Business change after synchronization publication';
      end if;
      if kind not in ('village','knowledge','spatial','offers','manifest')
        or length(scope) not between 1 and 128 or length(entity) not between 1 and 256
        or length(component_name) not between 1 and 64 then
        raise exception 'Invalid synchronization reference';
      end if;
      insert into game_sync_pending values(txid_current(),wid,kind,scope,component_name,entity)
        on conflict do nothing;
    end $$;
    create function game_sync_publish() returns jsonb language plpgsql as $$
    declare stream record; version record; refs jsonb; dependencies jsonb := '[]';
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
        dependencies := dependencies || jsonb_build_array(jsonb_build_object(
          'worldId',stream.world_id,'kind',stream.stream_kind,'key',stream.scope_key,
          'epoch',version.epoch,'revision',version.revision::text));
      end loop;
      for stream in select distinct world_id,stream_kind,scope_key from game_sync_pending
        where transaction_id=txid_current() order by world_id,stream_kind,scope_key
      loop
        select jsonb_agg(jsonb_build_object('component',component,'key',entity_key) order by component,entity_key)
          into refs from game_sync_pending where transaction_id=txid_current()
            and world_id=stream.world_id and stream_kind=stream.stream_kind and scope_key=stream.scope_key;
        insert into game_sync_changes(world_id,stream_kind,scope_key,epoch,revision,batch_id,changes,dependencies)
          select world_id,stream_kind,scope_key,epoch,revision,batch,refs,dependencies from game_sync_streams
          where world_id=stream.world_id and stream_kind=stream.stream_kind and scope_key=stream.scope_key;
      end loop;
      delete from game_sync_pending where transaction_id=txid_current();
      perform set_config('arbestra.sync_published','yes',true);
      return dependencies;
    end $$;
  `.execute(db);
}
