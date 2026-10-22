import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'kysely';
import { Value } from '@sinclair/typebox/value';
import { SyncV2ChangeSchema } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { readSpatialChanges, readSpatialScopeSnapshot, type SpatialReadContext } from './sync-v2-spatial-readers.js';
import { readTerrainProjection } from '../worlds/terrain.js';

const url=testDatabaseUrl(), target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected spatial synchronization database');
const db=createDatabase(url),worldId=randomUUID(),accountId=randomUUID(),neighbor=randomUUID();
const village=randomUUID(),foreignVillage=randomUUID(),ownBuilding=randomUUID(),foreignBuilding=randomUUID(),feature=randomUUID();
const worldSlug='sync-spatial-'+worldId;
const context:SpatialReadContext={worldId,worldSlug,accountId,widthCells:64,heightCells:64,chunkSize:32,generationVersion:1,chunkX:0,chunkY:0};
beforeAll(async()=>{
  const stale=await db.selectFrom('worlds').select('id').where('slug','like','sync-spatial-%').where('name','=','Spatial synchronization').execute();
  if(stale.length){
    const ids=stale.map(row=>row.id);
    const owners=await db.selectFrom('villages').select('ownerAccountId').where('worldId','in',ids).execute();
    await db.deleteFrom('stoneDeposits').where('worldId','in',ids).execute();
    await db.deleteFrom('worlds').where('id','in',ids).execute();
    if(owners.length)await db.deleteFrom('accounts').where('id','in',owners.map(row=>row.ownerAccountId)).where('email','like','%@sync.test').execute();
  }
  for(const id of [accountId,neighbor])await db.insertInto('accounts').values({id,email:id+'@sync.test',passwordHash:'fixture'}).execute();
  await db.insertInto('worlds').values({id:worldId,slug:worldSlug,name:'Spatial synchronization',topology:'torus',widthCells:64,heightCells:64,
    chunkSize:32,seed:4109,generationVersion:1,generationStatus:'ready',isOpen:true,generatedAt:new Date()}).execute();
  for(const id of [accountId,neighbor])await db.insertInto('worldMemberships').values({worldId,accountId:id,playerName:'Reader'}).execute();
  for(const [id,owner,x] of [[village,accountId,5],[foreignVillage,neighbor,10]] as const)
    await db.insertInto('villages').values({id,worldId,ownerAccountId:owner,name:'Fixture',anchorCellX:x,anchorCellY:x,economyActivatedAt:new Date()}).execute();
  for(const [id,owner,x] of [[ownBuilding,village,5],[foreignBuilding,foreignVillage,10]] as const){
    await db.insertInto('buildings').values({id,worldId,villageId:owner,buildingType:'dwelling',level:1,status:'completed',targetLevel:null,
      completedAt:new Date(),constructionStartedAt:null,constructionCompletesAt:null}).execute();
    await db.insertInto('worldCellOccupancies').values({worldId,cellX:x,cellY:x,buildingId:id,featureId:null,role:'anchor'}).execute();
  }
  await db.insertInto('worldFeatures').values({id:feature,worldId,featureTypeCode:'stone_outcrop',state:'available',variantSeed:7}).execute();
  await db.insertInto('stoneDeposits').values({worldId,featureId:feature,cellX:6,cellY:6,initialAmount:100,remainingAmount:80,reservedAmount:10,revision:1,updatedAt:new Date()}).execute();
  await db.insertInto('worldCellOccupancies').values({worldId,cellX:6,cellY:6,buildingId:null,featureId:feature,role:'body'}).execute();
  for(const chunkX of [0,1])for(const chunkY of [0,1])await db.insertInto('worldChunks').values({worldId,chunkX,chunkY,generationVersion:1,
    terrainCodes:Array(1024).fill(1),elevations:Array(1024).fill(0)}).execute();
},60000);
afterAll(async()=>{try{
  await db.deleteFrom('stoneDeposits').where('worldId','=',worldId).execute();
  await db.deleteFrom('worlds').where('id','=',worldId).execute();
  await db.deleteFrom('accounts').where('id','in',[accountId,neighbor]).execute();
}finally{await db.destroy();}},30000);

