import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type {
  BuildingType,
  BuildingTypeDefinition,
  VillageState,
  ExtractionResponse,
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
} from './complete-construction.js';
import {
  materializeVillageResource,
  projectGardenPlot,
  projectVillageResource,
} from './economy.js';
import { beginVillageEconomy, reconcileVillageEconomy, type VillageEconomy } from './reconcile-economy.js';
import { normalizeSpatialSelection, scaledCosts, type SpatialCell } from './spatial-selection.js';
import { advanceEnergy, beginRest, displayedEnergy, feedEnergy, type EnergyState } from '../population/energy.js';
import { startGardenHarvest } from '../population/garden-harvest.js';
import { materializeCohorts, withoutAssignment } from '../population/work.js';
import { startStoneExtraction, stoneDepositDetails, readExtraction, readStoneDeposit, safeAmount } from '../deposits/stone-extractions.js';

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
    .selectFrom('worldFeatures')
    .leftJoin('worldCellOccupancies', (join) => join
      .onRef('worldCellOccupancies.featureId', '=', 'worldFeatures.id')
      .onRef('worldCellOccupancies.worldId', '=', 'worldFeatures.worldId'))
    .leftJoin('stoneDeposits', (join) => join
      .onRef('stoneDeposits.featureId', '=', 'worldFeatures.id')
      .onRef('stoneDeposits.worldId', '=', 'worldFeatures.worldId'))
    .select([
      'worldFeatures.id',
      'worldFeatures.featureTypeCode',
      'worldFeatures.variantSeed',
      'worldFeatures.state as featureState',
      sql<number>`coalesce(stone_deposits.cell_x, world_cell_occupancies.cell_x)`.as('cellX'),
      sql<number>`coalesce(stone_deposits.cell_y, world_cell_occupancies.cell_y)`.as('cellY'),
      'stoneDeposits.initialAmount', 'stoneDeposits.remainingAmount', 'stoneDeposits.reservedAmount',
      'stoneDeposits.revision', 'stoneDeposits.updatedAt',
    ])
    .where('worldFeatures.worldId', '=', village.worldId);

  const endX = ground.originCellX + SNAPSHOT_SIZE;
  query =
    endX <= village.widthCells
      ? query
          .where(sql<boolean>`coalesce(stone_deposits.cell_x, world_cell_occupancies.cell_x) >= ${ground.originCellX}`)
          .where(sql<boolean>`coalesce(stone_deposits.cell_x, world_cell_occupancies.cell_x) < ${endX}`)
      : query.where(sql<boolean>`(coalesce(stone_deposits.cell_x, world_cell_occupancies.cell_x) >= ${ground.originCellX}
        or coalesce(stone_deposits.cell_x, world_cell_occupancies.cell_x) < ${endX - village.widthCells})`);

  const endY = ground.originCellY + SNAPSHOT_SIZE;
  query =
    endY <= village.heightCells
      ? query
          .where(sql<boolean>`coalesce(stone_deposits.cell_y, world_cell_occupancies.cell_y) >= ${ground.originCellY}`)
          .where(sql<boolean>`coalesce(stone_deposits.cell_y, world_cell_occupancies.cell_y) < ${endY}`)
      : query.where(sql<boolean>`(coalesce(stone_deposits.cell_y, world_cell_occupancies.cell_y) >= ${ground.originCellY}
        or coalesce(stone_deposits.cell_y, world_cell_occupancies.cell_y) < ${endY - village.heightCells})`);

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
  existingEconomy?: VillageEconomy,
): Promise<VillageState> {
  const village = await ownedVillage(tx, accountId, worldSlug);
  const economy = existingEconomy ?? await beginVillageEconomy(tx, village.worldId, village.villageId);
  if (economy.worldId !== village.worldId || economy.villageId !== village.villageId)
    throw new Error('Village economy context does not match the requested village');
  // This second pass uses the same bound and only matters for a zero-duration
  // transition created by the command before its snapshot is assembled.
  await reconcileVillageEconomy(tx, economy);
  const at = economy.through;
  const [
    ground,
    resourcesRows,
    definitions,
    occupancyRows,
    protectedRows,
    hiddenSupplyRows,
    accomplishmentRows,
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
    tx.selectFrom('buildingHiddenSupplies').select(['buildingId', 'claimedAt'])
      .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).execute(),
    tx.selectFrom('villageAccomplishments').select(['code', 'completedAt'])
      .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId)
      .orderBy('completedAt').orderBy('code').execute(),
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
      if (row.resourceCode === 'stone') safeAmount(projected.amount);
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
  const [cohorts, housingRows, harvestRows, extractionRows, gardenPlotRows] = await Promise.all([
    tx.selectFrom('populationCohorts').selectAll()
      .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).execute(),
    tx.selectFrom('buildings').select(['buildingType', 'level']).where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId).where('status', '=', 'completed').execute(),
    tx.selectFrom('gardenHarvests').selectAll().where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId).where('status', '=', 'in-progress').execute(),
    tx.selectFrom('depositExtractions').selectAll().where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId).where('status', '=', 'in-progress').execute(),
    tx.selectFrom('gardenPlots').select(['buildingId', 'cellX', 'cellY'])
      .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).execute(),
  ]);
  const projectedCohorts = cohorts.map((cohort) => ({
    ...cohort,
    energy: advanceEnergy({
      energy: cohort.energy, progress: cohort.energyProgress, activity: cohort.activity,
      restingSince: cohort.restingSince, foodUsedSinceRest: cohort.foodUsedSinceRest,
      updatedAt: cohort.energyUpdatedAt,
    } satisfies EnergyState, at),
  }));
  const population = {
    total: projectedCohorts.reduce((total, cohort) => total + cohort.memberCount, 0),
    housingCapacity: housingRows.reduce((total, row) => total + (row.buildingType === 'town-hall' ? 30 : row.buildingType === 'dwelling' ? (row.level >= 2 ? 25 : 5) : 0), 0),
    available: projectedCohorts.filter((cohort) => cohort.energy.activity === 'idle' && withoutAssignment(cohort))
      .reduce((total, cohort) => total + cohort.memberCount, 0),
    working: projectedCohorts.filter((cohort) => cohort.energy.activity === 'working')
      .reduce((total, cohort) => total + cohort.memberCount, 0),
    resting: projectedCohorts.filter((cohort) => cohort.energy.activity === 'resting')
      .reduce((total, cohort) => total + cohort.memberCount, 0),
    energyCounts: Array.from({ length: 11 }, (_, energy) => projectedCohorts
      .filter((cohort) => displayedEnergy(cohort.energy) === energy)
      .reduce((total, cohort) => total + cohort.memberCount, 0)),
  };
  const projectedPlots = await Promise.all(gardenPlotRows.map((plot) =>
    projectGardenPlot(tx, village.worldId, plot.cellX, plot.cellY, at)));
  const harvestByPlot = new Map(harvestRows.filter((item) => item.plotCellX !== null)
    .map((item) => [worldCellKey(item.plotCellX!, item.plotCellY!), item]));
  const legacyHarvestByBuilding = new Map(harvestRows.filter((item) => item.plotCellX === null)
    .map((item) => [item.buildingId, item]));
  const activeGardenRows = occupancyRows.filter((item) => item.buildingType === 'garden'
    && item.status === 'completed' && item.pendingExpansionId === null);
  const gardenAt = new Map(activeGardenRows.map((item) => [worldCellKey(item.cellX, item.cellY), item]));
  const canonicalByBuilding = new Map<string, string>();
  const componentBuildings = new Map<string, Set<string>>();
  const visitedGarden = new Set<string>();
  for (const seed of activeGardenRows) {
    const seedKey = worldCellKey(seed.cellX, seed.cellY);
    if (visitedGarden.has(seedKey)) continue;
    const queue = [seed], ids = new Set<string>();
    visitedGarden.add(seedKey);
    while (queue.length) {
      const current = queue.shift()!; ids.add(current.buildingId);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const neighbour = gardenAt.get(worldCellKey(normalizeCell(current.cellX + dx, village.widthCells), normalizeCell(current.cellY + dy, village.heightCells)));
        if (neighbour && !visitedGarden.has(worldCellKey(neighbour.cellX, neighbour.cellY))) {
          visitedGarden.add(worldCellKey(neighbour.cellX, neighbour.cellY)); queue.push(neighbour);
        }
      }
    }
    const canonical = [...ids].sort()[0]!;
    componentBuildings.set(canonical, ids);
    for (const id of ids) canonicalByBuilding.set(id, canonical);
  }
  const byBuilding = new Map<string, typeof occupancyRows>();
  for (const row of occupancyRows) {
    const logicalId = canonicalByBuilding.get(row.buildingId) ?? row.buildingId;
    const rows = byBuilding.get(logicalId) ?? [];
    rows.push(row);
    byBuilding.set(logicalId, rows);
  }
  const expansionIds = [...new Set(occupancyRows.flatMap((row) => row.pendingExpansionId ? [row.pendingExpansionId] : []))];
  const expansions = expansionIds.length === 0 ? [] : await tx.selectFrom('buildingExpansions')
    .select(['id', 'startedAt', 'completesAt']).where('worldId', '=', village.worldId)
    .where('id', 'in', expansionIds).execute();
  const expansionById = new Map(expansions.map((item) => [item.id, item]));
  const hiddenSupplies = new Map(hiddenSupplyRows.map((item) => [item.buildingId, item.claimedAt === null]));
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
    features.filter((feature) => feature.featureState !== 'depleted').map((feature) => worldCellKey(feature.cellX, feature.cellY)),
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
      population,
      accomplishments: accomplishmentRows.map((item) => ({ code: item.code, completedAt: item.completedAt.toISOString() })),
      extractions: await Promise.all(extractionRows.map((row) => readExtraction(tx, village.worldId, village.villageId, row.id))),
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
        deposit: feature.featureTypeCode === 'stone_outcrop' ? {
          featureId: feature.id, resourceCode: 'stone' as const, cellX: feature.cellX, cellY: feature.cellY,
          initialAmount: safeAmount(feature.initialAmount!), remainingAmount: safeAmount(feature.remainingAmount!),
          reservedAmount: safeAmount(feature.reservedAmount!), availableAmount: safeAmount(feature.remainingAmount!) - safeAmount(feature.reservedAmount!),
          state: feature.featureState === 'depleted' ? 'depleted' as const : 'available' as const,
          revision: safeAmount(feature.revision!), updatedAt: feature.updatedAt!.toISOString(),
        } : null,
      })),
    },
    cells: [...visible]
      .map((key) => {
        const [cellX, cellY] = parseCellKey(key);
        const row = occupied.get(key),
          logicalBuildingId = row ? canonicalByBuilding.get(row.buildingId) ?? row.buildingId : '',
          footprint = row ? (byBuilding.get(logicalBuildingId) ?? []) : [],
          activeCells = footprint.filter((item) => item.pendingExpansionId === null),
          pendingCells = footprint.filter((item) => item.pendingExpansionId !== null),
          expansion = pendingCells[0]?.pendingExpansionId
            ? expansionById.get(pendingCells[0].pendingExpansionId)
            : undefined,
          plots = row?.buildingType === 'garden' ? projectedPlots.filter((plot) =>
            (componentBuildings.get(logicalBuildingId) ?? new Set([row.buildingId])).has(plot.buildingId)) : [];
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
            row?.role === 'anchor' && (!canonicalByBuilding.has(row.buildingId) || row.buildingId === logicalBuildingId)
              ? {
                  id: logicalBuildingId,
                  type: row.buildingType as BuildingType,
                  level: row.level,
                  targetLevel: row.targetLevel,
                  status: row.status,
                  constructionStartedAt:
                    row.constructionStartedAt?.toISOString() ?? null,
                  constructionCompletesAt:
                    row.constructionCompletesAt?.toISOString() ?? null,
                  completedAt: row.completedAt?.toISOString() ?? null,
                  hiddenSuppliesAvailable: hiddenSupplies.get(row.buildingId) ?? false,
                  garden: row.buildingType === 'garden' && plots.length
                    ? {
                        storedCarrots: plots.reduce((sum, plot) => sum + plot.amount, 0),
                        capacity: plots.reduce((sum, plot) => sum + plot.capacity, 0),
                        productionPerHour: plots.reduce((sum, plot) => sum + plot.productionPerHour, 0),
                        productionUpdatedAt: at.toISOString(),
                        activeCellCount: row.status === 'completed' ? activeCells.length : 0,
                        pendingCellCount: row.status === 'completed' ? pendingCells.length : footprint.length,
                        plots: plots.map((plot) => {
                          const harvest = harvestByPlot.get(worldCellKey(plot.cellX, plot.cellY));
                          return { cellX: plot.cellX, cellY: plot.cellY, storedCarrots: plot.amount,
                            capacity: plot.capacity, productionPerHour: plot.productionPerHour,
                            productionUpdatedAt: plot.productionUpdatedAt.toISOString(), full: plot.amount >= plot.capacity,
                            harvest: harvest ? { id: harvest.id, startedAt: harvest.startedAt.toISOString(),
                              completesAt: harvest.completesAt.toISOString(), reservedCarrots: number(harvest.reservedCarrots) } : null };
                        }),
                        expansion: expansion ? {
                          id: expansion.id,
                          startedAt: expansion.startedAt.toISOString(),
                          completesAt: expansion.completesAt.toISOString(),
                          cells: pendingCells.map((item) => ({ cellX: item.cellX, cellY: item.cellY })),
                        } : null,
                        harvest: [...(componentBuildings.get(logicalBuildingId) ?? new Set([row.buildingId]))]
                          .map((id) => legacyHarvestByBuilding.get(id)).find(Boolean) ? (() => {
                          const harvest = [...(componentBuildings.get(logicalBuildingId) ?? new Set([row.buildingId]))]
                            .map((id) => legacyHarvestByBuilding.get(id)).find(Boolean)!;
                          return {
                            id: harvest.id, startedAt: harvest.startedAt.toISOString(),
                            completesAt: harvest.completesAt.toISOString(), workerCount: harvest.workerCount,
                            reservedCarrots: number(harvest.reservedCarrots),
                          };
                        })() : null,
                      }
                    : null,
                }
              : null,
          footprint: row
            ? {
                buildingId: logicalBuildingId,
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
  for (const cost of [...costs].sort((left, right) => left.resourceCode.localeCompare(right.resourceCode))) {
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
  for (const cell of [...cells].sort((left, right) => left.cellX - right.cellX || left.cellY - right.cellY)) {
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
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    const at = economy.through;
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
    return state(tx, accountId, worldSlug, economy);
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
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    const at = economy.through;
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
    return state(tx, accountId, worldSlug, economy);
  });
}

export async function expandGarden(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string,
  buildingId: string, rawCells: SpatialCell[], durationOverride: number | null,
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    const at = economy.through;
    const building = await tx.selectFrom('buildings').selectAll().where('id', '=', buildingId)
      .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).forUpdate().executeTakeFirst();
    if (!building || building.buildingType !== 'garden') throw new HttpError(404, 'GARDEN_NOT_FOUND', 'Jardin introuvable.');
    if (building.status !== 'completed') throw new HttpError(409, 'BUILDING_BUSY', 'Le jardin est encore en chantier.');
    const allActiveGardens = await tx.selectFrom('worldCellOccupancies')
      .innerJoin('buildings', (join) => join.onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId')
        .onRef('buildings.id', '=', 'worldCellOccupancies.buildingId'))
      .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY', 'buildings.id as buildingId'])
      .where('worldCellOccupancies.worldId', '=', village.worldId).where('buildings.villageId', '=', village.villageId)
      .where('buildings.buildingType', '=', 'garden').where('buildings.status', '=', 'completed')
      .where('worldCellOccupancies.pendingExpansionId', 'is', null).execute();
    const activeAt = new Map(allActiveGardens.map((cell) => [worldCellKey(cell.cellX, cell.cellY), cell]));
    const activeCells = allActiveGardens.filter((cell) => cell.buildingId === building.id), queue = [...allActiveGardens.filter((cell) => cell.buildingId === building.id)];
    const activeKeys = new Set(activeCells.map((cell) => worldCellKey(cell.cellX, cell.cellY)));
    while (queue.length) {
      const current = queue.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next = activeAt.get(worldCellKey(normalizeCell(current.cellX + dx, village.widthCells), normalizeCell(current.cellY + dy, village.heightCells)));
        if (next && !activeKeys.has(worldCellKey(next.cellX, next.cellY))) {
          activeKeys.add(worldCellKey(next.cellX, next.cellY)); activeCells.push(next); queue.push(next);
        }
      }
    }
    const componentIds = [...new Set(activeCells.map((cell) => cell.buildingId))];
    const pending = await tx.selectFrom('buildingExpansions').select('id').where('worldId', '=', village.worldId)
      .where('buildingId', 'in', componentIds).where('status', '=', 'under-construction').executeTakeFirst();
    if (pending) throw new HttpError(409, 'BUILDING_BUSY', 'Le jardin possède déjà une extension en chantier.');
    const selection = normalizeSpatialSelection(rawCells[0]!, rawCells, village.widthCells, village.heightCells);
    const occupiedRows = await tx.selectFrom('worldCellOccupancies')
      .leftJoin('buildings', (join) => join.onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId')
        .onRef('buildings.id', '=', 'worldCellOccupancies.buildingId'))
      .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY', 'worldCellOccupancies.pendingExpansionId',
        'buildings.buildingType', 'buildings.villageId'])
      .where('worldCellOccupancies.worldId', '=', village.worldId).execute();
    const occupiedAt = new Map(occupiedRows.map((item) => [worldCellKey(item.cellX, item.cellY), item]));
    const newCells: SpatialCell[] = [];
    for (const cell of selection.cells) {
      const occupied = occupiedAt.get(worldCellKey(cell.cellX, cell.cellY));
      if (!occupied) { await assertBuildable(tx, village, cell.cellX, cell.cellY); newCells.push(cell); continue; }
      if (occupied.pendingExpansionId !== null || occupied.buildingType !== 'garden' || occupied.villageId !== village.villageId)
        throw new HttpError(409, 'CELL_OCCUPIED', 'Une case de la sélection est occupée ou encore en chantier.');
    }
    if (!selection.cells.some((cell) => activeCells.some((active) =>
      toroidalManhattan(active.cellX, active.cellY, cell.cellX, cell.cellY, village.widthCells, village.heightCells) <= 1,
    ))) throw new HttpError(409, 'INVALID_BUILDING_EXTENSION', 'L’extension doit toucher le jardin actif.');
    if (newCells.length === 0) return state(tx, accountId, worldSlug, economy);
    const item = await definition(tx, 'garden', 1);
    await debit(tx, village.worldId, village.villageId, scaledCosts(item.costs, newCells.length), at);
    const completesAt = new Date(at.getTime() + (durationOverride ?? item.constructionDurationSeconds * 1_000));
    const expansion = await tx.insertInto('buildingExpansions').values({
      worldId: village.worldId, villageId: village.villageId, buildingId: building.id,
      status: 'under-construction', startedAt: at, completesAt, completedAt: null,
    }).returning('id').executeTakeFirstOrThrow();
    await reserveSelection(tx, village.worldId, building.id, selection.anchor, newCells, expansion.id, false);
    await tx.insertInto('scheduledTasks').values({
      worldId: village.worldId, taskType: COMPLETE_EXPANSION_TASK, subjectId: expansion.id,
      payload: {}, dueAt: completesAt, availableAt: completesAt, lastError: null, completedAt: null,
    }).execute();
    return state(tx, accountId, worldSlug, economy);
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
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    const at = economy.through;
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
      .forUpdate('buildings')
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
    return state(tx, accountId, worldSlug, economy);
  });
}
export async function harvestGarden(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
  cellXOrCommandId?: number | string,
  cellY?: number,
  commandId: string = randomUUID(),
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId)
      throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    const at = economy.through;
    const plots = await tx.selectFrom('gardenPlots').select(['buildingId', 'cellX', 'cellY'])
      .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).execute();
    const legacyCommandId = typeof cellXOrCommandId === 'string' ? cellXOrCommandId : commandId;
    const oldReceipt = await tx.selectFrom('gardenHarvests').select(['plotCellX', 'plotCellY'])
      .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId)
      .where('commandId', '=', legacyCommandId).executeTakeFirst();
    const fallback = plots.find((plot) => plot.buildingId === buildingId);
    const x = normalizeCell(typeof cellXOrCommandId === 'number' ? cellXOrCommandId : fallback?.cellX ?? -1, village.widthCells);
    const y = normalizeCell(typeof cellY === 'number' ? cellY : fallback?.cellY ?? -1, village.heightCells);
    if (oldReceipt) {
      if (oldReceipt.plotCellX === null) return state(tx, accountId, worldSlug, economy);
      if (oldReceipt.plotCellX !== x || oldReceipt.plotCellY !== y)
        throw new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette intention a déjà été utilisée pour une autre parcelle.');
      return state(tx, accountId, worldSlug, economy);
    }
    const byCell = new Map(plots.map((plot) => [worldCellKey(plot.cellX, plot.cellY), plot]));
    const queue = plots.filter((plot) => plot.buildingId === buildingId);
    const visited = new Set(queue.map((plot) => worldCellKey(plot.cellX, plot.cellY)));
    while (queue.length) {
      const current = queue.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next = byCell.get(worldCellKey(normalizeCell(current.cellX + dx, village.widthCells), normalizeCell(current.cellY + dy, village.heightCells)));
        if (next && !visited.has(worldCellKey(next.cellX, next.cellY))) {
          visited.add(worldCellKey(next.cellX, next.cellY)); queue.push(next);
        }
      }
    }
    const target = byCell.get(worldCellKey(x, y));
    if (!target || !visited.has(worldCellKey(x, y)))
      throw new HttpError(404, 'GARDEN_PLOT_NOT_READY', 'Cette parcelle n’appartient pas à ce Jardin.');
    const componentIds = [...new Set(plots.filter((plot) => visited.has(worldCellKey(plot.cellX, plot.cellY))).map((plot) => plot.buildingId))];
    const legacyHarvest = await tx.selectFrom('gardenHarvests').select('id').where('worldId', '=', village.worldId)
      .where('buildingId', 'in', componentIds).where('plotCellX', 'is', null).where('status', '=', 'in-progress').executeTakeFirst();
    if (legacyHarvest) throw new HttpError(409, 'GARDEN_HARVEST_IN_PROGRESS', 'Une récolte existante est encore en cours sur ce Jardin.');
    await startGardenHarvest(tx, village.worldId, village.villageId, target.buildingId, x, y, legacyCommandId, at);
    return state(tx, accountId, worldSlug, economy);
  });
}

