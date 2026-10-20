import {sql} from 'kysely';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { terraformQuote,type TerraformCommand,type TerraformRequest,fixedBuildingFootprint, type GeneratedLandscape, type LevelingCommand, type LevelingRequest } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { RC1_CANONICAL_CHECKSUM } from '../onboarding/spawn-map.js';
import { previewLeveling, commandLeveling, commandTerraform, COMPLETE_LEVELING_TASK } from './leveling.js';
import { beginVillageEconomy, reconcileVillageEconomy } from './reconcile-economy.js';
import { navigationRevision, loadNavigationContext } from '../navigation/context.js';
import { constructBuilding, constructBuildingArea, getVillageState } from './service.js';
import { spawnSpatialState } from '../onboarding/spawn-state.js';
import {activateTerrainVertices} from '../worlds/terrain-vertices.js';
import {readRc1Ground} from '../worlds/rc1-ground.js';

const url = testDatabaseUrl(), target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected leveling test database');
const db = createDatabase(url), accountId = randomUUID(), worldId = randomUUID(), villageId = randomUUID(), hallId = randomUUID(), slug = 'vertices-' + worldId;
const artifact = JSON.parse(readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8')) as GeneratedLandscape;
const request: LevelingRequest = { buildingType: 'university', anchor: { cellX: 59, cellY: 200 }, quarterTurns: 1, workerCount: 2 };
const cells = fixedBuildingFootprint('university', request.anchor, 1, { widthCells: 512, heightCells: 256 });
beforeAll(async () => {
  await migrateToLatest(url);
  await db.insertInto('accounts').values({ id: accountId, email: accountId + '@leveling.test', passwordHash: 'fixture' }).execute();
  await db.insertInto('worlds').values({ id: worldId, slug, name: 'Nivellement test', topology: 'torus', widthCells: 512, heightCells: 256, chunkSize: 32, seed: 4109, generationVersion: 3, generationStatus: 'ready', isOpen: false, generatedAt: new Date() }).execute();
  await db.insertInto('worldChunks').values(Array.from({length:128},(_,i)=>({worldId,chunkX:i%16,chunkY:Math.floor(i/16),generationVersion:3,terrainCodes:Array(1024).fill(1),elevations:Array(1024).fill(25)}))).execute();
  await db.insertInto('worldGenerationCandidates').values({ worldId, commandId: randomUUID(), ownerAccountId: accountId, parameters: artifact.geography!.parameters, checksum: RC1_CANONICAL_CHECKSUM, status: 'ready', artifact }).execute();
  await activateTerrainVertices(db,worldId);
  expect((await db.selectFrom('worlds').select('terrainModel').where('id','=',worldId).executeTakeFirstOrThrow()).terrainModel).toBe('vertices');
  await db.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Terrassier' }).execute();
  await db.insertInto('villages').values({ id: villageId, worldId, ownerAccountId: accountId, name: 'Terrasse', anchorCellX: 59, anchorCellY: 195, economyActivatedAt: new Date() }).execute();
  await db.insertInto('buildings').values({ id: hallId, worldId, villageId, buildingType: 'town-hall', level: 2, status: 'completed', completedAt: new Date(), constructionStartedAt: null, constructionCompletesAt: null }).execute();
  await db.insertInto('worldCellOccupancies').values({ worldId, cellX: 59, cellY: 195, buildingId: hallId, featureId: null, pendingExpansionId: null, role: 'anchor' }).execute();
  for (const cellX of [55,64]) {
    const id = randomUUID();
    await db.insertInto('buildings').values({id,worldId,villageId,buildingType:'dwelling',level:1,status:'completed',completedAt:new Date(),constructionStartedAt:null,constructionCompletesAt:null}).execute();
    await db.insertInto('worldCellOccupancies').values({worldId,cellX,cellY:200,buildingId:id,featureId:null,pendingExpansionId:null,role:'anchor'}).execute();
  }
  await db.insertInto('villageResources').values(['wood', 'stone', 'timber', 'cut-stone', 'carrot'].map(resourceCode => ({ worldId, villageId, resourceCode, amount: 10000 }))).onConflict(c => c.columns(['worldId','villageId','resourceCode']).doUpdateSet({amount:10000})).execute();
  await db.insertInto('villageResourceFlows').values({ worldId, villageId, resourceCode: 'wood', baseRatePerHour: 0, remainder: 0, productionUpdatedAt: new Date() }).execute();
  await db.insertInto('populationCohorts').values({ worldId, villageId, originVillageId: villageId, memberCount: 15, activity: 'idle', energy: 10, energyProgress: 0, energyUpdatedAt: new Date(), restingSince: null, foodUsedSinceRest: 0, harvestId: null, extractionId: null }).execute();
  // Controlled dry, gently sloping test pad over the genuine immutable RC1 source.
  const featureId=randomUUID(), removed=artifact.forest!.trees.flatMap((t,i)=>t.x>=50&&t.x<=69&&t.y>=187&&t.y<=207?[i]:[]);
  await db.insertInto('worldFeatures').values({id:featureId,worldId,featureTypeCode:'woodland',state:'available',variantSeed:1}).execute();
  await db.insertInto('worldRc1Resources').values({worldId,featureId,sourceKey:'test:cleared-pad',treeIndices:JSON.stringify(removed),removedIndices:JSON.stringify(removed)}).execute();
  await db.insertInto('worldTerrainVertices').values(Array.from({ length: 324 }, (_, i) => {
    const vertexX=51+i%18,vertexY=188+Math.floor(i/18);
    const height=vertexX>=57&&vertexX<=63&&vertexY>=198&&vertexY<=203?.25+(vertexX-60)*.015:.25;
    return {worldId,vertexX,vertexY,height};
  })).execute();
}, 120000);

it('invalidates all incident chunks at the torus seam and rolls the entire change back',async()=>{
 const prior=await navigationRevision(db,worldId),rollback=Error('VERTEX_SEAM_ROLLBACK');
 await expect(db.transaction().execute(async tx=>{
  await tx.insertInto('worldTerrainVertices').values({worldId,vertexX:0,vertexY:0,height:.8}).execute();
  const touched=await sql<{chunkX:number;chunkY:number}>`select chunk_x,chunk_y from navigation_chunk_versions where world_id=${worldId} and transaction_id=txid_current()`.execute(tx);
  expect(touched.rows.map(c=>`${c.chunkX}:${c.chunkY}`).sort()).toEqual(['0:0','0:7','15:0','15:7']);
  const g=await readRc1Ground(tx,worldId);
  expect(g.patch(0,0,32).heights[0]).toBe(.8);
  expect(g.patch(480,224,32).heights[1088]).toBe(.8);
  expect(await navigationRevision(tx,worldId)).not.toBe(prior);
  throw rollback;
 })).rejects.toBe(rollback);
 expect(await navigationRevision(db,worldId)).toBe(prior);
 expect(await db.selectFrom('worldTerrainVertices').select('height').where('worldId','=',worldId).where('vertexX','=',0).where('vertexY','=',0).execute()).toEqual([]);
});
afterAll(async () => {
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
}, 60000);

it('rejects single-cell foundations on a sculpted flank on both command routes without spending or reserving',async()=>{
  const cell={cellX:62,cellY:192},corner={vertexX:63,vertexY:192};
  await db.updateTable('worldTerrainVertices').set({height:8}).where('worldId','=',worldId).where('vertexX','=',corner.vertexX).where('vertexY','=',corner.vertexY).execute();
  const rows=async()=>Promise.all(['buildings','villageResources','worldCellOccupancies','buildingCommandReceipts','populationCohorts','scheduledTasks'].map(table=>
    sql`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as data from ${sql.table(table.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()))} t where world_id=${worldId}`.execute(db).then(r=>r.rows)));
  try{
    const ground=await readRc1Ground(db,worldId);expect(ground.field.geometry!.height(corner.vertexX,corner.vertexY)).toBe(8);
    const before=await rows();
    await expect(constructBuilding(db,accountId,slug,villageId,cell.cellX,cell.cellY,'dwelling',600000,randomUUID())).rejects.toMatchObject({code:'UNEVEN_TERRAIN'});
    expect(await rows()).toEqual(before);
    await expect(constructBuildingArea(db,accountId,slug,villageId,'sawmill',cell,[cell],600000,randomUUID())).rejects.toMatchObject({code:'UNEVEN_TERRAIN'});
    expect(await rows()).toEqual(before);
  }finally{
    await db.updateTable('worldTerrainVertices').set({height:.25}).where('worldId','=',worldId).where('vertexX','=',corner.vertexX).where('vertexY','=',corner.vertexY).execute();
  }
},120000);

it('certifies a local free-terrain quote without reserving on mismatch, admits 50 workers once and persists the chosen height',async()=>{
  await db.updateTable('populationCohorts').set({memberCount:60}).where('worldId','=',worldId).execute();
  const ground=await readRc1Ground(db,worldId),r:TerraformRequest={buildingType:'terrain',anchor:{cellX:62,cellY:192},quarterTurns:0,
    cells:[{cellX:62,cellY:192},{cellX:63,cellY:192}],height:.5,workerCount:50};
  const expected=terraformQuote(r,{widthCells:512,heightCells:256},ground.field.geometry!.height,0);
  const command:TerraformCommand={...r,commandId:randomUUID(),expected:{...expected,stoneDebit:99}};
  const rows=async()=>Promise.all(['levelingJobs','populationCohorts','worldCellOccupancies','worldTerrainVertices','villageResources','scheduledTasks'].map(table=>
    sql`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as data from ${sql.table(table.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()))} t where world_id=${worldId}`.execute(db).then(result=>result.rows)));
  const before=await rows();
  const adjusted=await commandTerraform(db,accountId,slug,villageId,command);
  expect(adjusted.status).toBe('changed');expect(await rows()).toEqual(before);
  if(adjusted.status!=='changed')throw Error('Expected corrected quote');
  expect(adjusted.preview.quote.workMs).toBe(expected.workMs);expect(adjusted.preview.quote.vertices).toEqual(expected.vertices);
  expect(adjusted.preview.quote.stoneDebit).toBe(0);expect(adjusted.preview.quote.transportMs).toBeGreaterThan(0);
  // Only the estimated round-trip differs, within 10% of the client's total.
  const serverQuote=adjusted.preview.quote;
  const transportMs=serverQuote.transportMs-Math.min(serverQuote.transportMs,Math.floor(serverQuote.durationMs/40));
  const accepted={...command,expected:{...serverQuote,transportMs,durationMs:serverQuote.workMs+2*transportMs}};
  expect(serverQuote.durationMs).toBeGreaterThan(accepted.expected.durationMs);
  expect(serverQuote.durationMs).toBeLessThanOrEqual(accepted.expected.durationMs*1.1);
  const result=await commandTerraform(db,accountId,slug,villageId,accepted);expect(result.status).toBe('started');
  const job=await db.selectFrom('levelingJobs').selectAll().where('worldId','=',worldId).executeTakeFirstOrThrow();
  expect(job.workerCount).toBe(50);expect(job.request.buildingType).toBe('terrain');
  expect(job.quote).toEqual(serverQuote);
  expect(job.completesAt.getTime()-job.startedAt.getTime()).toBe(serverQuote.durationMs);
  expect(result.status==='started'&&result.state.village.levelingJobs?.some(j=>j.id===job.id)).toBe(true);
  expect(await db.selectFrom('worldCellOccupancies').select('cellX').where('worldId','=',worldId).where('featureId','=',job.featureId).execute()).toHaveLength(expected.affectedCells!.length);
  await commandTerraform(db,accountId,slug,villageId,accepted);
  expect(await db.selectFrom('levelingJobs').select('id').where('worldId','=',worldId).execute()).toHaveLength(1);
  await expect(commandTerraform(db,accountId,slug,villageId,{...accepted,height:.75})).rejects.toMatchObject({code:'COMMAND_REUSED'});
  await expect(commandTerraform(db,randomUUID(),slug,villageId,accepted)).rejects.toMatchObject({code:'VILLAGE_NOT_FOUND'});
  await db.transaction().execute(async tx=>{
    const ctx=await beginVillageEconomy(tx,worldId,villageId);
    await reconcileVillageEconomy(tx,{...ctx,through:job.completesAt});
    await reconcileVillageEconomy(tx,{...ctx,through:job.completesAt});
  });
  const after=await readRc1Ground(db,worldId);
  for(const v of expected.vertices!)expect(after.field.geometry!.height(v.vertexX,v.vertexY)).toBe(.5);
  expect(await db.selectFrom('populationCohorts').select('id').where('levelingJobId','=',job.id).execute()).toHaveLength(0);
  // Leave the shared historical-leveling fixture exactly as it was geometrically.
  for(const v of expected.vertices!)await db.updateTable('worldTerrainVertices').set({height:ground.field.geometry!.height(v.vertexX,v.vertexY)}).where('worldId','=',worldId).where('vertexX','=',v.vertexX).where('vertexY','=',v.vertexY).execute();
  await db.deleteFrom('scheduledTasks').where('worldId','=',worldId).where('subjectId','=',job.id).execute();
  await db.deleteFrom('levelingJobs').where('worldId','=',worldId).where('id','=',job.id).execute();
},120000);

it('previews a remote campus outside the original region using its actual terrain and building accesses', async () => {
  // The village anchor is a presentation origin; the physical hall keeps its own identity and access.
  await db.updateTable('villages').set({anchorCellX:19}).where('worldId','=',worldId).where('id','=',villageId).execute();
  try {
    const state=await getVillageState(db,accountId,slug,villageId);
    expect(state.region.width).toBeGreaterThan(64);
    expect(cells.every(c=>state.cells.some(s=>s.cellX===c.cellX&&s.cellY===c.cellY&&s.canBuild))).toBe(true);
    const preview=await previewLeveling(db,accountId,slug,villageId,request);
    expect(preview.valid).toBe(true);expect(preview.quote.cells).toHaveLength(30);
  } finally {
    await db.updateTable('villages').set({anchorCellX:59}).where('worldId','=',worldId).where('id','=',villageId).execute();
  }
},120000);

it('reserves the shared-corner ring, rolls back changed vertices, finishes once and permits a university', async () => {
  const before = await getVillageState(db, accountId, slug, villageId);
  const preview = await previewLeveling(db, accountId, slug, villageId, request);
  expect(preview.valid).toBe(true); expect(preview.quote.cells).toHaveLength(30);
  expect(preview.quote.affectedCells).toHaveLength(56);expect(preview.quote.vertices).toHaveLength(42);
  expect(preview.quote.stoneDebit).toBe(0); expect(preview.quote.stoneCredit).toBe(0);
  const command: LevelingCommand = { ...request, commandId: randomUUID(), expected: preview.quote };
  const revision = await navigationRevision(db, worldId);
  let unlock!: () => void, locked!: (pid: number) => void;
  const gate = new Promise<void>(r => { unlock=r; }), ready = new Promise<number>(r => { locked=r; });
  const holder = db.transaction().execute(async tx => {
    await tx.selectFrom('villages').select('id').where('worldId','=',worldId).where('id','=',villageId).forUpdate().execute();
    locked((await sql<{pid:number}>`select pg_backend_pid() pid`.execute(tx)).rows[0]!.pid);
    await gate;
  });
  const pid = await ready;
  const attempts = Promise.allSettled([commandLeveling(db, accountId, slug, villageId, command), commandLeveling(db, accountId, slug, villageId, command)]);
  let results: Awaited<typeof attempts>;
  try {
    const until=Date.now()+15000; let waiting=0;
    while (Date.now()<until && waiting<2) {
      waiting=Number((await sql<{n:string}>`with recursive waiting(pid) as (
        select pid from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid))
        union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))
      ) select count(*)::text n from waiting`.execute(db)).rows[0]!.n);
      if (waiting<2) await new Promise(r=>setTimeout(r,20));
    }
    expect(waiting).toBe(2);
  } finally { unlock(); await holder; results=await attempts; }
  expect(results.every(r=>r.status==='fulfilled')).toBe(true);
  const launched = (results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof commandLeveling>>>).value;
  expect(launched.village.levelingJobs).toHaveLength(1);
  expect(launched.village.population.working).toBe(2);
  expect(launched.village.resources.map(r=>[r.code,r.amount])).toEqual(before.village.resources.map(r=>[r.code,r.amount]));
  const job = await db.selectFrom('levelingJobs').selectAll().where('worldId', '=', worldId).executeTakeFirstOrThrow();
  expect(await navigationRevision(db, worldId)).not.toBe(revision);
  const navigation = await loadNavigationContext(db, worldId, new Set(), new Set());
  expect(navigation.data!.occupancies.filter(c => c.buildingId === job.featureId)).toHaveLength(56);
  expect((await spawnSpatialState(db, worldId)).walkBlockedSurfaces).toContainEqual({ x: 59, y: 200, halfWidth: .5, halfHeight: .5 });
  await commandLeveling(db, accountId, slug, villageId, command);
  expect(await db.selectFrom('levelingJobs').select('id').where('worldId', '=', worldId).execute()).toHaveLength(1);
  await expect(commandLeveling(db, accountId, slug, villageId, { ...command, workerCount: 1 })).rejects.toMatchObject({ code: 'COMMAND_REUSED' });
  await expect(previewLeveling(db, randomUUID(), slug, villageId, request)).rejects.toMatchObject({ code: 'VILLAGE_NOT_FOUND' });
  await expect(previewLeveling(db, accountId, slug, villageId, request)).rejects.toMatchObject({ code: 'LEVELING_NEARBY' });
  const terraceBefore = await db.selectFrom('worldTerrainVertices').selectAll().where('worldId', '=', worldId).orderBy('vertexX').orderBy('vertexY').execute();
  await db.transaction().execute(async tx => {
    const ctx = await beginVillageEconomy(tx, worldId, villageId);
    await reconcileVillageEconomy(tx, { ...ctx, through: new Date(job.completesAt.getTime() - 1) });
  });
  expect(await db.selectFrom('worldTerrainVertices').selectAll().where('worldId', '=', worldId).orderBy('vertexX').orderBy('vertexY').execute()).toEqual(terraceBefore);
  async function rollbackState() {
    const rows = [];
    for (const table of ['leveling_jobs','world_cell_occupancies','world_features','world_terrain_vertices','population_cohorts','village_resources','village_resource_flows','scheduled_tasks'])
      rows.push((await sql`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) data from ${sql.table(table)} t where world_id=${worldId}`.execute(db)).rows);
    return {rows,revision:await navigationRevision(db,worldId)};
  }
  const rollbackBefore = await rollbackState();
  const rollback = new Error('LEVELING_COMPLETION_ROLLBACK');
  await expect(db.transaction().execute(async tx => {
    const ctx = await beginVillageEconomy(tx, worldId, villageId);
    await reconcileVillageEconomy(tx, { ...ctx, through: job.completesAt });
    expect((await tx.selectFrom('worldTerrainVertices').select('height').where('worldId', '=', worldId).where('vertexX', '=', 57).where('vertexY', '=', 198).executeTakeFirstOrThrow()).height).toBe(preview.quote.height);
    expect((await tx.selectFrom('levelingJobs').select('completedAt').where('worldId', '=', worldId).where('id', '=', job.id).executeTakeFirstOrThrow()).completedAt).not.toBeNull();
    expect(await tx.selectFrom('worldCellOccupancies').select('cellX').where('worldId', '=', worldId).where('featureId', '=', job.featureId).execute()).toHaveLength(0);
    throw rollback;
  })).rejects.toBe(rollback);
  expect(await rollbackState()).toEqual(rollbackBefore);
  expect(await db.selectFrom('worldTerrainVertices').selectAll().where('worldId', '=', worldId).orderBy('vertexX').orderBy('vertexY').execute()).toEqual(terraceBefore);
  await db.transaction().execute(async tx => {
    const ctx = await beginVillageEconomy(tx, worldId, villageId);
    await reconcileVillageEconomy(tx, { ...ctx, through: job.completesAt });
    await reconcileVillageEconomy(tx, { ...ctx, through: job.completesAt });
  });
  const done = await getVillageState(db, accountId, slug, villageId);
  expect(done.village.levelingJobs).toHaveLength(0); expect(done.village.population.working).toBe(0);
  expect(done.village.resources.map(r=>[r.code,r.amount])).toEqual(before.village.resources.map(r=>[r.code,r.amount]));
  const released = await db.selectFrom('populationCohorts').selectAll().where('worldId', '=', worldId).where('memberCount', '=', 2).executeTakeFirstOrThrow();
  expect(released.levelingJobId).toBeNull(); expect(released.energy * 79200000 + released.energyProgress).toBeLessThan(10 * 79200000);
  expect((await db.selectFrom('scheduledTasks').select('completedAt').where('worldId', '=', worldId).where('taskType', '=', COMPLETE_LEVELING_TASK).executeTakeFirstOrThrow()).completedAt).toBeNull();
  const definition = done.buildingTypes.find(b => b.code === 'university')!.levels.find(l => l.level === 1)!;
  const built = await constructBuildingArea(db, accountId, slug, villageId, 'university', request.anchor, cells, null, randomUUID(), definition.costs, 1);
  expect(built.cells.some(c => c.building?.type === 'university' && c.building.status === 'under-construction')).toBe(true);
}, 120000);

it('serializes disjoint footprints whose shared corner and neighbour rings overlap',async()=>{
 for(const [vertexX,vertexY,height] of [[54,191,.3],[56,193,.31]])await db.updateTable('worldTerrainVertices').set({height:height!}).where('worldId','=',worldId).where('vertexX','=',vertexX!).where('vertexY','=',vertexY!).execute();
 const requests:LevelingRequest[]=[{buildingType:'stonemason',anchor:{cellX:54,cellY:191},quarterTurns:0,workerCount:1},{buildingType:'stonemason',anchor:{cellX:56,cellY:193},quarterTurns:0,workerCount:1}];
 const commands:LevelingCommand[]=[];
 for(const r of requests){const p=await previewLeveling(db,accountId,slug,villageId,r);commands.push({...r,commandId:randomUUID(),expected:p.quote});}
 expect(commands[0]!.expected.cells.some(a=>commands[1]!.expected.cells.some(b=>a.cellX===b.cellX&&a.cellY===b.cellY))).toBe(false);
 let unlock!:()=>void,ready!:(pid:number)=>void;
 const gate=new Promise<void>(r=>{unlock=r;}),locked=new Promise<number>(r=>{ready=r;});
 const holder=db.transaction().execute(async tx=>{
  await tx.selectFrom('villages').select('id').where('worldId','=',worldId).where('id','=',villageId).forUpdate().execute();
  ready((await sql<{pid:number}>`select pg_backend_pid() pid`.execute(tx)).rows[0]!.pid);await gate;
 });
 const pid=await locked,attempts=Promise.allSettled(commands.map(c=>commandLeveling(db,accountId,slug,villageId,c)));
 let results:Awaited<typeof attempts>;
 try{
  let waiting=0;const until=Date.now()+15000;
  while(waiting<2&&Date.now()<until){
   waiting=Number((await sql<{n:string}>`with recursive waiting(pid) as (select pid from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)) union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))) select count(*)::text n from waiting`.execute(db)).rows[0]!.n);
   if(waiting<2)await new Promise(r=>setTimeout(r,20));
  }expect(waiting).toBe(2);
 }finally{unlock();await holder;results=await attempts;}
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;
 expect(rejected.reason).toMatchObject({code:'LEVELING_NEARBY'});
 expect(await db.selectFrom('levelingJobs').select('id').where('worldId','=',worldId).where('completedAt','is',null).execute()).toHaveLength(1);
},120000);
