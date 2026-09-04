import { sql, type Kysely, type Transaction } from 'kysely';

import type { BuildingType, BuildingTypeDefinition, VillageState } from '@arbestra/contracts';

import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { COMPLETE_CONSTRUCTION_TASK, settleDueConstructionsForVillage } from './complete-construction.js';
import { materializeBuildingBuffer, materializeVillageResource, projectBuildingBuffer, projectVillageResource } from './economy.js';

const CELL_SIZE = 2.5;

interface OwnedVillage {
  worldId: string;
  worldSlug: string;
  worldName: string;
  topology: 'torus';
  widthCells: number;
  heightCells: number;
  chunkSize: number;
  seed: string;
  villageId: string;
  villageName: string;
  anchorCellX: number;
  anchorCellY: number;
}

function asNumber(value: string | number): number {
  return Number(value);
}

function wrappedDelta(value: number, origin: number, size: number): number {
  const direct = value - origin;
  if (direct > size / 2) return direct - size;
  if (direct < -size / 2) return direct + size;
  return direct;
}

function toroidalManhattan(aX: number, aY: number, bX: number, bY: number, width: number, height: number): number {
  return Math.abs(wrappedDelta(aX, bX, width)) + Math.abs(wrappedDelta(aY, bY, height));
}

async function ownedVillage(
  transaction: Transaction<Database>, accountId: string, worldSlug: string,
): Promise<OwnedVillage> {
  const village = await transaction.selectFrom('villages')
    .innerJoin('worlds', 'worlds.id', 'villages.worldId')
    .innerJoin('worldMemberships', (join) => join
      .onRef('worldMemberships.worldId', '=', 'worlds.id')
      .on('worldMemberships.accountId', '=', accountId))
    .select([
      'worlds.id as worldId', 'worlds.slug as worldSlug', 'worlds.name as worldName', 'worlds.topology',
      'worlds.widthCells', 'worlds.heightCells', 'worlds.chunkSize', 'worlds.seed',
      'villages.id as villageId', 'villages.name as villageName', 'villages.anchorCellX', 'villages.anchorCellY',
    ])
    .where('worlds.slug', '=', worldSlug)
    .where('villages.ownerAccountId', '=', accountId)
    .executeTakeFirst();
  if (!village) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable dans ce monde.');
  return village;
}

async function serverTime(transaction: Transaction<Database>): Promise<Date> {
  return (await transaction.selectNoFrom(sql<Date>`transaction_timestamp()`.as('now')).executeTakeFirstOrThrow()).now;
}

async function buildingCatalog(transaction: Transaction<Database>): Promise<BuildingTypeDefinition[]> {
  const [types, levels, costs, production] = await Promise.all([
    transaction.selectFrom('buildingTypes').selectAll().orderBy('code').execute(),
    transaction.selectFrom('buildingTypeLevels').selectAll().orderBy('buildingTypeCode').orderBy('level').execute(),
    transaction.selectFrom('buildingLevelCosts').selectAll().orderBy('buildingTypeCode').orderBy('level').orderBy('resourceCode').execute(),
    transaction.selectFrom('buildingLevelProduction').selectAll().orderBy('buildingTypeCode').orderBy('level').orderBy('resourceCode').execute(),
  ]);
  return types.map((type) => ({
    code: type.code as BuildingType,
    displayName: type.displayName,
    progressionMode: type.progressionMode,
    productionMode: type.productionMode,
    instanceLimitPerVillage: type.instanceLimitPerVillage,
    visualKey: type.visualKey,
    buildable: type.buildable,
    levels: levels.filter((level) => level.buildingTypeCode === type.code).map((level) => ({
      level: level.level,
      constructionDurationSeconds: level.constructionDurationSeconds,
      additionalCellsRequired: level.additionalCellsRequired,
      visualVariant: level.visualVariant,
      costs: costs.filter((cost) => cost.buildingTypeCode === type.code && cost.level === level.level)
        .map((cost) => ({ resourceCode: cost.resourceCode, amount: asNumber(cost.amount) })),
      production: production.filter((item) => item.buildingTypeCode === type.code && item.level === level.level)
        .map((item) => ({ resourceCode: item.resourceCode, ratePerHour: asNumber(item.ratePerHour), capacity: item.capacity === null ? null : asNumber(item.capacity) })),
    })),
  }));
}