/** Starts a server-authoritative stone extraction. The feature UUID, not a viewport cell, is the target. */
export async function startVillageStoneExtraction(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string,
  featureId: string, commandId: string, workerCount: number,
): Promise<ExtractionResponse> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, featureId);
    const id = await startStoneExtraction(tx, village, economy, featureId, commandId, workerCount);
    return { villageState: await state(tx, accountId, worldSlug, economy),
      extraction: await readExtraction(tx, village.worldId, village.villageId, id),
      deposit: await readStoneDeposit(tx, village.worldId, featureId) };
  });
}

export async function getStoneDepositDetails(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, featureId: string,
) {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, featureId);
    return stoneDepositDetails(tx, village, economy, featureId);
  });
}

export async function discoverBuildingSuppliesInTransaction(
  tx: Transaction<Database>, accountId: string, worldSlug: string, villageId: string, buildingId: string,
): Promise<VillageState> {
  const village = await ownedVillage(tx, accountId, worldSlug);
  if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
  const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
  const supply = await tx.selectFrom('buildingHiddenSupplies').selectAll().where('worldId', '=', village.worldId)
    .where('villageId', '=', village.villageId).where('buildingId', '=', buildingId).forUpdate().executeTakeFirst();
  if (!supply) throw new HttpError(404, 'SUPPLIES_NOT_FOUND', 'Réserves introuvables.');
  const accomplishment = await tx.selectFrom('villageAccomplishments').select('completedAt')
    .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId)
    .where('code', '=', 'town-hall-supplies').executeTakeFirst();
  if (accomplishment) {
    if (!supply.claimedAt) throw new Error('Town-hall supplies accomplishment has no matching claim');
    return state(tx, accountId, worldSlug, economy);
  }
  if (supply.claimedAt) throw new Error('Claimed town-hall supplies have no matching accomplishment');
  await tx.insertInto('villageAccomplishments').values({
    worldId: village.worldId, villageId: village.villageId,
    code: 'town-hall-supplies', completedAt: economy.through,
  }).execute();
  await tx.updateTable('buildingHiddenSupplies').set({ claimedAt: economy.through }).where('worldId', '=', village.worldId)
    .where('villageId', '=', village.villageId).where('buildingId', '=', buildingId).execute();
  await tx.updateTable('villageResources').set({ amount: sql`amount + ${supply.amount}::bigint` })
    .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId)
    .where('resourceCode', '=', supply.resourceCode).execute();
  return state(tx, accountId, worldSlug, economy);
}

