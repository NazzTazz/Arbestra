import { sql, type Kysely, type Transaction } from 'kysely';
import type {
  BuildingType,
  BuildingTypeDefinition,
  VillageState,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import {
  normalizeCell,
  toroidalChebyshev,
  toroidalManhattan,
  wrappedDelta,
  worldCellKey,
} from '../worlds/coordinates.js';
import { TERRAIN } from '../worlds/generation.js';
import {
  COMPLETE_CONSTRUCTION_TASK,
  COMPLETE_EXPANSION_TASK,
  settleDueConstructionsForVillage,
  settleDueExpansionsForVillage,
} from './complete-construction.js';
import {
  materializeBuildingBuffer,
  materializeVillageResource,
  projectBuildingBuffer,
  projectVillageResource,
} from './economy.js';
import { normalizeSpatialSelection, scaledCosts, type SpatialCell } from './spatial-selection.js';

const CELL_SIZE = 2.5;
const SNAPSHOT_SIZE = 64;
const BUILD_RADIUS = 5;
interface OwnedVillage {
  worldId: string;
  worldSlug: string;
  worldName: string;
  topology: 'torus';
  widthCells: number;
  heightCells: number;
  chunkSize: number;
  seed: string;
  generationVersion: number;
  villageId: string;
  villageName: string;
  anchorCellX: number;
  anchorCellY: number;
}
const number = (value: string | number) => Number(value);

async function ownedVillage(
  tx: Transaction<Database>,
  accountId: string,
  worldSlug: string,
): Promise<OwnedVillage> {
  const row = await tx
    .selectFrom('villages')
    .innerJoin('worlds', 'worlds.id', 'villages.worldId')
    .innerJoin('worldMemberships', (join) =>
      join
        .onRef('worldMemberships.worldId', '=', 'worlds.id')
        .on('worldMemberships.accountId', '=', accountId),
    )
    .select([
      'worlds.id as worldId',
      'worlds.slug as worldSlug',
      'worlds.name as worldName',
      'worlds.topology',
      'worlds.widthCells',
      'worlds.heightCells',
      'worlds.chunkSize',
      'worlds.seed',
      'worlds.generationVersion',
      'villages.id as villageId',
      'villages.name as villageName',
      'villages.anchorCellX',
      'villages.anchorCellY',
    ])
    .where('worlds.slug', '=', worldSlug)
    .where('villages.ownerAccountId', '=', accountId)
    .executeTakeFirst();
  if (!row)
    throw new HttpError(
      404,
      'VILLAGE_NOT_FOUND',
      'Village introuvable dans ce monde.',
    );
  return row;
}
async function now(tx: Transaction<Database>) {
  return (
    await tx
      .selectNoFrom(sql<Date>`transaction_timestamp()`.as('now'))
      .executeTakeFirstOrThrow()
  ).now;
}

async function catalog(
  tx: Transaction<Database>,
): Promise<BuildingTypeDefinition[]> {
  const [types, levels, costs, production] = await Promise.all([
    tx.selectFrom('buildingTypes').selectAll().execute(),
    tx.selectFrom('buildingTypeLevels').selectAll().execute(),
    tx.selectFrom('buildingLevelCosts').selectAll().execute(),
    tx.selectFrom('buildingLevelProduction').selectAll().execute(),
  ]);
  return types.map((type) => ({
    code: type.code as BuildingType,
    displayName: type.displayName,
    progressionMode: type.progressionMode,
    productionMode: type.productionMode,
    instanceLimitPerVillage: type.instanceLimitPerVillage,
    visualKey: type.visualKey,
    buildable: type.buildable,
    levels: levels
      .filter((level) => level.buildingTypeCode === type.code)
      .map((level) => ({
        level: level.level,
        constructionDurationSeconds: level.constructionDurationSeconds,
        additionalCellsRequired: level.additionalCellsRequired,
        visualVariant: level.visualVariant,
        costs: costs
          .filter(
            (cost) =>
              cost.buildingTypeCode === type.code && cost.level === level.level,
          )
          .map((cost) => ({
            resourceCode: cost.resourceCode,
            amount: number(cost.amount),
          })),
        production: production
          .filter(
            (item) =>
              item.buildingTypeCode === type.code && item.level === level.level,
          )
          .map((item) => ({
            resourceCode: item.resourceCode,
            ratePerHour: number(item.ratePerHour),
            capacity: item.capacity === null ? null : number(item.capacity),
          })),
      })),
  }));
}

interface Snapshot {
  originCellX: number;
  originCellY: number;
  terrainCodes: number[];
  elevations: number[];
  terrainAt(x: number, y: number): number | undefined;
}
async function snapshot(
  tx: Transaction<Database>,
  village: OwnedVillage,
): Promise<Snapshot> {
  const originCellX = normalizeCell(
      village.anchorCellX - SNAPSHOT_SIZE / 2,
      village.widthCells,
    ),
    originCellY = normalizeCell(
      village.anchorCellY - SNAPSHOT_SIZE / 2,
      village.heightCells,
    );
  const wanted = new Map<string, { chunkX: number; chunkY: number }>();
  for (let y = 0; y < SNAPSHOT_SIZE; y += 1)
    for (let x = 0; x < SNAPSHOT_SIZE; x += 1) {
      const cx = normalizeCell(originCellX + x, village.widthCells),
        cy = normalizeCell(originCellY + y, village.heightCells),
        chunkX = Math.floor(cx / village.chunkSize),
        chunkY = Math.floor(cy / village.chunkSize);
      wanted.set(`${chunkX}:${chunkY}`, { chunkX, chunkY });
    }
  const chunks = await tx
    .selectFrom('worldChunks')
    .select(['chunkX', 'chunkY', 'terrainCodes', 'elevations'])
    .where('worldId', '=', village.worldId)
    .where((eb) =>
      eb.or(
        [...wanted.values()].map(({ chunkX, chunkY }) =>
          eb.and([eb('chunkX', '=', chunkX), eb('chunkY', '=', chunkY)]),
        ),
      ),
    )
    .execute();
  const byChunk = new Map(
    chunks.map((chunk) => [`${chunk.chunkX}:${chunk.chunkY}`, chunk]),
  );
  const terrainCodes: number[] = [];
  const elevations: number[] = [];
  for (let y = 0; y < SNAPSHOT_SIZE; y += 1)
    for (let x = 0; x < SNAPSHOT_SIZE; x += 1) {
      const cx = normalizeCell(originCellX + x, village.widthCells),
        cy = normalizeCell(originCellY + y, village.heightCells);
      const chunk = byChunk.get(
        `${Math.floor(cx / village.chunkSize)}:${Math.floor(cy / village.chunkSize)}`,
      );
      if (!chunk)
        throw new HttpError(
          409,
          'WORLD_NOT_READY',
          'Le terrain de ce monde est en préparation.',
        );
      const index =
        (cy % village.chunkSize) * village.chunkSize + (cx % village.chunkSize);
      terrainCodes.push(chunk.terrainCodes[index]!);
      elevations.push(chunk.elevations[index]!);
    }
  return {
    originCellX,
    originCellY,
    terrainCodes,
    elevations,
    terrainAt(cellX, cellY) {
      const x = wrappedDelta(cellX, originCellX, village.widthCells),
        y = wrappedDelta(cellY, originCellY, village.heightCells);
      return x >= 0 && y >= 0 && x < SNAPSHOT_SIZE && y < SNAPSHOT_SIZE
        ? terrainCodes[y * SNAPSHOT_SIZE + x]
        : undefined;
    },
  };
}

function candidates(
  footprints: Array<{ cellX: number; cellY: number }>,
  village: OwnedVillage,
) {
  const keys = new Set<string>();
  for (const footprint of footprints)
    for (let dy = -BUILD_RADIUS; dy <= BUILD_RADIUS; dy += 1)
      for (let dx = -BUILD_RADIUS; dx <= BUILD_RADIUS; dx += 1)
        keys.add(
          worldCellKey(
            normalizeCell(footprint.cellX + dx, village.widthCells),
            normalizeCell(footprint.cellY + dy, village.heightCells),
          ),
        );
  return keys;
}
function parseCellKey(key: string): [number, number] {
  const [rawX, rawY] = key.split(':');
  if (rawX === undefined || rawY === undefined)
    throw new Error(`Invalid cell key: ${key}`);
  return [Number(rawX), Number(rawY)];
}
async function clearings(tx: Transaction<Database>, worldId: string) {
  return tx
    .selectFrom('worldClearings')
    .select(['centerCellX', 'centerCellY', 'innerRadius'])
    .where('worldId', '=', worldId)
    .where('status', '=', 'protected')
    .execute();
}

async function featuresInSnapshot(
  tx: Transaction<Database>,
  village: OwnedVillage,
  ground: Snapshot,
) {
  let query = tx
    .selectFrom('worldCellOccupancies')
    .innerJoin('worldFeatures', (join) =>
      join
        .onRef('worldFeatures.id', '=', 'worldCellOccupancies.featureId')
        .onRef('worldFeatures.worldId', '=', 'worldCellOccupancies.worldId'),
    )
    .select([
      'worldFeatures.id',
      'worldFeatures.featureTypeCode',
      'worldFeatures.variantSeed',
      'worldCellOccupancies.cellX',
      'worldCellOccupancies.cellY',
    ])
    .where('worldCellOccupancies.worldId', '=', village.worldId);

  const endX = ground.originCellX + SNAPSHOT_SIZE;
  query =
    endX <= village.widthCells
      ? query
          .where('worldCellOccupancies.cellX', '>=', ground.originCellX)
          .where('worldCellOccupancies.cellX', '<', endX)
      : query.where((eb) =>
          eb.or([
            eb('worldCellOccupancies.cellX', '>=', ground.originCellX),
            eb('worldCellOccupancies.cellX', '<', endX - village.widthCells),
          ]),
        );

  const endY = ground.originCellY + SNAPSHOT_SIZE;
  query =
    endY <= village.heightCells
      ? query
          .where('worldCellOccupancies.cellY', '>=', ground.originCellY)
          .where('worldCellOccupancies.cellY', '<', endY)
      : query.where((eb) =>
          eb.or([
            eb('worldCellOccupancies.cellY', '>=', ground.originCellY),
            eb('worldCellOccupancies.cellY', '<', endY - village.heightCells),
          ]),
        );

  return query.execute();
}
function protectedCell(
  cellX: number,
  cellY: number,
  rows: Array<{
    centerCellX: number;
    centerCellY: number;
    innerRadius: number;
  }>,
  village: OwnedVillage,
) {
  return rows.some(
    (row) =>
      toroidalChebyshev(
        cellX,
        cellY,
        row.centerCellX,
        row.centerCellY,
        village.widthCells,
        village.heightCells,
      ) <= row.innerRadius,
  );
}

async function state(
  tx: Transaction<Database>,
  accountId: string,
  worldSlug: string,
): Promise<VillageState> {
  const village = await ownedVillage(tx, accountId, worldSlug);
  const at = await now(tx);
  await settleDueConstructionsForVillage(
    tx,
    village.worldId,
    village.villageId,
  );
  await settleDueExpansionsForVillage(tx, village.worldId, village.villageId);
  const [
    ground,
    resourcesRows,
    definitions,
    bufferRows,
    occupancyRows,
    protectedRows,
  ] = await Promise.all([
    snapshot(tx, village),
    tx
      .selectFrom('villageResources')
      .innerJoin(
        'resourceTypes',
        'resourceTypes.code',
        'villageResources.resourceCode',
      )
      .select([
        'villageResources.resourceCode',
        'resourceTypes.displayName',
        'resourceTypes.iconKey',
      ])
      .where('villageResources.worldId', '=', village.worldId)
      .where('villageResources.villageId', '=', village.villageId)
      .execute(),
    catalog(tx),
    tx
      .selectFrom('buildingResourceBuffers')
      .select(['buildingId', 'resourceCode'])
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId)
      .execute(),
    tx
      .selectFrom('worldCellOccupancies')
      .innerJoin('buildings', (join) =>
        join
          .onRef('buildings.id', '=', 'worldCellOccupancies.buildingId')
          .onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId'),
      )
      .select([
        'worldCellOccupancies.cellX',
        'worldCellOccupancies.cellY',
        'worldCellOccupancies.role',
        'worldCellOccupancies.pendingExpansionId',
        'buildings.id as buildingId',
        'buildings.buildingType',
        'buildings.level',
        'buildings.targetLevel',
        'buildings.status',
        'buildings.constructionStartedAt',
        'buildings.constructionCompletesAt',
        'buildings.completedAt',
      ])
      .where('worldCellOccupancies.worldId', '=', village.worldId)
      .where('buildings.villageId', '=', village.villageId)
      .execute(),
    clearings(tx, village.worldId),
  ]);
  const resources = await Promise.all(
    resourcesRows.map(async (row) => {
      const projected = await projectVillageResource(
        tx,
        village.worldId,
        village.villageId,
        row.resourceCode,
        at,
      );
      return {
        code: row.resourceCode,
        displayName: row.displayName,
        iconKey: row.iconKey,
        ...projected,
        productionUpdatedAt:
          projected.productionUpdatedAt?.toISOString() ?? null,
      };
    }),
  );
  const buffers = new Map<
    string,
    Awaited<ReturnType<typeof projectBuildingBuffer>>
  >();
  for (const row of bufferRows)
    buffers.set(
      `${row.buildingId}:${row.resourceCode}`,
      await projectBuildingBuffer(
        tx,
        village.worldId,
        row.buildingId,
        row.resourceCode,
        at,
      ),
    );
  const byBuilding = new Map<string, typeof occupancyRows>();
  for (const row of occupancyRows) {
    const rows = byBuilding.get(row.buildingId) ?? [];
    rows.push(row);
    byBuilding.set(row.buildingId, rows);
  }
  const expansionIds = [...new Set(occupancyRows.flatMap((row) => row.pendingExpansionId ? [row.pendingExpansionId] : []))];
  const expansions = expansionIds.length === 0 ? [] : await tx.selectFrom('buildingExpansions')
    .select(['id', 'startedAt', 'completesAt']).where('worldId', '=', village.worldId)
    .where('id', 'in', expansionIds).execute();
  const expansionById = new Map(expansions.map((item) => [item.id, item]));
  const available = candidates(
    occupancyRows
      .filter((row) => row.status === 'completed' && row.pendingExpansionId === null)
      .map((row) => ({ cellX: row.cellX, cellY: row.cellY })),
    village,
  );
  const occupied = new Map(
    occupancyRows.map((row) => [worldCellKey(row.cellX, row.cellY), row]),
  );
  const visible = new Set([...available, ...occupied.keys()]);
  const features = await featuresInSnapshot(tx, village, ground);
  const featureCells = new Set(
    features.map((feature) => worldCellKey(feature.cellX, feature.cellY)),
  );
  const wood = resources.find((item) => item.code === 'wood'),
    carrot = resources.find((item) => item.code === 'carrot');
  if (!wood || !carrot || !wood.productionUpdatedAt)
    throw new Error('Village resource seed is incomplete');
  return {
    serverTime: at.toISOString(),
    world: {
      id: village.worldId,
      slug: village.worldSlug,
      name: village.worldName,
      topology: village.topology,
      widthCells: village.widthCells,
      heightCells: village.heightCells,
      chunkSize: village.chunkSize,
      seed: village.seed,
      generationVersion: village.generationVersion,
    },
    village: {
      id: village.villageId,
      name: village.villageName,
      anchorCellX: village.anchorCellX,
      anchorCellY: village.anchorCellY,
      resources,
      wood: wood.amount,
      carrots: carrot.amount,
      woodProductionPerHour: wood.productionPerHour,
      woodProductionUpdatedAt: wood.productionUpdatedAt,
    },
    buildingTypes: definitions,
    region: {
      originCellX: ground.originCellX,
      originCellY: ground.originCellY,
      width: SNAPSHOT_SIZE,
      height: SNAPSHOT_SIZE,
      terrainCodes: ground.terrainCodes,
      elevations: ground.elevations,
      features: features.map((feature) => ({
        id: feature.id,
        type: feature.featureTypeCode,
        cellX: feature.cellX,
        cellY: feature.cellY,
        variantSeed: feature.variantSeed,
      })),
    },
    cells: [...visible]
      .map((key) => {
        const [cellX, cellY] = parseCellKey(key);
        const row = occupied.get(key),
          footprint = row ? (byBuilding.get(row.buildingId) ?? []) : [],
          activeCells = footprint.filter((item) => item.pendingExpansionId === null),
          pendingCells = footprint.filter((item) => item.pendingExpansionId !== null),
          expansion = pendingCells[0]?.pendingExpansionId
            ? expansionById.get(pendingCells[0].pendingExpansionId)
            : undefined,
          buffer = row ? buffers.get(`${row.buildingId}:carrot`) : undefined;
        return {
          id: key,
          cellX,
          cellY,
          x:
            wrappedDelta(cellX, village.anchorCellX, village.widthCells) *
            CELL_SIZE,
          z:
            wrappedDelta(cellY, village.anchorCellY, village.heightCells) *
            CELL_SIZE,
          building:
            row?.role === 'anchor'
              ? {
                  id: row.buildingId,
                  type: row.buildingType as BuildingType,
                  level: row.level,
                  targetLevel: row.targetLevel,
                  status: row.status,
                  constructionStartedAt:
                    row.constructionStartedAt?.toISOString() ?? null,
                  constructionCompletesAt:
                    row.constructionCompletesAt?.toISOString() ?? null,
                  completedAt: row.completedAt?.toISOString() ?? null,
                  garden: buffer
                    ? {
                        storedCarrots: buffer.amount,
                        capacity: buffer.capacity,
                        productionPerHour: buffer.productionPerHour,
                        productionUpdatedAt:
                          buffer.productionUpdatedAt.toISOString(),
                        activeCellCount: row.status === 'completed' ? activeCells.length : 0,
                        pendingCellCount: row.status === 'completed' ? pendingCells.length : footprint.length,
                        expansion: expansion ? {
                          id: expansion.id,
                          startedAt: expansion.startedAt.toISOString(),
                          completesAt: expansion.completesAt.toISOString(),
                          cells: pendingCells.map((item) => ({ cellX: item.cellX, cellY: item.cellY })),
                        } : null,
                      }
                    : null,
                }
              : null,
          footprint: row
            ? {
                buildingId: row.buildingId,
                buildingType: row.buildingType as BuildingType,
                role: row.role as 'anchor' | 'extension',
                state:
                  row.status === 'under-construction' || row.pendingExpansionId !== null
                    ? ('reserved' as const)
                    : ('active' as const),
              }
            : null,
          canBuild:
            available.has(key) &&
            !row &&
            !featureCells.has(key) &&
            ground.terrainAt(cellX, cellY) === TERRAIN.grassland &&
            !protectedCell(cellX, cellY, protectedRows, village),
        };
      })
      .filter((cell) => cell.canBuild || cell.footprint !== null),
  };
}

