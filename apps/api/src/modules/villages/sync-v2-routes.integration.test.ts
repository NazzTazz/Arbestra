import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {sql,Kysely,PostgresDialect,CamelCasePlugin} from 'kysely';
import type {Database} from '../../database/schema.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createDatabase} from '../../database/connection.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {DEVELOPMENT_IDS as ids} from '../../database/seed.js';
import {hashSessionToken} from '../../security/sessions.js';
import {HttpError} from '../../errors.js';
import {registerSyncV2Routes} from './sync-v2-routes.js';
import type {TravelNetworkExecutor} from '../navigation/network-job.js';

const unusedNavigation:TravelNetworkExecutor={network:async()=>{throw Error('Presentation is not exercised here');}};

const url=testDatabaseUrl(),target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected V2 route test database');
const db=createDatabase(url),app=Fastify(),token=randomUUID();
const prefix=`/api/worlds/aube/villages/${ids.village}`;
beforeAll(async()=>{
  await db.insertInto('sessions').values({accountId:ids.account,tokenHash:hashSessionToken(token),expiresAt:new Date(Date.now()+3600000)}).execute();
  await app.register(cookie);
  app.setErrorHandler((error,_request,reply)=>{if(error instanceof HttpError)return reply.status(error.statusCode).send({code:error.code});return reply.status(400).send({code:'VALIDATION_ERROR'});});
  await registerSyncV2Routes(app,db,{cookieName:'session'},unusedNavigation);await app.ready();
},30000);
afterAll(async()=>{await app.close();await db.deleteFrom('sessions').where('tokenHash','=',hashSessionToken(token)).execute();await db.destroy();});
it('requires protocol negotiation and authentication and rejects unknown request fields before coercion',async()=>{
  const payload={protocol:2,generation:0,scopes:[],cursors:[]};
  for(const operation of ['read','stream']){
    const request={method:'POST' as const,url:`${prefix}/sync/${operation}`,payload};
    expect((await app.inject(request)).statusCode).toBe(400);
    expect((await app.inject({...request,headers:{'x-arbestra-protocol':'2'}})).statusCode).toBe(401);
    expect((await app.inject({...request,headers:{'x-arbestra-protocol':'2'},cookies:{session:token},payload:{...payload,injected:true}})).json()).toMatchObject({code:'INVALID_SYNC_REQUEST'});
    expect((await app.inject({...request,headers:{'x-arbestra-protocol':'2'},cookies:{session:token},payload:{...payload,generation:'0'}})).statusCode).toBe(400);
  }
});
it('fails closed before writer activation, including bootstrap without economic mutation',async()=>{
  // Shadow only migration metadata to model an unactivated installation;
  // never edit the real migration ledger or disable business writers.
  const schema='sync_gate_'+randomUUID().replaceAll('-','');
  await sql`create schema ${sql.id(schema)}`.execute(db);
  const unready=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:url,max:1,options:`-c search_path=${schema},public`})}),plugins:[new CamelCasePlugin()]});
  const unavailable=Fastify();
  try{
  await sql`create table ${sql.id(schema,'kysely_migration')}(name text primary key)`.execute(db);
  await unavailable.register(cookie);
  unavailable.setErrorHandler((error,_request,reply)=>error instanceof HttpError?reply.status(error.statusCode).send({code:error.code}):reply.status(500).send({code:'UNEXPECTED'}));
  await registerSyncV2Routes(unavailable,unready,{cookieName:'session'},unusedNavigation);
  const before=await db.selectFrom('villages').selectAll().where('id','=',ids.village).executeTakeFirstOrThrow();
  for(const operation of ['read','stream','bootstrap']){
    const response=await unavailable.inject({method:operation==='bootstrap'?'GET':'POST',url:`${prefix}/${operation==='bootstrap'?'bootstrap?generation=0':`sync/${operation}`}`,
      headers:{'x-arbestra-protocol':'2'},cookies:{session:token},...(operation==='bootstrap'?{}:{payload:{protocol:2,generation:0,scopes:[],cursors:[]}})});
    expect(response.statusCode).toBe(503);expect(response.json()).toEqual({code:'SYNC_V2_UNAVAILABLE'});
  }
  expect(await db.selectFrom('villages').selectAll().where('id','=',ids.village).executeTakeFirstOrThrow()).toEqual(before);
  }finally{await unavailable.close();await unready.destroy();await sql`drop schema ${sql.id(schema)} cascade`.execute(db);}
});
