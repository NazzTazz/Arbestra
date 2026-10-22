import type {Kysely} from 'kysely';
import type {ConstructionConfirmationV2,SyncV2Batch} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {placeBuilding,type BuildingPlacement} from './construction.js';
import {publishPrivateEffects} from './sync-v2-effects.js';

/** Bounded placement answered on the V2 contract: same transaction, receipt
 * and rules as the historical path, then terminal journal publication and
 * the private effects read at H. An exact replay returns its original result
 * without effects or new publication. */
export async function placeBuildingV2(db:Kysely<Database>,accountId:string,slug:string,villageId:string,input:BuildingPlacement,
  durationOverride:number|null,generation:number):Promise<ConstructionConfirmationV2>{
  if(!Number.isSafeInteger(generation)||generation<0)throw Error('Invalid synchronization generation');
  let effects:SyncV2Batch|undefined;
  const confirmed=await placeBuilding(db,accountId,slug,villageId,input,durationOverride,
    async(tx,economy)=>{effects=await publishPrivateEffects(tx,economy,generation);});
  const buildingId=confirmed.cells.find(cell=>cell.footprint)?.footprint?.buildingId??null;
  // The receipt's created_at is a transaction timestamp, not H: a replay
  // takes the original instant from the building's construction start.
  const started=confirmed.cells.find(cell=>cell.building?.id===buildingId)?.building?.constructionStartedAt;
  return {protocol:2,worldId:confirmed.worldId,villageId:confirmed.villageId,commandId:confirmed.commandId,status:'applied',
    commandTime:started??confirmed.commandTime,result:{buildingId},...(effects?{effects}:{})};
}
