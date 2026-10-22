import {sql,type Kysely} from 'kysely';
import type {ProcessingCommand,ProcessingConfirmationV2} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {ownedVillage} from './service.js';
import {beginProcessingCommand,COMMAND_CATCHUP_BUDGET,type ReconciliationBudget} from './reconcile-economy.js';
import {commandProcessing} from './processing.js';
import {reconcileRestHousing} from '../population/work.js';
import {requestEconomyCatchup,ScopeCatchingUp} from './economy-catchup.js';
import {publishPrivateEffects} from './sync-v2-effects.js';

/** The transaction owns H, receipt, effects and terminal journal publication.
 * An exact retry reads its immutable result without waking the economy. */
export async function commandProcessingV2(db:Kysely<Database>,accountId:string,worldSlug:string,villageId:string,
  command:ProcessingCommand,generation:number,budget:ReconciliationBudget=COMMAND_CATCHUP_BUDGET):Promise<ProcessingConfirmationV2>{
  if(!Number.isSafeInteger(generation)||generation<0)throw Error('Invalid synchronization generation');
  return db.transaction().execute(async tx=>{
    await sql`set local lock_timeout='2s'`.execute(tx);
    await sql`set local statement_timeout='5s'`.execute(tx);
    const village=await ownedVillage(tx,accountId,worldSlug,villageId);
    const prepared=await beginProcessingCommand(tx,village.worldId,villageId,command,budget);
    if(prepared.catchingUp)throw new ScopeCatchingUp();
    const result=await commandProcessing(tx,prepared.economy,command);
    const confirmation:ProcessingConfirmationV2={protocol:2,worldId:village.worldId,villageId,commandId:command.commandId,
      status:'applied',commandTime:result.commandTime?.toISOString()??null,result:{orderId:result.orderId}};
    if(prepared.replay)return confirmation;
    if(prepared.reconciled)await reconcileRestHousing(tx,village.worldId,villageId,prepared.economy.through);
    // No business writes after this point, including no generic admission.
    const effects=await publishPrivateEffects(tx,prepared.economy,generation);
    if(effects)confirmation.effects=effects;
    return confirmation;
  }).catch(async error=>{
    if(error instanceof ScopeCatchingUp)await requestEconomyCatchup(db,accountId,worldSlug,villageId);
    throw error;
  });
}
