import {createHash} from 'node:crypto';
import {sql, type Kysely} from 'kysely';
import {HIERARCHICAL_ROUTE_VERSION, ROUTE_POLICY_VERSION, spawnDelta, type ChunkCrossing, type ChunkNavigationMesh, type TravelCell} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';

export interface NavigationVersions {worldId: string; namespace: string; width: number; height: number; chunkSize: number; versions: Record<string, string>}
export interface RouteCertificate {namespace: string; dependencies: Record<string, string>}
export interface CachedHallRoute {path: TravelCell[]; certificate: RouteCertificate; cost: number}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wrap = (x: number, size: number) => (x % size + size) % size;
function cacheLimits(){
  const value=(name:string,fallback:number,max:number)=>{const n=Number(process.env[name]??fallback);return Number.isSafeInteger(n)&&n>0?Math.min(n,max):fallback;};
  return{routes:value('NAVIGATION_CACHE_ROUTES',1024,16384),crossings:value('NAVIGATION_CACHE_CROSSINGS',4096,65536),
    meshes:value('NAVIGATION_CACHE_MESHES',2048,8192),bytes:value('NAVIGATION_CACHE_BYTES',16777216,268435456)};
}
const memory = new WeakMap<Kysely<Database>, Map<string, CachedHallRoute>>();
const touches=new WeakMap<Kysely<Database>,Map<string,number>>();
export async function touchHallRoute(db:Kysely<Database>,worldId:string,key:string){
  let recent=touches.get(db);if(!recent){recent=new Map();touches.set(db,recent);}
  const id=`${worldId}:${key}`,now=Date.now();if(now-(recent.get(id)??0)<60000)return;
  recent.delete(id);recent.set(id,now);while(recent.size>1024)recent.delete(recent.keys().next().value!);
  await sql`update navigation_hall_routes set last_used_at=statement_timestamp() where world_id=${worldId} and key=${key}
    and last_used_at<statement_timestamp()-interval '1 minute'`.execute(db);
}
function remember(db: Kysely<Database>, worldId: string, key: string, route: CachedHallRoute) {
  let entries = memory.get(db); if (!entries) {entries = new Map(); memory.set(db, entries);}
  const id = `${worldId}:${key}`; entries.delete(id); entries.set(id, route);
  while (entries.size > 64 || [...entries.values()].reduce((n, r) => n + r.path.length, 0) > 65536) entries.delete(entries.keys().next().value!);
}

/** A coherent, small manifest. Reading a route never loads the RC1 artifact. */
export async function navigationVersions(db: Kysely<Database>, worldId: string): Promise<NavigationVersions> {
  const world = await db.selectFrom('worlds').select(['widthCells', 'heightCells', 'chunkSize', 'seed', 'generationVersion', 'generationStatus']).where('id', '=', worldId).executeTakeFirstOrThrow();
  const source = await db.selectFrom('worldGenerationCandidates').select('checksum').where('worldId', '=', worldId).executeTakeFirst();
  // Append-only transaction marks avoid introducing chunk-row lock cycles after deposit locks.
  // Counting committed marks also detects transactions that commit out of txid order.
  const rows = await sql<{chunkX: number; chunkY: number; revision: string}>`select chunk_x,chunk_y,count(*)::text as revision from navigation_chunk_versions where world_id=${worldId} group by chunk_x,chunk_y`.execute(db);
  const versions = Object.fromEntries(rows.rows.map(r => [`${r.chunkX}:${r.chunkY}`, r.revision]));
  return {worldId, namespace: digest([worldId, world, source?.checksum, versions['-1:-1'] ?? '0', HIERARCHICAL_ROUTE_VERSION, ROUTE_POLICY_VERSION]),
    width: world.widthCells, height: world.heightCells, chunkSize: world.chunkSize, versions};
}

export function routeDependencies(manifest: NavigationVersions, path: readonly TravelCell[]): Record<string, string> {
  const dependencies: Record<string, string> = {'-1:-1': manifest.versions['-1:-1'] ?? '0'};
  const add = (x: number, y: number) => {
    // Swept certification samples at ±1/16. Touch the chunks containing these samples.
    for (const ox of [-1 / 16, 0, 1 / 16]) for (const oy of [-1 / 16, 0, 1 / 16]) {
      const key = `${Math.floor(wrap(x + ox, manifest.width) / manifest.chunkSize)}:${Math.floor(wrap(y + oy, manifest.height) / manifest.chunkSize)}`;
      dependencies[key] = manifest.versions[key] ?? '0';
    }
  };
  if (path[0]) add(path[0].cellX, path[0].cellY);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!, dx = spawnDelta(b.cellX, a.cellX, manifest.width), dy = spawnDelta(b.cellY, a.cellY, manifest.height);
    const steps = Math.max(1, Math.ceil((Math.abs(dx) + Math.abs(dy)) * 8));
    for (let j = 1; j <= steps; j++) add(a.cellX + dx * j / steps, a.cellY + dy * j / steps);
  }
  return dependencies;
}
export function certificateValid(manifest: NavigationVersions, certificate: RouteCertificate): boolean {
  return manifest.namespace === certificate.namespace && Object.entries(certificate.dependencies).every(([key, version]) => (manifest.versions[key] ?? '0') === version);
}
export function hallRouteKey(source: string, destination: string) {return digest([source, destination, 'pedestrian-v1', 'none']);}

