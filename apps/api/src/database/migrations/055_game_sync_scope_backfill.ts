import { sql, type Kysely } from 'kysely';

/** Staged after complete writer coverage. Existing scopes keep their epoch and
 * revision; a new scope starts at zero and requires an explicit snapshot. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    insert into game_sync_streams(world_id,stream_kind,scope_key)
    select world_id,stream_kind,scope_key from (
      select id as world_id,'manifest'::text as stream_kind,id::text as scope_key from worlds
      union select id,'offers','all' from worlds
      union select world_id,'village',id::text from villages
      union select world_id,'knowledge',owner_account_id::text from villages
      union select w.id,'spatial',x::text||','||y::text from worlds w
        cross join lateral generate_series(0,(w.width_cells-1)/w.chunk_size) x
        cross join lateral generate_series(0,(w.height_cells-1)/w.chunk_size) y
    ) scopes order by world_id,stream_kind,scope_key
    on conflict(world_id,stream_kind,scope_key) do nothing
  `.execute(db);
}
