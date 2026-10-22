import { sql, type Transaction } from 'kysely';

import type { Database } from '../../database/schema.js';

export interface ProjectedResource {
  amount: number;
  productionPerHour: number;
  productionUpdatedAt: Date | null;
}

export interface ProjectedBuffer {
  resourceCode: string;
  amount: number;
  capacity: number;
  productionPerHour: number;
  productionUpdatedAt: Date;
}

export interface ProjectedGardenPlot extends ProjectedBuffer {
  cellX: number;
  cellY: number;
  buildingId: string;
}

interface ProductionDelta {
  wholeUnits: string;
  remainder: string;
}

function asNumber(value: string | number): number {
  return Number(value);
}

/** SQL aliases f=flow and v=village are shared by projection and settlement. */
function directProductionRate() {
  return sql<string>`case when f.production_updated_at is null
      or (f.resource_code='wood' and v.economy_activated_at is not null) then 0
    else f.base_rate_per_hour + coalesce((select sum(bp.rate_per_hour) from buildings b
      join building_level_production bp on bp.building_type_code=b.building_type and bp.level=b.level
        and bp.resource_code=f.resource_code
      where b.world_id=f.world_id and b.village_id=f.village_id
        and (b.status='completed' or b.target_level is not null)),0) end`;
}

async function productionDelta(
  transaction: Transaction<Database>,
  storedRemainder: string,
  ratePerHour: number,
  from: Date,
  through: Date,
): Promise<ProductionDelta> {
  const effectiveThrough = through.getTime() > from.getTime() ? through : from;
  return transaction.selectNoFrom([
    sql<string>`floor(${storedRemainder}::numeric + ${ratePerHour}::numeric * extract(epoch from (${effectiveThrough}::timestamptz - ${from}::timestamptz)) / 3600)`.as('wholeUnits'),
    sql<string>`mod(${storedRemainder}::numeric + ${ratePerHour}::numeric * extract(epoch from (${effectiveThrough}::timestamptz - ${from}::timestamptz)) / 3600, 1)`.as('remainder'),
  ]).executeTakeFirstOrThrow();
}

export async function villageProductionPerHour(
  transaction: Transaction<Database>,
  worldId: string,
  villageId: string,
  resourceCode: string,
): Promise<number> {
  const row = await transaction.selectFrom('villageResourceFlows as f')
    .innerJoin('villages as v', join => join.onRef('v.worldId', '=', 'f.worldId').onRef('v.id', '=', 'f.villageId'))
    .select(directProductionRate().as('rate')).where('f.worldId', '=', worldId)
    .where('f.villageId', '=', villageId).where('f.resourceCode', '=', resourceCode).executeTakeFirst();
  return row ? asNumber(row.rate) : 0;
}

export async function projectVillageResource(
  transaction: Transaction<Database>,
  worldId: string,
  villageId: string,
  resourceCode: string,
  through: Date,
): Promise<ProjectedResource> {
  const resource = await transaction.selectFrom('villageResources')
    .leftJoin('villageResourceFlows', (join) => join
      .onRef('villageResourceFlows.worldId', '=', 'villageResources.worldId')
      .onRef('villageResourceFlows.villageId', '=', 'villageResources.villageId')
      .onRef('villageResourceFlows.resourceCode', '=', 'villageResources.resourceCode'))
    .select([
      'villageResources.amount',
      'villageResourceFlows.remainder',
      'villageResourceFlows.productionUpdatedAt',
    ])
    .where('villageResources.worldId', '=', worldId)
    .where('villageResources.villageId', '=', villageId)
    .where('villageResources.resourceCode', '=', resourceCode)
    .executeTakeFirstOrThrow();
  const rate = resource.productionUpdatedAt
    ? await villageProductionPerHour(transaction, worldId, villageId, resourceCode)
    : 0;
  if (!resource.productionUpdatedAt || resource.remainder === null || rate === 0) {
    return { amount: asNumber(resource.amount), productionPerHour: rate, productionUpdatedAt: resource.productionUpdatedAt ? through : null };
  }
  const delta = await productionDelta(transaction, resource.remainder, rate, resource.productionUpdatedAt, through);
  return {
    amount: asNumber(resource.amount) + asNumber(delta.wholeUnits),
    productionPerHour: rate,
    productionUpdatedAt: through,
  };
}

/** One snapshot query for the HUD, with the same numeric rounding as the
 * individual authoritative reader. No stock or production result is cached. */