export async function readHallRoute(db: Kysely<Database>, manifest: NavigationVersions, key: string, owner: Kysely<Database> = db, allowStale=false): Promise<CachedHallRoute | undefined> {
  const cached = memory.get(owner)?.get(`${manifest.worldId}:${key}`);
  if (cached && cached.certificate.namespace===manifest.namespace && (allowStale||certificateValid(manifest, cached.certificate))) return cached;
  const row = await sql<{payload: CachedHallRoute}>`select payload from navigation_hall_routes where world_id=${manifest.worldId} and key=${key} and namespace=${manifest.namespace}`.execute(db);
  const route = row.rows[0]?.payload;
  if (!route || (!allowStale&&!certificateValid(manifest, route.certificate))) return;
  remember(owner, manifest.worldId, key, route);
  return route;
}

export async function readCrossings(db: Kysely<Database>, manifest: NavigationVersions): Promise<ChunkCrossing[]> {
  const rows = await sql<{crossing: ChunkCrossing; dependencies: Record<string, string>}>`
    select crossing,dependencies from (select crossing,dependencies,created_at,
      sum(pg_column_size(crossing)+pg_column_size(dependencies)) over(order by created_at desc,id) as bytes
      from navigation_chunk_crossings where world_id=${manifest.worldId} and namespace=${manifest.namespace}) bounded
    where bytes<=4194304 order by created_at desc limit 2048`.execute(db);
  return rows.rows.map(r => ({...r.crossing, revalidate: !certificateValid(manifest, {namespace: manifest.namespace, dependencies: r.dependencies})}));
}

export async function readChunkMeshes(db: Kysely<Database>, manifest: NavigationVersions): Promise<ChunkNavigationMesh[]> {
  const rows=await sql<ChunkNavigationMesh&{dependencies:Record<string,string>}>`
    select chunk_x,chunk_y,cells,dependencies from (select chunk_x,chunk_y,cells,dependencies,updated_at,
      sum(pg_column_size(cells)+pg_column_size(dependencies)) over(order by updated_at desc,chunk_x,chunk_y) as bytes
      from navigation_chunk_meshes where world_id=${manifest.worldId} and namespace=${manifest.namespace}) bounded
    where bytes<=16777216 order by updated_at desc limit 2048`.execute(db);
  return rows.rows.filter(row=>certificateValid(manifest,{namespace:manifest.namespace,dependencies:row.dependencies}));
}
function meshDependencies(manifest:NavigationVersions,mesh:ChunkNavigationMesh){
  const dependencies:Record<string,string>={'-1:-1':manifest.versions['-1:-1']??'0'};
  const x=mesh.chunkX*manifest.chunkSize,y=mesh.chunkY*manifest.chunkSize;
  for(const px of [x-1,x,Math.min(manifest.width,x+manifest.chunkSize)])for(const py of [y-1,y,Math.min(manifest.height,y+manifest.chunkSize)]){
    const key=`${Math.floor(wrap(px,manifest.width)/manifest.chunkSize)}:${Math.floor(wrap(py,manifest.height)/manifest.chunkSize)}`;
    dependencies[key]=manifest.versions[key]??'0';
  }
  return dependencies;
}

