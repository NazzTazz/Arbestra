import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, beforeEach, expect, it} from 'vitest';
import {sql, type Kysely} from 'kysely';
import {createDatabase} from '../../database/connection.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {migrateToLatest} from '../../database/migrate.js';
import {installNavigationInvalidation,up as installNavigationCache} from '../../database/migrations/046_navigation_cache.js';
import {certificateValid, navigationVersions, publishHallRoute, readChunkMeshes, readHallRoute, routeDependencies,touchHallRoute} from './route-cache.js';

const url = testDatabaseUrl(), db = createDatabase(url), world = randomUUID();
beforeAll(async () => {
  await migrateToLatest(url);
  await db.transaction().execute(tx => installNavigationInvalidation(tx));
  await db.insertInto('worlds').values({id: world, slug: `cache-${world}`, name: 'Private route cache', topology: 'torus', widthCells: 256,
    heightCells: 128, chunkSize: 32, seed: 7, generationVersion: 1, generationStatus: 'ready', isOpen: false, generatedAt: new Date()}).execute();
}, 60000);
afterAll(async () => {await db.deleteFrom('worlds').where('id', '=', world).execute(); await db.destroy();});
beforeEach(async () => {
  await db.deleteFrom('worldChunks').where('worldId', '=', world).execute();
  await chunk(0, 0);
});
const path = [{cellX: 2, cellY: 2}, {cellX: 12, cellY: 2}];
it('invalidates the local certificate when a synthetic grove is attached to an existing woodland',async()=>{
  const feature=randomUUID();
  await db.insertInto('worldFeatures').values({id:feature,worldId:world,featureTypeCode:'woodland',state:'available',variantSeed:3}).execute();
  try{
    await db.insertInto('woodlandDeposits').values({worldId:world,featureId:feature,cellX:80,cellY:80,initialAmount:1500,
      remainingAmount:1500,reservedAmount:0,revision:1,updatedAt:new Date(),regrowthUpdatedAt:new Date()}).execute();
    const before=await navigationVersions(db,world),certificate={namespace:before.namespace,
      dependencies:routeDependencies(before,[{cellX:80,cellY:80},{cellX:81,cellY:80}])};
    await db.insertInto('worldRc1Resources').values({worldId:world,featureId:feature,sourceKey:`starter:${feature}`,treeIndices:'[]',removedIndices:'[]'}).execute();
    const after=await navigationVersions(db,world);
    expect(after.namespace).toBe(before.namespace);
    expect(certificateValid(after,certificate)).toBe(false);
    expect(Number(after.versions['2:2'])).toBe(Number(before.versions['2:2'])+1);
  }finally{
    await db.deleteFrom('woodlandDeposits').where('worldId','=',world).where('featureId','=',feature).execute();
    await db.deleteFrom('worldFeatures').where('worldId','=',world).where('id','=',feature).execute();
  }
});
async function chunk(x: number, y: number) {
  await db.insertInto('worldChunks').values({worldId: world, chunkX: x, chunkY: y, generationVersion: 1, terrainCodes: Array(1024).fill(1), elevations: Array(1024).fill(1)})
    .onConflict(c => c.columns(['worldId', 'chunkX', 'chunkY']).doUpdateSet({terrainCodes: Array(1024).fill(2)})).execute();
}

it('persists across a new connection and ignores a distant change while rejecting a changed dependency', async () => {
  const manifest = await navigationVersions(db, world), certificate = {namespace: manifest.namespace, dependencies: routeDependencies(manifest, path)};
  expect(await publishHallRoute(db, manifest, 'pair', {path, cost: 10, certificate}, [])).toBe(true);
  const restarted = createDatabase(url);
  try {expect((await readHallRoute(restarted, await navigationVersions(restarted, world), 'pair'))?.path).toEqual(path);}
  finally {await restarted.destroy();}
  await chunk(5, 2);
  expect(certificateValid(await navigationVersions(db, world), certificate)).toBe(true);
  await chunk(0, 0);
  expect(certificateValid(await navigationVersions(db, world), certificate)).toBe(false);
  expect(await readHallRoute(db, await navigationVersions(db, world), 'pair')).toBeUndefined();
});

