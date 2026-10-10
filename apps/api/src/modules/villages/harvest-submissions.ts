import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {sql,type Kysely,type Transaction} from 'kysely';
import type {HarvestIntent,HarvestReceipt} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import type {ScheduledTask} from '../../jobs/scheduled-tasks.js';
import {HttpError} from '../../errors.js';
import {ownedVillage} from './service.js';
import {acceptHarvestIntent} from './harvest-intents.js';
export const HARVEST_SUBMISSION_TASK='harvest.intent';
const pending=(commandId:string):HarvestReceipt=>({commandId,pending:true,accepted:[],refused:[]});
export async function receiveHarvestIntent(db:Kysely<Database>,accountId:string,slug:string,villageId:string,request:HarvestIntent):Promise<HarvestReceipt>{
 return db.transaction().execute(async tx=>{
  const village=await ownedVillage(tx,accountId,slug,villageId);
  if(!request.gardens.length&&!request.wood.length&&!request.stone.length)throw new HttpError(400,'HARVEST_EMPTY','Aucune ressource désignée.');
  const inserted=await tx.insertInto('harvestSubmissions').values({worldId:village.worldId,villageId,accountId,commandId:request.commandId,request:JSON.stringify(request),receipt:null})
    .onConflict(oc=>oc.columns(['worldId','villageId','commandId']).doNothing()).returning('commandId').executeTakeFirst();
  if(!inserted){const previous=await tx.selectFrom('harvestSubmissions').select(['request','receipt']).where('worldId','=',village.worldId).where('villageId','=',villageId).where('commandId','=',request.commandId).executeTakeFirstOrThrow();
   if(!isDeepStrictEqual(previous.request,request))throw new HttpError(409,'COMMAND_ID_CONFLICT','Cette intention a déjà été utilisée différemment.');return previous.receipt??pending(request.commandId);}
  await tx.insertInto('scheduledTasks').values({worldId:village.worldId,taskType:HARVEST_SUBMISSION_TASK,subjectId:randomUUID(),payload:{villageId,commandId:request.commandId},dueAt:sql`statement_timestamp()`,availableAt:sql`statement_timestamp()`,completedAt:null,lastError:null}).execute();
  return pending(request.commandId);
 });
}
export async function readHarvestReceipts(db:Kysely<Database>,accountId:string,slug:string,villageId:string,ids:string[]):Promise<HarvestReceipt[]>{
 if(ids.length>64||ids.some(id=>!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)))throw new HttpError(400,'HARVEST_IDS_INVALID','Identifiants invalides.');
 return db.transaction().execute(async tx=>{const village=await ownedVillage(tx,accountId,slug,villageId);
  const rows=await tx.selectFrom('harvestSubmissions').select(['commandId','receipt']).where('worldId','=',village.worldId).where('villageId','=',villageId).where('accountId','=',accountId).where('commandId','in',ids).execute();
  return rows.map(r=>r.receipt??pending(r.commandId));});
}
export async function processHarvestSubmission(tx:Transaction<Database>,task:ScheduledTask):Promise<void>{
 if(typeof task.payload.villageId!=='string'||typeof task.payload.commandId!=='string')return;
 const row=await tx.selectFrom('harvestSubmissions').selectAll().where('worldId','=',task.worldId).where('villageId','=',task.payload.villageId).where('commandId','=',task.payload.commandId).executeTakeFirst();
 if(!row||row.receipt)return;
 const world=await tx.selectFrom('worlds').select('slug').where('id','=',task.worldId).executeTakeFirstOrThrow();
 const local={transaction:()=>({execute:<T>(run:(transaction:Transaction<Database>)=>Promise<T>)=>run(tx)})} as unknown as Kysely<Database>;
 let receipt:HarvestReceipt;
 await sql`savepoint harvest_submission`.execute(tx);
 try{receipt=await acceptHarvestIntent(local,row.accountId,world.slug,row.villageId,row.request);await sql`release savepoint harvest_submission`.execute(tx);}
 catch(error){await sql`rollback to savepoint harvest_submission`.execute(tx);await sql`release savepoint harvest_submission`.execute(tx);
  if(!(error instanceof HttpError)||error.statusCode>=500)throw error;
  receipt={commandId:row.commandId,accepted:[],refused:[...row.request.gardens.map(c=>`garden:${c.cellX}:${c.cellY}`),...row.request.wood,...row.request.stone].map(key=>({key,reason:error.message}))};
 }
 await tx.updateTable('harvestSubmissions').set({receipt:JSON.stringify(receipt)}).where('worldId','=',task.worldId).where('villageId','=',row.villageId).where('commandId','=',row.commandId).execute();
}
