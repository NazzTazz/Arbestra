import {randomUUID} from 'node:crypto';
import {sql,type Transaction} from 'kysely';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import type {ProcessingCommand} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {createDatabase} from '../../database/connection.js';
import {migrateToLatest} from '../../database/migrate.js';
import {resetE2eState} from '../../database/reset-e2e.js';
import {DEVELOPMENT_IDS as ids} from '../../database/seed.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {processNextScheduledTask} from '../../jobs/scheduled-tasks.js';
import {commandProcessing,processingSnapshot,COMPLETE_PROCESSING_TASK} from './processing.js';
import {completeProcessing} from './complete-construction.js';
import {beginVillageEconomy,reconcileVillageEconomy} from './reconcile-economy.js';
import {constructBuilding,getVillageState,commandVillageProcessing,upgradeBuilding} from './service.js';

const url=testDatabaseUrl(),db=createDatabase(url),t0=new Date('2026-10-01T10:00:00Z');
const ctx=(ms=0)=>({worldId:ids.world,villageId:ids.village,through:new Date(t0.getTime()+ms)});
beforeAll(()=>migrateToLatest(url));
beforeEach(async()=>{await resetE2eState(url);await db.updateTable('populationCohorts').set({energy:10,energyProgress:0,energyUpdatedAt:t0}).where('worldId','=',ids.world).execute();});
afterAll(()=>db.destroy());
async function locked<T>(action:(tx:Transaction<Database>)=>Promise<T>){return db.transaction().execute(async tx=>{
  await tx.selectFrom('villages').select('id').where('worldId','=',ids.world).where('id','=',ids.village).forUpdate().executeTakeFirstOrThrow();return action(tx);
});}
async function workshop(type='sawmill',level=1){return (await db.insertInto('buildings').values({worldId:ids.world,villageId:ids.village,buildingType:type,level,targetLevel:null,status:'completed',constructionStartedAt:null,constructionCompletesAt:null,completedAt:t0,visualLayout:null}).returning('id').executeTakeFirstOrThrow()).id;}
async function amount(code:string){return Number((await db.selectFrom('villageResources').select('amount').where('worldId','=',ids.world).where('villageId','=',ids.village).where('resourceCode','=',code).executeTakeFirstOrThrow()).amount);}
async function stock(code:string,n:number){await db.updateTable('villageResources').set({amount:n}).where('worldId','=',ids.world).where('villageId','=',ids.village).where('resourceCode','=',code).execute();}
async function start(buildingId:string,lots=1,workers=1){const command:ProcessingCommand={commandId:randomUUID(),action:'start',buildingId,lots,workerCount:workers};await locked(tx=>commandProcessing(tx,ctx(),command));return command;}
async function orders(){return locked(tx=>processingSnapshot(tx,ctx()));}
async function reconcile(ms:number){await locked(tx=>reconcileVillageEconomy(tx,ctx(ms)));}
it('debits 25 on start, credits 20 only at completion, and preserves population on replay',async()=>{
  const id=await workshop(),command=await start(id);
  expect(await amount('wood')).toBe(1975);expect(await amount('timber')).toBe(0);
  await reconcile(599999);expect(await amount('timber')).toBe(0);
  await reconcile(600000);await reconcile(600000);await locked(tx=>commandProcessing(tx,ctx(600000),command));
  expect(await amount('timber')).toBe(20);expect(await amount('wood')).toBe(1975);
  expect((await orders())[0]).toMatchObject({status:'completed',completedLots:1,currentLot:null});
  const people=await db.selectFrom('populationCohorts').selectAll().where('villageId','=',ids.village).execute();
  expect(people.reduce((n,c)=>n+c.memberCount,0)).toBe(15);expect(people.every(c=>!c.processingLotId)).toBe(true);
  await expect(locked(tx=>commandProcessing(tx,ctx(),{...command,lots:2}))).rejects.toMatchObject({code:'COMMAND_REUSED'});
});
it('catches up finite orders with three workers without acknowledging existing notifications',async()=>{
  const id=await workshop('sawmill',3);await start(id,3,3);
  const lot=(await orders())[0]!.currentLot!;expect(Date.parse(lot.completesAt)-Date.parse(lot.startedAt)).toBe(200000);
  await reconcile(600000);expect(await amount('timber')).toBe(60);expect(await amount('wood')).toBe(1925);
  expect((await orders())[0]).toMatchObject({completedLots:3,status:'completed'});
  const tasks=await db.selectFrom('scheduledTasks').selectAll().where('taskType','=',COMPLETE_PROCESSING_TASK).execute();
  expect(tasks).toHaveLength(3);expect(tasks.every(t=>t.completedAt===null)).toBe(true);
});
it('blocks between lots without reserving future inputs and resumes at the explicit new date',async()=>{
  const id=await workshop('stonemason');await stock('stone',25);await start(id,2);await reconcile(600000);
  const order=(await orders())[0]!;expect(order).toMatchObject({status:'blocked',blockedReason:'missing-input',completedLots:1});
  expect(await amount('stone')).toBe(0);expect(await amount('cut-stone')).toBe(20);
  await stock('stone',25);await reconcile(1200000);expect(await amount('stone')).toBe(25);
  await locked(tx=>commandProcessing(tx,ctx(1200000),{commandId:randomUUID(),action:'resume',orderId:order.id,workerCount:2}));
  expect(Date.parse((await orders())[0]!.currentLot!.startedAt)).toBe(t0.getTime()+1200000);
  await reconcile(1500000);expect(await amount('cut-stone')).toBe(40);
});
it('pauses and cancels after the paid lot, preserving its deadline and completed output',async()=>{
  const id=await workshop();await start(id,3);const order=(await orders())[0]!,deadline=order.currentLot!.completesAt;
  await locked(tx=>commandProcessing(tx,ctx(1000),{commandId:randomUUID(),action:'pause',orderId:order.id}));
  expect((await orders())[0]!.currentLot!.completesAt).toBe(deadline);await reconcile(600000);
  expect((await orders())[0]).toMatchObject({status:'paused',completedLots:1});expect(await amount('wood')).toBe(1975);
  await locked(tx=>commandProcessing(tx,ctx(700000),{commandId:randomUUID(),action:'resume',orderId:order.id,workerCount:1}));
  await locked(tx=>commandProcessing(tx,ctx(700001),{commandId:randomUUID(),action:'cancel',orderId:order.id}));await reconcile(2000000);
  expect((await orders())[0]).toMatchObject({status:'cancelled',completedLots:2});expect(await amount('wood')).toBe(1950);expect(await amount('timber')).toBe(40);
});
it('rejects missing materials, excessive staffing and occupied staff without admitting a new order',async()=>{
  const id=await workshop();await stock('wood',24);await expect(start(id)).rejects.toMatchObject({code:'PROCESSING_UNAVAILABLE'});
  expect(await amount('wood')).toBe(24);expect(await orders()).toHaveLength(0);
  await stock('wood',100);await expect(start(id,1,2)).rejects.toMatchObject({code:'WORKER_CAP'});
  await db.updateTable('populationCohorts').set({memberCount:1}).where('villageId','=',ids.village).execute();
  await start(id);await expect(start(await workshop())).rejects.toMatchObject({code:'PROCESSING_UNAVAILABLE'});
  expect(await amount('wood')).toBe(75);expect(await orders()).toHaveLength(1);
});
it('stops for fatigue and releases the team without paying for another lot',async()=>{
  const id=await workshop();await db.updateTable('populationCohorts').set({memberCount:1,energy:0,energyProgress:22*600000+1}).where('villageId','=',ids.village).execute();
  await start(id,2);await reconcile(600000);expect((await orders())[0]).toMatchObject({status:'blocked',blockedReason:'missing-workers',completedLots:1});
  expect(await amount('wood')).toBe(1975);expect((await db.selectFrom('populationCohorts').select('processingLotId').where('villageId','=',ids.village).execute()).every(c=>c.processingLotId===null)).toBe(true);
});
it('rolls back demonstrated changes to stock, team, order, lot, receipt and notification',async()=>{
  const id=await workshop(),error=new Error('injected-after-processing-admission');
  const before=await db.selectFrom('populationCohorts').selectAll().where('villageId','=',ids.village).execute();
  await expect(locked(async tx=>{
    await commandProcessing(tx,ctx(),{commandId:randomUUID(),action:'start',buildingId:id,lots:2,workerCount:1});
    expect(Number((await tx.selectFrom('villageResources').select('amount').where('villageId','=',ids.village).where('resourceCode','=','wood').executeTakeFirstOrThrow()).amount)).toBe(1975);
    expect(await tx.selectFrom('populationCohorts').select('id').where('processingLotId','is not',null).execute()).toHaveLength(1);
    expect(await tx.selectFrom('processingCommandReceipts').selectAll().execute()).toHaveLength(1);
    expect(await tx.selectFrom('scheduledTasks').selectAll().where('taskType','=',COMPLETE_PROCESSING_TASK).execute()).toHaveLength(1);
    throw error;
  })).rejects.toBe(error);
  expect(await amount('wood')).toBe(2000);expect(await amount('timber')).toBe(0);expect(await orders()).toHaveLength(0);
  expect(await db.selectFrom('processingLots').selectAll().execute()).toHaveLength(0);expect(await db.selectFrom('processingCommandReceipts').selectAll().execute()).toHaveLength(0);
  expect(await db.selectFrom('scheduledTasks').selectAll().where('taskType','=',COMPLETE_PROCESSING_TASK).execute()).toHaveLength(0);
  expect(await db.selectFrom('populationCohorts').selectAll().where('villageId','=',ids.village).execute()).toEqual(before);
});
it('settles historical passive production once, retaining its remainder and existing workshops',async()=>{
  const id=await workshop();await db.updateTable('villages').set({economyActivatedAt:null}).where('id','=',ids.village).execute();
  await db.updateTable('villageResourceFlows').set({productionUpdatedAt:new Date(Date.now()-3600000),baseRatePerHour:60,remainder:'0.5'}).where('villageId','=',ids.village).execute();
  const first=await getVillageState(db,ids.account,'aube',ids.village);expect(first.village.wood).toBe(2120);expect(first.village.woodProductionPerHour).toBe(0);
  const flow=await db.selectFrom('villageResourceFlows').selectAll().where('villageId','=',ids.village).executeTakeFirstOrThrow();expect(Number(flow.remainder)).toBeGreaterThanOrEqual(0.5);expect(Number(flow.remainder)).toBeLessThan(0.6);
  expect((await getVillageState(db,ids.account,'aube',ids.village)).village.wood).toBe(2120);expect(await amount('timber')).toBe(0);
  expect(await db.selectFrom('buildings').select('id').where('id','=',id).execute()).toHaveLength(1);
});
it('allows multiple scieries, forbids upgrades during fabrication and uses refined construction costs',async()=>{
  const state=await getVillageState(db,ids.account,'aube',ids.village),free=state.cells.filter(c=>c.canBuild).slice(0,3);
  for(const c of free.slice(0,2))await constructBuilding(db,ids.account,'aube',ids.village,c.cellX,c.cellY,'sawmill',0);
  const mills=await db.selectFrom('buildings').select('id').where('villageId','=',ids.village).where('buildingType','=','sawmill').execute();expect(mills).toHaveLength(2);
  await db.updateTable('populationCohorts').set({energy:10,energyProgress:0,energyUpdatedAt:new Date()}).where('villageId','=',ids.village).execute();
  await commandVillageProcessing(db,ids.account,'aube',ids.village,{commandId:randomUUID(),action:'start',buildingId:mills[0]!.id,lots:1,workerCount:1});
  await expect(upgradeBuilding(db,ids.account,'aube',ids.village,mills[0]!.id,undefined,undefined,0)).rejects.toMatchObject({code:'PROCESSING_BUSY'});
  await stock('timber',25);await stock('cut-stone',10);
  const c=free[2]!;await constructBuilding(db,ids.account,'aube',ids.village,c.cellX,c.cellY,'dwelling',0);
  expect(await amount('timber')).toBe(0);expect(await amount('cut-stone')).toBe(0);
});
it('a scheduler acknowledges only its acquired task while catching up successor lots',async()=>{
  await start(await workshop(),2);const result=await processNextScheduledTask(db,{[COMPLETE_PROCESSING_TASK]:completeProcessing});
  expect(result?.outcome).toBe('completed');expect(await amount('timber')).toBe(40);
  const tasks=await db.selectFrom('scheduledTasks').selectAll().where('taskType','=',COMPLETE_PROCESSING_TASK).execute();expect(tasks).toHaveLength(2);expect(tasks.filter(t=>t.completedAt!==null)).toHaveLength(1);
});
it('charges log dwellings and their upgrade in raw wood only, preserving the other variant prices',async()=>{
  const free=(await getVillageState(db,ids.account,'aube',ids.village)).cells.filter(c=>c.canBuild);
  const c=free[0]!,commandId=randomUUID();
  const built=await constructBuilding(db,ids.account,'aube',ids.village,c.cellX,c.cellY,'dwelling',0,commandId,[{resourceCode:'wood',amount:25}],0,'logs');
  const house=built.cells.find(c=>c.building?.visualLayout?.recipe==='log-house')!.building!;
  await constructBuilding(db,ids.account,'aube',ids.village,c.cellX,c.cellY,'dwelling',0,commandId,[{resourceCode:'wood',amount:25}],0,'logs');
  expect(await amount('wood')).toBe(1975);expect(await amount('timber')).toBe(0);expect(await amount('cut-stone')).toBe(0);
  await upgradeBuilding(db,ids.account,'aube',ids.village,house.id,undefined,undefined,0,undefined,[{resourceCode:'wood',amount:300}],2);
  expect(await amount('wood')).toBe(1675);expect(await amount('timber')).toBe(0);
  await stock('timber',50);await stock('cut-stone',10);
  const beam=free[1]!,stone=free[2]!;
  await constructBuilding(db,ids.account,'aube',ids.village,beam.cellX,beam.cellY,'dwelling',0,undefined,undefined,0,'beams');
  expect(await amount('timber')).toBe(25);expect(await amount('cut-stone')).toBe(10);
  await constructBuilding(db,ids.account,'aube',ids.village,stone.cellX,stone.cellY,'dwelling',0);
  expect(await amount('wood')).toBe(1675);expect(await amount('timber')).toBe(0);expect(await amount('cut-stone')).toBe(0);
});
it('bootstraps a raw-funded scierie and spends its first two lots on a beam dwelling without refined gifts',async()=>{
  expect(await amount('timber')).toBe(0);expect(await amount('cut-stone')).toBe(0);
  const initial=await getVillageState(db,ids.account,'aube',ids.village),cell=initial.cells.find(c=>c.canBuild)!;
  const built=await constructBuilding(db,ids.account,'aube',ids.village,cell.cellX,cell.cellY,'sawmill',0);
  const mill=built.cells.find(c=>c.building?.type==='sawmill')!.building!;
  expect(await amount('wood')).toBe(1950);
  // Position the completed fixture and its workers at the controlled test clock.
  await db.updateTable('buildings').set({completedAt:t0}).where('id','=',mill.id).execute();
  await db.updateTable('populationCohorts').set({energy:10,energyProgress:0,energyUpdatedAt:t0}).where('villageId','=',ids.village).execute();
  await start(mill.id,2);await reconcile(1200000);
  expect(await amount('wood')).toBe(1900);expect(await amount('timber')).toBe(40);
  const next=(await getVillageState(db,ids.account,'aube',ids.village)).cells.find(c=>c.canBuild)!;
  await constructBuilding(db,ids.account,'aube',ids.village,next.cellX,next.cellY,'dwelling',0,undefined,undefined,0,'beams');
  expect(await amount('timber')).toBe(15);expect(await amount('cut-stone')).toBe(0);expect(await amount('wood')).toBe(1900);
});
it('forces a village-lock wait between two competing debits',async()=>{
  const first=await workshop(),second=await workshop();await stock('wood',25);
  await db.updateTable('populationCohorts').set({energyUpdatedAt:new Date(),energy:10,energyProgress:0}).where('villageId','=',ids.village).execute();
  let ready!:()=>void,release!:()=>void,pidReady!:(pid:number)=>void;
  const admitted=new Promise<void>(r=>{ready=r;}),gate=new Promise<void>(r=>{release=r;}),pidPromise=new Promise<number>(r=>{pidReady=r;});
  async function bounded<T>(promise:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Concurrency barrier timed out')),20000);})]);}
    finally{clearTimeout(timer);}
  }
  const a=locked(async tx=>{await commandProcessing(tx,{...ctx(),through:new Date()},{commandId:randomUUID(),action:'start',buildingId:first,lots:1,workerCount:1});ready();await bounded(gate);});
  let b:Promise<void>|undefined;
  const settledA=Promise.allSettled([a]);
  try{await bounded(admitted);
    b=db.transaction().execute(async tx=>{await sql`set local lock_timeout = '10s'`.execute(tx);
      const pid=(await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;pidReady(pid);
      await commandProcessing(tx,await beginVillageEconomy(tx,ids.world,ids.village),{commandId:randomUUID(),action:'start',buildingId:second,lots:1,workerCount:1});});
    void b.catch(()=>undefined);
    const pid=await bounded(pidPromise);let waiting=false;
    for(let n=0;n<50&&!waiting;n++){const rows=await sql<{waiting:boolean}>`select wait_event_type='Lock' as waiting from pg_stat_activity where pid=${pid}`.execute(db);waiting=rows.rows[0]?.waiting??false;if(!waiting)await new Promise(r=>setTimeout(r,20));}
    expect(waiting).toBe(true);
  }finally{release();await settledA;if(b)await Promise.allSettled([b]);}
  const outcomes=await Promise.allSettled([a,b!]);expect(outcomes[0]!.status).toBe('fulfilled');expect(outcomes[1]!.status).toBe('rejected');expect(await amount('wood')).toBe(0);expect(await orders()).toHaveLength(1);
});
it('rejects another owner and another world without changing stocks',async()=>{
  const command:ProcessingCommand={commandId:randomUUID(),action:'start',buildingId:await workshop(),lots:1,workerCount:1};
  await expect(commandVillageProcessing(db,randomUUID(),'aube',ids.village,command)).rejects.toMatchObject({code:'VILLAGE_NOT_FOUND'});
  await expect(commandVillageProcessing(db,ids.account,'another-world',ids.village,command)).rejects.toMatchObject({code:'VILLAGE_NOT_FOUND'});
  expect(await orders()).toHaveLength(0);expect(await amount('wood')).toBe(2000);
});

it('interleaves successor lots of two workshops by deadline rather than finishing one workshop in a block',async()=>{
  const slow=await workshop('sawmill',2),fast=await workshop('sawmill',3);
  await start(slow,2,2);await start(fast,2,3);
  await locked(async tx=>{
    await sql`create temporary table processing_test_trace(position serial, deadline timestamptz);
      create function pg_temp.processing_trace() returns trigger language plpgsql as $$
      begin insert into processing_test_trace(deadline) values(new.completed_at); return new; end; $$;
      create trigger processing_test_trace after update of completed_at on processing_lots
        for each row when (old.completed_at is null and new.completed_at is not null)
        execute function pg_temp.processing_trace();`.execute(tx);
    try{
      await reconcileVillageEconomy(tx,ctx(600000));
      const trace=await sql<{deadline:Date}>`select deadline from processing_test_trace order by position`.execute(tx);
      expect(trace.rows.map(r=>r.deadline.getTime()-t0.getTime())).toEqual([200000,300000,400000,600000]);
    }finally{await sql`drop trigger processing_test_trace on processing_lots; drop table processing_test_trace;`.execute(tx);}
  });
  expect(await amount('timber')).toBe(80);expect(await amount('wood')).toBe(1900);
});

it('freezes the paid lot recipe when the catalogue changes',async()=>{
  await start(await workshop());
  await db.updateTable('processingRecipes').set({version:2,outputAmount:999}).where('buildingTypeCode','=','sawmill').where('level','=',1).execute();
  try{await reconcile(600000);expect(await amount('timber')).toBe(20);}
  finally{await db.updateTable('processingRecipes').set({version:1,outputAmount:20}).where('buildingTypeCode','=','sawmill').where('level','=',1).execute();}
});