async function definition(
  tx: Transaction<Database>,
  buildingType: string,
  level: number,
) {
  const row = await tx
    .selectFrom('buildingTypes')
    .innerJoin(
      'buildingTypeLevels',
      'buildingTypeLevels.buildingTypeCode',
      'buildingTypes.code',
    )
    .select([
      'buildingTypes.code',
      'buildingTypes.buildable',
      'buildingTypes.productionMode',
      'buildingTypes.instanceLimitPerVillage',
      'buildingTypeLevels.additionalCellsRequired',
      'buildingTypeLevels.constructionDurationSeconds',
    ])
    .where('buildingTypes.code', '=', buildingType)
    .where('buildingTypeLevels.level', '=', level)
    .executeTakeFirst();
  if (!row)
    throw new HttpError(
      409,
      'BUILDING_LEVEL_UNKNOWN',
      'Ce niveau de bâtiment n’existe pas.',
    );
  const [costs, production] = await Promise.all([
    tx
      .selectFrom('buildingLevelCosts')
      .select(['resourceCode', 'amount'])
      .where('buildingTypeCode', '=', buildingType)
      .where('level', '=', level)
      .execute(),
    tx
      .selectFrom('buildingLevelProduction')
      .select(['resourceCode', 'ratePerHour', 'capacity'])
      .where('buildingTypeCode', '=', buildingType)
      .where('level', '=', level)
      .execute(),
  ]);
  return { ...row, costs, production };
}
async function debit(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  costs: Array<{ resourceCode: string; amount: string | number }>,
  at: Date,
) {
  for (const cost of costs) {
    const amount = number(cost.amount);
    if (
      (await materializeVillageResource(
        tx,
        worldId,
        villageId,
        cost.resourceCode,
        at,
      )) < amount
    )
      throw new HttpError(
        409,
        'INSUFFICIENT_RESOURCES',
        'Ressources insuffisantes.',
      );
    await tx
      .updateTable('villageResources')
      .set({ amount: sql`amount - ${amount}::bigint` })
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('resourceCode', '=', cost.resourceCode)
      .execute();
  }
}
async function assertBuildable(
  tx: Transaction<Database>,
  village: OwnedVillage,
  cellX: number,
  cellY: number,
) {
  const ground = await snapshot(tx, village);
  if (ground.terrainAt(cellX, cellY) !== TERRAIN.grassland)
    throw new HttpError(
      409,
      'TERRAIN_NOT_BUILDABLE',
      'Ce terrain ne peut pas accueillir de bâtiment.',
    );
  if (
    await tx
      .selectFrom('worldCellOccupancies')
      .select('role')
      .where('worldId', '=', village.worldId)
      .where('cellX', '=', cellX)
      .where('cellY', '=', cellY)
      .executeTakeFirst()
  )
    throw new HttpError(409, 'CELL_OCCUPIED', 'Cette case est déjà occupée.');
  if (
    protectedCell(cellX, cellY, await clearings(tx, village.worldId), village)
  )
    throw new HttpError(
      409,
      'CLEARING_PROTECTED',
      'Cette clairière est protégée.',
    );
  const footprints = await tx
    .selectFrom('worldCellOccupancies')
    .innerJoin('buildings', 'buildings.id', 'worldCellOccupancies.buildingId')
    .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY', 'worldCellOccupancies.pendingExpansionId'])
    .where('worldCellOccupancies.worldId', '=', village.worldId)
    .where('buildings.villageId', '=', village.villageId)
    .where('buildings.status', '=', 'completed')
    .execute();
  if (!candidates(footprints.filter((footprint) => footprint.pendingExpansionId === null), village).has(worldCellKey(cellX, cellY)))
    throw new HttpError(
      409,
      'OUTSIDE_VILLAGE_REACH',
      'Cette case est trop éloignée de votre village.',
    );
}
async function reserve(
  tx: Transaction<Database>,
  worldId: string,
  cellX: number,
  cellY: number,
  buildingId: string,
  role: 'anchor' | 'extension',
) {
  const row = await tx
    .insertInto('worldCellOccupancies')
    .values({ worldId, cellX, cellY, buildingId, featureId: null, role })
    .onConflict((conflict) =>
      conflict.columns(['worldId', 'cellX', 'cellY']).doNothing(),
    )
    .returning('cellX')
    .executeTakeFirst();
  if (!row)
    throw new HttpError(
      409,
      'CELL_OCCUPIED',
      'Cette case vient d’être réservée.',
    );
}

