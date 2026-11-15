import { sql, type Kysely } from 'kysely';

/** The `desire` V2 stream (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §4.3 and
 * §17, slice T3b). Invisible plumbing: nothing displays it yet.
 *
 * - One stream per canonical chunk of 32 cells ("cx,cy", chunk units, like
 *   `spatial`), kind `desire`, component `desirePaths`. The kind constraint and
 *   `game_sync_touch` accept it (057 did the same for `traffic`).
 * - Every chunk of every OPEN world has its stream from the start, and a world
 *   gets its chunks when it opens (inserted open, or `is_open` set): a client
 *   subscribing to a chunk no edge ever touched must find a stream, or it would
 *   never hear of the first path there. A candidate world that is never opened
 *   (and may be deleted) gets none: no orphan rows. The bootstrap leaves a chunk
 *   without a stream out of its resolution instead of failing the capture.
 *   Existing streams keep their epoch and revision.
 * - `world_desire_visible_passages()` is THE threshold N of the spec (decision
 *   12, §8.1): an edge is a path once it has that many passages. The trigger
 *   below and the reader (sync-v2-desire-readers.ts) both call it; nothing else
 *   holds the number. Changing it is a migration that also re-publishes.
 * - Statement-level triggers on `world_desire_edges` (the desire task upserts up
 *   to 1 000 rows per statement, so a row trigger would run 1 000 times) touch
 *   the chunk's stream only when an edge's VISIBILITY changes: an insert at or
 *   above N, an update crossing N in either direction, a delete of a visible
 *   edge. Counts and timestamps moving below or above N publish nothing, and
 *   no payload ever carries them. Like 060, plain collection: the entity is the
 *   origin cell "x,y" (both of its edges are re-read), the chunk is the one of
 *   that cell, set-based and in key order. Only the world's desire task writes
 *   this table, never a command: the publication at COMMIT (053, deferred
 *   constraint trigger) belongs to the scheduler's own transaction. A world
 *   being deleted (the cascade) has no chunk size left to read: nothing touched.
 *   The primary key of an edge is never updated.
 * Additive: no existing row, function body or trigger changes behaviour for the
 * other kinds. */
