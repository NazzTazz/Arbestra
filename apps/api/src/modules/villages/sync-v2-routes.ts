import type {FastifyInstance} from 'fastify';
import {sql,type Kysely} from 'kysely';
import {Type} from '@sinclair/typebox';
import {Value} from '@sinclair/typebox/value';
import {SyncV2BatchSchema,SyncV2ReadRequestSchema,type SyncV2ReadRequest} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import type {AppConfig} from '../../config.js';
import {HttpError} from '../../errors.js';
import {authenticate} from '../auth/service.js';
import {reconcileVillageForRead} from './service.js';
import {captureSyncV2} from './sync-v2-capture.js';
import {serveSyncV2Stream} from './sync-v2-stream.js';

const params=Type.Object({worldSlug:Type.String({minLength:1,maxLength:64}),villageId:Type.String({format:'uuid'})});
const headers=Type.Object({'x-arbestra-protocol':Type.Literal('2')},{additionalProperties:true});
const prefix='/api/worlds/:worldSlug/villages/:villageId';

/** Registration is not activation: until the complete writer/backfill rollout
 * is recorded, these endpoints fail closed rather than expose partial streams. */
export async function assertSyncV2Available(db:Kysely<Database>):Promise<void>{
  const {ready}=(await sql<{ready:boolean}>`select count(*)=4 as ready from kysely_migration where name in
    ('053_game_sync_private_writers','054_game_sync_shared_writers','055_game_sync_scope_backfill','056_village_economy_catchups')`.execute(db)).rows[0]!;
  if(!ready)throw new HttpError(503,'SYNC_V2_UNAVAILABLE','Synchronisation V2 indisponible.');
}

export async function registerSyncV2Routes(app:FastifyInstance,db:Kysely<Database>,config:Pick<AppConfig,'cookieName'>){
  const streams=new Set<()=>void>();
  app.addHook('preClose',async()=>{for(const close of streams)close();});
  app.get(`${prefix}/bootstrap`,{schema:{params,headers,querystring:Type.Object({generation:Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER})}),
    response:{200:SyncV2BatchSchema}}},async(request,reply)=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);
    await assertSyncV2Available(db);
    const {worldSlug,villageId}=request.params as {worldSlug:string;villageId:string};
    // Explicit pre-H compatibility adapter. It commits before the single MVCC
    // capture of values and cursors, and never constructs a legacy snapshot.
    await reconcileVillageForRead(db,account.id,worldSlug,villageId);
    reply.header('Cache-Control','no-store');
    return captureSyncV2(db,account.id,worldSlug,villageId,{protocol:2,generation:(request.query as {generation:number}).generation,scopes:[],cursors:[]});
  });
  for(const operation of ['read','stream'] as const)app.post(`${prefix}/sync/${operation}`,{
    bodyLimit:32768,schema:{params,headers,body:SyncV2ReadRequestSchema,...(operation==='read'?{response:{200:SyncV2BatchSchema}}:{})},
    // Reject unknown fields before Fastify's AJV removes them.
    preValidation:async request=>{if(!Value.Check(SyncV2ReadRequestSchema,request.body))throw new HttpError(400,'INVALID_SYNC_REQUEST','Requête de synchronisation invalide.');},
  },async(request,reply)=>{
    const token=request.cookies[config.cookieName];
    const account=await authenticate(db,token);
    await assertSyncV2Available(db);
    const {worldSlug,villageId}=request.params as {worldSlug:string;villageId:string};
    const body=request.body as SyncV2ReadRequest;
    reply.header('Cache-Control','no-store');
    if(operation==='read')return captureSyncV2(db,account.id,worldSlug,villageId,body);
    const close=()=>reply.raw.destroy();streams.add(close);
    try{await serveSyncV2Stream(reply,body,async next=>{
      const current=await authenticate(db,token);
      return captureSyncV2(db,current.id,worldSlug,villageId,next);
    },{onError:()=>app.log.warn({code:'SYNC_V2_STREAM_INTERRUPTED'},'Synchronization stream interrupted')});}
    finally{streams.delete(close);}
  });
}