async function reserveSelection(
  tx: Transaction<Database>, worldId: string, buildingId: string,
  anchor: SpatialCell, cells: SpatialCell[], pendingExpansionId: string | null = null, initial = true,
) {
  for (const cell of cells) {
    const row = await tx.insertInto('worldCellOccupancies').values({
      worldId, cellX: cell.cellX, cellY: cell.cellY, buildingId, featureId: null,
      pendingExpansionId,
      role: initial && cell.cellX === anchor.cellX && cell.cellY === anchor.cellY ? 'anchor' : 'extension',
    }).onConflict((conflict) => conflict.columns(['worldId', 'cellX', 'cellY']).doNothing())
      .returning('cellX').executeTakeFirst();
    if (!row) throw new HttpError(409, 'CELL_OCCUPIED', 'Au moins une case vient d’être réservée.');
  }
}

export function getVillageState(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
) {
  return db.transaction().execute((tx) => state(tx, accountId, worldSlug));
}
export async function constructBuilding(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  cellX: number,
  cellY: number,
  buildingType: BuildingType,
  durationOverride: number | null,
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId)
      throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const x = normalizeCell(cellX, village.widthCells);
    const y = normalizeCell(cellY, village.heightCells);
    const at = await now(tx);
    await settleDueConstructionsForVillage(
      tx,
      village.worldId,
      village.villageId,
    );
    const item = await definition(tx, buildingType, 1);
    if (!item.buildable)
      throw new HttpError(
        409,
        'BUILDING_NOT_BUILDABLE',
        'Ce bâtiment ne peut pas être construit directement.',
      );
    if (item.instanceLimitPerVillage !== null) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`${village.worldId}:${village.villageId}:${buildingType}`}, 0))`.execute(
        tx,
      );
      const count = await tx
        .selectFrom('buildings')
        .select(sql<number>`count(*)::integer`.as('count'))
        .where('worldId', '=', village.worldId)
        .where('villageId', '=', village.villageId)
        .where('buildingType', '=', buildingType)
        .executeTakeFirstOrThrow();
      if (count.count >= item.instanceLimitPerVillage)
        throw new HttpError(
          409,
          'BUILDING_LIMIT_REACHED',
          'Limite atteinte pour ce bâtiment.',
        );
    }
    await assertBuildable(tx, village, x, y);
    await debit(tx, village.worldId, village.villageId, item.costs, at);
    const completesAt = new Date(
      at.getTime() +
        (durationOverride ?? item.constructionDurationSeconds * 1_000),
    );
    const building = await tx
      .insertInto('buildings')
      .values({
        worldId: village.worldId,
        villageId: village.villageId,
        buildingType,
        level: 1,
        targetLevel: null,
        status: 'under-construction',
        constructionStartedAt: at,
        constructionCompletesAt: completesAt,
        completedAt: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await reserve(tx, village.worldId, x, y, building.id, 'anchor');
    if (item.productionMode === 'buffered')
      await tx
        .insertInto('buildingResourceBuffers')
        .values(
          item.production.map((production) => ({
            worldId: village.worldId,
            villageId: village.villageId,
            buildingId: building.id,
            resourceCode: production.resourceCode,
            storedAmount: 0,
            remainder: 0,
            productionUpdatedAt: completesAt,
          })),
        )
        .execute();
    await tx
      .insertInto('scheduledTasks')
      .values({
        worldId: village.worldId,
        taskType: COMPLETE_CONSTRUCTION_TASK,
        subjectId: building.id,
        payload: {},
        dueAt: completesAt,
        availableAt: completesAt,
        lastError: null,
        completedAt: null,
      })
      .execute();
    return state(tx, accountId, worldSlug);
  });
}
/** Construct a spatial building in one atomic selection. Non-spatial buildings
 * are deliberately kept on the existing single-cell command path. */
export async function constructBuildingArea(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string,
  buildingType: BuildingType, anchor: SpatialCell, rawCells: SpatialCell[], durationOverride: number | null,
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const at = await now(tx);
    await settleDueConstructionsForVillage(tx, village.worldId, village.villageId);
    await settleDueExpansionsForVillage(tx, village.worldId, village.villageId);
    const item = await definition(tx, buildingType, 1);
    if (!item.buildable) throw new HttpError(409, 'BUILDING_NOT_BUILDABLE', 'Ce bâtiment ne peut pas être construit directement.');
    const selection = normalizeSpatialSelection(anchor, rawCells, village.widthCells, village.heightCells);
    if (item.code !== 'garden' && selection.cells.length !== 1)
      throw new HttpError(400, 'INVALID_BUILDING_FOOTPRINT', 'Ce bâtiment occupe exactement une case.');
    if (item.instanceLimitPerVillage !== null) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`${village.worldId}:${village.villageId}:${buildingType}`}, 0))`.execute(tx);
      const count = await tx.selectFrom('buildings').select(sql<number>`count(*)::integer`.as('count'))
        .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId)
        .where('buildingType', '=', buildingType).executeTakeFirstOrThrow();
      if (count.count >= item.instanceLimitPerVillage) throw new HttpError(409, 'BUILDING_LIMIT_REACHED', 'Limite atteinte pour ce bâtiment.');
    }
    for (const cell of selection.cells) await assertBuildable(tx, village, cell.cellX, cell.cellY);
    await debit(tx, village.worldId, village.villageId, scaledCosts(item.costs, item.code === 'garden' ? selection.cells.length : 1), at);
    const completesAt = new Date(at.getTime() + (durationOverride ?? item.constructionDurationSeconds * 1_000));
    const building = await tx.insertInto('buildings').values({
      worldId: village.worldId, villageId: village.villageId, buildingType, level: 1, targetLevel: null,
      status: 'under-construction', constructionStartedAt: at, constructionCompletesAt: completesAt, completedAt: null,
    }).returning('id').executeTakeFirstOrThrow();
    await reserveSelection(tx, village.worldId, building.id, selection.anchor, selection.cells);
    if (item.productionMode === 'buffered') await tx.insertInto('buildingResourceBuffers').values(item.production.map((production) => ({
      worldId: village.worldId, villageId: village.villageId, buildingId: building.id,
      resourceCode: production.resourceCode, storedAmount: 0, remainder: 0, productionUpdatedAt: completesAt,
    }))).execute();
    await tx.insertInto('scheduledTasks').values({
      worldId: village.worldId, taskType: COMPLETE_CONSTRUCTION_TASK, subjectId: building.id,
      payload: {}, dueAt: completesAt, availableAt: completesAt, lastError: null, completedAt: null,
    }).execute();
    return state(tx, accountId, worldSlug);
  });
}