const KINDS_BEFORE = `'village','knowledge','spatial','offers','manifest','traffic'`;
const KINDS_AFTER = `${KINDS_BEFORE},'desire'`;
const touch = (kinds: string) => `
  create or replace function game_sync_touch(wid uuid, kind text, scope text, component_name text, entity text)
  returns void language plpgsql as $$
  begin
    if current_setting('arbestra.sync_published', true) = 'yes' then
      raise exception 'Business change after synchronization publication';
    end if;
    if kind not in (${kinds})
      or length(scope) not between 1 and 128 or length(entity) not between 1 and 256
      or length(component_name) not between 1 and 64 then
      raise exception 'Invalid synchronization reference';
    end if;
    insert into game_sync_pending values(txid_current(),wid,kind,scope,component_name,entity)
      on conflict do nothing;
  end $$;`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    alter table game_sync_streams drop constraint game_sync_streams_stream_kind_check;
    alter table game_sync_streams add constraint game_sync_streams_stream_kind_check
      check (stream_kind in (${KINDS_AFTER}));
    ${touch(KINDS_AFTER)}
  `,
    )
    .execute(db);
  await sql`
    create function world_desire_visible_passages() returns integer language sql immutable as $$ select 3 $$;

    create function game_sync_collect_desire() returns trigger language plpgsql as $$
    declare touched bigint;
    begin
      -- The chunk key and the entity key of the origin cell of an edge.
      if TG_OP = 'INSERT' then
        insert into game_sync_pending
          select distinct txid_current(),e.world_id,'desire',
            (e.cell_x/w.chunk_size)::text||','||(e.cell_y/w.chunk_size)::text,'desirePaths',e.cell_x::text||','||e.cell_y::text
          from new_edges e join worlds w on w.id=e.world_id
          where e.passages>=world_desire_visible_passages()
          order by 2,4,6
        on conflict do nothing;
      elsif TG_OP = 'UPDATE' then
        insert into game_sync_pending
          select distinct txid_current(),n.world_id,'desire',
            (n.cell_x/w.chunk_size)::text||','||(n.cell_y/w.chunk_size)::text,'desirePaths',n.cell_x::text||','||n.cell_y::text
          from new_edges n
          join old_edges o on o.world_id=n.world_id and o.cell_x=n.cell_x and o.cell_y=n.cell_y and o.direction=n.direction
          join worlds w on w.id=n.world_id
          where (o.passages>=world_desire_visible_passages()) <> (n.passages>=world_desire_visible_passages())
          order by 2,4,6
        on conflict do nothing;
      else
        insert into game_sync_pending
          select distinct txid_current(),o.world_id,'desire',
            (o.cell_x/w.chunk_size)::text||','||(o.cell_y/w.chunk_size)::text,'desirePaths',o.cell_x::text||','||o.cell_y::text
          from old_edges o join worlds w on w.id=o.world_id
          where o.passages>=world_desire_visible_passages()
          order by 2,4,6
        on conflict do nothing;
      end if;
      get diagnostics touched = row_count;
      if touched > 0 then
        if current_setting('arbestra.sync_published', true) = 'yes' then
          raise exception 'Business change after synchronization publication';
        end if;
        perform set_config('arbestra.sync_auto_publish','yes',true);
      end if;
      return null;
    end $$;
    create trigger game_sync_desire_insert after insert on world_desire_edges
      referencing new table as new_edges for each statement execute function game_sync_collect_desire();
    create trigger game_sync_desire_update after update on world_desire_edges
      referencing old table as old_edges new table as new_edges for each statement execute function game_sync_collect_desire();
    create trigger game_sync_desire_delete after delete on world_desire_edges
      referencing old table as old_edges for each statement execute function game_sync_collect_desire();

    -- The chunks of a world exist from its opening (055 did it for the worlds of its day).
    create function game_sync_init_desire() returns trigger language plpgsql as $$
    begin
      insert into game_sync_streams(world_id,stream_kind,scope_key)
        select new.id,'desire',x::text||','||y::text
        from generate_series(0,(new.width_cells-1)/new.chunk_size) x
        cross join generate_series(0,(new.height_cells-1)/new.chunk_size) y
        order by 3
      on conflict do nothing;
      return null;
    end $$;
    create trigger game_sync_world_desire after insert or update of is_open on worlds
      for each row when (new.is_open) execute function game_sync_init_desire();
    insert into game_sync_streams(world_id,stream_kind,scope_key)
      select w.id,'desire',x::text||','||y::text from worlds w
        cross join lateral generate_series(0,(w.width_cells-1)/w.chunk_size) x
        cross join lateral generate_series(0,(w.height_cells-1)/w.chunk_size) y
      where w.is_open
      order by 1,3
    on conflict do nothing;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger game_sync_world_desire on worlds;
    drop function game_sync_init_desire();
    drop trigger game_sync_desire_delete on world_desire_edges;
    drop trigger game_sync_desire_update on world_desire_edges;
    drop trigger game_sync_desire_insert on world_desire_edges;
    drop function game_sync_collect_desire();
    drop function world_desire_visible_passages();
    -- Journal of the kind, its vectors, and a publication still pending.
    delete from game_sync_pending where stream_kind = 'desire';
    delete from game_sync_streams where stream_kind = 'desire';
    delete from game_sync_batches b where b.dependencies @> '[{"kind":"desire"}]'::jsonb
      and not exists(select 1 from game_sync_changes c
        where c.world_id=b.world_id and c.dependencies_batch_id=b.batch_id);
  `.execute(db);
  await sql
    .raw(
      `
    alter table game_sync_streams drop constraint game_sync_streams_stream_kind_check;
    alter table game_sync_streams add constraint game_sync_streams_stream_kind_check
      check (stream_kind in (${KINDS_BEFORE}));
    ${touch(KINDS_BEFORE)}
  `,
    )
    .execute(db);
}
