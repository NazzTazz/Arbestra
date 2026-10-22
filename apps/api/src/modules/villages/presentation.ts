import {createHash} from 'node:crypto';
import type {Kysely} from 'kysely';
import type {VillagePresentation,VillageState} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import type {TravelNetworkExecutor} from '../navigation/network-job.js';
import {readVillageProjection} from './service.js';

/** Selection of the historical read-only projection: placement and routing
 * rules stay in one place. Collections are ordered canonically because
 * occupancy rows have no SQL order and the version digests the content. */
export function villagePresentation(state:VillageState):VillagePresentation{
  const cells=state.cells.map(({cellX,cellY,canBuild,footprint,building})=>({cellX,cellY,canBuild,footprint,displaysBuilding:building!==null}))
    .sort((a,b)=>a.cellY-b.cellY||a.cellX-b.cellX);
  const travelRoutes=[...state.travelRoutes].sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
  const market=state.village.market;
  if(!market)throw Error('Village projection has no market configuration');
  const region={...state.region,features:[...state.region.features].sort((a,b)=>a.cellY-b.cellY||a.cellX-b.cellX||a.id.localeCompare(b.id))};
  const content={cells,travelRoutes,region,market:{unlocked:market.unlocked,deliveryMs:market.deliveryMs,
    commissionPercent:market.commissionPercent,resources:market.resources}};
  const version=createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return {protocol:2,worldId:state.world.id,villageId:state.village.id,version,observedAt:state.serverTime,...content};
}

/** One read-only MVCC capture, then the shared CPU pool for routing. No
 * economic wake-up, admission or notification. */
export async function readVillagePresentation(db:Kysely<Database>,accountId:string,worldSlug:string,villageId:string,
  compute:TravelNetworkExecutor):Promise<VillagePresentation>{
  return villagePresentation(await readVillageProjection(db,accountId,worldSlug,villageId,compute));
}