/** Publish only after revalidation; no CPU work or village reconciliation under this lock. */
export async function publishHallRoute(db: Kysely<Database>, manifest: NavigationVersions, key: string, route: CachedHallRoute, crossings: readonly ChunkCrossing[], meshes: readonly ChunkNavigationMesh[]=[]): Promise<boolean> {
  const limits=cacheLimits();
  return db.transaction().execute(async tx => {
    await sql`select pg_advisory_xact_lock_shared(hashtextextended(${'infrastructure:' + manifest.worldId},0))`.execute(tx);
    const current = await navigationVersions(tx, manifest.worldId);
    if (!certificateValid(current, route.certificate)) return false;
    const meshRows=meshes.slice(0,256).map(mesh=>({...mesh,dependencies:meshDependencies(manifest,mesh)}))
      .filter(mesh=>certificateValid(current,{namespace:manifest.namespace,dependencies:mesh.dependencies}))
      .map(mesh=>({chunk_x:mesh.chunkX,chunk_y:mesh.chunkY,cells:mesh.cells,dependencies:mesh.dependencies}));
    if(meshRows.length)await sql`insert into navigation_chunk_meshes(world_id,namespace,chunk_x,chunk_y,cells,dependencies)
      select ${manifest.worldId},${manifest.namespace},r.chunk_x,r.chunk_y,r.cells,r.dependencies
      from jsonb_to_recordset(${JSON.stringify(meshRows)}::jsonb) as r(chunk_x integer,chunk_y integer,cells text,dependencies jsonb)
      on conflict(world_id,namespace,chunk_x,chunk_y) do update set
        cells=case when navigation_chunk_meshes.dependencies=excluded.dependencies then navigation_merge_cells(navigation_chunk_meshes.cells,excluded.cells) else excluded.cells end,
        dependencies=excluded.dependencies,updated_at=statement_timestamp()`.execute(tx);
    // A capped batch bounds persistence and avoids keeping every explored local edge.
    let bytes = 0;
    const rows:Array<{id:string;chunk_x:number;chunk_y:number;dependencies:Record<string,string>;crossing:ChunkCrossing}>=[];
    for (const crossing of crossings.slice(0, 256)) {
      const encoded = JSON.stringify(crossing); bytes += Buffer.byteLength(encoded);
      if (bytes > 4194304) break;
      const dependencies = routeDependencies(manifest, crossing.path);
      if (!certificateValid(current, {namespace: manifest.namespace, dependencies})) continue;
      const id = digest([manifest.namespace, crossing.key, dependencies]);
      rows.push({id,chunk_x:crossing.chunkX,chunk_y:crossing.chunkY,dependencies,crossing});
    }
    if(rows.length)await sql`insert into navigation_chunk_crossings(world_id,id,namespace,chunk_x,chunk_y,dependencies,crossing)
      select ${manifest.worldId},r.id,${manifest.namespace},r.chunk_x,r.chunk_y,r.dependencies,r.crossing
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(id text,chunk_x integer,chunk_y integer,dependencies jsonb,crossing jsonb)
      on conflict(world_id,id) do nothing`.execute(tx);
    await sql`insert into navigation_hall_routes(world_id,key,namespace,payload) values(${manifest.worldId},${key},${manifest.namespace},${JSON.stringify(route)}::jsonb)
      on conflict(world_id,key) do update set namespace=excluded.namespace,payload=excluded.payload,last_used_at=statement_timestamp()`.execute(tx);
    await sql`delete from navigation_route_dependencies where world_id=${manifest.worldId} and route_key=${key}`.execute(tx);
    const dependencies=Object.entries(route.certificate.dependencies).map(([chunk, version])=>{
      const [x, y] = chunk.split(':').map(Number);
      return{chunk_x:x,chunk_y:y,revision:version};
    });
    await sql`insert into navigation_route_dependencies(world_id,route_key,chunk_x,chunk_y,revision)
      select ${manifest.worldId},${key},r.chunk_x,r.chunk_y,r.revision
      from jsonb_to_recordset(${JSON.stringify(dependencies)}::jsonb) as r(chunk_x integer,chunk_y integer,revision bigint)`.execute(tx);
    // Cache rows are dispensable: missions own their full geometry.
    await sql`delete from navigation_hall_routes where world_id=${manifest.worldId} and key in
      (select key from (select key,row_number() over(order by last_used_at desc,key) as n,
        sum(pg_column_size(payload)) over(order by last_used_at desc,key) as bytes
        from navigation_hall_routes where world_id=${manifest.worldId}) bounded where n>${limits.routes} or bytes>${limits.bytes})`.execute(tx);
    await sql`delete from navigation_chunk_crossings where world_id=${manifest.worldId} and id in
      (select id from (select id,row_number() over(order by created_at desc,id) as n,
        sum(pg_column_size(crossing)+pg_column_size(dependencies)) over(order by created_at desc,id) as bytes
        from navigation_chunk_crossings where world_id=${manifest.worldId}) bounded where n>${limits.crossings} or bytes>${limits.bytes})`.execute(tx);
    await sql`delete from navigation_chunk_meshes where world_id=${manifest.worldId} and (namespace,chunk_x,chunk_y) in
      (select namespace,chunk_x,chunk_y from (select namespace,chunk_x,chunk_y,row_number() over(order by updated_at desc,namespace,chunk_x,chunk_y) as n,
        sum(pg_column_size(cells)+pg_column_size(dependencies)) over(order by updated_at desc,namespace,chunk_x,chunk_y) as bytes
        from navigation_chunk_meshes where world_id=${manifest.worldId}) bounded where n>${limits.meshes} or bytes>${limits.bytes})`.execute(tx);
    return true;
  });
}