export async function projectVillageResources(transaction:Transaction<Database>,worldId:string,villageId:string,through:Date,codes?:readonly string[]){
 if(codes?.length===0)return [];
 if(codes&&codes.length>64)throw new RangeError('Too many resource codes');
 const result=await sql<{code:string;displayName:string;iconKey:string;amount:string;productionPerHour:string;productionUpdatedAt:Date|null}>`
  select r.resource_code as code, t.display_name, t.icon_key,
   (r.amount + case when f.production_updated_at is null or f.remainder is null or p.rate=0 then 0
    else floor(f.remainder + p.rate * extract(epoch from (greatest(${through}::timestamptz,f.production_updated_at)-f.production_updated_at))/3600) end)::text as amount,
   p.rate::text as production_per_hour,
   case when f.production_updated_at is null then null else ${through}::timestamptz end as production_updated_at
  from village_resources r join resource_types t on t.code=r.resource_code
  join villages v on v.world_id=r.world_id and v.id=r.village_id
  left join village_resource_flows f on f.world_id=r.world_id and f.village_id=r.village_id and f.resource_code=r.resource_code
  cross join lateral (select ${directProductionRate()} as rate) p
  where r.world_id=${worldId} and r.village_id=${villageId}
    ${codes?sql`and r.resource_code in (${sql.join([...new Set(codes)])})`:sql``}
 `.execute(transaction);
 return result.rows.map(row=>({...row,amount:Number(row.amount),productionPerHour:Number(row.productionPerHour)}));
}

export async function materializeVillageResource(
  transaction: Transaction<Database>,
  worldId: string,
  villageId: string,
  resourceCode: string,
  through: Date,
): Promise<number> {
  // The caller owns the village. Materialized CTEs retain flow -> stock lock
  // order, exact PostgreSQL numeric arithmetic and the post-lock command H.
  const result = await sql<{amount: string}>`
    with locked_flow as materialized (
      select f.*, ${directProductionRate()} as rate
      from village_resource_flows f join villages v on v.world_id=f.world_id and v.id=f.village_id
      where f.world_id=${worldId} and f.village_id=${villageId} and f.resource_code=${resourceCode}
      for update of f
    ), projected as materialized (
      select r.amount, f.world_id is not null as has_flow,
        greatest(${through}::timestamptz,f.production_updated_at) as at,
        coalesce(f.remainder + f.rate * extract(epoch from
          (greatest(${through}::timestamptz,f.production_updated_at)-f.production_updated_at))/3600,0) as progress
      from village_resources r left join locked_flow f
        on f.world_id=r.world_id and f.village_id=r.village_id and f.resource_code=r.resource_code
      where r.world_id=${worldId} and r.village_id=${villageId} and r.resource_code=${resourceCode}
      for update of r
    ), balance as (
      update village_resources r set amount=r.amount+floor(p.progress)::bigint from projected p
      where r.world_id=${worldId} and r.village_id=${villageId} and r.resource_code=${resourceCode}
        and floor(p.progress)<>0 returning r.amount
    ), cursor as (
      update village_resource_flows f set remainder=mod(p.progress,1),production_updated_at=p.at from projected p
      where f.world_id=${worldId} and f.village_id=${villageId} and f.resource_code=${resourceCode} and p.has_flow
        and (f.production_updated_at is distinct from p.at or f.remainder is distinct from mod(p.progress,1))
      returning f.resource_code
    ) select coalesce((select amount from balance),p.amount)::text as amount from projected p
  `.execute(transaction);
  if (!result.rows[0]) throw new Error('Village resource missing');
  return asNumber(result.rows[0].amount);
}

async function bufferState(
  transaction: Transaction<Database>,
  worldId: string,
  buildingId: string,
  resourceCode: string,
) {
  return transaction.selectFrom('buildingResourceBuffers')
    .innerJoin('buildings', (join) => join
      .onRef('buildings.worldId', '=', 'buildingResourceBuffers.worldId')
      .onRef('buildings.id', '=', 'buildingResourceBuffers.buildingId'))
    .innerJoin('buildingLevelProduction', (join) => join
      .onRef('buildingLevelProduction.buildingTypeCode', '=', 'buildings.buildingType')
      .onRef('buildingLevelProduction.level', '=', 'buildings.level')
      .onRef('buildingLevelProduction.resourceCode', '=', 'buildingResourceBuffers.resourceCode'))
    .select([
      'buildingResourceBuffers.storedAmount', 'buildingResourceBuffers.remainder',
      'buildingResourceBuffers.productionUpdatedAt', 'buildingResourceBuffers.resourceCode',
      'buildingLevelProduction.ratePerHour', 'buildingLevelProduction.capacity',
      'buildings.status', 'buildings.targetLevel', 'buildings.buildingType',
    ])
    .where('buildingResourceBuffers.worldId', '=', worldId)
    .where('buildingResourceBuffers.buildingId', '=', buildingId)
    .where('buildingResourceBuffers.resourceCode', '=', resourceCode)
    .executeTakeFirstOrThrow();
}

