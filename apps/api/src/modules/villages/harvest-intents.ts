import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {sql,type Kysely} from 'kysely';
import type {HarvestIntent,HarvestReceipt,ExploitationRequest} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {HttpError} from '../../errors.js';
import {ownedVillage,prepareExploitation,prepareWorksiteSelection} from './service.js';
import {beginVillageEconomy} from './reconcile-economy.js';
import {createWorksite,WAKE_EXTRACTION_WORKSITE_TASK} from '../deposits/worksites.js';
import {readStoneDeposit} from '../deposits/stone-extractions.js';
import {materializeCohorts} from '../population/work.js';
import {normalizeCell} from '../worlds/coordinates.js';

/** A receipt confirms durable targets, not delivered stock or an immediate departure.
 * Existing admission/worker code chooses teams, routes and lots after commit.
 */
export async function acceptHarvestIntent(db:Kysely<Database>,accountId:string,worldSlug:string,villageId:string,raw:HarvestIntent):Promise<HarvestReceipt>{
  return db.transaction().execute(async tx=>{
    const village=await ownedVillage(tx,accountId,worldSlug,villageId);
    const request:HarvestIntent={commandId:raw.commandId.toLowerCase(),
      gardens:[...new Map(raw.gardens.map(c=>{const p={cellX:normalizeCell(c.cellX,village.widthCells),cellY:normalizeCell(c.cellY,village.heightCells)};return [`${p.cellX}:${p.cellY}`,p];})).values()].sort((a,b)=>a.cellX-b.cellX||a.cellY-b.cellY),
      wood:[...new Set(raw.wood.map(id=>id.toLowerCase()))].sort(),stone:[...new Set(raw.stone.map(id=>id.toLowerCase()))].sort()};
    const economy=await beginVillageEconomy(tx,village.worldId,villageId,undefined,[],[...request.wood,...request.stone]);
    const previous=await tx.selectFrom('harvestIntents').selectAll().where('worldId','=',village.worldId).where('villageId','=',villageId).where('commandId','=',request.commandId).executeTakeFirst();
    if(previous){if(!isDeepStrictEqual(previous.request,request))throw new HttpError(409,'COMMAND_ID_CONFLICT','Cette intention a déjà été utilisée différemment.');return previous.receipt;}
    if(!request.gardens.length&&!request.wood.length&&!request.stone.length)throw new HttpError(400,'HARVEST_EMPTY','Aucune ressource désignée.');
    const receipt:HarvestReceipt={commandId:request.commandId,accepted:[],refused:[]};
    const cohorts=await materializeCohorts(tx,village.worldId,villageId,economy.through);
    const cap=Math.max(1,Math.min(21,cohorts.reduce((n,c)=>n+c.memberCount,0)));
    const command:ExploitationRequest={...request,workerCap:cap,durationMs:null,cohortId:null,woodMode:'cut',initialAdmission:'allow-wait'};
    let gardenPlan:Awaited<ReturnType<typeof prepareExploitation>>['plan']=null;
    if(request.gardens.length){
      const prepared=await prepareExploitation(tx,village,economy,accountId,{...command,wood:[],stone:[]});
      command.gardens=prepared.preview.gardens;gardenPlan=prepared.plan;receipt.refused.push(...prepared.preview.excluded);
      for(const cell of command.gardens){
        const {projectGardenPlot}=await import('./economy.js');
        const plot=await projectGardenPlot(tx,village.worldId,cell.cellX,cell.cellY,economy.through);
        receipt.accepted.push({key:`garden:${cell.cellX}:${cell.cellY}`,...cell,resource:'carrot',amount:Math.floor(plot.amount)});
      }
    }
    for(const family of ['wood','stone'] as const){
      const selection=await prepareWorksiteSelection(tx,village,economy,{commandId:request.commandId,mode:family==='wood'?'cut':'extract',workerCap:10,featureIds:request[family]});
      command[family]=selection.included.map(i=>i.featureId);
      receipt.refused.push(...selection.excluded.map(i=>({key:i.featureId,reason:i.reason})));
      for(const target of selection.included){
        const deposit=await readStoneDeposit(tx,village.worldId,target.featureId);
        receipt.accepted.push({key:target.featureId,cellX:target.cellX,cellY:target.cellY,resource:family,
          amount:Math.max(0,Math.floor(deposit.remainingAmount-(family==='wood'?deposit.initialAmount/10:0)))});
      }
    }
    let orderId:string|null=null;
    if(receipt.accepted.length){
      // Only automatic orders belong to this tool. Never append to a manual, paused or stopped order.
      let existing=await tx.selectFrom('exploitationOrders').selectAll().where('worldId','=',village.worldId).where('villageId','=',villageId)
        .where(eb=>eb.exists(eb.selectFrom('harvestIntents').select('commandId').whereRef('harvestIntents.orderId','=','exploitationOrders.id').where('harvestIntents.worldId','=',village.worldId).where('harvestIntents.villageId','=',villageId)))
        .where('deadline','is',null).where('gardenStatus','in',command.gardens.length?['completed']:['pending','active','completed'])
        .where(eb=>eb.exists(eb.selectFrom('extractionWorksites').select('id').whereRef('exploitationOrderId','=','exploitationOrders.id').where('status','=','running')))
        .where(eb=>eb.not(eb.exists(eb.selectFrom('extractionWorksites').select('id').whereRef('exploitationOrderId','=','exploitationOrders.id').where('status','in',['paused','stopping','stopped']))))
        .orderBy('confirmedAt','desc').executeTakeFirst();
      if(existing){
        const targets=await tx.selectFrom('extractionWorksiteTargets').innerJoin('extractionWorksites','extractionWorksites.id','extractionWorksiteTargets.worksiteId')
          .select(['featureId','extractionWorksiteTargets.status','resourceCode']).where('extractionWorksites.worldId','=',village.worldId).where('extractionWorksites.villageId','=',villageId).where('exploitationOrderId','=',existing.id).where('extractionWorksites.status','=','running').execute();
        if((['wood','stone'] as const).some(family=>targets.filter(t=>t.resourceCode===family&&t.status==='pending').length+command[family].length>64||targets.some(t=>command[family].includes(t.featureId))))existing=undefined;
      }
      if(existing){
        orderId=existing.id;
        await tx.updateTable('exploitationOrders').set({workerCap:cap,...(gardenPlan?{gardenStatus:'pending' as const,gardenPlan:JSON.stringify(gardenPlan)}:{})}).where('id','=',orderId).where('worldId','=',village.worldId).execute();
      }else{
        const order=await tx.insertInto('exploitationOrders').values({worldId:village.worldId,villageId,commandId:request.commandId,request:JSON.stringify(command),workerCap:cap,confirmedAt:economy.through,deadline:null,cohortId:null,initialRemaining:0,gardenStatus:gardenPlan?'pending':'completed',gardenPlan:gardenPlan?JSON.stringify(gardenPlan):null,nextWakeAt:null}).returning('id').executeTakeFirstOrThrow();orderId=order.id;
      }
      for(const family of ['wood','stone'] as const)if(command[family].length){
        const site=await tx.selectFrom('extractionWorksites').select('id').where('worldId','=',village.worldId).where('villageId','=',villageId).where('exploitationOrderId','=',orderId).where('resourceCode','=',family).where('status','=','running').executeTakeFirst();
        if(site){
          const last=await tx.selectFrom('extractionWorksiteTargets').select(sql<number>`coalesce(max(ordinal),-1)::integer`.as('ordinal')).where('worldId','=',village.worldId).where('worksiteId','=',site.id).executeTakeFirstOrThrow();
          await tx.insertInto('extractionWorksiteTargets').values(command[family].map((featureId,i)=>({worldId:village.worldId,villageId,worksiteId:site.id,featureId,ordinal:last.ordinal+i+1,status:'pending' as const,admittedAt:null,thresholdReachedAt:null,completedAt:null,reason:null}))).execute();
        }else await createWorksite(tx,economy,{commandId:randomUUID(),mode:family==='wood'?'cut':'extract',workerCap:10,featureIds:command[family]},command[family],orderId);
      }
      await tx.insertInto('scheduledTasks').values({worldId:village.worldId,taskType:WAKE_EXTRACTION_WORKSITE_TASK,subjectId:randomUUID(),payload:{exploitationOrderId:orderId},dueAt:economy.through,availableAt:economy.through,completedAt:null,lastError:null}).execute();
    }
    await tx.insertInto('harvestIntents').values({worldId:village.worldId,villageId,commandId:request.commandId,request:JSON.stringify(request),receipt:JSON.stringify(receipt),orderId,createdAt:economy.through}).execute();
    return receipt;
  });
}
