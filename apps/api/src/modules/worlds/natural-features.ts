import {sql,type Kysely} from 'kysely';
import type {Database} from '../../database/schema.js';

export interface FeatureArea {minX:number;maxX:number;minY:number;maxY:number}
/** Restrict the economic view before projecting stock. A deposit's canonical
 * location wins over any surviving occupancy, including outside the window. */
export function naturalFeaturesQuery(db:Kysely<Database>,worldId:string,areas:readonly FeatureArea[]){
 if(!areas.length)throw Error('A natural-feature read needs an area');
 const inside=(x:string,y:string)=>sql<boolean>`(${sql.join(areas.map(a=>sql`(${sql.ref(x)} >= ${a.minX} and ${sql.ref(x)} < ${a.maxX} and ${sql.ref(y)} >= ${a.minY} and ${sql.ref(y)} < ${a.maxY})`),sql` or `)})`;
 return db.with(cte=>cte('projectedDeposits').materialized(),eb=>eb.selectFrom('resourceDeposits').selectAll()
  .where('worldId','=',worldId).where(inside('cellX','cellY')))
  .with('featureLocations',eb=>eb.selectFrom('worldCellOccupancies')
   .select(['worldId','featureId','cellX','cellY']).where('worldId','=',worldId).where('featureId','is not',null)
   .where(inside('cellX','cellY'))
   // Reading only identifiers lets PostgreSQL prune all economic projections.
   .where(sql<boolean>`not exists(select 1 from resource_deposits rd where rd.world_id=world_cell_occupancies.world_id and rd.feature_id=world_cell_occupancies.feature_id)`)
   .union(eb.selectFrom('projectedDeposits').select(['worldId','featureId','cellX','cellY'])))
  .selectFrom('featureLocations')
  .innerJoin('worldFeatures',j=>j.onRef('worldFeatures.worldId','=','featureLocations.worldId').onRef('worldFeatures.id','=','featureLocations.featureId'))
  .leftJoin('projectedDeposits as resourceDeposits',j=>j.onRef('resourceDeposits.worldId','=','worldFeatures.worldId').onRef('resourceDeposits.featureId','=','worldFeatures.id'))
  .select(['worldFeatures.id','worldFeatures.featureTypeCode','worldFeatures.variantSeed','worldFeatures.state as featureState',
   'featureLocations.cellX','featureLocations.cellY','resourceDeposits.initialAmount','resourceDeposits.remainingAmount',
   'resourceDeposits.reservedAmount','resourceDeposits.revision','resourceDeposits.updatedAt','resourceDeposits.resourceCode','resourceDeposits.cleared','resourceDeposits.blocksCell'])
  .where('worldFeatures.worldId','=',worldId);
}
