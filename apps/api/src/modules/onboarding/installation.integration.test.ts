import {materializeWoodlands} from '../deposits/woodland.js';
import {getVillageState} from '../villages/service.js';
import {getTerrain,getTerrainUpdates} from '../worlds/terrain.js';
import {readFileSync} from 'node:fs';
import {sql} from 'kysely';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createDatabase} from '../../database/connection.js';
import {migrateToLatest} from '../../database/migrate.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {STARTER_KIT} from './starter-kit.js';
import {RC1_CANONICAL_CHECKSUM} from './spawn-map.js';
import {SpawnCompute} from './spawn-compute.js';
import {installVillage,poseRemainingStarter,readInstallation} from './installation.js';
import type {GeneratedLandscape,SpawnPoseRequest} from '@arbestra/contracts';
const url=testDatabaseUrl(),target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected installation test database');
const db=createDatabase(url),compute=new SpawnCompute(),accountId=randomUUID(),worlds:string[]=[];
const artifact=JSON.parse(readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json',import.meta.url),'utf8')) as GeneratedLandscape;
async function fixture(){const id=randomUUID(),slug='install-'+id;worlds.push(id);
 await db.insertInto('worlds').values({id,slug,name:'Installation RC1 test',topology:'torus',widthCells:512,heightCells:256,chunkSize:32,seed:4109,generationStatus:'ready',generationVersion:3,isOpen:true,generatedAt:new Date()}).execute();
 await db.insertInto('worldGenerationCandidates').values({worldId:id,commandId:randomUUID(),ownerAccountId:accountId,parameters:artifact.geography!.parameters,status:'ready',checksum:RC1_CANONICAL_CHECKSUM,artifact}).execute();
 const input:SpawnPoseRequest={commandId:randomUUID(),artifactChecksum:RC1_CANONICAL_CHECKSUM,kitVersion:STARTER_KIT.version,point:{x:140,y:20},quarterTurns:0,mode:'grouped',playerName:'Recette',villageName:'Petit village'};
 return{id,slug,input};
}
describe('effective RC1 installation on isolated worlds',()=>{
 beforeAll(async()=>{await migrateToLatest(url);await db.insertInto('accounts').values({id:accountId,email:accountId+'@installation.test',passwordHash:'fixture'}).execute();},120000);
 afterAll(async()=>{await compute.close();if(worlds.length){await db.deleteFrom('populationCohorts').where('worldId','in',worlds).execute();await db.deleteFrom('woodlandDeposits').where('worldId','in',worlds).execute();await db.deleteFrom('stoneDeposits').where('worldId','in',worlds).execute();await db.deleteFrom('worlds').where('id','in',worlds).execute();}await db.deleteFrom('accounts').where('id','=',accountId).execute();await db.destroy();},60000);
 it('atomically places the compact kit, credits once, projects 2000 per natural stone site and preserves the signed source',async()=>{
  const f=await fixture(),installed=await installVillage(db,compute,accountId,f.slug,f.input);
  expect(installed.remaining).toEqual([]);
  const playable=await getVillageState(db,accountId,f.slug);
  expect(playable.cells.filter(c=>c.building)).toHaveLength(4); // Adjacent gardens form one logical site.
  expect(playable.cells.flatMap(c=>c.building?.garden?.plots??[])).toHaveLength(2);expect(playable.village.population.total).toBe(15);
  const terrain=await getTerrain(db,accountId,f.slug,'4,0');expect(terrain.chunks[0]!.rc1?.terraces).toHaveLength(6);
  const updates=await getTerrainUpdates(db,accountId,f.slug,'4,0');expect(updates.chunks[0]!.rc1?.terraces).toEqual(terrain.chunks[0]!.rc1!.terraces);
  expect(await db.selectFrom('worldChunks').select('chunkX').where('worldId','=',f.id).execute()).toHaveLength(128);
  expect(await readInstallation(db,accountId,f.slug)).toEqual(installed);
  const buildings=await db.selectFrom('buildings').selectAll().where('worldId','=',f.id).execute();expect(buildings).toHaveLength(5);
  expect(await db.selectFrom('worldSpawnTerraces').selectAll().where('worldId','=',f.id).execute()).toHaveLength(6);
  const stocks=await db.selectFrom('villageResources').select(['resourceCode','amount']).where('worldId','=',f.id).execute();expect(stocks.find(r=>r.resourceCode==='wood')?.amount).toBe('2000');
  const stones=await db.selectFrom('worldRc1Resources').innerJoin('stoneDeposits',j=>j.onRef('stoneDeposits.featureId','=','worldRc1Resources.featureId').onRef('stoneDeposits.worldId','=','worldRc1Resources.worldId')).select(['sourceKey','remainingAmount']).where('worldRc1Resources.worldId','=',f.id).execute();
  expect(stones.filter(s=>s.sourceKey.startsWith('stone:'))).toHaveLength(28);expect(stones.filter(s=>s.sourceKey.startsWith('stone:')).every(s=>Number(s.remainingAmount)===2000)).toBe(true);
  expect(stones.filter(s=>s.sourceKey.startsWith('starter:')).map(s=>Number(s.remainingAmount)).sort((a,b)=>a-b)).toEqual([150,150,2000,2000]);
  expect(await installVillage(db,compute,accountId,f.slug,f.input)).toEqual(installed);
  expect(await db.selectFrom('buildings').selectAll().where('worldId','=',f.id).execute()).toEqual(buildings);
  await expect(installVillage(db,compute,accountId,f.slug,{...f.input,point:{x:141,y:20}})).rejects.toMatchObject({code:'COMMAND_CONFLICT'});
  expect((await db.selectFrom('worldGenerationCandidates').select('artifact').where('worldId','=',f.id).executeTakeFirstOrThrow()).artifact).toEqual(artifact);
 },120000);
 it('starts with the HDV only and persists individual kit placements without redotation',async()=>{
  const f=await fixture(),installed=await installVillage(db,compute,accountId,f.slug,{...f.input,mode:'manual'});
  expect(installed.remaining).toHaveLength(4);
  expect(await db.selectFrom('buildings').selectAll().where('worldId','=',f.id).execute()).toHaveLength(1);
  const garden=installed.kit.elements.find(e=>e.type==='garden')!;
  const input={commandId:randomUUID(),elementKey:garden.key,point:{x:138,y:19},quarterTurns:0};
  const posed=await poseRemainingStarter(db,compute,accountId,f.slug,installed.villageId,input);
  expect(posed.remaining).not.toContain(garden.key);expect(posed.remaining).toHaveLength(3);
  expect(await poseRemainingStarter(db,compute,accountId,f.slug,installed.villageId,input)).toEqual(posed);
  expect(await db.selectFrom('gardenPlots').selectAll().where('worldId','=',f.id).execute()).toHaveLength(1);
  expect(await db.selectFrom('buildings').selectAll().where('worldId','=',f.id).execute()).toHaveLength(2);
  expect(await db.selectFrom('worldRc1Resources').selectAll().where('worldId','=',f.id).where('sourceKey','like','starter:%').execute()).toHaveLength(6);
  await expect(poseRemainingStarter(db,compute,accountId,f.slug,installed.villageId,{...input,commandId:randomUUID()})).rejects.toMatchObject({code:'STARTER_UNAVAILABLE'});
 },120000);
 it('refuses a changed artifact before any persistent village, membership or projection',async()=>{
  const f=await fixture();await expect(installVillage(db,compute,accountId,f.slug,{...f.input,artifactChecksum:'0'.repeat(64)})).rejects.toMatchObject({code:'SPAWN_MAP_STALE'});
  for(const table of ['villages','worldMemberships','worldRc1Resources','worldSpawnTerraces'] as const)expect(await db.selectFrom(table).selectAll().where('worldId','=',f.id).execute()).toEqual([]);
 });
 it('rolls back after resources, terrain, buildings and economics have actually been inserted',async()=>{
  const f=await fixture(),name='test_install_'+f.id.replaceAll('-','');
  await sql.raw(`create function ${name}() returns trigger language plpgsql as $$ begin
   if new.world_id='${f.id}' then
    if (select count(*) from world_rc1_resources where world_id=new.world_id)>2000
      and (select count(*) from world_spawn_terraces where world_id=new.world_id)=6
      and (select count(*) from buildings where world_id=new.world_id)=5
      and (select sum(member_count) from population_cohorts where world_id=new.world_id)=15
      and (select amount from village_resources where world_id=new.world_id and resource_code='wood')=2000
    then raise exception 'injected-after-complete-installation' using errcode='P0001';
    else raise exception 'fixture-did-not-reach-required-writes';end if;
   end if;return new;end $$;create trigger ${name} after insert on village_starter_installations for each row execute function ${name}();`).execute(db);
  try{
   await expect(installVillage(db,compute,accountId,f.slug,f.input)).rejects.toMatchObject({code:'P0001',message:'injected-after-complete-installation'});
   for(const table of ['villages','worldMemberships','worldFeatures','woodlandDeposits','stoneDeposits','worldCellOccupancies','worldRc1Resources','worldSpawnTerraces','worldChunks','buildings','villageResources','populationCohorts','villageStarterInstallations'] as const)
    expect(await db.selectFrom(table).selectAll().where('worldId','=',f.id).execute(),table).toEqual([]);
   expect((await db.selectFrom('worldGenerationCandidates').select('artifact').where('worldId','=',f.id).executeTakeFirstOrThrow()).artifact).toEqual(artifact);
  }finally{await sql.raw('drop trigger '+name+' on village_starter_installations;drop function '+name+'();').execute(db);}
 },120000);
 it('retains settled woodland stock and reconciles a missing physical occupancy within its world',async()=>{
  const f=await fixture(),id=randomUUID(),at=new Date();
  await db.insertInto('worldFeatures').values({id,worldId:f.id,featureTypeCode:'woodland',state:'available',variantSeed:1}).execute();
  await db.insertInto('woodlandDeposits').values({worldId:f.id,featureId:id,cellX:100,cellY:20,initialAmount:1500,remainingAmount:1500,reservedAmount:0,revision:1,updatedAt:at,regrowthUpdatedAt:at}).execute();
  await db.insertInto('worldCellOccupancies').values({worldId:f.id,featureId:id,buildingId:null,cellX:100,cellY:20,role:'body'}).execute();
  await db.transaction().execute(async tx=>{
   const before=await tx.selectFrom('woodlandDeposits').selectAll().where('worldId','=',f.id).where('featureId','=',id).forUpdate().executeTakeFirstOrThrow();
   await materializeWoodlands(tx,f.id,[id],at);
   expect(await tx.selectFrom('woodlandDeposits').selectAll().where('worldId','=',f.id).where('featureId','=',id).executeTakeFirstOrThrow()).toEqual(before);
   await tx.deleteFrom('worldCellOccupancies').where('worldId','=',f.id).where('featureId','=',id).execute();
   await materializeWoodlands(tx,f.id,[id],at);
   expect(await tx.selectFrom('worldCellOccupancies').select('featureId').where('worldId','=',f.id).where('featureId','=',id).execute()).toEqual([{featureId:id}]);
  });
 },30000);
 it('serializes two accounts targeting the same site and rechecks the committed neighbor',async()=>{
  const f=await fixture(),other=randomUUID();await db.insertInto('accounts').values({id:other,email:other+'@installation.test',passwordHash:'fixture'}).execute();
  let release!:()=>void,arrived!:()=>void;const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{arrived=r;});
  const held={run:async(...args:Parameters<SpawnCompute['run']>)=>{const result=await compute.run(...args);arrived();await gate;return result;}};
  const first=installVillage(db,held,accountId,f.slug,f.input);let second:ReturnType<typeof installVillage>|undefined;
  try{
   let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('first installation did not reach barrier')),45000);})]);}finally{clearTimeout(timer);}
   second=installVillage(db,compute,other,f.slug,{...f.input,commandId:randomUUID()});void second.catch(()=>{});
   const deadline=Date.now()+3500;let waiting=false;
   while(Date.now()<deadline){const locks=await sql<{waiting:boolean}>`select exists(select 1 from pg_locks where locktype='advisory' and not granted and objid::bigint=(hashtextextended(${'infrastructure:'+f.id},0)&4294967295)) as waiting`.execute(db);if(locks.rows[0]!.waiting){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}
   expect(waiting,'the competing transaction must wait on this world spatial lock').toBe(true);release();await first;
   await expect(second).rejects.toMatchObject({code:'SPAWN_BLOCKED'});
   expect(await db.selectFrom('villages').selectAll().where('worldId','=',f.id).execute()).toHaveLength(1);
   expect(await db.selectFrom('worldMemberships').selectAll().where('worldId','=',f.id).where('accountId','=',other).execute()).toEqual([]);
  }finally{release();await Promise.allSettled([first,...(second?[second]:[])]);await db.deleteFrom('accounts').where('id','=',other).execute();}
 },120000);

});