async function readVillageState(
  transaction: Transaction<Database>, accountId: string, worldSlug: string,
): Promise<VillageState> {
  const village = await ownedVillage(transaction, accountId, worldSlug);
  const now = await serverTime(transaction);
  await settleDueConstructionsForVillage(transaction, village.worldId, village.villageId);

  const [resourceRows, catalog, buffers, cells, footprints] = await Promise.all([
    transaction.selectFrom('villageResources').innerJoin('resourceTypes', 'resourceTypes.code', 'villageResources.resourceCode')
      .select(['villageResources.resourceCode', 'resourceTypes.displayName', 'resourceTypes.iconKey'])
      .where('villageResources.worldId', '=', village.worldId).where('villageResources.villageId', '=', village.villageId)
      .orderBy('villageResources.resourceCode').execute(),
    buildingCatalog(transaction),
    transaction.selectFrom('buildingResourceBuffers').select(['buildingId', 'resourceCode'])
      .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).execute(),
    transaction.selectFrom('villageCells')
      .leftJoin('buildings', (join) => join
        .onRef('buildings.anchorCellId', '=', 'villageCells.id')
        .onRef('buildings.worldId', '=', 'villageCells.worldId'))
      .select([
        'villageCells.id as siteId', 'villageCells.cellX', 'villageCells.cellY',
        'buildings.id as buildingId', 'buildings.buildingType', 'buildings.level', 'buildings.targetLevel',
        'buildings.status', 'buildings.constructionStartedAt', 'buildings.constructionCompletesAt', 'buildings.completedAt',
      ])
      .where('villageCells.worldId', '=', village.worldId).where('villageCells.villageId', '=', village.villageId)
      .orderBy('villageCells.cellX').orderBy('villageCells.cellY').execute(),
    transaction.selectFrom('buildingCells').innerJoin('buildings', (join) => join
      .onRef('buildings.id', '=', 'buildingCells.buildingId').onRef('buildings.worldId', '=', 'buildingCells.worldId'))
      .select(['buildingCells.cellId', 'buildingCells.buildingId', 'buildingCells.role', 'buildings.buildingType', 'buildings.status', 'buildings.targetLevel'])
      .where('buildingCells.worldId', '=', village.worldId).where('buildingCells.villageId', '=', village.villageId).execute(),
  ]);

  const resources = await Promise.all(resourceRows.map(async (resource) => {
    const projected = await projectVillageResource(transaction, village.worldId, village.villageId, resource.resourceCode, now);
    return { code: resource.resourceCode, displayName: resource.displayName, iconKey: resource.iconKey, ...projected,
      productionUpdatedAt: projected.productionUpdatedAt?.toISOString() ?? null };
  }));
  const projectedBuffers = new Map<string, Awaited<ReturnType<typeof projectBuildingBuffer>>>();
  for (const buffer of buffers) {
    projectedBuffers.set(`${buffer.buildingId}:${buffer.resourceCode}`,
      await projectBuildingBuffer(transaction, village.worldId, buffer.buildingId, buffer.resourceCode, now));
  }
  const footprintsByCell = new Map(footprints.map((footprint) => [footprint.cellId, footprint]));
  const footprintByBuilding = new Map<string, typeof footprints>();
  for (const footprint of footprints) {
    const list = footprintByBuilding.get(footprint.buildingId) ?? [];
    list.push(footprint);
    footprintByBuilding.set(footprint.buildingId, list);
  }
  const wood = resources.find((resource) => resource.code === 'wood');
  const carrot = resources.find((resource) => resource.code === 'carrot');
  if (!wood || !carrot || !wood.productionUpdatedAt) throw new Error('Village resource seed is incomplete');

  return {
    serverTime: now.toISOString(),
    world: {
      id: village.worldId, slug: village.worldSlug, name: village.worldName, topology: village.topology,
      widthCells: village.widthCells, heightCells: village.heightCells, chunkSize: village.chunkSize, seed: village.seed,
    },
    village: {
      id: village.villageId, name: village.villageName, anchorCellX: village.anchorCellX, anchorCellY: village.anchorCellY,
      resources, wood: wood.amount, carrots: carrot.amount,
      woodProductionPerHour: wood.productionPerHour, woodProductionUpdatedAt: wood.productionUpdatedAt,
    },
    buildingTypes: catalog,
    cells: cells.map((cell) => {
      const footprint = footprintsByCell.get(cell.siteId);
      const gardenBuffer = cell.buildingId ? projectedBuffers.get(`${cell.buildingId}:carrot`) : undefined;
      const buildingFootprint = cell.buildingId ? footprintByBuilding.get(cell.buildingId) ?? [] : [];
      const extension = buildingFootprint.find((item) => item.role === 'extension');
      const isUpgrade = cell.status === 'under-construction' && cell.targetLevel !== null;
      return {
        id: cell.siteId,
        cellX: cell.cellX,
        cellY: cell.cellY,
        x: wrappedDelta(cell.cellX, village.anchorCellX, village.widthCells) * CELL_SIZE,
        z: wrappedDelta(cell.cellY, village.anchorCellY, village.heightCells) * CELL_SIZE,
        building: cell.buildingId && cell.buildingType && cell.level !== null && cell.status
          ? {
              id: cell.buildingId, type: cell.buildingType as BuildingType, level: cell.level,
              targetLevel: cell.targetLevel, status: cell.status,
              constructionStartedAt: cell.constructionStartedAt?.toISOString() ?? null,
              constructionCompletesAt: cell.constructionCompletesAt?.toISOString() ?? null,
              completedAt: cell.completedAt?.toISOString() ?? null,
              garden: gardenBuffer ? {
                storedCarrots: gardenBuffer.amount, capacity: gardenBuffer.capacity,
                productionPerHour: gardenBuffer.productionPerHour,
                productionUpdatedAt: gardenBuffer.productionUpdatedAt.toISOString(),
                extensionCellId: extension && !isUpgrade ? extension.cellId : null,
                pendingExtensionCellId: extension && isUpgrade ? extension.cellId : null,
              } : null,
            }
          : null,
        footprint: footprint ? {
          buildingId: footprint.buildingId,
          buildingType: footprint.buildingType as BuildingType,
          role: footprint.role,
          state: footprint.status === 'under-construction' && footprint.targetLevel !== null && footprint.role === 'extension'
            ? 'reserved' as const : 'active' as const,
        } : null,
        canBuild: !footprint,
      };
    }),
  };
}