it('rolls back the physical edit and its versions together after observing both writes', async () => {
  const before = await navigationVersions(db, world), injected = new Error('rollback-navigation-proof');
  await expect(db.transaction().execute(async tx => {
    await tx.updateTable('worldChunks').set({elevations: Array(1024).fill(3)}).where('worldId', '=', world).where('chunkX', '=', 0).where('chunkY', '=', 0).execute();
    expect((await tx.selectFrom('worldChunks').select('elevations').where('worldId', '=', world).where('chunkX', '=', 0).where('chunkY', '=', 0).executeTakeFirstOrThrow()).elevations[0]).toBe(3);
    expect((await navigationVersions(tx, world)).versions).not.toEqual(before.versions);
    throw injected;
  })).rejects.toBe(injected);
  expect((await navigationVersions(db, world)).versions).toEqual(before.versions);
  expect((await db.selectFrom('worldChunks').select('elevations').where('worldId', '=', world).where('chunkX', '=', 0).where('chunkY', '=', 0).executeTakeFirstOrThrow()).elevations[0]).toBe(1);
});

it('records dependencies on both sides of a toroidal seam', async () => {
  const manifest = await navigationVersions(db, world);
  const dependencies = routeDependencies(manifest, [{cellX: 255, cellY: 127}, {cellX: 1, cellY: 127}, {cellX: 1, cellY: 1}]);
  expect(Object.keys(dependencies)).toEqual(expect.arrayContaining(['7:3', '0:3', '0:0', '-1:-1']));
});

it('merges partial mesh checks, restores them and discards them after a neighbouring physical edit',async()=>{
  const manifest=await navigationVersions(db,world),certificate={namespace:manifest.namespace,dependencies:routeDependencies(manifest,path)};
  const cells=(first:string)=>first+'00'.repeat(1023);
  await publishHallRoute(db,manifest,'mesh-pair',{path,cost:10,certificate},[],[{chunkX:0,chunkY:0,cells:cells('02')}]);
  await publishHallRoute(db,manifest,'mesh-pair',{path,cost:10,certificate},[],[{chunkX:0,chunkY:0,cells:cells('08')}]);
  expect((await readChunkMeshes(db,manifest)).find(m=>m.chunkX===0&&m.chunkY===0)?.cells).toBe(cells('0a'));
  await chunk(1,0);
  expect(await readChunkMeshes(db,await navigationVersions(db,world))).toEqual([]);
});