async function activeSurface(
  transaction: Transaction<Database>, worldId: string, buildingId: string,
): Promise<number> {
  const row = await transaction.selectFrom('worldCellOccupancies')
    .select(sql<number>`count(*)::integer`.as('count'))
    .where('worldId', '=', worldId).where('buildingId', '=', buildingId)
    .where('pendingExpansionId', 'is', null).executeTakeFirstOrThrow();
  return row.count;
}

async function bufferedRates(
  transaction: Transaction<Database>, worldId: string, buildingId: string,
  buildingType: string, status: string, rate: string | number, capacity: string | number | null,
) {
  const active = status === 'completed';
  if (!active) return { rate: 0, capacity: 0 };
  const multiplier = buildingType === 'garden'
    ? await activeSurface(transaction, worldId, buildingId)
    : 1;
  return { rate: Number(rate) * multiplier, capacity: Number(capacity ?? 0) * multiplier };
}

export async function projectBuildingBuffer(
  transaction: Transaction<Database>,
  worldId: string,
  buildingId: string,
  resourceCode: string,
  through: Date,
): Promise<ProjectedBuffer> {
  const buffer = await bufferState(transaction, worldId, buildingId, resourceCode);
  const rates = await bufferedRates(transaction, worldId, buildingId, buffer.buildingType, buffer.status, buffer.ratePerHour, buffer.capacity);
  const rate = rates.rate;
  const capacity = rates.capacity;
  const delta = await productionDelta(transaction, buffer.remainder, rate, buffer.productionUpdatedAt, through);
  return {
    resourceCode: buffer.resourceCode,
    amount: Math.min(capacity, asNumber(buffer.storedAmount) + asNumber(delta.wholeUnits)),
    capacity,
    productionPerHour: rate,
    productionUpdatedAt: through,
  };
}

export async function materializeBuildingBuffer(
  transaction: Transaction<Database>,
  worldId: string,
  buildingId: string,
  resourceCode: string,
  through: Date,
): Promise<ProjectedBuffer> {
  // Callers that mutate village economy hold the village row before this buffer.
  await transaction.selectFrom('buildingResourceBuffers').select('buildingId')
    .where('worldId', '=', worldId).where('buildingId', '=', buildingId).where('resourceCode', '=', resourceCode)
    .forUpdate().executeTakeFirstOrThrow();
  const buffer = await bufferState(transaction, worldId, buildingId, resourceCode);
  const rates = await bufferedRates(transaction, worldId, buildingId, buffer.buildingType, buffer.status, buffer.ratePerHour, buffer.capacity);
  const rate = rates.rate;
  const capacity = rates.capacity;
  const effectiveThrough = through.getTime() > buffer.productionUpdatedAt.getTime() ? through : buffer.productionUpdatedAt;
  const delta = await productionDelta(transaction, buffer.remainder, rate, buffer.productionUpdatedAt, effectiveThrough);
  const uncapped = asNumber(buffer.storedAmount) + asNumber(delta.wholeUnits);
  const capped = Math.min(capacity, uncapped);
  const remainder = capped >= capacity ? '0' : delta.remainder;
  await transaction.updateTable('buildingResourceBuffers').set({
    storedAmount: capped,
    remainder,
    productionUpdatedAt: effectiveThrough,
  }).where('worldId', '=', worldId).where('buildingId', '=', buildingId).where('resourceCode', '=', resourceCode).execute();
  return { resourceCode, amount: capped, capacity, productionPerHour: rate, productionUpdatedAt: effectiveThrough };
}

async function gardenPlotState(
  transaction: Transaction<Database>, worldId: string, cellX: number, cellY: number,
) {
  return transaction.selectFrom('gardenPlots')
    .innerJoin('buildings', (join) => join
      .onRef('buildings.worldId', '=', 'gardenPlots.worldId')
      .onRef('buildings.id', '=', 'gardenPlots.buildingId'))
    .innerJoin('buildingLevelProduction', (join) => join
      .onRef('buildingLevelProduction.buildingTypeCode', '=', 'buildings.buildingType')
      .onRef('buildingLevelProduction.level', '=', 'buildings.level')
      .on('buildingLevelProduction.resourceCode', '=', 'carrot'))
    .select(['gardenPlots.buildingId', 'gardenPlots.cellX', 'gardenPlots.cellY', 'gardenPlots.storedAmount',
      'gardenPlots.remainder', 'gardenPlots.productionUpdatedAt', 'buildingLevelProduction.ratePerHour',
      'buildingLevelProduction.capacity'])
    .where('gardenPlots.worldId', '=', worldId).where('gardenPlots.cellX', '=', cellX)
    .where('gardenPlots.cellY', '=', cellY).executeTakeFirstOrThrow();
}

