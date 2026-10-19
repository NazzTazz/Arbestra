import {sql,type Kysely} from 'kysely';
import type {Database} from '../../database/schema.js';

/** Snapshot-visible fingerprint, including repeated edits in one transaction.
 * Stocks only participate through the two thresholds that affect geometry.
 * No joins, resource arrays or world geometry cross the SQL connection here.
 */
export async function rc1GroundVersion(db:Kysely<Database>,worldId:string):Promise<{version:string;rows:string}>{
 const result=await sql<{version:string;rows:string}>`select concat_ws('|',
  (select md5(coalesce(string_agg(xmin::text||':'||ctid::text,',' order by feature_id),'')) from world_rc1_resources where world_id=${worldId}),
  (select md5(coalesce(string_agg(concat_ws(':',feature_id,cell_x,cell_y,cleared,initial_amount=0,remaining_amount<=initial_amount*.1),',' order by feature_id),'')) from woodland_deposits where world_id=${worldId}),
  (select md5(coalesce(string_agg(concat_ws(':',id,variant_seed),',' order by id),'')) from world_features where world_id=${worldId}),
  (select md5(coalesce(string_agg(xmin::text||':'||ctid::text,',' order by cell_x,cell_y),'')) from world_spawn_terraces where world_id=${worldId}),
  (select md5(coalesce(string_agg(xmin::text||':'||ctid::text,',' order by vertex_x,vertex_y),'')) from world_terrain_vertices where world_id=${worldId})
 ) as version, concat_ws('|',
  (select md5(coalesce(string_agg(xmin::text||':'||ctid::text,',' order by feature_id),'')) from woodland_deposits where world_id=${worldId}),
  (select md5(coalesce(string_agg(xmin::text||':'||ctid::text,',' order by id),'')) from world_features where world_id=${worldId})
 ) as rows`.execute(db);
 return result.rows[0]!;
}
