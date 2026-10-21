import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {sql,type Kysely} from 'kysely';
import {createDatabase} from '../database/connection.js';
import {testDatabaseUrl} from '../database/test-environment.js';
import type {Database} from '../database/schema.js';
import {processNextScheduledTask} from './scheduled-tasks.js';

const url=testDatabaseUrl(),target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected scheduler test database');
const root=createDatabase(url),schema='scheduler_'+randomUUID().replaceAll('-','');
let db:Kysely<Database>;
beforeAll(async()=>{
  await sql`create schema ${sql.id(schema)}`.execute(root);
  await sql`create table ${sql.id(schema,'scheduled_tasks')} (like public.scheduled_tasks including all)`.execute(root);
  db=root.withSchema(schema);
});
beforeEach(async()=>{await db.deleteFrom('scheduledTasks').execute();});
afterAll(async()=>{await sql`drop schema ${sql.id(schema)} cascade`.execute(root);await root.destroy();});
const add=async(attempts=0,type='fixture')=>db.insertInto('scheduledTasks').values({worldId:randomUUID(),taskType:type,subjectId:randomUUID(),payload:{original:true},
  dueAt:new Date(0),availableAt:new Date(0),attempts,lastError:null,completedAt:null}).returningAll().executeTakeFirstOrThrow();

it('delays a slow failure from the failure time and rolls back its observed writes',async()=>{
  const task=await add(),failure=Error('identified scheduler regression');let failedAt!:Date,observed=false;
  const result=await processNextScheduledTask(db,{fixture:async tx=>{
    await tx.updateTable('scheduledTasks').set({payload:{changed:true}}).where('id','=',task.id).execute();
    observed=(await tx.selectFrom('scheduledTasks').select('payload').where('id','=',task.id).executeTakeFirstOrThrow()).payload.changed===true;
    await sql`select pg_sleep(0.15)`.execute(tx);
    failedAt=(await sql<{at:Date}>`select clock_timestamp() as at`.execute(tx)).rows[0]!.at;
    throw failure;
  }},100);
  expect(observed).toBe(true);expect(result).toEqual({taskId:task.id,outcome:'retry-scheduled'});
  const saved=await db.selectFrom('scheduledTasks').selectAll().where('id','=',task.id).executeTakeFirstOrThrow();
  expect(saved.payload).toEqual(task.payload);expect(saved.dueAt).toEqual(task.dueAt);expect(saved.completedAt).toBeNull();
  expect(saved.lastError).toBe(failure.message);expect(saved.attempts).toBe(1);
  expect(saved.availableAt.getTime()-failedAt.getTime()).toBeGreaterThanOrEqual(95);
  expect(await processNextScheduledTask(db,{})).toBeNull();
});

it('backs off persistent failures, keeps their intention and lets healthy work complete',async()=>{
  const failed=await add(5600),healthy=await add(0,'healthy');
  // The failed item is deterministically selected first.
  await db.updateTable('scheduledTasks').set({availableAt:new Date(1)}).where('id','=',healthy.id).execute();
  const handlers={fixture:async()=>{throw Error('persistent failure');},healthy:async()=>{}};
  expect(await processNextScheduledTask(db,handlers)).toEqual({taskId:failed.id,outcome:'retry-scheduled'});
  const saved=await db.selectFrom('scheduledTasks').selectAll().where('id','=',failed.id).executeTakeFirstOrThrow();
  const now=(await sql<{at:Date}>`select clock_timestamp() as at`.execute(db)).rows[0]!.at;
  expect(saved.availableAt.getTime()-now.getTime()).toBeGreaterThan(295000);
  expect(saved.availableAt.getTime()-now.getTime()).toBeLessThanOrEqual(300000);
  expect(saved.payload).toEqual(failed.payload);expect(saved.dueAt).toEqual(failed.dueAt);expect(saved.completedAt).toBeNull();
  expect(await processNextScheduledTask(db,handlers)).toEqual({taskId:healthy.id,outcome:'completed'});
  expect(await processNextScheduledTask(db,handlers)).toBeNull();
});

it('increases the retry interval without postponing the first transient retry excessively',async()=>{
  const task=await add(2);
  await processNextScheduledTask(db,{fixture:async()=>{throw Error('third failure');}});
  const row=await db.selectFrom('scheduledTasks').selectAll().where('id','=',task.id).executeTakeFirstOrThrow();
  const now=(await sql<{at:Date}>`select clock_timestamp() as at`.execute(db)).rows[0]!.at;
  expect(row.availableAt.getTime()-now.getTime()).toBeGreaterThan(3500);
  expect(row.availableAt.getTime()-now.getTime()).toBeLessThanOrEqual(4000);
  expect(row.attempts).toBe(3);
});

it('retains the explicit immediate retry option used by transactional tests',async()=>{
  const task=await add(5600);let calls=0;
  const handlers={fixture:async()=>{if(calls++===0)throw Error('once');}};
  expect((await processNextScheduledTask(db,handlers,0))?.outcome).toBe('retry-scheduled');
  expect(await processNextScheduledTask(db,handlers,0)).toEqual({taskId:task.id,outcome:'completed'});
  expect(calls).toBe(2);
});