function projectedPlot(row: Awaited<ReturnType<typeof gardenPlotState>>, delta: ProductionDelta, through: Date): ProjectedGardenPlot {
  const capacity = Number(row.capacity ?? 0);
  return { resourceCode: 'carrot', buildingId: row.buildingId, cellX: row.cellX, cellY: row.cellY,
    amount: Math.min(capacity, asNumber(row.storedAmount) + asNumber(delta.wholeUnits)), capacity,
    productionPerHour: Number(row.ratePerHour), productionUpdatedAt: through };
}

export async function projectGardenPlot(
  transaction: Transaction<Database>, worldId: string, cellX: number, cellY: number, through: Date,
): Promise<ProjectedGardenPlot> {
  const row = await gardenPlotState(transaction, worldId, cellX, cellY);
  const effectiveThrough = through > row.productionUpdatedAt ? through : row.productionUpdatedAt;
  const delta = await productionDelta(transaction, String(row.remainder), Number(row.ratePerHour), row.productionUpdatedAt, effectiveThrough);
  return projectedPlot(row, delta, effectiveThrough);
}

/** Same numeric projection and bound as projectGardenPlot, in one snapshot query. */
export async function projectGardenPlots(transaction: Transaction<Database>, worldId: string, villageId: string, through: Date,
  cells?: readonly { cellX: number; cellY: number }[]): Promise<ProjectedGardenPlot[]> {
  if(cells?.length===0)return [];
  if(cells&&cells.length>1024)throw new RangeError('Too many garden plots');
  const { rows } = await sql<{buildingId:string;cellX:number;cellY:number;amount:string;capacity:string;productionPerHour:string;productionUpdatedAt:Date}>`
    select g.building_id, g.cell_x, g.cell_y,
      least(coalesce(p.capacity,0), g.stored_amount + floor(g.remainder + p.rate_per_hour *
        extract(epoch from (greatest(${through}::timestamptz,g.production_updated_at)-g.production_updated_at))/3600)) as amount,
      coalesce(p.capacity,0) as capacity, p.rate_per_hour as production_per_hour,
      greatest(${through}::timestamptz,g.production_updated_at) as production_updated_at
    from garden_plots g join buildings b on b.world_id=g.world_id and b.id=g.building_id
    join building_level_production p on p.building_type_code=b.building_type and p.level=b.level and p.resource_code='carrot'
    where g.world_id=${worldId} and g.village_id=${villageId}
      ${cells?sql`and (g.cell_x,g.cell_y) in (select c."cellX",c."cellY"
        from jsonb_to_recordset(${JSON.stringify(cells)}::jsonb) as c("cellX" int,"cellY" int))`:sql``}
    order by g.cell_x,g.cell_y
  `.execute(transaction);
  return rows.map(row=>({...row,resourceCode:'carrot',amount:Number(row.amount),capacity:Number(row.capacity),productionPerHour:Number(row.productionPerHour)}));
}

export async function materializeGardenPlot(
  transaction: Transaction<Database>, worldId: string, cellX: number, cellY: number, through: Date,
): Promise<ProjectedGardenPlot> {
  await transaction.selectFrom('gardenPlots').select('cellX').where('worldId', '=', worldId)
    .where('cellX', '=', cellX).where('cellY', '=', cellY).forUpdate().executeTakeFirstOrThrow();
  const row = await gardenPlotState(transaction, worldId, cellX, cellY);
  const effectiveThrough = through > row.productionUpdatedAt ? through : row.productionUpdatedAt;
  const delta = await productionDelta(transaction, String(row.remainder), Number(row.ratePerHour), row.productionUpdatedAt, effectiveThrough);
  const capacity = Number(row.capacity ?? 0);
  const amount = Math.min(capacity, asNumber(row.storedAmount) + asNumber(delta.wholeUnits));
  await transaction.updateTable('gardenPlots').set({ storedAmount: amount,
    remainder: amount >= capacity ? '0' : delta.remainder, productionUpdatedAt: effectiveThrough })
    .where('worldId', '=', worldId).where('cellX', '=', cellX).where('cellY', '=', cellY).executeTakeFirstOrThrow();
  return { resourceCode: 'carrot', buildingId: row.buildingId, cellX, cellY, amount, capacity,
    productionPerHour: Number(row.ratePerHour), productionUpdatedAt: effectiveThrough };
}