async function buildingDefinition(transaction: Transaction<Database>, buildingType: string, level: number) {
  const definition = await transaction.selectFrom('buildingTypes')
    .innerJoin('buildingTypeLevels', 'buildingTypeLevels.buildingTypeCode', 'buildingTypes.code')
    .select([
      'buildingTypes.code', 'buildingTypes.buildable', 'buildingTypes.productionMode',
      'buildingTypes.instanceLimitPerVillage', 'buildingTypes.progressionMode',
      'buildingTypeLevels.level', 'buildingTypeLevels.additionalCellsRequired', 'buildingTypeLevels.constructionDurationSeconds',
    ])
    .where('buildingTypes.code', '=', buildingType).where('buildingTypeLevels.level', '=', level).executeTakeFirst();
  if (!definition) throw new HttpError(409, 'BUILDING_LEVEL_UNKNOWN', 'Ce niveau de bâtiment n’existe pas.');
  const [costs, production] = await Promise.all([
    transaction.selectFrom('buildingLevelCosts').select(['resourceCode', 'amount'])
      .where('buildingTypeCode', '=', buildingType).where('level', '=', level).orderBy('resourceCode').execute(),
    transaction.selectFrom('buildingLevelProduction').select(['resourceCode', 'ratePerHour', 'capacity'])
      .where('buildingTypeCode', '=', buildingType).where('level', '=', level).orderBy('resourceCode').execute(),
  ]);
  return { ...definition, costs, production };
}

async function debitCosts(
  transaction: Transaction<Database>, worldId: string, villageId: string,
  costs: Array<{ resourceCode: string; amount: string }>, now: Date,
): Promise<void> {
  for (const cost of costs) {
    const available = await materializeVillageResource(transaction, worldId, villageId, cost.resourceCode, now);
    const amount = asNumber(cost.amount);
    if (available < amount) throw new HttpError(409, 'INSUFFICIENT_RESOURCES', 'Ressources insuffisantes.');
    await transaction.updateTable('villageResources').set({ amount: sql`amount - ${amount}::bigint` })
      .where('worldId', '=', worldId).where('villageId', '=', villageId).where('resourceCode', '=', cost.resourceCode)
      .executeTakeFirstOrThrow();
  }
}

