import { isDeepStrictEqual } from 'node:util';
import type { Kysely, Transaction } from 'kysely';
import type { HudWorkforceIntent, HudWorkforceConfirmation, HudWorkforceState } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { ownedVillage, withVillageProjection } from './service.js';
import { beginVillageEconomy, type VillageEconomy } from './reconcile-economy.js';
import { changeExtractionPool, readExtractionPools, wakeExtractionPool } from '../deposits/extraction-pools.js';
import { populationGesture } from '../population/gestures.js';
import { advanceEnergy } from '../population/energy.js';
import { energyState, withoutAssignment, reconcileRestHousing } from '../population/work.js';
import { projectVillageResources } from './economy.js';
import { villageSyncRevision } from './sync-revision.js';

/** Scoped snapshot at the command bound. No geography, catalogue or display navigation. */
async function hudState(tx:Transaction<Database>,ctx:VillageEconomy):Promise<HudWorkforceState> {
  const [cohorts,resources,extractionPools,sites]=await Promise.all([
    tx.selectFrom('populationCohorts').selectAll().where('worldId','=',ctx.worldId).where('villageId','=',ctx.villageId).execute(),
    projectVillageResources(tx,ctx.worldId,ctx.villageId,ctx.through),
    readExtractionPools(tx,ctx.worldId,ctx.villageId),
    tx.selectFrom('extractionWorksites').select('poolResource').where('worldId','=',ctx.worldId).where('villageId','=',ctx.villageId)
      .where('status','in',['running','paused','stopping']).execute(),
  ]);
  const population={available:0,working:0,resting:0,pendingRelease:{idle:0,resting:0}};
  for(const cohort of cohorts) {
    const energy=advanceEnergy(energyState(cohort),ctx.through);
    if(energy.activity==='idle'&&withoutAssignment(cohort))population.available+=cohort.memberCount;
    if(energy.activity==='working')population.working+=cohort.memberCount;
    if(energy.activity==='resting')population.resting+=cohort.memberCount;
    if(cohort.pendingRelease)population.pendingRelease[cohort.pendingRelease]+=cohort.memberCount;
  }
  const openWorksites={wood:0,stone:0,other:0};
  for(const site of sites)openWorksites[site.poolResource??'other']++;
  return {worldId:ctx.worldId,villageId:ctx.villageId,serverTime:ctx.through.toISOString(),
    minimumRevision:(await villageSyncRevision(tx,ctx.worldId)).revision,
    population,carrots:resources.find(r=>r.code==='carrot')?.amount??0,extractionPools,openWorksites};
}

export async function commandHudWorkforce(db:Kysely<Database>,accountId:string,slug:string,villageId:string,
  request:HudWorkforceIntent):Promise<HudWorkforceConfirmation> {
  const owner=await ownedVillage(db,accountId,slug,villageId);
  const known=await db.selectFrom('hudWorkforceReceipts').selectAll().where('worldId','=',owner.worldId)
    .where('villageId','=',villageId).where('commandId','=',request.command.commandId).executeTakeFirst();
  if(known) {
    if(!isDeepStrictEqual(known.request,request))throw new HttpError(409,'COMMAND_ID_CONFLICT','Cette commande a déjà été utilisée différemment.');
    // Lost HTTP responses must not repeat reconciliation, admissions or the display projection.
    // Ownership is checked again inside this coherent read-only snapshot.
    const hud=await withVillageProjection(db,accountId,slug,villageId,(tx,ctx)=>hudState(tx,ctx));
    return {commandId:request.command.commandId,affected:known.affected,carrots:known.carrots,hud};
  }
  const confirmed=await db.transaction().execute(async tx=>{
    const village=await ownedVillage(tx,accountId,slug,villageId);
    const ctx=await beginVillageEconomy(tx,village.worldId,villageId);
    const previous=await tx.selectFrom('hudWorkforceReceipts').selectAll().where('worldId','=',ctx.worldId).where('villageId','=',villageId).where('commandId','=',request.command.commandId).executeTakeFirst();
    let result={affected:0,carrots:0};
    if(previous){
      if(!isDeepStrictEqual(previous.request,request))throw new HttpError(409,'COMMAND_ID_CONFLICT','Cette commande a déjà été utilisée différemment.');
      result={affected:previous.affected,carrots:previous.carrots};
    }else{
      if(request.kind==='pool')await changeExtractionPool(tx,ctx,request.command);
      else result=await populationGesture(tx,ctx,request.command);
      await tx.insertInto('hudWorkforceReceipts').values({worldId:ctx.worldId,villageId,commandId:request.command.commandId,request:JSON.stringify(request),...result}).execute();
      if(request.kind==='population'&&request.command.action==='feed'&&request.command.group==='idle'){
        await wakeExtractionPool(tx,ctx,'wood');
        await wakeExtractionPool(tx,ctx,'stone');
      }
    }
    // beginVillageEconomy already reconciled due work at H. Settings have a
    // durable wake; new route-dependent departures belong to that worker cycle,
    // not to the acknowledgement of the player's gesture.
    await reconcileRestHousing(tx,ctx.worldId,ctx.villageId,ctx.through);
    return {...result,commandId:request.command.commandId,hud:await hudState(tx,ctx)};
  });
  // A projection can have started after H but before COMMIT. Its timestamp alone
  // cannot authorize replacing these confirmed counters.
  confirmed.hud.minimumRevision=(await villageSyncRevision(db,owner.worldId)).revision;
  return confirmed;
}
