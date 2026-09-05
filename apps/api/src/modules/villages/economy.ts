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

interface ProductionDelta {
  wholeUnits: string;
  remainder: string;
}

function asNumber(value: string | number): number {
  return Number(value);
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
  const result = await transaction.selectFrom('villageResourceFlows')
    .leftJoin('buildings', (join) => join
      .onRef('buildings.worldId', '=', 'villageResourceFlows.worldId')
      .onRef('buildings.villageId', '=', 'villageResourceFlows.villageId')
      .on((builder) => builder.or([
        builder('buildings.status', '=', 'completed'),
        builder('buildings.targetLevel', 'is not', null),
      ])))
    .leftJoin('buildingTypes', (join) => join
      .onRef('buildingTypes.code', '=', 'buildings.buildingType')
      .on('buildingTypes.productionMode', '=', 'direct'))
    .leftJoin('buildingLevelProduction', (join) => join
      .onRef('buildingLevelProduction.buildingTypeCode', '=', 'buildings.buildingType')
      .onRef('buildingLevelProduction.level', '=', 'buildings.level')
      .onRef('buildingLevelProduction.resourceCode', '=', 'villageResourceFlows.resourceCode'))
    .select(sql<string>`village_resource_flows.base_rate_per_hour + coalesce(sum(building_level_production.rate_per_hour), 0)`.as('rate'))
    .where('villageResourceFlows.worldId', '=', worldId)
    .where('villageResourceFlows.villageId', '=', villageId)
    .where('villageResourceFlows.resourceCode', '=', resourceCode)
    .groupBy('villageResourceFlows.baseRatePerHour')
    .executeTakeFirst();
  return result ? asNumber(result.rate) : 0;
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

export async function materializeVillageResource(
  transaction: Transaction<Database>,
  worldId: string,
  villageId: string,
  resourceCode: string,
  through: Date,
): Promise<number> {
  // Callers that mutate village economy hold the village row before this flow.
  const flow = await transaction.selectFrom('villageResourceFlows')
    .select(['remainder', 'productionUpdatedAt'])
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .where('resourceCode', '=', resourceCode)
    .forUpdate()
    .executeTakeFirst();
  if (!flow) {
    const resource = await transaction.selectFrom('villageResources').select('amount')
      .where('worldId', '=', worldId).where('villageId', '=', villageId).where('resourceCode', '=', resourceCode)
      .forUpdate().executeTakeFirstOrThrow();
    return asNumber(resource.amount);
  }
  const rate = await villageProductionPerHour(transaction, worldId, villageId, resourceCode);
  const effectiveThrough = through.getTime() > flow.productionUpdatedAt.getTime() ? through : flow.productionUpdatedAt;
  const delta = await productionDelta(transaction, flow.remainder, rate, flow.productionUpdatedAt, effectiveThrough);
  const resource = await transaction.updateTable('villageResources')
    .set({ amount: sql`amount + ${delta.wholeUnits}::bigint` })
    .where('worldId', '=', worldId).where('villageId', '=', villageId).where('resourceCode', '=', resourceCode)
    .returning('amount').executeTakeFirstOrThrow();
  await transaction.updateTable('villageResourceFlows')
    .set({ remainder: delta.remainder, productionUpdatedAt: effectiveThrough })
    .where('worldId', '=', worldId).where('villageId', '=', villageId).where('resourceCode', '=', resourceCode)
    .executeTakeFirstOrThrow();
  return asNumber(resource.amount);
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
