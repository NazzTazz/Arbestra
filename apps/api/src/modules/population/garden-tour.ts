import {sql,type Transaction} from 'kysely';
import type {GardenHarvestStop,TravelCell} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {HttpError} from '../../errors.js';
import {materializeGardenPlot} from '../villages/economy.js';
import {assignWorkers,eligibleWorkers,materializeCohorts} from './work.js';
import {COMPLETE_GARDEN_HARVEST_TASK} from './garden-harvest.js';

/** The caller owns the village lock, post-lock bound and the canonical selection. */
export async function startGardenTour(tx:Transaction<Database>,worldId:string,villageId:string,commandId:string,through:Date,
  plan:{stops:Array<Omit<GardenHarvestStop,'reservedCarrots'>>;returnPath:TravelCell[];durationMs:number}){
  const plots=await tx.selectFrom('gardenPlots').selectAll().where('worldId','=',worldId).where('villageId','=',villageId)
    .where(eb=>eb.or(plan.stops.map(p=>eb.and([eb('cellX','=',p.cellX),eb('cellY','=',p.cellY)]))))
    .orderBy('cellX').orderBy('cellY').forUpdate().execute();
  if(plots.length!==plan.stops.length)throw new HttpError(404,'GARDEN_PLOT_NOT_READY','Une parcelle sélectionnée n’appartient pas à ce village.');
  const buildings=await tx.selectFrom('buildings').select(['id','status','buildingType']).where('worldId','=',worldId)
    .where('villageId','=',villageId).where('id','in',[...new Set(plots.map(p=>p.buildingId))].sort()).orderBy('id').forUpdate().execute();
  if(buildings.length!==new Set(plots.map(p=>p.buildingId)).size||buildings.some(b=>b.status!=='completed'||b.buildingType!=='garden'))throw new HttpError(409,'GARDEN_NOT_READY','Une parcelle sélectionnée est encore en chantier.');
  const active=await tx.selectFrom('gardenHarvests').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).where('status','=','in-progress').execute();
  const overlaps=active.some(h=>plan.stops.some(p=>h.plotCellX===p.cellX&&h.plotCellY===p.cellY
    ||h.stops.some(s=>s.cellX===p.cellX&&s.cellY===p.cellY)||h.plotCellX===null&&plots.some(plot=>plot.cellX===p.cellX&&plot.cellY===p.cellY&&plot.buildingId===h.buildingId)));
  if(overlaps)throw new HttpError(409,'GARDEN_HARVEST_IN_PROGRESS','Une parcelle sélectionnée est déjà en récolte.');
  const cohorts=await materializeCohorts(tx,worldId,villageId,through),eligible=eligibleWorkers(cohorts,plan.durationMs);
  if(!eligible.some(c=>c.memberCount>=1))throw new HttpError(409,'HARVESTERS_UNAVAILABLE','Aucun habitant disponible avec assez d’énergie pour toute la tournée.');
  const amounts=new Map<string,number>();
  for(const plot of plots){const buffer=await materializeGardenPlot(tx,worldId,plot.cellX,plot.cellY,through);
    if(buffer.amount<1)throw new HttpError(409,'GARDEN_EMPTY','Une parcelle sélectionnée ne contient plus de carotte.');
    amounts.set(`${plot.cellX}:${plot.cellY}`,buffer.amount);}
  const stops=plan.stops.map(s=>({...s,reservedCarrots:amounts.get(`${s.cellX}:${s.cellY}`)!})),first=stops[0]!;
  const buildingId=plots.find(p=>p.cellX===first.cellX&&p.cellY===first.cellY)!.buildingId;
  const harvest=await tx.insertInto('gardenHarvests').values({worldId,villageId,buildingId,commandId,status:'in-progress',
    plotCellX:first.cellX,plotCellY:first.cellY,workerCount:1,startedAt:through,completesAt:new Date(through.getTime()+plan.durationMs),completedAt:null,
    reservedCarrots:stops.reduce((sum,s)=>sum+s.reservedCarrots,0),transportMs:first.arrivesAfterMs,
    pathCells:sql`${JSON.stringify(first.path)}::jsonb`,stops:sql`${JSON.stringify(stops)}::jsonb`,returnPathCells:sql`${JSON.stringify(plan.returnPath)}::jsonb`}).returning('id').executeTakeFirstOrThrow();
  await assignWorkers(tx,eligible,1,{harvestId:harvest.id,extractionId:null});
  for(const plot of plots)await tx.updateTable('gardenPlots').set({storedAmount:0,productionUpdatedAt:through})
    .where('worldId','=',worldId).where('villageId','=',villageId).where('cellX','=',plot.cellX).where('cellY','=',plot.cellY).execute();
  await tx.insertInto('scheduledTasks').values({worldId,taskType:COMPLETE_GARDEN_HARVEST_TASK,subjectId:harvest.id,
    payload:{},dueAt:new Date(through.getTime()+plan.durationMs),availableAt:new Date(through.getTime()+plan.durationMs),lastError:null,completedAt:null}).execute();
  return harvest.id;
}