it('waits for a concurrent spatial writer and refuses to publish its stale result', async () => {
  const manifest = await navigationVersions(db, world), certificate = {namespace: manifest.namespace, dependencies: routeDependencies(manifest, path)};
  let entered!: () => void, release!: () => void, writerPid = 0;
  const ready = new Promise<void>(r => {entered = r;}), gate = new Promise<void>(r => {release = r;});
  const writer = db.transaction().execute(async tx => {
    writerPid=(await sql<{pid:number}>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid;
    await sql`select pg_advisory_xact_lock(hashtextextended(${'infrastructure:' + world},0))`.execute(tx);
    await tx.updateTable('worldChunks').set({elevations: Array(1024).fill(4)}).where('worldId', '=', world).where('chunkX', '=', 0).where('chunkY', '=', 0).execute();
    entered(); await gate;
  });
  let publication: Promise<boolean> | undefined;
  try {
    await Promise.race([ready, writer, new Promise<never>((_, reject) => setTimeout(() => reject(Error('writer barrier timeout')), 5000))]);
    publication = publishHallRoute(db, manifest, 'racing-pair', {path, cost: 10, certificate}, []);
    const deadline = Date.now() + 5000; let waiting = false;
    while (Date.now() < deadline) {
      const locks = await sql<{waiting: boolean}>`select exists(select 1 from pg_stat_activity where ${writerPid}=any(pg_blocking_pids(pid))) as waiting`.execute(db);
      if (locks.rows[0]?.waiting) {waiting = true; break;}
      await new Promise(r => setTimeout(r, 20));
    }
    expect(waiting).toBe(true);
  } finally {release(); await writer; if (publication) expect(await publication).toBe(false);}
  expect(await readHallRoute(db, await navigationVersions(db, world), 'racing-pair')).toBeUndefined();
}, 15000);

it('sees an older transaction committing later and does not serialize unrelated edits through a chunk row', async () => {
  const before=await navigationVersions(db,world);
  let entered!:()=>void,release!:()=>void;
  const ready=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
  const older=db.transaction().execute(async tx=>{
    await sql`select navigation_touch_box(${world},80,80,1)`.execute(tx);entered();await gate;
  });
  try{
    await ready;
    await db.transaction().execute(async tx=>{
      await sql`set local lock_timeout='1s'`.execute(tx);
      await sql`select navigation_touch_box(${world},84,84,1)`.execute(tx);
      await sql`select navigation_touch_box(${world},84,84,1)`.execute(tx);
    });
    const intermediate=await navigationVersions(db,world);
    expect(Number(intermediate.versions['2:2']??'0')).toBe(Number(before.versions['2:2']??'0')+1);
  }finally{release();await older;}
  expect(Number((await navigationVersions(db,world)).versions['2:2'])).toBe(Number(before.versions['2:2']??'0')+2);
});

it('executes the complete additive cache migration transactionally and restores the prior schema and rows',async()=>{
  const before=await navigationVersions(db,world),injected=new Error('migration-validation-rollback');
  await expect(db.transaction().execute(async tx=>{
    await sql`drop table navigation_route_dependencies,navigation_hall_routes,navigation_chunk_crossings,navigation_chunk_meshes,navigation_chunk_versions`.execute(tx);
    await installNavigationCache(tx as unknown as Kysely<unknown>);
    await sql`select navigation_touch_box(${world},80,80,1)`.execute(tx);
    expect((await navigationVersions(tx,world)).versions['2:2']).toBe('1');
    expect((await sql<{merged:string}>`select navigation_merge_cells('02','08') as merged`.execute(tx)).rows[0]!.merged).toBe('0a');
    throw injected;
  })).rejects.toBe(injected);
  expect((await navigationVersions(db,world)).versions).toEqual(before.versions);
});

it('measures thirty SQL reloads after restart and thirty subsequent RAM hits with current dependency checks',async()=>{
  const manifest=await navigationVersions(db,world);
  for(let i=0;i<30;i++){
    const points=Array.from({length:48+i*8},(_,j)=>({cellX:(j+2)%256,cellY:8}));
    await publishHallRoute(db,manifest,`latency-${i}`,{path:points,cost:points.length-1,
      certificate:{namespace:manifest.namespace,dependencies:routeDependencies(manifest,points)}},[]);
  }
  const restarted=createDatabase(url),timings:{sql:number[];ram:number[]}={sql:[],ram:[]};
  try{
    for(const mode of ['sql','ram'] as const)for(let i=0;i<30;i++){
      const began=performance.now();
      const route=await restarted.transaction().setIsolationLevel('repeatable read').execute(async tx=>
        readHallRoute(tx,await navigationVersions(tx,world),`latency-${i}`,restarted));
      await touchHallRoute(restarted,world,`latency-${i}`);
      timings[mode].push(performance.now()-began);expect(route?.path).toHaveLength(48+i*8);
    }
  }finally{await restarted.destroy();}
  console.info(JSON.stringify({navigationCacheLatency:Object.fromEntries(Object.entries(timings).map(([mode,values])=>{
    const sorted=[...values].sort((a,b)=>a-b);return[mode,{n:values.length,median:sorted[15],p95:sorted[28],max:sorted[29]}];
  }))}));
});
