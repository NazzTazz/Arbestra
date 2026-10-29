import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';

/** Snapshot-visible fingerprint, including repeated edits in one transaction.
 * Stocks do not affect geometry: a trunk stands until its stump is removed
 * (slice 2e) or its case cleared. No joins, resource arrays or world geometry
 * cross the SQL connection here.
 */
export async function rc1GroundVersion(
  db: Kysely<Database>,
  worldId: string,
): Promise<{ version: string; rows: string }> {
  const result = await sql<{ version: string; rows: string }>`select concat_ws('|',
  (select md5(coalesce(string_agg(xmin::text||':'||ctid::text,',' order by feature_id),'')) from world_rc1_resources where world_id=${worldId}),
  (select md5(coalesce(string_agg(concat_ws(':',feature_id,cell_x,cell_y,cleared,initial_amount=0),',' order by feature_id),'')) from woodland_deposits where world_id=${worldId}),
  (select md5(coalesce(string_agg(concat_ws(':',id,variant_seed),',' order by id),'')) from world_features where world_id=${worldId}),
  (select md5(coalesce(string_agg(xmin::text||':'||ctid::text,',' order by cell_x,cell_y),'')) from world_spawn_terraces where world_id=${worldId}),
  (select md5(coalesce(string_agg(xmin::text||':'||ctid::text,',' order by vertex_x,vertex_y),'')) from world_terrain_vertices where world_id=${worldId}),
  (select md5(coalesce(string_agg(feature_id::text||':'||tree_index,',' order by feature_id,tree_index),'')) from woodland_trees where world_id=${worldId} and stump_removed_at is not null)
 ) as version, concat_ws('|',
  (select md5(coalesce(string_agg(xmin::text||':'||ctid::text,',' order by feature_id),'')) from woodland_deposits where world_id=${worldId}),
  (select md5(coalesce(string_agg(xmin::text||':'||ctid::text,',' order by id),'')) from world_features where world_id=${worldId})
 ) as rows`.execute(db);
  return result.rows[0]!;
}
