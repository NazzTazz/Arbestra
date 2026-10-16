import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {sql} from 'kysely';
import {createDatabase} from '../../database/connection.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {migrateToLatest} from '../../database/migrate.js';
import {ownedVillage,stoneTravelPath} from './service.js';

const url=testDatabaseUrl();
const target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected route test database');
const db=createDatabase(url);
beforeAll(()=>migrateToLatest(url));
afterAll(()=>db.destroy());
it('reaches a woodland from the real door when the coarse hall anchor is enclosed, but refuses an actual barrier',async()=>{
 const rollback=new Error('route fixture rollback');
 await expect(db.transaction().execute(async tx=>{
  const account=randomUUID(),world=randomUUID(),village=randomUUID(),hall=randomUUID(),feature=randomUUID();
  await tx.insertInto('accounts').values({id:account,email:account+'@route.test',passwordHash:'fixture'}).execute();
  await tx.insertInto('worlds').values({id:world,slug:world,name:'Route regression',topology:'torus',widthCells:64,heightCells:64,chunkSize:32,seed:1,generationVersion:1,generationStatus:'ready',generatedAt:new Date()}).execute();
  await tx.insertInto('worldMemberships').values({worldId:world,accountId:account,playerName:'Route'}).execute();
  await tx.insertInto('villages').values({id:village,worldId:world,ownerAccountId:account,name:'Route',anchorCellX:10,anchorCellY:10}).execute();
  await tx.insertInto('buildings').values({id:hall,worldId:world,villageId:village,buildingType:'town-hall',level:1,targetLevel:null,status:'completed',constructionStartedAt:null,constructionCompletesAt:null,completedAt:new Date()}).execute();
  await tx.insertInto('worldCellOccupancies').values(Array.from({length:9},(_,i)=>({worldId:world,buildingId:hall,featureId:null,cellX:9+i%3,cellY:9+Math.floor(i/3),role:i===4?'anchor':'body'}))).execute();
  await tx.insertInto('worldChunks').values([0,1,2,3].map(i=>({worldId:world,chunkX:i%2,chunkY:Math.floor(i/2),generationVersion:1,terrainCodes:Array(1024).fill(1),elevations:Array(1024).fill(0)}))).execute();
  await tx.insertInto('worldFeatures').values({id:feature,worldId:world,featureTypeCode:'woodland',state:'available',variantSeed:1}).execute();
  await tx.insertInto('woodlandDeposits').values({worldId:world,featureId:feature,cellX:16,cellY:10,initialAmount:1000,remainingAmount:1000,reservedAmount:0,revision:1,updatedAt:new Date(),regrowthUpdatedAt:new Date()}).execute();
  const owner=await ownedVillage(tx,account,world,village);
  const path=await stoneTravelPath(tx,owner,feature);
  expect(path?.length,'the door, rather than the occupied coarse anchor, decides access').toBeGreaterThan(1);
  expect(path![0]).not.toEqual({cellX:10,cellY:10});
  expect(path!.at(-1)).toEqual({cellX:16,cellY:10});
  // A full water ring around the destination really is impassable.
  await sql`update world_chunks set terrain_codes = (select array_agg(case when abs((n-1)%32-16)<=1 and abs((n-1)/32-10)<=1 and n<>10*32+16+1 then 0 else v end order by n) from unnest(terrain_codes) with ordinality as a(v,n)) where world_id=${world} and chunk_x=0 and chunk_y=0`.execute(tx);
  expect(await stoneTravelPath(tx,owner,feature)).toBeUndefined();
  throw rollback;
 })).rejects.toBe(rollback);
},30000);