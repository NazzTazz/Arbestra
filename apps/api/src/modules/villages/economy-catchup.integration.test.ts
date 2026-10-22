import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {CamelCasePlugin,Kysely,PostgresDialect} from 'kysely';
import {afterAll,beforeAll,expect,it} from 'vitest';
import type {Database} from '../../database/schema.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {resetE2eState} from '../../database/reset-e2e.js';
import {DEVELOPMENT_IDS as ids} from '../../database/seed.js';
import {up} from '../../database/migrations/056_village_economy_catchups.js';
import {processNextScheduledTask} from '../../jobs/scheduled-tasks.js';
import {advanceEconomyCatchup,requestEconomyCatchup,ECONOMY_CATCHUP_TASK} from './economy-catchup.js';
import {commandVillageProcessing} from './service.js';

const url=testDatabaseUrl(),target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected catch-up test database');
const schema='catchup_test_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:url,max:1});
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:url,max:3,
  options:`-c search_path=${schema},public -c statement_timeout=20000 -c lock_timeout=10000`})}),plugins:[new CamelCasePlugin()]});
beforeAll(async()=>{await resetE2eState(url);await admin.query(`create schema ${schema}`);await up(db as unknown as Kysely<unknown>);},60000);
afterAll(async()=>{await db.destroy();await admin.query(`drop schema ${schema} cascade`);await admin.end();},30000);

it('deduplicates wakeups, rolls back observed progress and continues before acknowledging only its acquired task',async()=>{
  const started=new Date(Date.now()-10000),houses:string[]=[];
  for(let i=0;i<3;i++)houses.push((await db.insertInto('buildings').values({worldId:ids.world,villageId:ids.village,
    buildingType:'dwelling',level:1,targetLevel:null,status:'under-construction',constructionStartedAt:started,
    constructionCompletesAt:new Date(started.getTime()+1000*(i+1)),completedAt:null}).returning('id').executeTakeFirstOrThrow()).id);
  await db.insertInto('scheduledTasks').values({worldId:ids.world,taskType:'fixture.unrelated',subjectId:randomUUID(),payload:{preserve:true},
    dueAt:new Date('1901-01-01'),availableAt:new Date('1901-01-01'),completedAt:null,lastError:'preserved old notification'}).execute();
  const oldTasks=await db.selectFrom('scheduledTasks').selectAll().orderBy('id').execute();
  await requestEconomyCatchup(db,ids.account,'aube',ids.village);
  await requestEconomyCatchup(db,ids.account,'aube',ids.village);
  const first=await db.selectFrom('scheduledTasks').selectAll().where('taskType','=',ECONOMY_CATCHUP_TASK).execute();
  expect(first).toHaveLength(1);
  const tables=['villages','buildings','villageResources','villageResourceFlows','villagePopulations','populationCohorts','scheduledTasks','villageEconomyCatchups'] as const;
  const capture=async()=>Promise.all(tables.map(async table=>(await db.selectFrom(table).selectAll().execute())
    .map(row=>JSON.stringify(row)).sort()));
  const before=await capture(),failure=Error('CATCHUP_ROLLBACK_AFTER_PROGRESS');
  await expect(db.transaction().execute(async tx=>{
    const acquired=await tx.selectFrom('scheduledTasks').selectAll().where('id','=',first[0]!.id).forUpdate().skipLocked().executeTakeFirstOrThrow();
    await advanceEconomyCatchup(tx,acquired,{maxTransitions:1,maxWorkMs:200});
    expect((await tx.selectFrom('buildings').select('status').where('id','=',houses[0]!).executeTakeFirstOrThrow()).status).toBe('completed');
    expect((await tx.selectFrom('villageEconomyCatchups').select('transitions').executeTakeFirstOrThrow()).transitions).toBe('1');
    expect(await tx.selectFrom('scheduledTasks').select('id').where('taskType','=',ECONOMY_CATCHUP_TASK).execute()).toHaveLength(2);
    throw failure;
  })).rejects.toBe(failure);
  expect(await capture()).toEqual(before);
  for(let i=0;i<3;i++){
    const pending=await db.selectFrom('scheduledTasks').selectAll().where('taskType','=',ECONOMY_CATCHUP_TASK).where('completedAt','is',null).execute();
    expect(pending).toHaveLength(1);
    // Force this test's new continuation ahead of older, untouched notifications.
    await db.updateTable('scheduledTasks').set({availableAt:new Date('1900-01-01'),dueAt:new Date('1900-01-01')})
      .where('id','=',pending[0]!.id).execute();
    expect(await processNextScheduledTask(db,{[ECONOMY_CATCHUP_TASK]:(tx,task)=>advanceEconomyCatchup(tx,task,{maxTransitions:1,maxWorkMs:200})}))
      .toEqual({taskId:pending[0]!.id,outcome:'completed'});
    const cursor=await db.selectFrom('villageEconomyCatchups').selectAll().executeTakeFirstOrThrow();
    expect(cursor.transitions).toBe(String(i+1));expect(cursor.status).toBe(i===2?'complete':'active');
    expect(cursor.completedThrough).toEqual(i===2?cursor.targetThrough:null);
  }
  expect(await db.selectFrom('buildings').select('id').where('id','in',houses).where('status','=','completed').execute()).toHaveLength(3);
  if(oldTasks.length)expect(await db.selectFrom('scheduledTasks').selectAll().where('id','in',oldTasks.map(task=>task.id)).orderBy('id').execute()).toEqual(oldTasks);
  expect(await db.selectFrom('scheduledTasks').select('id').where('taskType','=',ECONOMY_CATCHUP_TASK).where('completedAt','is',null).execute()).toEqual([]);
},60000);

it('rolls back a bounded command before scheduling one economic wakeup, without recording a command intent',async()=>{
  const started=new Date(Date.now()-10000);
  for(let i=0;i<2;i++)await db.insertInto('buildings').values({worldId:ids.world,villageId:ids.village,
    buildingType:'dwelling',level:1,targetLevel:null,status:'under-construction',constructionStartedAt:started,
    constructionCompletesAt:new Date(started.getTime()+i*1000),completedAt:null}).execute();
  const tables=['villages','buildings','villageResources','villageResourceFlows','villagePopulations','populationCohorts',
    'processingOrders','processingLots','processingCommandReceipts'] as const;
  const capture=()=>Promise.all(tables.map(async table=>(await db.selectFrom(table).selectAll().execute()).map(row=>JSON.stringify(row)).sort()));
  const before=await capture();
  const command={commandId:randomUUID(),action:'start' as const,buildingId:randomUUID(),lots:1,workerCount:1};
  for(let retry=0;retry<2;retry++){
    await expect(commandVillageProcessing(db,ids.account,'aube',ids.village,command,'commit',{maxTransitions:1,maxWorkMs:200}))
      .rejects.toMatchObject({statusCode:503,code:'SCOPE_CATCHING_UP'});
    expect(await capture()).toEqual(before);
    expect(await db.selectFrom('scheduledTasks').select('id').where('taskType','=',ECONOMY_CATCHUP_TASK).where('completedAt','is',null).execute()).toHaveLength(1);
  }
  expect((await db.selectFrom('villageEconomyCatchups').selectAll().executeTakeFirstOrThrow()).transitions).toBe('0');
},60000);
