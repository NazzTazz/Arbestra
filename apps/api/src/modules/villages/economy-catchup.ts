import {randomUUID} from 'node:crypto';
import {sql,type Kysely,type Transaction} from 'kysely';
import type {Database} from '../../database/schema.js';
import type {ScheduledTask} from '../../jobs/scheduled-tasks.js';
import {HttpError} from '../../errors.js';
import {ownedVillage} from './service.js';
import {beginVillageEconomy,COMMAND_CATCHUP_BUDGET,type ReconciliationBudget} from './reconcile-economy.js';

export const ECONOMY_CATCHUP_TASK='economy.catchup';
export class ScopeCatchingUp extends HttpError {
  constructor(){super(503,'SCOPE_CATCHING_UP','Actualisation du village en cours. Réessayez dans un instant.');}
}

async function continuation(tx:Transaction<Database>,worldId:string,villageId:string,generation:string){
  const {now}=await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('now')).executeTakeFirstOrThrow();
  await tx.insertInto('scheduledTasks').values({worldId,taskType:ECONOMY_CATCHUP_TASK,subjectId:randomUUID(),
    payload:{villageId,generation},dueAt:now,availableAt:now,lastError:null,completedAt:null}).execute();
}

/** Call only after the command transaction rolled back. Deduplication belongs
 * to the village's generation; no existing notification is read or changed. */
export async function requestEconomyCatchup(db:Kysely<Database>,accountId:string,worldSlug:string,villageId:string):Promise<void>{
  await db.transaction().execute(async tx=>{
    await sql`set local lock_timeout='2s'`.execute(tx);
    await sql`set local statement_timeout='5s'`.execute(tx);
    const village=await ownedVillage(tx,accountId,worldSlug,villageId);
    await tx.selectFrom('villages').select('id').where('worldId','=',village.worldId).where('id','=',village.villageId).forUpdate().executeTakeFirstOrThrow();
    const previous=await tx.selectFrom('villageEconomyCatchups').select(['status']).where('worldId','=',village.worldId)
      .where('villageId','=',village.villageId).executeTakeFirst();
    if(previous?.status==='active')return;
    const {through}=await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('through')).executeTakeFirstOrThrow();
    const generation=randomUUID();
    await tx.insertInto('villageEconomyCatchups').values({worldId:village.worldId,villageId:village.villageId,generation,
      targetThrough:through,completedThrough:null,lastTransitionAt:null,transitions:0,status:'active'})
      .onConflict(conflict=>conflict.columns(['worldId','villageId']).doUpdateSet({generation,targetThrough:through,
        completedThrough:null,lastTransitionAt:null,transitions:0,status:'active',updatedAt:through})).execute();
    await continuation(tx,village.worldId,village.villageId,generation);
  });
}

/** Scheduler owns its task lock. Village then cursor precede all economy
 * locks; progress and the next notification commit together. */
export async function advanceEconomyCatchup(tx:Transaction<Database>,task:ScheduledTask,
  budget:ReconciliationBudget=COMMAND_CATCHUP_BUDGET):Promise<void>{
  const {villageId,generation}=task.payload;
  await sql`set local lock_timeout='2s'`.execute(tx);
  await sql`set local statement_timeout='5s'`.execute(tx);
  if(typeof villageId!=='string'||typeof generation!=='string')throw Error('Invalid economy continuation');
  const village=await tx.selectFrom('villages').select('id').where('worldId','=',task.worldId).where('id','=',villageId).forUpdate().executeTakeFirst();
  if(!village)return;
  const cursor=await tx.selectFrom('villageEconomyCatchups').selectAll().where('worldId','=',task.worldId)
    .where('villageId','=',villageId).forUpdate().executeTakeFirst();
  if(!cursor||cursor.generation!==generation||cursor.status!=='active')return;
  const economy=await beginVillageEconomy(tx,task.worldId,villageId,undefined,[],[],false,[villageId],cursor.targetThrough,budget);
  const progress=economy.catchup!;
  await tx.updateTable('villageEconomyCatchups').set({status:progress.complete?'complete':'active',
    // A processed event is not a completeness frontier: another event (or a
    // newly created successor) may share its timestamp and precede its UUID.
    completedThrough:progress.complete?cursor.targetThrough:cursor.completedThrough,
    lastTransitionAt:progress.lastTransitionAt??cursor.lastTransitionAt,transitions:sql`transitions+${progress.transitions}`,
    updatedAt:sql`statement_timestamp()`}).where('worldId','=',task.worldId).where('villageId','=',villageId).execute();
  if(!progress.complete)await continuation(tx,task.worldId,villageId,generation);
}