it('reads selected cells and features while excluding neighboring private identities',async()=>{
  await db.transaction().setIsolationLevel('repeatable read').execute(async tx=>{
    await sql`set transaction read only`.execute(tx);
    const changes=await readSpatialChanges(tx,context,[{component:'spatialCells',key:'5,5'},{component:'spatialCells',key:'10,10'},
      {component:'spatialFeatures',key:feature},{component:'spatialExteriors',key:foreignBuilding}]);
    for(const change of changes)expect([...Value.Errors(SyncV2ChangeSchema,change)].map(error=>error.message)).toEqual([]);
    expect(changes[0]).toMatchObject({component:'spatialCells',upsert:expect.arrayContaining([
      {id:'5,5',cellX:5,cellY:5,occupied:true,buildingId:ownBuilding,role:'anchor',pendingExpansionId:null},
      {id:'10,10',cellX:10,cellY:10,occupied:false},
    ])});
    expect(changes[1]).toMatchObject({component:'spatialFeatures',upsert:[{id:feature,locations:[{cellX:6,cellY:6,deposit:{availableAmount:70}}]}]});
    const exterior=changes[2]!;
    expect(exterior).toMatchObject({component:'spatialExteriors',upsert:[{cellX:10,cellY:10,width:1,depth:1,exterior:{model:'dwelling',phase:'finished'}}]});
    expect(JSON.stringify(changes)).not.toContain(foreignBuilding);
    expect(JSON.stringify(changes)).not.toContain(foreignVillage);
    expect(JSON.stringify(changes)).not.toContain(neighbor);
  });
});
it('shares the existing pure terrain projection and preserves the complete chunk halo',async()=>{
  await db.transaction().setIsolationLevel('repeatable read').execute(async tx=>{
    await sql`set transaction read only`.execute(tx);
    const [change]=(await readSpatialChanges(tx,context,[{component:'spatialGround',key:'*'}]));
    if(change?.component!=='spatialGround')throw Error('Missing ground component');
    const {features:_features,occupiedCells:_occupied,...expected}=(await readTerrainProjection(tx,accountId,worldSlug,'0,0',true)).chunks[0]!;
    void _features;void _occupied;
    expect(change.upsert[0]?.data).toEqual(expected);
    expect(change.upsert[0]?.data.terrainCodes).toHaveLength(34*34);
  });
});
it('rejects noncanonical scopes and keys outside the selected chunk',async()=>{
  await db.transaction().execute(async tx=>{
    await expect(readSpatialChanges(tx,{...context,chunkX:-1},[])).rejects.toThrow('Non-canonical');
    await expect(readSpatialChanges(tx,context,[{component:'spatialCells',key:'32,0'}])).rejects.toThrow('outside spatial scope');
    const removed=await readSpatialChanges(tx,{...context,chunkX:1},[{component:'spatialFeatures',key:feature}]);
    expect(removed).toEqual([{component:'spatialFeatures',upsert:[],remove:[feature]}]);
  });
});
it('initializes every spatial component without leaking neighboring identities',async()=>{
  await db.transaction().setIsolationLevel('repeatable read').execute(async tx=>{
    await sql`set transaction read only`.execute(tx);
    const changes=await readSpatialScopeSnapshot(tx,context);
    expect(changes.map(change=>change.component).sort()).toEqual(['spatialCells','spatialExteriors','spatialFeatures','spatialGround']);
    for(const change of changes){
      expect([...Value.Errors(SyncV2ChangeSchema,change)].map(error=>error.message)).toEqual([]);
      expect(change.remove).toEqual([]);
    }
    expect(changes.find(change=>change.component==='spatialFeatures')).toMatchObject({upsert:[{id:feature}]});
    expect(JSON.stringify(changes)).not.toContain(foreignBuilding);
    expect(JSON.stringify(changes)).not.toContain(foreignVillage);
    expect(JSON.stringify(changes)).not.toContain(neighbor);
  });
});
