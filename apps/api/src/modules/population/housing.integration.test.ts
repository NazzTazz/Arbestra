import {sql,type Transaction} from 'kysely';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createDatabase} from '../../database/connection.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {migrateToLatest} from '../../database/migrate.js';
import {resetE2eState} from '../../database/reset-e2e.js';
import {DEVELOPMENT_IDS as ids} from '../../database/seed.js';
import type {Database} from '../../database/schema.js';
import {materializeCohorts,reconcileRestHousing} from './work.js';
const url=testDatabaseUrl(),db=createDatabase(url),worldId=ids.world,villageId=ids.village;
beforeAll(async()=>{await migrateToLatest(url);await resetE2eState(url);});afterAll(()=>db.destroy());
const rollback=new Error('housing fixture rollback');
async function fixture(count:number,run:(tx:Transaction<Database>,t:Date,homes:string[])=>Promise<void>,error:Error=rollback){
  await expect(db.transaction().execute(async tx=>{
    await tx.selectFrom('villages').select('id').where('worldId','=',worldId).where('id','=',villageId).forUpdate().executeTakeFirstOrThrow();
    const t=(await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
    const homes=[];for(const level of [1,2])homes.push((await tx.insertInto('buildings').values({worldId,villageId,buildingType:'dwelling',level,targetLevel:null,
      status:'completed',constructionStartedAt:null,constructionCompletesAt:null,completedAt:t}).returning('id').executeTakeFirstOrThrow()).id);
    await tx.insertInto('populationCohorts').values({worldId,villageId,originVillageId:villageId,memberCount:count,activity:'resting',energy:2,energyProgress:123,
      energyUpdatedAt:t,restingSince:t,foodUsedSinceRest:1,harvestId:null,extractionId:null}).execute();
    await run(tx,t,homes);throw rollback;
  })).rejects.toBe(error);
}
it('fragments resting cohorts across houses first then town hall, preserving energy and stable placements',async()=>{
  await fixture(40,async(tx,t,homes)=>{
    const before=await tx.selectFrom('villageResources').selectAll().where('worldId','=',worldId).orderBy('resourceCode').execute();
    const cohorts=await materializeCohorts(tx,worldId,villageId,t),rest=cohorts.filter(c=>c.activity==='resting');
    expect(rest.reduce((n,c)=>n+c.memberCount,0)).toBe(40);
    expect(rest.filter(c=>c.restBuildingId===homes[0]).reduce((n,c)=>n+c.memberCount,0)).toBe(5);
    expect(rest.filter(c=>c.restBuildingId===homes[1]).reduce((n,c)=>n+c.memberCount,0)).toBe(25);
    expect(rest.find(c=>c.restBuildingId===ids.townHall)?.memberCount).toBe(10);
    expect(rest.every(c=>c.energy===2&&c.energyProgress===123&&c.foodUsedSinceRest===1&&c.originVillageId===villageId)).toBe(true);
    expect((await materializeCohorts(tx,worldId,villageId,t)).map(c=>[c.id,c.restBuildingId,c.memberCount]).sort()).toEqual(cohorts.map(c=>[c.id,c.restBuildingId,c.memberCount]).sort());
    expect(await tx.selectFrom('villageResources').selectAll().where('worldId','=',worldId).orderBy('resourceCode').execute()).toEqual(before);
    const awake=await materializeCohorts(tx,worldId,villageId,new Date(t.getTime()+5*3600000));
    expect(awake.every(c=>c.restBuildingId===null)).toBe(true);expect(awake.reduce((n,c)=>n+c.memberCount,0)).toBe(55);
  });
});
it('keeps excess people resting without a bed and fills new capacity without moving housed cohorts',async()=>{
  await fixture(80,async(tx,t)=>{
    const cohorts=await materializeCohorts(tx,worldId,villageId,t),rest=cohorts.filter(c=>c.activity==='resting');
    expect(rest.filter(c=>c.restBuildingId===null).reduce((n,c)=>n+c.memberCount,0)).toBe(20);
    const housed=rest.filter(c=>c.restBuildingId!==null);
    await tx.insertInto('buildings').values({worldId,villageId,buildingType:'dwelling',level:1,targetLevel:null,status:'completed',constructionStartedAt:null,constructionCompletesAt:null,completedAt:t}).execute();
    const updated=await materializeCohorts(tx,worldId,villageId,t);
    expect(updated.filter(c=>c.activity==='resting'&&c.restBuildingId===null).reduce((n,c)=>n+c.memberCount,0)).toBe(15);
    for(const c of housed)expect(updated.find(r=>r.id===c.id)).toMatchObject({restBuildingId:c.restBuildingId,memberCount:c.memberCount});
  });
});
it('allocates automatic rest at exhaustion',async()=>{
  await fixture(1,async(tx,t)=>{
    await tx.updateTable('populationCohorts').set({energy:0,energyProgress:0,energyUpdatedAt:new Date(t.getTime()-1)}).where('villageId','=',villageId).where('activity','=','idle').execute();
    const rows=await materializeCohorts(tx,worldId,villageId,t);
    expect(rows.reduce((n,c)=>n+c.memberCount,0)).toBe(16);
    expect(rows.every(c=>c.activity==='resting'&&c.restBuildingId!==null)).toBe(true);
  });
});
it('reconciles snapshot beds and wake-ups without rewriting unchanged energy cursors on every poll',async()=>{
  await fixture(40,async(tx,t)=>{
    const first=await reconcileRestHousing(tx,worldId,villageId,t);
    expect(first.filter(c=>c.restBuildingId!==null)).toHaveLength(3);
    const later=await reconcileRestHousing(tx,worldId,villageId,new Date(t.getTime()+1000));
    expect(later.sort((a,b)=>a.id.localeCompare(b.id))).toEqual(first.sort((a,b)=>a.id.localeCompare(b.id)));
    const awake=await reconcileRestHousing(tx,worldId,villageId,new Date(t.getTime()+5*3600000));
    expect(awake.every(c=>c.restBuildingId===null)).toBe(true);
    expect(awake.filter(c=>c.id!==first.find(r=>r.activity==='idle')?.id).every(c=>c.activity==='idle')).toBe(true);
  });
});
it('does not reserve beds for a team whose committed journey is still in progress',async()=>{
  await fixture(1,async(tx,t)=>{
    const harvest=await tx.insertInto('gardenHarvests').values({worldId,villageId,buildingId:ids.townHall,status:'in-progress',commandId:randomUUID(),
      startedAt:t,completesAt:new Date(t.getTime()+60000),completedAt:null,workerCount:15,reservedCarrots:0,
      plotCellX:null,plotCellY:null,transportMs:0,pathCells:[]}).returning('id').executeTakeFirstOrThrow();
    await tx.updateTable('populationCohorts').set({activity:'working',energy:0,energyProgress:0,energyUpdatedAt:new Date(t.getTime()-1),harvestId:harvest.id})
      .where('villageId','=',villageId).where('activity','=','idle').execute();
    const rows=await materializeCohorts(tx,worldId,villageId,t),away=rows.filter(c=>c.harvestId===harvest.id);
    expect(away.reduce((n,c)=>n+c.memberCount,0)).toBe(15);expect(away.every(c=>c.restBuildingId===null)).toBe(true);
    expect(rows.filter(c=>c.restBuildingId!==null).reduce((n,c)=>n+c.memberCount,0)).toBe(1);
  });
});
it('rolls back verified splits and bed assignments after an identified failure',async()=>{
  const rows=()=>db.selectFrom('populationCohorts').selectAll().where('worldId','=',worldId).orderBy('id').execute();
  const before=await rows(),injected=new Error('abort after assigned housing');
  await fixture(40,async(tx,t)=>{const rest=(await materializeCohorts(tx,worldId,villageId,t)).filter(c=>c.activity==='resting');
    expect(rest).toHaveLength(3);expect(rest.every(c=>c.restBuildingId!==null)).toBe(true);throw injected;
  },injected);expect(await rows()).toEqual(before);
});