async function lockFreeCell(
  transaction: Transaction<Database>, worldId: string, villageId: string, cellId: string,
) {
  const cell = await transaction.selectFrom('villageCells').select(['id', 'cellX', 'cellY'])
    .where('id', '=', cellId).where('worldId', '=', worldId).where('villageId', '=', villageId)
    .forUpdate().executeTakeFirst();
  if (!cell) throw new HttpError(404, 'BUILDING_SITE_NOT_FOUND', 'Emplacement introuvable.');
  const occupied = await transaction.selectFrom('buildingCells').select('buildingId')
    .where('worldId', '=', worldId).where('cellId', '=', cell.id).executeTakeFirst();
  if (occupied) throw new HttpError(409, 'SITE_OCCUPIED', 'Cet emplacement est déjà occupé.');
  return cell;
}

export function getVillageState(db: Kysely<Database>, accountId: string, worldSlug: string): Promise<VillageState> {
  return db.transaction().execute((transaction) => readVillageState(transaction, accountId, worldSlug));
}

export async function constructBuilding(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, cellId: string,
  buildingType: BuildingType, constructionDurationOverrideMs: number | null,
): Promise<VillageState> {
  return db.transaction().execute(async (transaction) => {
    const village = await ownedVillage(transaction, accountId, worldSlug);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const now = await serverTime(transaction);
    await settleDueConstructionsForVillage(transaction, village.worldId, village.villageId);
    const definition = await buildingDefinition(transaction, buildingType, 1);
    if (!definition.buildable) throw new HttpError(409, 'BUILDING_NOT_BUILDABLE', 'Ce bâtiment ne peut pas être construit directement.');
    if (definition.instanceLimitPerVillage !== null) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`${village.worldId}:${village.villageId}:${buildingType}`}, 0))`.execute(transaction);
      const count = await transaction.selectFrom('buildings').select(sql<number>`count(*)::integer`.as('count'))
        .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId)
        .where('buildingType', '=', buildingType).executeTakeFirstOrThrow();
      if (count.count >= definition.instanceLimitPerVillage) throw new HttpError(409, 'BUILDING_LIMIT_REACHED', 'Limite atteinte pour ce bâtiment.');
    }
    await debitCosts(transaction, village.worldId, village.villageId, definition.costs, now);
    const cell = await lockFreeCell(transaction, village.worldId, village.villageId, cellId);
    const durationMs = constructionDurationOverrideMs ?? definition.constructionDurationSeconds * 1_000;
    const completesAt = new Date(now.getTime() + durationMs);
    const building = await transaction.insertInto('buildings').values({
      worldId: village.worldId, villageId: village.villageId, anchorCellId: cell.id, buildingType,
      level: 1, targetLevel: null, status: 'under-construction', constructionStartedAt: now,
      constructionCompletesAt: completesAt, completedAt: null,
    }).returning('id').executeTakeFirstOrThrow();
    await transaction.insertInto('buildingCells').values({
      worldId: village.worldId, villageId: village.villageId, buildingId: building.id, cellId: cell.id, role: 'anchor',
    }).execute();
    if (definition.productionMode === 'buffered') {
      await transaction.insertInto('buildingResourceBuffers').values(definition.production.map((production) => ({
        worldId: village.worldId, villageId: village.villageId, buildingId: building.id,
        resourceCode: production.resourceCode, storedAmount: 0, remainder: 0, productionUpdatedAt: completesAt,
      }))).execute();
    }
    await transaction.insertInto('scheduledTasks').values({
      worldId: village.worldId, taskType: COMPLETE_CONSTRUCTION_TASK, subjectId: building.id,
      payload: {}, dueAt: completesAt, availableAt: completesAt, lastError: null, completedAt: null,
    }).execute();
    return readVillageState(transaction, accountId, worldSlug);
  });
}

export async function upgradeBuilding(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, buildingId: string,
  extensionCellId: string | undefined, constructionDurationOverrideMs: number | null,
): Promise<VillageState> {
  return db.transaction().execute(async (transaction) => {
    const village = await ownedVillage(transaction, accountId, worldSlug);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const now = await serverTime(transaction);
    await settleDueConstructionsForVillage(transaction, village.worldId, village.villageId);
    const building = await transaction.selectFrom('buildings').innerJoin('villageCells', 'villageCells.id', 'buildings.anchorCellId')
      .select(['buildings.id', 'buildings.buildingType', 'buildings.level', 'buildings.status', 'villageCells.cellX', 'villageCells.cellY'])
      .where('buildings.id', '=', buildingId).where('buildings.worldId', '=', village.worldId)
      .where('buildings.villageId', '=', village.villageId).forUpdate().executeTakeFirst();
    if (!building) throw new HttpError(404, 'BUILDING_NOT_FOUND', 'Bâtiment introuvable.');
    if (building.status !== 'completed') throw new HttpError(409, 'BUILDING_BUSY', 'Ce bâtiment est déjà en chantier.');
    const definition = await buildingDefinition(transaction, building.buildingType, building.level + 1);
    await debitCosts(transaction, village.worldId, village.villageId, definition.costs, now);

    if (definition.additionalCellsRequired === 1) {
      if (!extensionCellId) throw new HttpError(400, 'EXTENSION_CELL_REQUIRED', 'Choisissez une case pour étendre le bâtiment.');
      const extension = await lockFreeCell(transaction, village.worldId, village.villageId, extensionCellId);
      if (toroidalManhattan(extension.cellX, extension.cellY, building.cellX, building.cellY, village.widthCells, village.heightCells) !== 1) {
        throw new HttpError(409, 'INVALID_BUILDING_EXTENSION', 'Cette case ne peut pas accueillir l’extension.');
      }
      await transaction.insertInto('buildingCells').values({
        worldId: village.worldId, villageId: village.villageId, buildingId: building.id,
        cellId: extension.id, role: 'extension',
      }).execute();
    } else if (definition.additionalCellsRequired !== 0) {
      throw new HttpError(409, 'UNSUPPORTED_FOOTPRINT', 'Cette forme de bâtiment n’est pas encore prise en charge.');
    } else if (extensionCellId) {
      throw new HttpError(400, 'UNEXPECTED_EXTENSION_CELL', 'Cette amélioration ne requiert pas de case.');
    }

    const durationMs = constructionDurationOverrideMs ?? definition.constructionDurationSeconds * 1_000;
    const completesAt = new Date(now.getTime() + durationMs);
    await transaction.updateTable('buildings').set({
      status: 'under-construction', targetLevel: building.level + 1, constructionStartedAt: now,
      constructionCompletesAt: completesAt, completedAt: null,
    }).where('id', '=', building.id).executeTakeFirstOrThrow();
    await transaction.insertInto('scheduledTasks').values({
      worldId: village.worldId, taskType: COMPLETE_CONSTRUCTION_TASK, subjectId: building.id,
      payload: {}, dueAt: completesAt, availableAt: completesAt, lastError: null, completedAt: null,
    }).execute();
    return readVillageState(transaction, accountId, worldSlug);
  });
}

export async function harvestGarden(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, buildingId: string,
): Promise<VillageState> {
  return db.transaction().execute(async (transaction) => {
    const village = await ownedVillage(transaction, accountId, worldSlug);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const now = await serverTime(transaction);
    await settleDueConstructionsForVillage(transaction, village.worldId, village.villageId);
    const building = await transaction.selectFrom('buildings').innerJoin('buildingTypes', 'buildingTypes.code', 'buildings.buildingType')
      .select(['buildings.id', 'buildings.status', 'buildings.targetLevel', 'buildingTypes.productionMode'])
      .where('buildings.id', '=', buildingId).where('buildings.worldId', '=', village.worldId)
      .where('buildings.villageId', '=', village.villageId).forUpdate().executeTakeFirst();
    if (!building || building.productionMode !== 'buffered') throw new HttpError(404, 'BUFFERED_BUILDING_NOT_FOUND', 'Bâtiment récoltable introuvable.');
    if (building.status !== 'completed' && building.targetLevel === null) throw new HttpError(409, 'BUILDING_NOT_READY', 'Le bâtiment est encore en chantier.');
    const buffers = await transaction.selectFrom('buildingResourceBuffers').select('resourceCode')
      .where('worldId', '=', village.worldId).where('buildingId', '=', building.id).orderBy('resourceCode').execute();
    for (const row of buffers) {
      const buffer = await materializeBuildingBuffer(transaction, village.worldId, building.id, row.resourceCode, now);
      await transaction.updateTable('villageResources').set({ amount: sql`amount + ${buffer.amount}::bigint` })
        .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).where('resourceCode', '=', row.resourceCode)
        .executeTakeFirstOrThrow();
      await transaction.updateTable('buildingResourceBuffers').set({ storedAmount: 0, productionUpdatedAt: now })
        .where('worldId', '=', village.worldId).where('buildingId', '=', building.id).where('resourceCode', '=', row.resourceCode).execute();
    }
    return readVillageState(transaction, accountId, worldSlug);
  });
}