export async function expandGarden(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string,
  buildingId: string, rawCells: SpatialCell[], durationOverride: number | null,
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const at = await now(tx);
    await settleDueConstructionsForVillage(tx, village.worldId, village.villageId);
    await settleDueExpansionsForVillage(tx, village.worldId, village.villageId);
    const building = await tx.selectFrom('buildings').selectAll().where('id', '=', buildingId)
      .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).forUpdate().executeTakeFirst();
    if (!building || building.buildingType !== 'garden') throw new HttpError(404, 'GARDEN_NOT_FOUND', 'Jardin introuvable.');
    if (building.status !== 'completed') throw new HttpError(409, 'BUILDING_BUSY', 'Le jardin est encore en chantier.');
    const pending = await tx.selectFrom('buildingExpansions').select('id').where('worldId', '=', village.worldId)
      .where('buildingId', '=', building.id).where('status', '=', 'under-construction').executeTakeFirst();
    if (pending) throw new HttpError(409, 'BUILDING_BUSY', 'Le jardin possède déjà une extension en chantier.');
    const activeCells = await tx.selectFrom('worldCellOccupancies').select(['cellX', 'cellY'])
      .where('worldId', '=', village.worldId).where('buildingId', '=', building.id)
      .where('pendingExpansionId', 'is', null).execute();
    const selection = normalizeSpatialSelection(rawCells[0]!, rawCells, village.widthCells, village.heightCells);
    for (const cell of selection.cells) {
      await assertBuildable(tx, village, cell.cellX, cell.cellY);
    }
    if (!selection.cells.some((cell) => activeCells.some((active) =>
      toroidalManhattan(active.cellX, active.cellY, cell.cellX, cell.cellY, village.widthCells, village.heightCells) === 1,
    ))) throw new HttpError(409, 'INVALID_BUILDING_EXTENSION', 'L’extension doit toucher le jardin actif.');
    const item = await definition(tx, 'garden', 1);
    await materializeBuildingBuffer(tx, village.worldId, building.id, 'carrot', at);
    await debit(tx, village.worldId, village.villageId, scaledCosts(item.costs, selection.cells.length), at);
    const completesAt = new Date(at.getTime() + (durationOverride ?? item.constructionDurationSeconds * 1_000));
    const expansion = await tx.insertInto('buildingExpansions').values({
      worldId: village.worldId, villageId: village.villageId, buildingId: building.id,
      status: 'under-construction', startedAt: at, completesAt, completedAt: null,
    }).returning('id').executeTakeFirstOrThrow();
    await reserveSelection(tx, village.worldId, building.id, selection.anchor, selection.cells, expansion.id, false);
    await tx.insertInto('scheduledTasks').values({
      worldId: village.worldId, taskType: COMPLETE_EXPANSION_TASK, subjectId: expansion.id,
      payload: {}, dueAt: completesAt, availableAt: completesAt, lastError: null, completedAt: null,
    }).execute();
    return state(tx, accountId, worldSlug);
  });
}