export async function discoverBuildingSupplies(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, buildingId: string,
): Promise<VillageState> {
  return db.transaction().execute((tx) =>
    discoverBuildingSuppliesInTransaction(tx, accountId, worldSlug, villageId, buildingId));
}

async function populationCommand(
  tx: Transaction<Database>, village: OwnedVillage, economy: VillageEconomy,
  commandId: string, count: number, type: 'feed' | 'rest',
) {
  if (!Number.isInteger(count) || count < 1) throw new HttpError(400, 'POPULATION_COUNT_INVALID', 'Effectif invalide.');
  const repeated = await tx.selectFrom('populationCommandReceipts').selectAll()
    .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId)
    .where('commandId', '=', commandId).executeTakeFirst();
  if (repeated) {
    if (repeated.commandType !== type || repeated.memberCount !== count)
      throw new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette intention a déjà été utilisée différemment.');
    return;
  }
  const cohorts = await materializeCohorts(tx, village.worldId, village.villageId, economy.through);
  let remaining = count;
  const eligible = cohorts.filter((cohort) => cohort.activity === 'idle' && withoutAssignment(cohort))
    .filter((cohort) => type === 'feed'
      ? feedEnergy({ energy: cohort.energy, progress: cohort.energyProgress, activity: cohort.activity,
        restingSince: cohort.restingSince, foodUsedSinceRest: cohort.foodUsedSinceRest, updatedAt: cohort.energyUpdatedAt }) !== null
      : beginRest({ energy: cohort.energy, progress: cohort.energyProgress, activity: cohort.activity,
        restingSince: cohort.restingSince, foodUsedSinceRest: cohort.foodUsedSinceRest, updatedAt: cohort.energyUpdatedAt }) !== null);
  if (eligible.reduce((total, cohort) => total + cohort.memberCount, 0) < remaining)
    throw new HttpError(409, type === 'feed' ? 'POPULATION_FOOD_UNAVAILABLE' : 'POPULATION_REST_UNAVAILABLE', 'Habitants éligibles insuffisants.');
  if (type === 'feed') {
    const carrots = await tx.selectFrom('villageResources').select('amount').where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId).where('resourceCode', '=', 'carrot').forUpdate().executeTakeFirstOrThrow();
    if (number(carrots.amount) < count) throw new HttpError(409, 'CARROTS_INSUFFICIENT', 'Carottes insuffisantes.');
    await tx.updateTable('villageResources').set({ amount: sql`amount - ${count}::bigint` }).where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId).where('resourceCode', '=', 'carrot').execute();
  }
  for (const cohort of eligible) {
    if (remaining === 0) break;
    const memberCount = Math.min(remaining, cohort.memberCount);
    const initial = { energy: cohort.energy, progress: cohort.energyProgress, activity: cohort.activity,
      restingSince: cohort.restingSince, foodUsedSinceRest: cohort.foodUsedSinceRest, updatedAt: cohort.energyUpdatedAt };
    const next = type === 'feed' ? feedEnergy(initial)! : beginRest(initial)!;
    const values = { activity: next.activity, energy: next.energy, energyProgress: next.progress,
      restingSince: next.restingSince, foodUsedSinceRest: next.foodUsedSinceRest, energyUpdatedAt: next.updatedAt };
    if (memberCount === cohort.memberCount) await tx.updateTable('populationCohorts').set(values).where('id', '=', cohort.id).execute();
    else {
      await tx.updateTable('populationCohorts').set({ memberCount: cohort.memberCount - memberCount }).where('id', '=', cohort.id).execute();
      await tx.insertInto('populationCohorts').values({ worldId: village.worldId, villageId: village.villageId,
        originVillageId: cohort.originVillageId, memberCount, ...values, harvestId: null, extractionId: null }).execute();
    }
    remaining -= memberCount;
  }
  await tx.insertInto('populationCommandReceipts').values({ worldId: village.worldId, villageId: village.villageId,
    commandId, commandType: type, memberCount: count }).execute();
}

export async function feedPopulation(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, commandId: string, count: number,
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    await populationCommand(tx, village, economy, commandId, count, 'feed');
    return state(tx, accountId, worldSlug, economy);
  });
}

export async function restPopulation(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, commandId: string, count: number,
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    await populationCommand(tx, village, economy, commandId, count, 'rest');
    return state(tx, accountId, worldSlug, economy);
  });
}