export async function upgradeBuilding(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
  extensionCellX: number | undefined,
  extensionCellY: number | undefined,
  durationOverride: number | null,
): Promise<VillageState> {
  // Compatibility for saved clients/tests from the old single-cell Garden UX.
  // The HTTP API uses /expansions; both paths now create the same expansion.
  if (extensionCellX !== undefined && extensionCellY !== undefined)
    return expandGarden(db, accountId, worldSlug, villageId, buildingId,
      [{ cellX: extensionCellX, cellY: extensionCellY }], durationOverride);
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId)
      throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const at = await now(tx);
    await settleDueConstructionsForVillage(
      tx,
      village.worldId,
      village.villageId,
    );
    const building = await tx
      .selectFrom('buildings')
      .innerJoin('worldCellOccupancies', (join) =>
        join
          .onRef('worldCellOccupancies.buildingId', '=', 'buildings.id')
          .on('worldCellOccupancies.role', '=', 'anchor'),
      )
      .select([
        'buildings.id',
        'buildings.buildingType',
        'buildings.level',
        'buildings.status',
        'worldCellOccupancies.cellX',
        'worldCellOccupancies.cellY',
      ])
      .where('buildings.id', '=', buildingId)
      .where('buildings.worldId', '=', village.worldId)
      .where('buildings.villageId', '=', village.villageId)
      .forUpdate()
      .executeTakeFirst();
    if (!building)
      throw new HttpError(404, 'BUILDING_NOT_FOUND', 'Bâtiment introuvable.');
    if (building.buildingType === 'garden')
      throw new HttpError(409, 'SPATIAL_BUILDING', 'Étendez le jardin avec sa sélection de terrain.');
    if (building.status !== 'completed')
      throw new HttpError(
        409,
        'BUILDING_BUSY',
        'Ce bâtiment est déjà en chantier.',
      );
    const item = await definition(
      tx,
      building.buildingType,
      building.level + 1,
    );
    if (item.additionalCellsRequired === 1) {
      if (extensionCellX === undefined || extensionCellY === undefined)
        throw new HttpError(
          400,
          'EXTENSION_CELL_REQUIRED',
          'Choisissez une case pour étendre le bâtiment.',
        );
      const x = normalizeCell(extensionCellX, village.widthCells);
      const y = normalizeCell(extensionCellY, village.heightCells);
      if (
        toroidalManhattan(
          x,
          y,
          building.cellX,
          building.cellY,
          village.widthCells,
          village.heightCells,
        ) !== 1
      )
        throw new HttpError(
          409,
          'INVALID_BUILDING_EXTENSION',
          'Cette case ne peut pas accueillir l’extension.',
        );
      await assertBuildable(tx, village, x, y);
      await debit(tx, village.worldId, village.villageId, item.costs, at);
      await reserve(tx, village.worldId, x, y, building.id, 'extension');
    } else {
      if (extensionCellX !== undefined || extensionCellY !== undefined)
        throw new HttpError(
          400,
          'UNEXPECTED_EXTENSION_CELL',
          'Cette amélioration ne requiert pas de case.',
        );
      await debit(tx, village.worldId, village.villageId, item.costs, at);
    }
    const completesAt = new Date(
      at.getTime() +
        (durationOverride ?? item.constructionDurationSeconds * 1_000),
    );
    await tx
      .updateTable('buildings')
      .set({
        status: 'under-construction',
        targetLevel: building.level + 1,
        constructionStartedAt: at,
        constructionCompletesAt: completesAt,
        completedAt: null,
      })
      .where('id', '=', building.id)
      .execute();
    await tx
      .insertInto('scheduledTasks')
      .values({
        worldId: village.worldId,
        taskType: COMPLETE_CONSTRUCTION_TASK,
        subjectId: building.id,
        payload: {},
        dueAt: completesAt,
        availableAt: completesAt,
        lastError: null,
        completedAt: null,
      })
      .execute();
    return state(tx, accountId, worldSlug);
  });
}
export async function harvestGarden(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId)
      throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const at = await now(tx);
    await settleDueConstructionsForVillage(
      tx,
      village.worldId,
      village.villageId,
    );
    // Settle rate/capacity changes before moving the buffer's clock to now.
    await settleDueExpansionsForVillage(tx, village.worldId, village.villageId);
    const building = await tx
      .selectFrom('buildings')
      .innerJoin(
        'buildingTypes',
        'buildingTypes.code',
        'buildings.buildingType',
      )
      .select([
        'buildings.id',
        'buildings.status',
        'buildings.targetLevel',
        'buildingTypes.productionMode',
      ])
      .where('buildings.id', '=', buildingId)
      .where('buildings.worldId', '=', village.worldId)
      .where('buildings.villageId', '=', village.villageId)
      .forUpdate()
      .executeTakeFirst();
    if (!building || building.productionMode !== 'buffered')
      throw new HttpError(
        404,
        'BUFFERED_BUILDING_NOT_FOUND',
        'Bâtiment récoltable introuvable.',
      );
    if (building.status !== 'completed' && building.targetLevel === null)
      throw new HttpError(
        409,
        'BUILDING_NOT_READY',
        'Le bâtiment est encore en chantier.',
      );
    const buffers = await tx
      .selectFrom('buildingResourceBuffers')
      .select('resourceCode')
      .where('worldId', '=', village.worldId)
      .where('buildingId', '=', building.id)
      .execute();
    for (const buffer of buffers) {
      const amount = await materializeBuildingBuffer(
        tx,
        village.worldId,
        building.id,
        buffer.resourceCode,
        at,
      );
      await tx
        .updateTable('villageResources')
        .set({ amount: sql`amount + ${amount.amount}::bigint` })
        .where('worldId', '=', village.worldId)
        .where('villageId', '=', village.villageId)
        .where('resourceCode', '=', buffer.resourceCode)
        .execute();
      await tx
        .updateTable('buildingResourceBuffers')
        .set({ storedAmount: 0, productionUpdatedAt: at })
        .where('worldId', '=', village.worldId)
        .where('buildingId', '=', building.id)
        .where('resourceCode', '=', buffer.resourceCode)
        .execute();
    }
    return state(tx, accountId, worldSlug);
  });
}
