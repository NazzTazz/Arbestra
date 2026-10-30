import { placeBuilding } from './construction.js';
import { levelingSnapshot } from './leveling.js';
import { villageTerrainRegion } from './terrain-region.js';
import { footprintVertices, isBuildingFootprintFlat } from '@arbestra/contracts';
import { observationVillage } from '../admin/observation-actions.js';
import { devTime, devTimeSync } from '../operations/dev-timing.js';
import { fixedBuildingFootprint, withinBuildReach, BUILD_REACH as BUILD_RADIUS } from '@arbestra/contracts';
import { readRc1Ground } from '../worlds/rc1-ground.js';
import { readRc1Source } from '../worlds/rc1-source.js';
import { villageSyncRevision } from './sync-revision.js';
import { VillageReadReconciliations } from './read-reconciliation.js';
import { networkJob, networkState, type NetworkJob, type TravelNetworkExecutor } from '../navigation/network-job.js';
import { commandTravelNetwork, transactionRefiner } from '../navigation/transaction-refinement.js';
import { naturalFeaturesQuery } from '../worlds/natural-features.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type {
  BuildingType,
  BuildingTypeDefinition,
  VillageState,
  TravelCell,
  TravelNetworkState,
  TravelRoute,
  InfrastructurePlan,
  RoadStroke,
  StartExtractionWorksiteRequest,
  ChangeExtractionWorksiteRequest,
  ExtractionWorksiteSelection,
} from '@arbestra/contracts';
import {
  canonicalWoodTrees,
  designatedTrees,
  queueContribution,
  exploitationAdmissionCap,
  travelDuration,
  refineTravelRoute,
  infrastructureSurface,
  subCellKey,
} from '@arbestra/contracts';
import {
  readInfrastructure,
  readNavigationInfrastructure,
  factoryCapability,
  assertNoInfrastructure,
} from './infrastructure.js';
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
import { COMPLETE_CONSTRUCTION_TASK, COMPLETE_EXPANSION_TASK } from './complete-construction.js';
import {
  materializeVillageResource,
  projectGardenPlots,
  projectVillageResource,
  projectVillageResources,
} from './economy.js';
import {
  beginVillageEconomy,
  beginProcessingCommand,
  reconcileVillageEconomy,
  type VillageEconomy,
  type ReconciliationBudget,
} from './reconcile-economy.js';
import { requestEconomyCatchup, ScopeCatchingUp } from './economy-catchup.js';
import { normalizeSpatialSelection, scaledCosts, type SpatialCell } from './spatial-selection.js';
import { planGardenTour } from '@arbestra/contracts';
import { projectPopulation } from '../population/projection.js';

import { reconcileRestHousing } from '../population/work.js';
import {
  eligibleWorkers,
  materializeCohorts,
  projectCohorts,
  withoutAssignment,
  workingTeam,
} from '../population/work.js';
import { admitScience, scienceSnapshot, scienceCommand } from '../science/service.js';
import type { ScienceCommand } from '@arbestra/contracts';
import { recognizedDepositRoute, hasRecognizedDepositAccess } from '../science/deposit-access.js';
import { knownGeography } from '../science/knowledge.js';
import {
  claimWoodlandCell,
  designatedWood,
  nextWoodWork,
  readWoodlandTrees,
  woodDesignations,
  woodlandTreesField,
} from '../deposits/woodland.js';
import {
  stoneDepositDetails,
  readDepositAccess,
  readDepositAccessContext,
  readExtractions,
  readStoneDeposit,
  safeAmount,
  stoneExtractionDuration,
} from '../deposits/stone-extractions.js';
import {
  admitWorksites,
  changeWorksite,
  createWorksite,
  readWorksites,
  worksiteTargetDistance,
} from '../deposits/worksites.js';
import { readExtractionPools } from '../deposits/extraction-pools.js';
import { admitExploitationGardens, readExploitationOrders } from './exploitation-budget.js';
import { commandProcessing, previewProcessing, processingSnapshot } from './processing.js';
import { marketSnapshot } from './market.js';
import type { MarketCommand } from '@arbestra/contracts';
import type { ProcessingCommand } from '@arbestra/contracts';
import type { ExploitationRequest, ExploitationPreview } from '@arbestra/contracts';

const CELL_SIZE = 2.5;
export interface OwnedVillage {
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

export async function ownedVillage(
  tx: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId?: string,
): Promise<OwnedVillage> {
  return devTime('ownership', async () => {
    const row = await tx
      .selectFrom('villages')
      .innerJoin('worlds', 'worlds.id', 'villages.worldId')
      .innerJoin('worldMemberships', (join) =>
        join.onRef('worldMemberships.worldId', '=', 'worlds.id').on('worldMemberships.accountId', '=', accountId),
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
      .where((eb) => (villageId ? eb('villages.id', '=', villageId) : sql<boolean>`true`))
      .orderBy('villages.id')
      .executeTakeFirst();
    if (!row) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable dans ce monde.');
    observationVillage(accountId, row.worldId, row.villageId);
    return row;
  });
}
export async function catalog(tx: Transaction<Database>): Promise<BuildingTypeDefinition[]> {
  const { types, levels, costs, production, recipes, variantCosts } = await tx
    .selectNoFrom([
      jsonArrayFrom(tx.selectFrom('buildingTypes').selectAll()).as('types'),
      jsonArrayFrom(tx.selectFrom('buildingTypeLevels').selectAll()).as('levels'),
      jsonArrayFrom(tx.selectFrom('buildingLevelCosts').selectAll()).as('costs'),
      jsonArrayFrom(tx.selectFrom('buildingLevelProduction').selectAll()).as('production'),
      jsonArrayFrom(tx.selectFrom('processingRecipes').selectAll()).as('recipes'),
      jsonArrayFrom(tx.selectFrom('buildingVariantCosts').selectAll()).as('variantCosts'),
    ])
    .executeTakeFirstOrThrow();
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
        variantCosts: variantCosts
          .filter((c) => c.buildingTypeCode === type.code && c.level === level.level)
          .map((c) => ({
            variant: c.variant,
            resourceCode: c.resourceCode,
            amount: Number(c.amount),
            ...(c.replacesResourceCode ? { replacesResourceCode: c.replacesResourceCode } : {}),
          })),
        ...Object.fromEntries(
          recipes
            .filter((recipe) => recipe.buildingTypeCode === type.code && recipe.level === level.level)
            .map((recipe) => [
              'processing',
              {
                version: recipe.version,
                inputResource: recipe.inputResource,
                inputAmount: recipe.inputAmount,
                outputResource: recipe.outputResource,
                outputAmount: recipe.outputAmount,
                workMs: recipe.workMs,
                workerCap: recipe.workerCap,
              },
            ]),
        ),
        costs: costs
          .filter((cost) => cost.buildingTypeCode === type.code && cost.level === level.level)
          .map((cost) => ({
            resourceCode: cost.resourceCode,
            amount: number(cost.amount),
          })),
        production: (type.productionMode === 'processing' ? [] : production)
          .filter((item) => item.buildingTypeCode === type.code && item.level === level.level)
          .map((item) => ({
            resourceCode: item.resourceCode,
            ratePerHour: number(item.ratePerHour),
            capacity: item.capacity === null ? null : number(item.capacity),
          })),
      })),
  }));
}

function footprintHeights(
  ground: Snapshot,
  cells: readonly SpatialCell[],
  world: { widthCells: number; heightCells: number },
) {
  return ground.rc1?.field.geometry
    ? footprintVertices(cells, world).map((v) => ground.rc1!.field.geometry!.height(v.vertexX, v.vertexY) * 100)
    : cells.map((c) => ground.elevationAt(c.cellX, c.cellY) ?? NaN);
}
function assertFlatVertexFoundation(
  ground: Snapshot | undefined,
  cells: readonly SpatialCell[],
  world: { widthCells: number; heightCells: number },
) {
  if (ground?.rc1?.field.geometry && !isBuildingFootprintFlat(footprintHeights(ground, cells, world)))
    throw new HttpError(
      409,
      'UNEVEN_TERRAIN',
      'Construction impossible sur une pente. Préparez une surface plane avec la terraformation.',
    );
}
interface Snapshot {
  rc1?: Awaited<ReturnType<typeof readRc1Ground>>;
  originCellX: number;
  originCellY: number;
  width: number;
  height: number;
  terrainCodes: number[];
  elevations: number[];
  terrainAt(x: number, y: number): number | undefined;
  elevationAt(x: number, y: number): number | undefined;
}
async function snapshot(
  tx: Transaction<Database>,
  village: OwnedVillage,
  existing?: { footprints?: readonly TravelCell[]; ground?: Awaited<ReturnType<typeof readRc1Ground>> | undefined },
): Promise<Snapshot> {
  return devTime('snapshot_ground', async () => {
    const footprints =
      existing?.footprints ??
      (await tx
        .selectFrom('worldCellOccupancies as o')
        .innerJoin('buildings as b', (j) => j.onRef('b.worldId', '=', 'o.worldId').onRef('b.id', '=', 'o.buildingId'))
        .select(['o.cellX', 'o.cellY'])
        .where('o.worldId', '=', village.worldId)
        .where('b.villageId', '=', village.villageId)
        .execute());
    const { originCellX, originCellY, width, height } = villageTerrainRegion(village, footprints);
    if (village.generationVersion === 3) {
      const ground = existing?.ground ?? (await readRc1Ground(tx, village.worldId)),
        terrainCodes: number[] = [],
        elevations: number[] = [];
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const c = ground.cell(originCellX + x, originCellY + y);
          terrainCodes.push(c.code);
          elevations.push(c.elevation);
        }
      return {
        rc1: ground,
        originCellX,
        originCellY,
        width,
        height,
        terrainCodes,
        elevations,
        terrainAt(x, y) {
          return ground.cell(x, y).code;
        },
        elevationAt(x, y) {
          return ground.cell(x, y).elevation;
        },
      };
    }
    const wanted = new Map<string, { chunkX: number; chunkY: number }>();
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
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
    const byChunk = new Map(chunks.map((chunk) => [`${chunk.chunkX}:${chunk.chunkY}`, chunk]));
    const terrainCodes: number[] = [];
    const elevations: number[] = [];
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const cx = normalizeCell(originCellX + x, village.widthCells),
          cy = normalizeCell(originCellY + y, village.heightCells);
        const chunk = byChunk.get(`${Math.floor(cx / village.chunkSize)}:${Math.floor(cy / village.chunkSize)}`);
        if (!chunk) throw new HttpError(409, 'WORLD_NOT_READY', 'Le terrain de ce monde est en préparation.');
        const index = (cy % village.chunkSize) * village.chunkSize + (cx % village.chunkSize);
        terrainCodes.push(chunk.terrainCodes[index]!);
        elevations.push(chunk.elevations[index]!);
      }
    return {
      originCellX,
      originCellY,
      width,
      height,
      terrainCodes,
      elevations,
      elevationAt(cellX, cellY) {
        const x = normalizeCell(cellX - originCellX, village.widthCells),
          y = normalizeCell(cellY - originCellY, village.heightCells);
        return x < width && y < height ? elevations[y * width + x] : undefined;
      },
      terrainAt(cellX, cellY) {
        const x = normalizeCell(cellX - originCellX, village.widthCells),
          y = normalizeCell(cellY - originCellY, village.heightCells);
        return x < width && y < height ? terrainCodes[y * width + x] : undefined;
      },
    };
  });
}

/** Route beyond the visual snapshot, using real world chunks and occupancy in a bounded corridor. */
export async function stoneTravelPath(
  tx: Transaction<Database>,
  village: OwnedVillage,
  featureId: string,
  visiblePath?: TravelCell[],
): Promise<TravelCell[] | undefined> {
  const deposit = await tx
    .selectFrom('resourceDeposits')
    .select(['cellX', 'cellY', 'remainingAmount', 'resourceCode', 'cleared'])
    .where('worldId', '=', village.worldId)
    .where('featureId', '=', featureId)
    .executeTakeFirst();
  // A wood case is work until it is cleared: once its wood is cut, its stumps
  // are still removed one by one (docs/SPEC-BOIS-ARBRE-UNITE.md). Whether a cut
  // has wood left is decided by the selection and the admission, not here.
  if (!deposit || (deposit.resourceCode === 'wood' ? deposit.cleared : Number(deposit.remainingAmount) <= 0))
    return undefined;
  // Most local targets have no reported expedition. Check that fact once
  // before loading the player's science and historical route. Permissions are
  // still read on every call; a cached physical path grants no remote access.
  if (await hasRecognizedDepositAccess(tx, village.worldId, village.villageId, deposit)) {
    const recognized = await recognizedDepositRoute(tx, village.worldId, village.villageId, deposit);
    return recognized ? refineVillagePath(tx, village, recognized, featureId) : undefined;
  }
  if (visiblePath) return refineVillagePath(tx, village, visiblePath, featureId);
  const dx = wrappedDelta(deposit.cellX, village.anchorCellX, village.widthCells);
  const dy = wrappedDelta(deposit.cellY, village.anchorCellY, village.heightCells);
  // For a destination inside the minimum local window, refinement never uses
  // the coarse legs: it starts at the real door and searches this same region.
  // Skip the otherwise discarded coarse network, keeping all access checks.
  if (village.generationVersion === 3 && dx >= -32 && dx < 32 && dy >= -32 && dy < 32) {
    try {
      return await refineVillagePath(
        tx,
        village,
        [
          { cellX: village.anchorCellX, cellY: village.anchorCellY },
          { cellX: deposit.cellX, cellY: deposit.cellY },
        ],
        featureId,
      );
    } catch (error) {
      if (error instanceof HttpError && error.code === 'DESTINATION_UNREACHABLE') return undefined;
      throw error;
    }
  }
  // World-reach commands can target arbitrarily remote cells. Keep this case bounded
  // until long-distance navigation has a chunk-level planner.
  if (Math.abs(dx) + Math.abs(dy) > 128) {
    const path: TravelCell[] = [{ cellX: village.anchorCellX, cellY: village.anchorCellY }];
    for (let i = 1; i <= Math.abs(dx); i++)
      path.push({
        cellX: normalizeCell(village.anchorCellX + Math.sign(dx) * i, village.widthCells),
        cellY: village.anchorCellY,
      });
    for (let i = 1; i <= Math.abs(dy); i++)
      path.push({
        cellX: deposit.cellX,
        cellY: normalizeCell(village.anchorCellY + Math.sign(dy) * i, village.heightCells),
      });
    return refineVillagePath(tx, village, path, featureId);
  }
  const width = Math.min(village.widthCells, Math.abs(dx) + 17);
  const height = Math.min(village.heightCells, Math.abs(dy) + 17);
  const originCellX = normalizeCell(village.anchorCellX + Math.min(0, dx) - 8, village.widthCells);
  const originCellY = normalizeCell(village.anchorCellY + Math.min(0, dy) - 8, village.heightCells);
  const xs = Array.from({ length: width }, (_, i) => normalizeCell(originCellX + i, village.widthCells));
  const ys = Array.from({ length: height }, (_, i) => normalizeCell(originCellY + i, village.heightCells));
  const wanted = new Map<string, { chunkX: number; chunkY: number }>();
  for (const y of ys)
    for (const x of xs) {
      const chunkX = Math.floor(x / village.chunkSize),
        chunkY = Math.floor(y / village.chunkSize);
      wanted.set(`${chunkX}:${chunkY}`, { chunkX, chunkY });
    }
  const [chunks, occupied] = await Promise.all([
    village.generationVersion === 3
      ? Promise.resolve([])
      : tx
          .selectFrom('worldChunks')
          .select(['chunkX', 'chunkY', 'terrainCodes'])
          .where('worldId', '=', village.worldId)
          .where((eb) =>
            eb.or(
              [...wanted.values()].map(({ chunkX, chunkY }) =>
                eb.and([eb('chunkX', '=', chunkX), eb('chunkY', '=', chunkY)]),
              ),
            ),
          )
          .execute(),
    tx
      .selectFrom('worldCellOccupancies')
      .select(['cellX', 'cellY'])
      .where('worldId', '=', village.worldId)
      .where('cellX', 'in', xs)
      .where('cellY', 'in', ys)
      .execute(),
  ]);
  const rc1 = village.generationVersion === 3 ? await readRc1Ground(tx, village.worldId) : null;
  const byChunk = new Map(chunks.map((chunk) => [`${chunk.chunkX}:${chunk.chunkY}`, chunk]));
  const terrainCodes = ys.flatMap((y) =>
    xs.map((x) => {
      if (rc1) return rc1.cell(x, y).code;
      const chunk = byChunk.get(`${Math.floor(x / village.chunkSize)}:${Math.floor(y / village.chunkSize)}`);
      if (!chunk) throw new HttpError(409, 'WORLD_NOT_READY', 'Le terrain de ce monde est en préparation.');
      return chunk.terrainCodes[(y % village.chunkSize) * village.chunkSize + (x % village.chunkSize)]!;
    }),
  );
  // Typed, not cast: the command lane rejects a ground whose world differs.
  const routeState: TravelNetworkState = {
    world: { id: village.worldId, widthCells: village.widthCells, heightCells: village.heightCells },
    village: { anchorCellX: village.anchorCellX, anchorCellY: village.anchorCellY },
    region: {
      originCellX,
      originCellY,
      width,
      height,
      terrainCodes,
      features: [
        {
          id: featureId,
          cellX: deposit.cellX,
          cellY: deposit.cellY,
          type: deposit.resourceCode === 'wood' ? 'woodland' : 'stone_outcrop',
          deposit: { state: 'available' },
        },
      ],
    },
    // An anonymous footprint only blocks the cell.
    cells: occupied.map((cell) => ({ ...cell, footprint: { buildingId: '' }, building: null })),
  };
  const path = (await commandTravelNetwork(tx, routeState, rc1, [featureId])).find(
    (route) => route.id === featureId,
  )?.cells;
  if (path) return refineVillagePath(tx, village, path, featureId, rc1 ?? undefined);
  // Coarse centres can be blocked by the hall's own footprint or RC1 trunks
  // while the real door and sub-cell passages remain accessible. Let the
  // existing bounded local planner certify access before declaring failure.
  if (Math.abs(dx) + Math.abs(dy) <= 128) {
    try {
      return await refineVillagePath(
        tx,
        village,
        [
          { cellX: village.anchorCellX, cellY: village.anchorCellY },
          { cellX: deposit.cellX, cellY: deposit.cellY },
        ],
        featureId,
        rc1 ?? undefined,
      );
    } catch (error) {
      if (error instanceof HttpError && error.code === 'DESTINATION_UNREACHABLE') return undefined;
      throw error;
    }
  }
  return undefined;
}

export async function refineVillagePath(
  tx: Transaction<Database>,
  village: Pick<
    OwnedVillage,
    | 'worldId'
    | 'villageId'
    | 'anchorCellX'
    | 'anchorCellY'
    | 'widthCells'
    | 'heightCells'
    | 'chunkSize'
    | 'generationVersion'
  >,
  path: TravelCell[],
  id: string,
  existingGround?: Awaited<ReturnType<typeof readRc1Ground>>,
): Promise<TravelCell[]> {
  const full = village as OwnedVillage,
    ground = await snapshot(tx, full, { ground: existingGround }),
    features = await featuresInSnapshot(tx, full, ground, Boolean(ground.rc1));
  const rows = await tx
    .selectFrom('worldCellOccupancies')
    .leftJoin('buildings', (join) =>
      join
        .onRef('buildings.id', '=', 'worldCellOccupancies.buildingId')
        .onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId'),
    )
    .select([
      'worldCellOccupancies.cellX',
      'worldCellOccupancies.cellY',
      'worldCellOccupancies.role',
      'worldCellOccupancies.pendingExpansionId',
      'buildings.id',
      'buildings.villageId',
      'buildings.buildingType',
      'buildings.status',
      'buildings.visualLayout',
      'buildings.quarterTurns',
    ])
    .where('worldCellOccupancies.worldId', '=', village.worldId)
    .where('worldCellOccupancies.buildingId', 'is not', null)
    .where(
      sql<boolean>`mod(world_cell_occupancies.cell_x-${ground.originCellX}+${village.widthCells},${village.widthCells}) < ${ground.width}`,
    )
    .where(
      sql<boolean>`mod(world_cell_occupancies.cell_y-${ground.originCellY}+${village.heightCells},${village.heightCells}) < ${ground.height}`,
    )
    .execute();
  const context = {
    world: { ...village, id: village.worldId },
    village: {
      anchorCellX: village.anchorCellX,
      anchorCellY: village.anchorCellY,
      townHallBuildingId: rows.find((r) => r.villageId === village.villageId && r.buildingType === 'town-hall')?.id,
    },
    region: {
      originCellX: ground.originCellX,
      originCellY: ground.originCellY,
      width: ground.width,
      height: ground.height,
      terrainCodes: ground.terrainCodes,
      features: features.map((f) => ({
        ...f,
        type: f.featureTypeCode,
        deposit: {
          blocksCell: f.blocksCell,
          cleared: f.cleared,
          // A wood case stays until its last stump is removed.
          state:
            f.featureTypeCode !== 'leveling-site' &&
            (f.resourceCode === 'wood' ? f.cleared : Number(f.remainingAmount) === 0)
              ? 'depleted'
              : 'available',
        },
      })),
    },
    cells: rows.map((r) => ({
      cellX: r.cellX,
      cellY: r.cellY,
      footprint: {
        buildingId: r.id,
        buildingType: r.buildingType,
        state: r.status === 'under-construction' || r.pendingExpansionId !== null ? 'reserved' : 'active',
      },
      building:
        r.role === 'anchor'
          ? {
              id: r.id,
              type: r.buildingType,
              visualLayout: r.visualLayout,
              quarterTurns: r.visualLayout?.quarterTurns ?? r.quarterTurns,
            }
          : null,
    })),
    infrastructure: await readNavigationInfrastructure(tx, village),
  } as unknown as Pick<VillageState, 'world' | 'village' | 'region' | 'cells' | 'infrastructure'>;
  const rc1 = ground.rc1;
  const executor = transactionRefiner(tx),
    input = { id, kind: 'stone' as const, cells: path, destination: path.at(-1)! };
  const route = executor
    ? (
        await executor.refine(async (known) => ({
          ...networkJob(networkState(context), rc1 ?? undefined, known),
          refinement: input,
        }))
      )[0]
    : refineTravelRoute(context, input, new Set(), undefined, rc1?.navigation, undefined, {
        onLimit: () => {
          throw new HttpError(503, 'NAVIGATION_BUSY', 'Calcul du trajet interrompu. Réessayez.');
        },
      });
  if (!route) throw new HttpError(409, 'DESTINATION_UNREACHABLE', 'Aucun accès praticable depuis le village.');
  return route.cells;
}

function candidates(footprints: Array<{ cellX: number; cellY: number }>, village: OwnedVillage) {
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
  if (rawX === undefined || rawY === undefined) throw new Error(`Invalid cell key: ${key}`);
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
  excludeWoodlands = false,
  withTrees = false,
) {
  return devTime('features', async () => {
    const endX = ground.originCellX + ground.width;
    const endY = ground.originCellY + ground.height;
    const xs =
      endX <= village.widthCells
        ? [[ground.originCellX, endX]]
        : [
            [ground.originCellX, village.widthCells],
            [0, endX - village.widthCells],
          ];
    const ys =
      endY <= village.heightCells
        ? [[ground.originCellY, endY]]
        : [
            [ground.originCellY, village.heightCells],
            [0, endY - village.heightCells],
          ];
    return naturalFeaturesQuery(
      tx,
      village.worldId,
      xs.flatMap(([minX, maxX]) => ys.map(([minY, maxY]) => ({ minX: minX!, maxX: maxX!, minY: minY!, maxY: maxY! }))),
      excludeWoodlands,
      undefined,
      withTrees,
    ).execute();
  });
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
      toroidalChebyshev(cellX, cellY, row.centerCellX, row.centerCellY, village.widthCells, village.heightCells) <=
      row.innerRadius,
  );
}

/** Final writes common to command replies and ordinary snapshots. */
async function admitVillageWork(tx: Transaction<Database>, economy: VillageEconomy, village: OwnedVillage) {
  await admitExploitationGardens(tx, economy);
  await admitWorksites(tx, economy, village, (featureId) => stoneTravelPath(tx, village, featureId));
  await admitScience(tx, economy);
}

async function finalizeVillageEconomy(
  tx: Transaction<Database>,
  economy: VillageEconomy,
  village: OwnedVillage,
  admit = true,
) {
  return devTime('admission', async () => {
    // Keep the command bound, including zero-duration transitions and admissions.
    await reconcileVillageEconomy(tx, economy);
    if (admit) await admitVillageWork(tx, economy, village);
  });
}
export type ConstructionReplyMode = 'snapshot' | 'commit';
/** Runs last in the command transaction, after a new (not replayed) commit. */
export type AfterConstructionWrites = (tx: Transaction<Database>, economy: VillageEconomy) => Promise<void>;
export interface ConstructionCommit {
  worldId: string;
  villageId: string;
  through: Date;
  commandId?: string;
  confirmation?: import('@arbestra/contracts').ConstructionConfirmation;
}
export type ConstructionResult<Mode extends ConstructionReplyMode> = Mode extends 'commit'
  ? ConstructionCommit
  : VillageState;
export async function villageCommandResult<Mode extends ConstructionReplyMode>(
  tx: Transaction<Database>,
  accountId: string,
  worldSlug: string,
  village: OwnedVillage,
  economy: VillageEconomy,
  mode: Mode,
  commandId?: string,
  afterWrites?: AfterConstructionWrites,
): Promise<ConstructionResult<Mode>> {
  if (mode === 'snapshot') return (await state(tx, accountId, worldSlug, economy)) as ConstructionResult<Mode>;
  await finalizeVillageEconomy(tx, economy, village);
  await reconcileRestHousing(tx, village.worldId, village.villageId, economy.through);
  // Terminal step of a committed command (V2 publication): no write after it.
  if (afterWrites) await afterWrites(tx, economy);
  return {
    worldId: village.worldId,
    villageId: village.villageId,
    through: economy.through,
    ...(commandId ? { commandId } : {}),
  } as ConstructionResult<Mode>;
}

/** A coherent projection for transport, with no economic writes or locks. */
export function withVillageProjection<T>(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  read: (tx: Transaction<Database>, economy: VillageEconomy, village: OwnedVillage) => Promise<T>,
) {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      await sql`set transaction read only`.execute(tx);
      const village = await ownedVillage(tx, accountId, worldSlug, villageId);
      const through = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow()).at;
      await sql`select set_config('arbestra.economy_through', ${through.toISOString()}, true)`.execute(tx);
      return read(tx, { worldId: village.worldId, villageId, through }, village);
    });
}

/** Inspection needs persisted infrastructure and committed paths, never speculative routing. */
export async function readVillageObservation(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
) {
  const village = await ownedVillage(db, accountId, worldSlug, villageId);
  // Parse/check immutable geography before starting the bounded transaction.
  // The snapshot revalidates its row identity and reads every mutable edit.
  if (village.generationVersion === 3) await readRc1Source(db, village.worldId);
  return withVillageProjection(db, accountId, worldSlug, villageId, (tx, economy, currentVillage) =>
    state(tx, accountId, worldSlug, economy, false, true, 'observation', currentVillage),
  );
}

export async function readVillageProjection(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  compute?: TravelNetworkExecutor,
) {
  // The low-level inline reader remains usable by transactional integration
  // callers. Every application HTTP/SSE projection injects the shared CPU pool.
  if (!compute)
    return withVillageProjection(db, accountId, worldSlug, villageId, (tx, economy, village) =>
      state(tx, accountId, worldSlug, economy, false, true, undefined, village),
    );
  let projected: VillageState | undefined;
  const routes = await compute.network(async (known) => {
    let captured:
      | { input: NetworkJob['state']; ground: Awaited<ReturnType<typeof readRc1Ground>> | undefined }
      | undefined;
    projected = await withVillageProjection(db, accountId, worldSlug, villageId, (tx, economy, village) =>
      state(
        tx,
        accountId,
        worldSlug,
        economy,
        false,
        true,
        (input, ground) => {
          captured = { input, ground };
        },
        village,
      ),
    );
    // All data comes from that one MVCC snapshot. SQL is finished before worker
    // transfer/search, and the result does not acquire a newer revision or H.
    if (!captured) throw Error('Missing navigation projection');
    const { input, ground } = captured;
    return devTimeSync('navigation_input', () => networkJob(input, ground, known));
  });
  if (!projected) throw Error('Missing village projection');
  projected.travelRoutes.unshift(...routes); // Committed woodland paths were captured with the snapshot.
  return projected;
}

/** Post-commit scoped response. Reuse authoritative cells/stocks without display routing. */
export async function readConstructionConfirmation(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  commit: ConstructionCommit,
): Promise<import('@arbestra/contracts').ConstructionConfirmation> {
  if (commit.confirmation) return commit.confirmation;
  if (!commit.commandId) throw Error('Construction confirmation requires an idempotent command');
  const projected = await withVillageProjection(db, accountId, worldSlug, commit.villageId, (tx, economy, village) =>
    state(tx, accountId, worldSlug, economy, false, true, 'construction', village),
  );
  return {
    kind: 'construction',
    commandId: commit.commandId,
    worldId: commit.worldId,
    villageId: commit.villageId,
    commandTime: commit.through.toISOString(),
    serverTime: projected.serverTime,
    minimumRevision: projected.syncRevision!,
    cells: projected.cells,
    resources: projected.village.resources,
  };
}

/** The same persisted footprints and garden components serve projection and road validation. */
function readVillageOccupancies(tx: Transaction<Database>, village: OwnedVillage) {
  return tx
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
      'buildings.visualLayout',
      'buildings.quarterTurns',
    ])
    .where('worldCellOccupancies.worldId', '=', village.worldId)
    .where('buildings.villageId', '=', village.villageId)
    .execute();
}
type VillageOccupancyRows = Awaited<ReturnType<typeof readVillageOccupancies>>;
function groupVillageOccupancies(
  occupancyRows: VillageOccupancyRows,
  village: Pick<OwnedVillage, 'widthCells' | 'heightCells'>,
) {
  const activeGardenRows = occupancyRows.filter(
    (item) => item.buildingType === 'garden' && item.status === 'completed' && item.pendingExpansionId === null,
  );
  const gardenAt = new Map(activeGardenRows.map((item) => [worldCellKey(item.cellX, item.cellY), item]));
  const canonicalByBuilding = new Map<string, string>();
  const componentBuildings = new Map<string, Set<string>>();
  const visitedGarden = new Set<string>();
  for (const seed of activeGardenRows) {
    const seedKey = worldCellKey(seed.cellX, seed.cellY);
    if (visitedGarden.has(seedKey)) continue;
    const queue = [seed],
      ids = new Set<string>();
    visitedGarden.add(seedKey);
    while (queue.length) {
      const current = queue.shift()!;
      ids.add(current.buildingId);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const neighbour = gardenAt.get(
          worldCellKey(
            normalizeCell(current.cellX + dx, village.widthCells),
            normalizeCell(current.cellY + dy, village.heightCells),
          ),
        );
        if (neighbour && !visitedGarden.has(worldCellKey(neighbour.cellX, neighbour.cellY))) {
          visitedGarden.add(worldCellKey(neighbour.cellX, neighbour.cellY));
          queue.push(neighbour);
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
  return { canonicalByBuilding, componentBuildings, byBuilding };
}

/** Command-local geometry, not a partial economic VillageState or a cached permission. */
export interface InfrastructureSpatialState extends Omit<TravelNetworkState, 'world' | 'village' | 'cells'> {
  world: VillageState['world'];
  village: TravelNetworkState['village'] & {
    id: string;
    wood: number;
    resources: Array<{ code: string; amount: number }>;
  };
  cells: ReadonlyArray<TravelNetworkState['cells'][number] & { footprint: VillageState['cells'][number]['footprint'] }>;
  infrastructure: InfrastructurePlan;
  travelRoutes: TravelRoute[];
}
export async function readInfrastructureSpatialState(
  tx: Transaction<Database>,
  village: OwnedVillage,
  economy: VillageEconomy,
  plan?: InfrastructurePlan,
  routes = true,
  stroke?: RoadStroke,
): Promise<{
  snapshot: InfrastructureSpatialState;
  ground: Snapshot['rc1'];
  /** Rows already read for the geometry; plots are projected only with routes. */
  occupancies: VillageOccupancyRows;
  plots: Awaited<ReturnType<typeof projectGardenPlots>>;
}> {
  if (economy.worldId !== village.worldId || economy.villageId !== village.villageId)
    throw Error('Infrastructure context does not match village economy');
  const [ground, occupancyRows, infrastructure, wood, stone] = await Promise.all([
    snapshot(tx, village),
    readVillageOccupancies(tx, village),
    plan ?? readInfrastructure(tx, village.worldId, village.villageId),
    projectVillageResource(tx, village.worldId, village.villageId, 'wood', economy.through),
    projectVillageResource(tx, village.worldId, village.villageId, 'stone', economy.through),
  ]);
  // Automatic paths are needed only for newly captured, unoccupied cells. The
  // caller validates the stroke before rasterizing it; road undo needs none.
  const occupied = new Set(occupancyRows.map((row) => worldCellKey(row.cellX, row.cellY)));
  const captured = new Set(infrastructure.inheritedCells);
  const needsRoutes =
    routes &&
    (!stroke ||
      [...infrastructureSurface([{ ...stroke, operation: 'paint' }], village).values()].some((pixel) => {
        const cell = subCellKey({ x: (pixel.x + 0.5) / 2, y: (pixel.y + 0.5) / 2 }, village);
        return !occupied.has(cell) && !captured.has(cell);
      }));
  const [features, projectedPlots, extractionRows, navigation] = await Promise.all([
    featuresInSnapshot(tx, village, ground),
    needsRoutes ? projectGardenPlots(tx, village.worldId, village.villageId, economy.through) : Promise.resolve([]),
    needsRoutes ? readExtractions(tx, village.worldId, village.villageId) : Promise.resolve([]),
    needsRoutes ? readNavigationInfrastructure(tx, village, infrastructure) : Promise.resolve(infrastructure),
  ]);
  const { canonicalByBuilding, componentBuildings } = groupVillageOccupancies(occupancyRows, village);
  const townHallBuildingId = occupancyRows.find((row) => row.buildingType === 'town-hall')?.buildingId;
  const context: InfrastructureSpatialState = {
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
      anchorCellX: village.anchorCellX,
      anchorCellY: village.anchorCellY,
      ...(townHallBuildingId ? { townHallBuildingId } : {}),
      wood: wood.amount,
      resources: [
        { code: 'wood', amount: wood.amount },
        { code: 'stone', amount: stone.amount },
      ],
    },
    region: {
      originCellX: ground.originCellX,
      originCellY: ground.originCellY,
      width: ground.width,
      height: ground.height,
      terrainCodes: ground.terrainCodes,
      features: features.map((f) => ({
        id: f.id,
        type: f.featureTypeCode,
        cellX: f.cellX,
        cellY: f.cellY,
        deposit:
          f.initialAmount !== null
            ? {
                ...(f.blocksCell !== null ? { blocksCell: f.blocksCell } : {}),
                cleared: f.cleared ?? false,
                state: f.cleared || f.featureState === 'depleted' ? 'depleted' : 'available',
              }
            : null,
      })),
    },
    cells: occupancyRows.map((row) => {
      const logicalId = canonicalByBuilding.get(row.buildingId) ?? row.buildingId;
      const component = componentBuildings.get(logicalId);
      const plots =
        row.buildingType === 'garden'
          ? projectedPlots.filter((p) => component?.has(p.buildingId) ?? p.buildingId === row.buildingId)
          : [];
      return {
        cellX: row.cellX,
        cellY: row.cellY,
        footprint: {
          buildingId: logicalId,
          buildingType: row.buildingType,
          role: row.role as 'anchor' | 'extension',
          state: row.status === 'under-construction' || row.pendingExpansionId !== null ? 'reserved' : 'active',
        },
        building:
          row.role === 'anchor' && (!canonicalByBuilding.has(row.buildingId) || row.buildingId === logicalId)
            ? {
                id: logicalId,
                type: row.buildingType,
                quarterTurns: row.visualLayout?.quarterTurns ?? row.quarterTurns,
                visualLayout: row.visualLayout,
                garden:
                  row.buildingType === 'garden' && plots.length
                    ? { plots: plots.map((p) => ({ cellX: p.cellX, cellY: p.cellY })) }
                    : null,
              }
            : null,
      };
    }),
    infrastructure,
    travelRoutes: [],
  };
  if (needsRoutes) {
    context.travelRoutes = await commandTravelNetwork(tx, { ...context, infrastructure: navigation }, ground.rc1);
    for (const { extraction } of extractionRows)
      if (extraction.resourceCode === 'wood' && extraction.path.length)
        context.travelRoutes.push({
          id: extraction.featureId,
          kind: 'wood',
          destination: { cellX: extraction.cellX, cellY: extraction.cellY },
          cells: extraction.path,
        });
  }
  return { snapshot: context, ground: ground.rc1, occupancies: occupancyRows, plots: projectedPlots };
}

/** Garden plots a selection can name, with the eligibility facts the full
 * snapshot gives them: one entry per plot under the anchor of its logical
 * garden (merged component), its building status and any in-progress harvest. */
function gardenSelectionPlots(
  occupancyRows: VillageOccupancyRows,
  projectedPlots: Awaited<ReturnType<typeof projectGardenPlots>>,
  harvestRows: ReadonlyArray<{
    buildingId: string;
    plotCellX: number | null;
    plotCellY: number | null;
    stops: ReadonlyArray<{ cellX: number; cellY: number }>;
  }>,
  village: Pick<OwnedVillage, 'widthCells' | 'heightCells'>,
) {
  const harvestedPlots = new Set(
    harvestRows
      .filter((item) => item.plotCellX !== null)
      .flatMap((item) =>
        (item.stops.length ? item.stops : [{ cellX: item.plotCellX!, cellY: item.plotCellY! }]).map((plot) =>
          worldCellKey(plot.cellX, plot.cellY),
        ),
      ),
  );
  const legacyHarvests = new Set(harvestRows.filter((item) => item.plotCellX === null).map((item) => item.buildingId));
  const { canonicalByBuilding, componentBuildings } = groupVillageOccupancies(occupancyRows, village);
  return occupancyRows.flatMap((row) => {
    const logicalId = canonicalByBuilding.get(row.buildingId) ?? row.buildingId;
    if (row.buildingType !== 'garden' || row.role !== 'anchor' || row.buildingId !== logicalId) return [];
    const members = componentBuildings.get(logicalId) ?? new Set([row.buildingId]);
    const legacyHarvest = [...members].some((id) => legacyHarvests.has(id));
    return projectedPlots
      .filter((plot) => members.has(plot.buildingId))
      .map((plot) => ({
        cellX: plot.cellX,
        cellY: plot.cellY,
        storedCarrots: plot.amount,
        status: row.status,
        harvested: legacyHarvest || harvestedPlots.has(worldCellKey(plot.cellX, plot.cellY)),
      }));
  });
}

export async function state(
  tx: Transaction<Database>,
  accountId: string,
  worldSlug: string,
  existingEconomy?: VillageEconomy,
  admit = true,
  readOnly = false,
  deferNavigation?:
    | 'observation'
    | 'construction'
    | ((input: NetworkJob['state'], ground: Awaited<ReturnType<typeof readRc1Ground>> | undefined) => void),
  projectionVillage?: OwnedVillage,
): Promise<VillageState> {
  return devTime('snapshot', async () => {
    if (deferNavigation && !readOnly) throw Error('Deferred navigation requires a read-only projection');
    if (readOnly && !existingEconomy) throw Error('Read-only projection requires an explicit clock/context');
    const village =
      readOnly && projectionVillage
        ? projectionVillage
        : await ownedVillage(tx, accountId, worldSlug, existingEconomy?.villageId);
    // Prepare immutable geography before the economy lock. snapshot() revalidates
    // its identity and reads current local edits after the lock is acquired.
    if (!existingEconomy && village.generationVersion === 3) await readRc1Source(tx, village.worldId);
    const economy = existingEconomy ?? (await beginVillageEconomy(tx, village.worldId, village.villageId));
    if (economy.worldId !== village.worldId || economy.villageId !== village.villageId)
      throw new Error('Village economy context does not match the requested village');
    if (!readOnly) await finalizeVillageEconomy(tx, economy, village, admit);
    const at = economy.through;
    const syncBefore = await villageSyncRevision(tx, village.worldId);
    const occupancies = readVillageOccupancies(tx, village);
    const [ground, resourcesRows, definitions, occupancyRows, protectedRows, hiddenSupplyRows, accomplishmentRows] =
      await devTime('snapshot_reads', () =>
        Promise.all([
          occupancies.then((footprints) => snapshot(tx, village, { footprints })),
          projectVillageResources(tx, village.worldId, village.villageId, at),
          catalog(tx),
          occupancies,
          clearings(tx, village.worldId),
          tx
            .selectFrom('buildingHiddenSupplies')
            .select(['buildingId', 'claimedAt'])
            .where('worldId', '=', village.worldId)
            .where('villageId', '=', village.villageId)
            .execute(),
          tx
            .selectFrom('villageAccomplishments')
            .select(['code', 'completedAt'])
            .where('worldId', '=', village.worldId)
            .where('villageId', '=', village.villageId)
            .orderBy('completedAt')
            .orderBy('code')
            .execute(),
        ]),
      );
    const resources = resourcesRows.map((row) => {
      safeAmount(row.amount);
      return {
        ...row,
        productionUpdatedAt: row.productionUpdatedAt?.toISOString() ?? null,
      };
    });
    const [cohorts, housingRows, harvestRows, extractionRows, projectedPlots, growth] = await devTime(
      'population',
      () =>
        Promise.all([
          readOnly
            ? tx
                .selectFrom('populationCohorts')
                .selectAll()
                .where('worldId', '=', village.worldId)
                .where('villageId', '=', village.villageId)
                .orderBy('id')
                .execute()
            : reconcileRestHousing(tx, village.worldId, village.villageId, at),
          tx
            .selectFrom('buildings')
            .select(['id', 'buildingType', 'level'])
            .where('worldId', '=', village.worldId)
            .where('villageId', '=', village.villageId)
            .where((eb) => eb.or([eb('status', '=', 'completed'), eb('targetLevel', 'is not', null)]))
            .execute(),
          tx
            .selectFrom('gardenHarvests')
            .selectAll()
            .where('worldId', '=', village.worldId)
            .where('villageId', '=', village.villageId)
            .where('status', '=', 'in-progress')
            .execute(),
          readExtractions(tx, village.worldId, village.villageId),
          projectGardenPlots(tx, village.worldId, village.villageId, at),
          tx
            .selectFrom('villagePopulations')
            .select('nextArrivalAt')
            .where('worldId', '=', village.worldId)
            .where('villageId', '=', village.villageId)
            .executeTakeFirst(),
        ]),
    );
    const population = projectPopulation(cohorts, housingRows, growth, at);
    const harvestByPlot = new Map(
      harvestRows
        .filter((item) => item.plotCellX !== null)
        .flatMap((item) =>
          (item.stops.length ? item.stops : [{ cellX: item.plotCellX!, cellY: item.plotCellY! }]).map(
            (plot) => [worldCellKey(plot.cellX, plot.cellY), item] as const,
          ),
        ),
    );
    const legacyHarvestByBuilding = new Map(
      harvestRows.filter((item) => item.plotCellX === null).map((item) => [item.buildingId, item]),
    );
    const { canonicalByBuilding, componentBuildings, byBuilding } = groupVillageOccupancies(occupancyRows, village);
    const expansionIds = [
      ...new Set(occupancyRows.flatMap((row) => (row.pendingExpansionId ? [row.pendingExpansionId] : []))),
    ];
    const expansions =
      expansionIds.length === 0
        ? []
        : await tx
            .selectFrom('buildingExpansions')
            .select(['id', 'startedAt', 'completesAt'])
            .where('worldId', '=', village.worldId)
            .where('id', 'in', expansionIds)
            .execute();
    const expansionById = new Map(expansions.map((item) => [item.id, item]));
    const hiddenSupplies = new Map(hiddenSupplyRows.map((item) => [item.buildingId, item.claimedAt === null]));
    const available = candidates(
      occupancyRows
        .filter(
          (row) =>
            (row.status === 'completed' || (row.buildingType === 'town-hall' && row.targetLevel !== null)) &&
            row.pendingExpansionId === null,
        )
        .map((row) => ({ cellX: row.cellX, cellY: row.cellY })),
      village,
    );
    const occupied = new Map(occupancyRows.map((row) => [worldCellKey(row.cellX, row.cellY), row]));
    const visible = new Set([...available, ...occupied.keys()]);
    // The snapshot shows each touched tree of its woodlands (slice 2d).
    const features = await featuresInSnapshot(tx, village, ground, false, true);
    const featureCells = new Set(
      features
        .filter((feature) => (feature.resourceCode ? feature.blocksCell : feature.featureState !== 'depleted'))
        .map((feature) => worldCellKey(feature.cellX, feature.cellY)),
    );
    const wood = resources.find((item) => item.code === 'wood'),
      carrot = resources.find((item) => item.code === 'carrot');
    if (!wood || !carrot || !wood.productionUpdatedAt) throw new Error('Village resource seed is incomplete');
    const townHallBuildingId = occupancyRows.find((row) => row.buildingType === 'town-hall')?.buildingId;
    const villageState: VillageState = {
      science: await scienceSnapshot(tx, economy, readOnly),
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
        ...(townHallBuildingId ? { townHallBuildingId } : {}),
        resources,
        wood: wood.amount,
        carrots: carrot.amount,
        woodProductionPerHour: wood.productionPerHour,
        woodProductionUpdatedAt: wood.productionUpdatedAt,
        population,
        accomplishments: accomplishmentRows.map((item) => ({
          code: item.code,
          completedAt: item.completedAt.toISOString(),
        })),
        extractions: extractionRows.map((row) => row.extraction),
        worksites: await readWorksites(tx, village.worldId, village.villageId, extractionRows),
        extractionPools: await readExtractionPools(tx, village.worldId, village.villageId),
        exploitationOrders: await readExploitationOrders(tx, economy, {
          gardens: harvestRows,
          extractions: extractionRows,
        }),
        levelingJobs: await levelingSnapshot(tx, economy),
        processingOrders: await processingSnapshot(tx, economy),
        market: await marketSnapshot(tx, economy),
      },
      buildingTypes: definitions,
      travelRoutes: [],
      region: {
        originCellX: ground.originCellX,
        originCellY: ground.originCellY,
        width: ground.width,
        height: ground.height,
        terrainCodes: ground.terrainCodes,
        elevations: ground.elevations,
        ...(ground.rc1?.field.geometry
          ? {
              vertexHeights: Array.from({ length: (ground.width + 1) * (ground.height + 1) }, (_, i) =>
                ground.rc1!.field.geometry!.height(
                  ground.originCellX + (i % (ground.width + 1)),
                  ground.originCellY + Math.floor(i / (ground.width + 1)),
                ),
              ),
            }
          : {}),
        features: features.map((feature) => ({
          id: feature.id,
          type: feature.featureTypeCode,
          cellX: feature.cellX,
          cellY: feature.cellY,
          variantSeed: feature.variantSeed,
          deposit:
            feature.initialAmount !== null
              ? {
                  featureId: feature.id,
                  resourceCode: feature.resourceCode!,
                  blocksCell: feature.blocksCell!,
                  cleared: feature.cleared ?? false,
                  cellX: feature.cellX,
                  cellY: feature.cellY,
                  initialAmount: safeAmount(feature.initialAmount!),
                  remainingAmount: safeAmount(feature.remainingAmount!),
                  reservedAmount: safeAmount(feature.reservedAmount!),
                  availableAmount: safeAmount(feature.remainingAmount!) - safeAmount(feature.reservedAmount!),
                  ...(feature.resourceCode === 'wood'
                    ? { cutAmount: safeAmount(feature.cutAmount!), ...woodlandTreesField(feature.trees) }
                    : {}),
                  state:
                    feature.cleared || feature.featureState === 'depleted'
                      ? ('depleted' as const)
                      : ('available' as const),
                  revision: safeAmount(feature.revision!),
                  updatedAt: feature.updatedAt!.toISOString(),
                }
              : null,
        })),
      },
      cells: [...visible]
        .map((key) => {
          const [cellX, cellY] = parseCellKey(key);
          const row = occupied.get(key),
            logicalBuildingId = row ? (canonicalByBuilding.get(row.buildingId) ?? row.buildingId) : '',
            footprint = row ? (byBuilding.get(logicalBuildingId) ?? []) : [],
            activeCells = footprint.filter((item) => item.pendingExpansionId === null),
            pendingCells = footprint.filter((item) => item.pendingExpansionId !== null),
            gardenExpansions = [
              ...new Set(pendingCells.flatMap((item) => (item.pendingExpansionId ? [item.pendingExpansionId] : []))),
            ]
              .flatMap((id) => {
                const item = expansionById.get(id);
                return item
                  ? [
                      {
                        id,
                        startedAt: item.startedAt.toISOString(),
                        completesAt: item.completesAt.toISOString(),
                        cells: pendingCells
                          .filter((cell) => cell.pendingExpansionId === id)
                          .map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
                      },
                    ]
                  : [];
              })
              .sort((a, b) => a.completesAt.localeCompare(b.completesAt) || a.id.localeCompare(b.id)),
            plots =
              row?.buildingType === 'garden'
                ? projectedPlots.filter((plot) =>
                    (componentBuildings.get(logicalBuildingId) ?? new Set([row.buildingId])).has(plot.buildingId),
                  )
                : [];
          return {
            id: key,
            cellX,
            cellY,
            x: wrappedDelta(cellX, village.anchorCellX, village.widthCells) * CELL_SIZE,
            z: wrappedDelta(cellY, village.anchorCellY, village.heightCells) * CELL_SIZE,
            building:
              row?.role === 'anchor' &&
              (!canonicalByBuilding.has(row.buildingId) || row.buildingId === logicalBuildingId)
                ? {
                    id: logicalBuildingId,
                    type: row.buildingType as BuildingType,
                    level: row.level,
                    targetLevel: row.targetLevel,
                    status: row.status,
                    constructionStartedAt: row.constructionStartedAt?.toISOString() ?? null,
                    constructionCompletesAt: row.constructionCompletesAt?.toISOString() ?? null,
                    completedAt: row.completedAt?.toISOString() ?? null,
                    hiddenSuppliesAvailable: hiddenSupplies.get(row.buildingId) ?? false,
                    visualLayout: row.visualLayout,
                    quarterTurns: row.visualLayout?.quarterTurns ?? row.quarterTurns,
                    garden:
                      row.buildingType === 'garden' && plots.length
                        ? {
                            storedCarrots: plots.reduce((sum, plot) => sum + plot.amount, 0),
                            capacity: plots.reduce((sum, plot) => sum + plot.capacity, 0),
                            productionPerHour: plots.reduce((sum, plot) => sum + plot.productionPerHour, 0),
                            productionUpdatedAt: at.toISOString(),
                            activeCellCount: row.status === 'completed' ? activeCells.length : 0,
                            pendingCellCount: row.status === 'completed' ? pendingCells.length : footprint.length,
                            plots: plots.map((plot) => {
                              const harvest = harvestByPlot.get(worldCellKey(plot.cellX, plot.cellY));
                              return {
                                cellX: plot.cellX,
                                cellY: plot.cellY,
                                storedCarrots: plot.amount,
                                capacity: plot.capacity,
                                productionPerHour: plot.productionPerHour,
                                productionUpdatedAt: plot.productionUpdatedAt.toISOString(),
                                full: plot.amount >= plot.capacity,
                                harvest: harvest
                                  ? {
                                      id: harvest.id,
                                      startedAt: harvest.startedAt.toISOString(),
                                      completesAt: harvest.completesAt.toISOString(),
                                      reservedCarrots:
                                        harvest.stops.find((s) => s.cellX === plot.cellX && s.cellY === plot.cellY)
                                          ?.reservedCarrots ?? number(harvest.reservedCarrots),
                                      transportMs: harvest.transportMs,
                                      path: harvest.pathCells ?? [],
                                      stops: harvest.stops,
                                      returnPath: harvest.returnPathCells ?? [],
                                    }
                                  : null,
                              };
                            }),
                            expansion: gardenExpansions[0] ?? null,
                            expansions: gardenExpansions,
                            harvest: [...(componentBuildings.get(logicalBuildingId) ?? new Set([row.buildingId]))]
                              .map((id) => legacyHarvestByBuilding.get(id))
                              .find(Boolean)
                              ? (() => {
                                  const harvest = [
                                    ...(componentBuildings.get(logicalBuildingId) ?? new Set([row.buildingId])),
                                  ]
                                    .map((id) => legacyHarvestByBuilding.get(id))
                                    .find(Boolean)!;
                                  return {
                                    id: harvest.id,
                                    startedAt: harvest.startedAt.toISOString(),
                                    completesAt: harvest.completesAt.toISOString(),
                                    workerCount: harvest.workerCount,
                                    reservedCarrots: number(harvest.reservedCarrots),
                                    transportMs: harvest.transportMs,
                                    path: harvest.pathCells ?? [],
                                  };
                                })()
                              : null,
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
              deferNavigation !== 'observation' &&
              available.has(key) &&
              !row &&
              !featureCells.has(key) &&
              ground.terrainAt(cellX, cellY) === TERRAIN.grassland &&
              (!ground.rc1 ||
                (!ground.rc1.field.surfaceReason(
                  { x: cellX, y: cellY, halfWidth: 0.5, halfHeight: 0.5 },
                  null,
                  0.125,
                ) &&
                  !ground.rc1.field.intersectsTree({ x: cellX, y: cellY, halfWidth: 0.5, halfHeight: 0.5 }))) &&
              !protectedCell(cellX, cellY, protectedRows, village),
          };
        })
        // Keep the same spatial support for the shared renderer, but inspection
        // never needs the expensive terrain suitability previews for commands.
        .filter((cell) => deferNavigation === 'observation' || cell.canBuild || cell.footprint !== null),
    };
    villageState.infrastructure = await devTime('infrastructure', () =>
      readInfrastructure(tx, village.worldId, village.villageId),
    );
    villageState.factoryEnabled = await factoryCapability(tx, village.worldId);
    if (deferNavigation === 'observation' || deferNavigation === 'construction') villageState.travelRoutes = [];
    else {
      const navigationInfrastructure = await devTime('infrastructure', () =>
        readNavigationInfrastructure(tx, village, villageState.infrastructure),
      );
      if (deferNavigation) {
        deferNavigation(networkState({ ...villageState, infrastructure: navigationInfrastructure }), ground.rc1);
        villageState.travelRoutes = [];
      } else
        villageState.travelRoutes = await commandTravelNetwork(
          tx,
          { ...villageState, infrastructure: navigationInfrastructure },
          ground.rc1,
        );
    }
    // Reuse committed mission paths; do not search routes to every woodland in the snapshot.
    for (const extraction of villageState.village.extractions)
      if (extraction.resourceCode === 'wood' && extraction.path.length) {
        villageState.travelRoutes.push({
          id: extraction.featureId,
          kind: 'wood',
          destination: { cellX: extraction.cellX, cellY: extraction.cellY },
          cells: extraction.path,
        });
      }
    const syncAfter = readOnly && projectionVillage ? syncBefore : await villageSyncRevision(tx, village.worldId);
    // A concurrent world commit can invalidate READ COMMITTED assembly. The
    // HTTP adapter replaces such a snapshot after commit with a coherent reader.
    if (syncBefore.others === syncAfter.others) villageState.syncRevision = syncAfter.revision;
    return villageState;
  });
}

async function definition(
  tx: Transaction<Database>,
  buildingType: string,
  level: number,
  houseVariant: 'stone' | 'logs' | 'beams' = 'stone',
) {
  const row = await tx
    .selectFrom('buildingTypes')
    .innerJoin('buildingTypeLevels', 'buildingTypeLevels.buildingTypeCode', 'buildingTypes.code')
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
  if (!row) throw new HttpError(409, 'BUILDING_LEVEL_UNKNOWN', 'Ce niveau de bâtiment n’existe pas.');
  const [costs, production, variants] = await Promise.all([
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
    tx
      .selectFrom('buildingVariantCosts')
      .select(['resourceCode', 'amount', 'replacesResourceCode'])
      .where('buildingTypeCode', '=', buildingType)
      .where('level', '=', level)
      .where('variant', '=', houseVariant)
      .execute(),
  ]);
  const combined = new Map(costs.map((c) => [c.resourceCode, Number(c.amount)]));
  for (const c of variants) {
    if (c.replacesResourceCode) combined.delete(c.replacesResourceCode);
    combined.set(c.resourceCode, (combined.get(c.resourceCode) ?? 0) + Number(c.amount));
  }
  return { ...row, costs: [...combined].map(([resourceCode, amount]) => ({ resourceCode, amount })), production };
}
export async function debit(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  costs: Array<{ resourceCode: string; amount: string | number }>,
  at: Date,
) {
  for (const cost of [...costs].sort((left, right) => left.resourceCode.localeCompare(right.resourceCode))) {
    const amount = number(cost.amount);
    if ((await materializeVillageResource(tx, worldId, villageId, cost.resourceCode, at)) < amount)
      throw new HttpError(409, 'INSUFFICIENT_RESOURCES', 'Ressources insuffisantes.');
    await tx
      .updateTable('villageResources')
      .set({ amount: sql`amount - ${amount}::bigint` })
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('resourceCode', '=', cost.resourceCode)
      .execute();
  }
}
async function assertBuildable(tx: Transaction<Database>, village: OwnedVillage, cellX: number, cellY: number) {
  return assertBuildableCells(tx, village, [{ cellX, cellY }]);
}
/** One command context for the whole footprint, after the village/spatial locks. */
export async function assertBuildableCells(
  tx: Transaction<Database>,
  village: OwnedVillage,
  cells: readonly SpatialCell[],
) {
  if (!cells.length) return;
  const leveling = await tx
    .selectFrom('levelingJobs')
    .select('quote')
    .where('worldId', '=', village.worldId)
    .where('completedAt', 'is', null)
    .execute();
  if (
    leveling.some((j) =>
      j.quote.cells.some((p) =>
        cells.some(
          (c) => toroidalChebyshev(c.cellX, c.cellY, p.cellX, p.cellY, village.widthCells, village.heightCells) <= 1,
        ),
      ),
    )
  )
    throw new HttpError(
      409,
      'LEVELING_NEARBY',
      'Attendez la fin du nivellement avant de construire sur cette emprise ou contre son bord.',
    );
  await assertNoInfrastructure(tx, village.worldId, cells, village);
  const ground = await snapshot(tx, village),
    protectedRows = await clearings(tx, village.worldId);
  const occupied = await tx
    .selectFrom('worldCellOccupancies')
    .select(['cellX', 'cellY'])
    .where('worldId', '=', village.worldId)
    .where((eb) => eb.or(cells.map((c) => eb.and([eb('cellX', '=', c.cellX), eb('cellY', '=', c.cellY)]))))
    .execute();
  const occupiedKeys = new Set(occupied.map((c) => worldCellKey(c.cellX, c.cellY)));
  const footprints = await tx
    .selectFrom('worldCellOccupancies')
    .innerJoin('buildings', (j) =>
      j
        .onRef('buildings.id', '=', 'worldCellOccupancies.buildingId')
        .onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId'),
    )
    .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY', 'worldCellOccupancies.pendingExpansionId'])
    .where('worldCellOccupancies.worldId', '=', village.worldId)
    .where('buildings.villageId', '=', village.villageId)
    .where((eb) =>
      eb.or([
        eb('buildings.status', '=', 'completed'),
        eb.and([eb('buildings.buildingType', '=', 'town-hall'), eb('buildings.targetLevel', 'is not', null)]),
      ]),
    )
    .execute();
  const sources = footprints.filter((c) => c.pendingExpansionId === null);
  for (const { cellX, cellY } of cells) {
    const surface = { x: cellX, y: cellY, halfWidth: 0.5, halfHeight: 0.5 };
    if (
      ground.terrainAt(cellX, cellY) !== TERRAIN.grassland ||
      (ground.rc1 && (ground.rc1.field.surfaceReason(surface, null, 0.125) || ground.rc1.field.intersectsTree(surface)))
    )
      throw new HttpError(409, 'TERRAIN_NOT_BUILDABLE', 'Cette emprise rencontre un obstacle naturel.');
    if (occupiedKeys.has(worldCellKey(cellX, cellY)))
      throw new HttpError(409, 'CELL_OCCUPIED', 'Cette case est déjà occupée.');
    if (protectedCell(cellX, cellY, protectedRows, village))
      throw new HttpError(409, 'CLEARING_PROTECTED', 'Cette clairière est protégée.');
    if (!withinBuildReach({ cellX, cellY }, sources, village))
      throw new HttpError(409, 'OUTSIDE_VILLAGE_REACH', 'Cette case est trop éloignée de votre village.');
  }
  return ground;
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
    .onConflict((conflict) => conflict.columns(['worldId', 'cellX', 'cellY']).doNothing())
    .returning('cellX')
    .executeTakeFirst();
  if (row) await claimWoodlandCell(tx, worldId, cellX, cellY);
  if (!row) throw new HttpError(409, 'CELL_OCCUPIED', 'Cette case vient d’être réservée.');
}

async function reserveSelection(
  tx: Transaction<Database>,
  worldId: string,
  buildingId: string,
  anchor: SpatialCell,
  cells: SpatialCell[],
  pendingExpansionId: string | null = null,
  initial = true,
) {
  for (const cell of [...cells].sort((left, right) => left.cellX - right.cellX || left.cellY - right.cellY)) {
    const row = await tx
      .insertInto('worldCellOccupancies')
      .values({
        worldId,
        cellX: cell.cellX,
        cellY: cell.cellY,
        buildingId,
        featureId: null,
        pendingExpansionId,
        role: initial && cell.cellX === anchor.cellX && cell.cellY === anchor.cellY ? 'anchor' : 'extension',
      })
      .onConflict((conflict) => conflict.columns(['worldId', 'cellX', 'cellY']).doNothing())
      .returning('cellX')
      .executeTakeFirst();
    await claimWoodlandCell(tx, worldId, cell.cellX, cell.cellY);
    if (!row) throw new HttpError(409, 'CELL_OCCUPIED', 'Au moins une case vient d’être réservée.');
  }
}

const readReconciliations = new WeakMap<Kysely<Database>, VillageReadReconciliations>();

/** Read-side wakeup: finish all economic writes, but do not build a transport
 * snapshot while holding village/deposit/navigation locks. */
export async function reconcileVillageForRead(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId?: string,
) {
  // Resolve the default village and check this caller before joining a flight.
  const candidate = await ownedVillage(db, accountId, worldSlug, villageId);
  let reconciliations = readReconciliations.get(db);
  if (!reconciliations) {
    reconciliations = new VillageReadReconciliations((owner, slug, id) =>
      db.transaction().execute(async (tx) => {
        const village = await ownedVillage(tx, owner, slug, id);
        if (village.generationVersion === 3) await readRc1Source(tx, village.worldId);
        const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
        // No command took place after begin: all due transitions are already at H.
        await devTime('admission', () => admitVillageWork(tx, economy, village));
        await reconcileRestHousing(tx, village.worldId, village.villageId, economy.through);
        return economy;
      }),
    );
    readReconciliations.set(db, reconciliations);
  }
  return reconciliations.run(accountId, worldSlug, candidate.worldId, candidate.villageId);
}

export function getVillageState(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId?: string,
  compute?: TravelNetworkExecutor,
) {
  return devTime('village', async () => {
    const committed = await reconcileVillageForRead(db, accountId, worldSlug, villageId);
    // This fresh MVCC view starts after the wakeup committed; its own serverTime
    // and revision cover every projected field. Commands retain their existing H.
    return readVillageProjection(db, accountId, worldSlug, committed.villageId, compute);
  });
}

export async function commandVillageScience<Mode extends ConstructionReplyMode = 'snapshot'>(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  command: ScienceCommand,
  replyMode: Mode = 'snapshot' as Mode,
  afterWrites?: AfterConstructionWrites,
): Promise<ConstructionResult<Mode>> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    await scienceCommand(tx, economy, command);
    return villageCommandResult(tx, accountId, worldSlug, village, economy, replyMode, undefined, afterWrites);
  });
}

/** Durable receipts are immutable. A retry only needs ownership, request equality
 * and a fresh read-only transport projection; it must not wake unrelated work. */
async function replayVillageCommand(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  command: MarketCommand | ProcessingCommand,
  table: 'marketExchanges' | 'processingCommandReceipts',
): Promise<ConstructionCommit | undefined> {
  const village = await ownedVillage(db, accountId, worldSlug, villageId);
  const previous = await db
    .selectFrom(table)
    .select(['request', sql<Date>`statement_timestamp()`.as('through')])
    .where('worldId', '=', village.worldId)
    .where('villageId', '=', villageId)
    .where('commandId', '=', command.commandId)
    .executeTakeFirst();
  if (!previous) return;
  if (!isDeepStrictEqual(previous.request, command))
    throw new HttpError(409, 'COMMAND_REUSED', 'Identifiant de commande déjà utilisé.');
  return {
    worldId: village.worldId,
    villageId: village.villageId,
    through: previous.through,
    commandId: command.commandId,
  };
}

export async function commandVillageProcessing<Mode extends ConstructionReplyMode = 'snapshot'>(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  command: ProcessingCommand,
  replyMode: Mode = 'snapshot' as Mode,
  budget?: ReconciliationBudget,
): Promise<ConstructionResult<Mode>> {
  if (replyMode === 'commit') {
    const replay = await replayVillageCommand(
      db,
      accountId,
      worldSlug,
      villageId,
      command,
      'processingCommandReceipts',
    );
    if (replay) return replay as ConstructionResult<Mode>;
  }
  return db
    .transaction()
    .execute(async (tx) => {
      const village = await ownedVillage(tx, accountId, worldSlug, villageId);
      if (replyMode === 'commit') {
        const prepared = await beginProcessingCommand(tx, village.worldId, village.villageId, command, budget);
        if (prepared.catchingUp) throw new ScopeCatchingUp();
        if (!prepared.replay) {
          await commandProcessing(tx, prepared.economy, command);
          if (prepared.reconciled)
            await reconcileRestHousing(tx, village.worldId, village.villageId, prepared.economy.through);
        }
        // Processing durations are strictly positive; the command cannot create
        // a new completion at H. Do not run unrelated admissions as a finalizer.
        return { ...prepared.economy, commandId: command.commandId } as ConstructionResult<Mode>;
      }
      const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
      await commandProcessing(tx, economy, command);
      return villageCommandResult(tx, accountId, worldSlug, village, economy, replyMode, command.commandId);
    })
    .catch(async (error) => {
      // Kysely has completed ROLLBACK before this separate durable wakeup.
      // There is no command receipt or deferred command intent on this path.
      if (error instanceof ScopeCatchingUp) await requestEconomyCatchup(db, accountId, worldSlug, villageId);
      throw error;
    });
}

export async function previewVillageProcessing(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
  workerCount: number,
  orderId?: string,
) {
  return withVillageProjection(db, accountId, worldSlug, villageId, (tx, economy) =>
    previewProcessing(tx, economy, buildingId, workerCount, orderId),
  );
}

/** Explicit administrative pilot conversion. No catalog upgrade, cost or implicit migration. */
export async function configureTownHallFactory(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  cellX: number,
  cellY: number,
  apply = true,
  entranceFace: '-x' | '+x' = '-x',
) {
  let preview: unknown;
  const previewRollback = new Error('FACTORY_PREVIEW_ROLLBACK');
  try {
    return await db.transaction().execute(async (tx) => {
      const village = await ownedVillage(tx, accountId, worldSlug);
      if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
      const x = normalizeCell(cellX, village.widthCells),
        y = normalizeCell(cellY, village.heightCells);
      const economy = await beginVillageEconomy(
        tx,
        village.worldId,
        villageId,
        undefined,
        [{ cellX: x, cellY: y }],
        [],
        true,
      );
      await reconcileVillageEconomy(tx, economy);
      const hall = await tx
        .selectFrom('buildings')
        .selectAll()
        .where('worldId', '=', village.worldId)
        .where('villageId', '=', villageId)
        .where('buildingType', '=', 'town-hall')
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (hall.status !== 'completed') throw new HttpError(409, 'BUILDING_BUSY', 'Hôtel de ville en travaux.');
      const cells = await tx
        .selectFrom('worldCellOccupancies')
        .select(['cellX', 'cellY', 'role'])
        .where('worldId', '=', village.worldId)
        .where('buildingId', '=', hall.id)
        .execute();
      const anchor = cells.find((c) => c.role === 'anchor')!;
      if (hall.visualLayout) {
        if (cells.some((c) => c.cellX === x && c.cellY === y)) {
          preview = { buildingId: hall.id, cells, layout: hall.visualLayout, alreadyConfigured: true };
          if (!apply) throw previewRollback;
          return preview;
        }
        throw new HttpError(409, 'LAYOUT_ALREADY_SET', 'Implantation déjà configurée.');
      }
      if (
        cells.length !== 1 ||
        toroidalManhattan(anchor.cellX, anchor.cellY, x, y, village.widthCells, village.heightCells) !== 1
      )
        throw new HttpError(409, 'INVALID_FOOTPRINT', 'Une cellule voisine est requise.');
      const ground = await assertBuildable(tx, village, x, y);
      assertFlatVertexFoundation(ground, [{ cellX: x, cellY: y }], village);
      const elevation = (cx: number, cy: number) => ground?.elevationAt(cx, cy) ?? NaN;
      if (Math.abs(elevation(x, y) - elevation(anchor.cellX, anchor.cellY)) > 1)
        throw new HttpError(409, 'UNEVEN_TERRAIN', 'Emprise trop inclinée.');
      const quarterTurns = x === anchor.cellX ? 0 : 1;
      const layout = {
        recipe: 'town-hall' as const,
        version: 1 as const,
        quarterTurns,
        entranceFace,
        offset: [0, 0] as [number, number],
      };
      preview = { buildingId: hall.id, cells: [anchor, { cellX: x, cellY: y, role: 'extension' }], layout };
      if (!apply) throw previewRollback;
      await reserve(tx, village.worldId, x, y, hall.id, 'extension');
      await tx
        .updateTable('buildings')
        .set({ visualLayout: layout })
        .where('worldId', '=', village.worldId)
        .where('id', '=', hall.id)
        .executeTakeFirstOrThrow();
      return preview;
    });
  } catch (error) {
    if (error === previewRollback) return preview;
    throw error;
  }
}
const universityCampusCells = (anchor: SpatialCell, quarterTurns = 0) =>
  fixedBuildingFootprint('university', anchor, quarterTurns);

/** Conservative adaptation of existing campuses; village/business locks are already held. */
async function ensureUniversityCampus(
  tx: Transaction<Database>,
  village: OwnedVillage,
  buildingId: string,
  anchor: SpatialCell,
) {
  const building = await tx
    .selectFrom('buildings')
    .select('quarterTurns')
    .where('worldId', '=', village.worldId)
    .where('id', '=', buildingId)
    .where('villageId', '=', village.villageId)
    .executeTakeFirstOrThrow();
  const cells = universityCampusCells(anchor, building.quarterTurns).map((c) => ({
    cellX: normalizeCell(c.cellX, village.widthCells),
    cellY: normalizeCell(c.cellY, village.heightCells),
  }));
  const existing = await tx
    .selectFrom('worldCellOccupancies')
    .select(['cellX', 'cellY'])
    .where('worldId', '=', village.worldId)
    .where('buildingId', '=', buildingId)
    .execute();
  const expected = new Set(cells.map((c) => worldCellKey(c.cellX, c.cellY)));
  if (existing.some((c) => !expected.has(worldCellKey(c.cellX, c.cellY))))
    throw new HttpError(409, 'INVALID_BUILDING_FOOTPRINT', 'L’emprise existante ne correspond pas à ce campus.');
  const occupied = new Set(existing.map((c) => worldCellKey(c.cellX, c.cellY)));
  const added = cells.filter((c) => !occupied.has(worldCellKey(c.cellX, c.cellY)));
  if (!added.length) return;
  const ground = await snapshot(tx, village);
  const heights = footprintHeights(ground, cells, village);
  if (!isBuildingFootprintFlat(heights))
    throw new HttpError(409, 'UNEVEN_TERRAIN', 'L’Université demande une emprise plane.');
  await assertBuildableCells(tx, village, added);
  await reserveSelection(tx, village.worldId, buildingId, anchor, added, null, false);
}

/** Explicit deployment/recipe adaptation, never performed by a snapshot read. */
export async function adaptUniversityCampus(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const anchor = await tx
      .selectFrom('worldCellOccupancies')
      .innerJoin('buildings', 'buildings.id', 'worldCellOccupancies.buildingId')
      .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY'])
      .where('worldCellOccupancies.worldId', '=', village.worldId)
      .where('worldCellOccupancies.buildingId', '=', buildingId)
      .where('buildings.villageId', '=', village.villageId)
      .where('buildings.buildingType', '=', 'university')
      .where('worldCellOccupancies.role', '=', 'anchor')
      .executeTakeFirst();
    if (!anchor) throw new HttpError(404, 'BUILDING_NOT_FOUND', 'Université introuvable.');
    const cells = universityCampusCells(anchor).map((c) => ({
      cellX: normalizeCell(c.cellX, village.widthCells),
      cellY: normalizeCell(c.cellY, village.heightCells),
    }));
    await beginVillageEconomy(tx, village.worldId, village.villageId, undefined, cells, [], true);
    await tx
      .selectFrom('buildings')
      .select('id')
      .where('worldId', '=', village.worldId)
      .where('id', '=', buildingId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    await ensureUniversityCampus(tx, village, buildingId, anchor);
  });
}

type ExpectedCost = { resourceCode: string; amount: number };
type CostLike = { resourceCode: string; amount: string | number };
type BuildingCommandType = 'construct' | 'upgrade' | 'expand';

function canonicalCosts(costs: ExpectedCost[] | undefined): ExpectedCost[] {
  return [...(costs ?? [])]
    .map((cost) => ({ resourceCode: cost.resourceCode, amount: cost.amount }))
    .sort((a, b) => a.resourceCode.localeCompare(b.resourceCode));
}

function assertAcceptedCosts(actual: CostLike[], expected: ExpectedCost[] | undefined): void {
  if (!expected?.length) return;
  const bounds = new Map(expected.map((cost) => [cost.resourceCode, cost.amount]));
  if (actual.some((cost) => Number(cost.amount) > (bounds.get(cost.resourceCode) ?? -1)))
    throw new HttpError(409, 'BUILDING_COST_CHANGED', 'Le coût a changé. Vérifier la palette avant de recommencer.');
}

async function claimBuildingCommand(
  tx: Transaction<Database>,
  village: OwnedVillage,
  commandId: string | undefined,
  commandType: BuildingCommandType,
  request: unknown,
): Promise<boolean> {
  if (!commandId) return false;
  const inserted = await tx
    .insertInto('buildingCommandReceipts')
    .values({
      worldId: village.worldId,
      villageId: village.villageId,
      commandId,
      commandType,
      request: JSON.stringify(request),
      buildingId: null,
    })
    .onConflict((conflict) => conflict.columns(['worldId', 'villageId', 'commandId']).doNothing())
    .returning('commandId')
    .executeTakeFirst();
  if (inserted) return false;
  const existing = await tx
    .selectFrom('buildingCommandReceipts')
    .select(['commandType', 'request'])
    .where('worldId', '=', village.worldId)
    .where('villageId', '=', village.villageId)
    .where('commandId', '=', commandId)
    .executeTakeFirstOrThrow();
  const comparable = (value: unknown) =>
    commandType === 'construct' && value && typeof value === 'object' ? { quarterTurns: 0, ...value } : value;
  if (existing.commandType !== commandType || !isDeepStrictEqual(comparable(existing.request), comparable(request)))
    throw new HttpError(
      409,
      'COMMAND_ID_CONFLICT',
      'Cette intention de construction a déjà été utilisée différemment.',
    );
  return true;
}

async function finishBuildingCommand(
  tx: Transaction<Database>,
  village: OwnedVillage,
  commandId: string | undefined,
  buildingId: string,
): Promise<void> {
  if (!commandId) return;
  await tx
    .updateTable('buildingCommandReceipts')
    .set({ buildingId })
    .where('worldId', '=', village.worldId)
    .where('villageId', '=', village.villageId)
    .where('commandId', '=', commandId)
    .execute();
}

/** Compatibility adapters share the bounded placement command. Only explicit
 * snapshot callers request the complete read-only presentation afterwards. */
async function placementResult<Mode extends ConstructionReplyMode>(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  confirmed: import('@arbestra/contracts').ConstructionConfirmation,
  mode: Mode,
): Promise<ConstructionResult<Mode>> {
  if (mode === 'snapshot')
    return (await readVillageProjection(db, accountId, worldSlug, confirmed.villageId)) as ConstructionResult<Mode>;
  return {
    worldId: confirmed.worldId,
    villageId: confirmed.villageId,
    through: new Date(confirmed.commandTime),
    commandId: confirmed.commandId,
    confirmation: confirmed,
  } as ConstructionResult<Mode>;
}
export async function constructBuilding<Mode extends ConstructionReplyMode = 'snapshot'>(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  cellX: number,
  cellY: number,
  buildingType: BuildingType,
  durationOverride: number | null,
  commandId?: string,
  expectedCosts?: ExpectedCost[],
  quarterTurns = 0,
  houseVariant: 'stone' | 'logs' | 'beams' = 'stone',
  replyMode: Mode = 'snapshot' as Mode,
): Promise<ConstructionResult<Mode>> {
  const fixed = buildingType === 'university' || buildingType === 'stonemason';
  const confirmed = await placeBuilding(
    db,
    accountId,
    worldSlug,
    villageId,
    {
      buildingType,
      anchor: { cellX, cellY },
      cells: fixed ? fixedBuildingFootprint(buildingType, { cellX, cellY }, quarterTurns) : [{ cellX, cellY }],
      commandId,
      expectedCosts,
      quarterTurns,
      houseVariant,
      legacy: !fixed,
    },
    durationOverride,
  );
  return placementResult(db, accountId, worldSlug, confirmed, replyMode);
}
export async function constructBuildingArea<Mode extends ConstructionReplyMode = 'snapshot'>(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingType: BuildingType,
  anchor: SpatialCell,
  rawCells: SpatialCell[],
  durationOverride: number | null,
  commandId?: string,
  expectedCosts?: ExpectedCost[],
  quarterTurns = 0,
  houseVariant: 'stone' | 'logs' | 'beams' = 'stone',
  replyMode: Mode = 'snapshot' as Mode,
): Promise<ConstructionResult<Mode>> {
  const confirmed = await placeBuilding(
    db,
    accountId,
    worldSlug,
    villageId,
    { buildingType, anchor, cells: rawCells, commandId, expectedCosts, quarterTurns, houseVariant },
    durationOverride,
  );
  return placementResult(db, accountId, worldSlug, confirmed, replyMode);
}

export async function expandGarden<Mode extends ConstructionReplyMode = 'snapshot'>(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
  rawCells: SpatialCell[],
  durationOverride: number | null,
  commandId?: string,
  expectedCosts?: ExpectedCost[],
  replyMode: Mode = 'snapshot' as Mode,
  afterWrites?: AfterConstructionWrites,
): Promise<ConstructionResult<Mode>> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(
      tx,
      village.worldId,
      village.villageId,
      undefined,
      rawCells.map((c) => ({
        cellX: normalizeCell(c.cellX, village.widthCells),
        cellY: normalizeCell(c.cellY, village.heightCells),
      })),
      [],
      true,
    );
    const at = economy.through;
    const canonicalSelection = normalizeSpatialSelection(
      rawCells[0]!,
      rawCells,
      village.widthCells,
      village.heightCells,
    );
    const commandRequest = {
      buildingId,
      cells: canonicalSelection.cells,
      expectedCosts: canonicalCosts(expectedCosts),
    };
    if (await claimBuildingCommand(tx, village, commandId, 'expand', commandRequest))
      return villageCommandResult(tx, accountId, worldSlug, village, economy, replyMode, commandId);
    const building = await tx
      .selectFrom('buildings')
      .selectAll()
      .where('id', '=', buildingId)
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId)
      .forUpdate()
      .executeTakeFirst();
    if (!building || building.buildingType !== 'garden')
      throw new HttpError(404, 'GARDEN_NOT_FOUND', 'Jardin introuvable.');
    if (building.status !== 'completed') throw new HttpError(409, 'BUILDING_BUSY', 'Le jardin est encore en chantier.');
    const allActiveGardens = await tx
      .selectFrom('worldCellOccupancies')
      .innerJoin('buildings', (join) =>
        join
          .onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId')
          .onRef('buildings.id', '=', 'worldCellOccupancies.buildingId'),
      )
      .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY', 'buildings.id as buildingId'])
      .where('worldCellOccupancies.worldId', '=', village.worldId)
      .where('buildings.villageId', '=', village.villageId)
      .where('buildings.buildingType', '=', 'garden')
      .where('buildings.status', '=', 'completed')
      .where('worldCellOccupancies.pendingExpansionId', 'is', null)
      .execute();
    const activeAt = new Map(allActiveGardens.map((cell) => [worldCellKey(cell.cellX, cell.cellY), cell]));
    const activeCells = allActiveGardens.filter((cell) => cell.buildingId === building.id),
      queue = [...allActiveGardens.filter((cell) => cell.buildingId === building.id)];
    const activeKeys = new Set(activeCells.map((cell) => worldCellKey(cell.cellX, cell.cellY)));
    while (queue.length) {
      const current = queue.shift()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next = activeAt.get(
          worldCellKey(
            normalizeCell(current.cellX + dx, village.widthCells),
            normalizeCell(current.cellY + dy, village.heightCells),
          ),
        );
        if (next && !activeKeys.has(worldCellKey(next.cellX, next.cellY))) {
          activeKeys.add(worldCellKey(next.cellX, next.cellY));
          activeCells.push(next);
          queue.push(next);
        }
      }
    }
    const componentIds = [...new Set(activeCells.map((cell) => cell.buildingId))];
    const pending = await tx
      .selectFrom('buildingExpansions')
      .select('id')
      .where('worldId', '=', village.worldId)
      .where('buildingId', 'in', componentIds)
      .where('status', '=', 'under-construction')
      .executeTakeFirst();
    if (pending) throw new HttpError(409, 'BUILDING_BUSY', 'Le jardin possède déjà une extension en chantier.');
    const selection = canonicalSelection;
    const occupiedRows = await tx
      .selectFrom('worldCellOccupancies')
      .leftJoin('buildings', (join) =>
        join
          .onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId')
          .onRef('buildings.id', '=', 'worldCellOccupancies.buildingId'),
      )
      .select([
        'worldCellOccupancies.cellX',
        'worldCellOccupancies.cellY',
        'worldCellOccupancies.pendingExpansionId',
        'buildings.buildingType',
        'buildings.villageId',
        'buildings.status',
      ])
      .where('worldCellOccupancies.worldId', '=', village.worldId)
      .execute();
    const occupiedAt = new Map(occupiedRows.map((item) => [worldCellKey(item.cellX, item.cellY), item]));
    const newCells: SpatialCell[] = [];
    for (const cell of selection.cells) {
      const occupied = occupiedAt.get(worldCellKey(cell.cellX, cell.cellY));
      if (!occupied) {
        newCells.push(cell);
        continue;
      }
      if (
        occupied.pendingExpansionId !== null ||
        occupied.buildingType !== 'garden' ||
        occupied.villageId !== village.villageId ||
        occupied.status !== 'completed'
      )
        throw new HttpError(409, 'CELL_OCCUPIED', 'Une case de la sélection est occupée ou encore en chantier.');
    }
    if (
      !selection.cells.some((cell) =>
        activeCells.some(
          (active) =>
            toroidalManhattan(
              active.cellX,
              active.cellY,
              cell.cellX,
              cell.cellY,
              village.widthCells,
              village.heightCells,
            ) <= 1,
        ),
      )
    )
      throw new HttpError(409, 'INVALID_BUILDING_EXTENSION', 'L’extension doit toucher le jardin actif.');
    if (newCells.length === 0)
      return villageCommandResult(tx, accountId, worldSlug, village, economy, replyMode, commandId, afterWrites);
    await assertBuildableCells(tx, village, newCells);
    const item = await definition(tx, 'garden', 1);
    const actualCosts = scaledCosts(item.costs, newCells.length);
    assertAcceptedCosts(actualCosts, expectedCosts);
    await debit(tx, village.worldId, village.villageId, actualCosts, at);
    const completesAt = new Date(at.getTime() + (durationOverride ?? item.constructionDurationSeconds * 1_000));
    const expansion = await tx
      .insertInto('buildingExpansions')
      .values({
        worldId: village.worldId,
        villageId: village.villageId,
        buildingId: building.id,
        status: 'under-construction',
        startedAt: at,
        completesAt,
        completedAt: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await reserveSelection(tx, village.worldId, building.id, selection.anchor, newCells, expansion.id, false);
    await tx
      .insertInto('scheduledTasks')
      .values({
        worldId: village.worldId,
        taskType: COMPLETE_EXPANSION_TASK,
        subjectId: expansion.id,
        payload: {},
        dueAt: completesAt,
        availableAt: completesAt,
        lastError: null,
        completedAt: null,
      })
      .execute();
    await finishBuildingCommand(tx, village, commandId, building.id);
    return villageCommandResult(tx, accountId, worldSlug, village, economy, replyMode, commandId, afterWrites);
  });
}

export async function upgradeBuilding<Mode extends ConstructionReplyMode = 'snapshot'>(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
  extensionCellX: number | undefined,
  extensionCellY: number | undefined,
  durationOverride: number | null,
  commandId?: string,
  expectedCosts?: ExpectedCost[],
  expectedLevel?: number,
  replyMode: Mode = 'snapshot' as Mode,
  afterWrites?: AfterConstructionWrites,
): Promise<ConstructionResult<Mode>> {
  // Compatibility for saved clients/tests from the old single-cell Garden UX.
  // The HTTP API uses /expansions; both paths now create the same expansion.
  if (extensionCellX !== undefined && extensionCellY !== undefined)
    return expandGarden(
      db,
      accountId,
      worldSlug,
      villageId,
      buildingId,
      [{ cellX: extensionCellX, cellY: extensionCellY }],
      durationOverride,
      commandId,
      expectedCosts,
      replyMode,
    );
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const campusAnchor = await tx
      .selectFrom('buildings')
      .innerJoin('worldCellOccupancies', (join) =>
        join
          .onRef('worldCellOccupancies.worldId', '=', 'buildings.worldId')
          .onRef('worldCellOccupancies.buildingId', '=', 'buildings.id'),
      )
      .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY'])
      .where('buildings.worldId', '=', village.worldId)
      .where('buildings.villageId', '=', village.villageId)
      .where('buildings.id', '=', buildingId)
      .where('buildings.buildingType', '=', 'university')
      .where('worldCellOccupancies.role', '=', 'anchor')
      .executeTakeFirst();
    const campusCells = campusAnchor
      ? universityCampusCells(campusAnchor).map((c) => ({
          cellX: normalizeCell(c.cellX, village.widthCells),
          cellY: normalizeCell(c.cellY, village.heightCells),
        }))
      : undefined;
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, undefined, campusCells, [], true);
    const at = economy.through;
    const commandRequest = {
      buildingId,
      expectedLevel: expectedLevel ?? null,
      expectedCosts: canonicalCosts(expectedCosts),
    };
    if (await claimBuildingCommand(tx, village, commandId, 'upgrade', commandRequest))
      return villageCommandResult(tx, accountId, worldSlug, village, economy, replyMode, commandId);
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
        'buildings.visualLayout',
        'worldCellOccupancies.cellX',
        'worldCellOccupancies.cellY',
      ])
      .where('buildings.id', '=', buildingId)
      .where('buildings.worldId', '=', village.worldId)
      .where('buildings.villageId', '=', village.villageId)
      .forUpdate('buildings')
      .executeTakeFirst();
    if (!building) throw new HttpError(404, 'BUILDING_NOT_FOUND', 'Bâtiment introuvable.');
    if (building.buildingType === 'garden')
      throw new HttpError(409, 'SPATIAL_BUILDING', 'Étendez le jardin avec sa sélection de terrain.');
    if (building.status !== 'completed') throw new HttpError(409, 'BUILDING_BUSY', 'Ce bâtiment est déjà en chantier.');
    if (expectedLevel !== undefined && building.level + 1 !== expectedLevel)
      throw new HttpError(
        409,
        'BUILDING_LEVEL_CHANGED',
        'Le niveau du bâtiment a changé. Vérifier la palette avant de recommencer.',
      );
    const order = await tx
      .selectFrom('processingOrders')
      .select('id')
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', villageId)
      .where('buildingId', '=', buildingId)
      .where('status', 'not in', ['completed', 'cancelled'])
      .executeTakeFirst();
    if (order)
      throw new HttpError(
        409,
        'PROCESSING_BUSY',
        'Terminez ou annulez l’ordre de fabrication avant d’améliorer l’atelier.',
      );
    if (building.buildingType === 'university') await ensureUniversityCampus(tx, village, building.id, building);
    const item = await definition(
      tx,
      building.buildingType,
      building.level + 1,
      building.visualLayout?.recipe === 'log-house'
        ? 'logs'
        : building.visualLayout?.recipe === 'beam-house'
          ? 'beams'
          : 'stone',
    );
    assertAcceptedCosts(item.costs, expectedCosts);
    if (item.additionalCellsRequired === 1) {
      if (extensionCellX === undefined || extensionCellY === undefined)
        throw new HttpError(400, 'EXTENSION_CELL_REQUIRED', 'Choisissez une case pour étendre le bâtiment.');
      const x = normalizeCell(extensionCellX, village.widthCells);
      const y = normalizeCell(extensionCellY, village.heightCells);
      if (toroidalManhattan(x, y, building.cellX, building.cellY, village.widthCells, village.heightCells) !== 1)
        throw new HttpError(409, 'INVALID_BUILDING_EXTENSION', 'Cette case ne peut pas accueillir l’extension.');
      await assertBuildable(tx, village, x, y);
      await debit(tx, village.worldId, village.villageId, item.costs, at);
      await reserve(tx, village.worldId, x, y, building.id, 'extension');
    } else {
      if (extensionCellX !== undefined || extensionCellY !== undefined)
        throw new HttpError(400, 'UNEXPECTED_EXTENSION_CELL', 'Cette amélioration ne requiert pas de case.');
      await debit(tx, village.worldId, village.villageId, item.costs, at);
    }
    const completesAt = new Date(at.getTime() + (durationOverride ?? item.constructionDurationSeconds * 1_000));
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
    await finishBuildingCommand(tx, village, commandId, building.id);
    return villageCommandResult(tx, accountId, worldSlug, village, economy, replyMode, commandId, afterWrites);
  });
}
/** Starts a server-authoritative stone extraction. The feature UUID, not a viewport cell, is the target. */
export async function getStoneDepositDetails(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  featureId: string,
) {
  return withVillageProjection(db, accountId, worldSlug, villageId, (tx, economy, village) =>
    readVillageDepositDetails(tx, accountId, village, economy, featureId),
  );
}

export async function readVillageDepositDetails(
  tx: Transaction<Database>,
  accountId: string,
  village: OwnedVillage,
  economy: VillageEconomy,
  featureId: string,
) {
  const position = await tx
    .selectFrom('resourceDeposits')
    .select(['cellX', 'cellY'])
    .where('worldId', '=', village.worldId)
    .where('featureId', '=', featureId)
    .executeTakeFirst();
  if (!position) throw new HttpError(404, 'DEPOSIT_NOT_FOUND', 'Gisement inconnu.');
  const knowledge = await knownGeography(tx, village.worldId, accountId, village.widthCells, village.heightCells, [
    { minX: position.cellX, maxX: position.cellX + 1, minY: position.cellY, maxY: position.cellY + 1 },
  ]);
  if (!knowledge.known(position)) throw new HttpError(404, 'DEPOSIT_NOT_FOUND', 'Gisement inconnu.');
  const path = await stoneTravelPath(tx, village, featureId);
  return stoneDepositDetails(tx, village, economy, featureId, path ? travelDuration(path, village) : 0, Boolean(path));
}

function canonicalExploitation(request: ExploitationRequest, village: OwnedVillage): ExploitationRequest {
  const { woodTrees: rawTrees, ...rest } = request;
  const wood = request.wood.map((id) => id.toLowerCase());
  // Checked against the selection; absent without designation, so that an
  // order recorded before designations replays identically.
  woodDesignations(wood, rawTrees);
  const woodTrees = canonicalWoodTrees(rawTrees);
  return {
    ...rest,
    cohortId: request.cohortId?.toLowerCase() ?? null,
    initialAdmission: request.initialAdmission ?? 'allow-wait',
    gardens: request.gardens.map((c) => ({
      cellX: normalizeCell(c.cellX, village.widthCells),
      cellY: normalizeCell(c.cellY, village.heightCells),
    })),
    wood,
    ...(woodTrees ? { woodTrees } : {}),
    stone: request.stone.map((id) => id.toLowerCase()),
  };
}

export async function prepareExploitation(
  tx: Transaction<Database>,
  village: OwnedVillage,
  economy: VillageEconomy,
  accountId: string,
  request: ExploitationRequest,
) {
  // Preparation projects eligibility; only the subsequent command assigns work.
  // Gardens need their plots and the village network (the same routes as the
  // full snapshot, from the command geometry), never a whole VillageState.
  const gardenContext = request.gardens.length
    ? await Promise.all([
        readInfrastructureSpatialState(tx, village, economy),
        tx
          .selectFrom('gardenHarvests')
          .select(['buildingId', 'plotCellX', 'plotCellY', 'stops'])
          .where('worldId', '=', village.worldId)
          .where('villageId', '=', village.villageId)
          .where('status', '=', 'in-progress')
          .execute(),
      ])
    : undefined;
  const projectedCohorts = await projectCohorts(tx, village.worldId, village.villageId, economy.through);
  const population = {
    total: projectedCohorts.reduce((n, c) => n + c.memberCount, 0),
    cohorts: projectedCohorts.map((c) => ({
      id: c.id,
      memberCount: c.memberCount,
      activity: c.activity,
      assignmentId:
        c.harvestId ??
        c.extractionId ??
        c.scienceActivityId ??
        c.processingLotId ??
        c.tradeJourneyId ??
        c.levelingJobId,
    })),
  };
  const preview: ExploitationPreview = {
    gardens: [],
    wood: [],
    stone: [],
    excluded: [],
    gardenReturnMs: null,
    estimates: { carrot: 0, wood: 0, stone: 0 },
    workforce: {
      structuralMax: 0,
      autoWorkerCap: 0,
      availableNow: 0,
      allocation: { gardens: 0, wood: 0, stone: 0 },
      reason: null,
    },
  };
  const plots = gardenContext
    ? gardenSelectionPlots(gardenContext[0].occupancies, gardenContext[0].plots, gardenContext[1], village)
    : [];
  const seen = new Set<string>();
  for (const cell of request.gardens) {
    const key = `garden:${cell.cellX}:${cell.cellY}`;
    const p = plots.find((p) => p.cellX === cell.cellX && p.cellY === cell.cellY);
    const reason = seen.has(key)
      ? 'duplicate'
      : !p
        ? 'not-found'
        : p.status !== 'completed'
          ? 'building-incomplete'
          : p.harvested
            ? 'already-assigned'
            : p.storedCarrots < 1
              ? 'empty'
              : null;
    seen.add(key);
    if (reason) preview.excluded.push({ key, reason });
    else {
      preview.gardens.push(cell);
      preview.estimates.carrot += p!.storedCarrots;
    }
  }
  const plan = preview.gardens.length
    ? planGardenTour(
        gardenContext![0].snapshot.travelRoutes,
        { cellX: village.anchorCellX, cellY: village.anchorCellY },
        preview.gardens,
        village,
      )
    : null;
  if (preview.gardens.length && !plan) {
    preview.excluded.push(
      ...preview.gardens.map((p) => ({ key: `garden:${p.cellX}:${p.cellY}`, reason: 'unreachable' })),
    );
    preview.gardens = [];
    preview.estimates.carrot = 0;
  }
  preview.gardenReturnMs = plan?.durationMs ?? null;
  // Selection and workforce estimation share exactly the same routes in this
  // preparation. No geometry is changed before the preparation returns.
  const paths = new Map<string, TravelCell[] | undefined>();
  const deposits = new Map<string, Awaited<ReturnType<typeof readStoneDeposit>>>();
  const depositFor = async (id: string) => {
    if (!deposits.has(id)) deposits.set(id, await readStoneDeposit(tx, village.worldId, id));
    return deposits.get(id)!;
  };
  const pathFor = async (id: string) => {
    if (!paths.has(id)) paths.set(id, await stoneTravelPath(tx, village, id));
    return paths.get(id);
  };
  // Trees kept for each designated wood case, in their order.
  const designated = new Map<string, number[]>();
  for (const family of ['wood', 'stone'] as const) {
    if (!request[family].length) continue;
    const selection = await prepareWorksiteSelection(
      tx,
      village,
      economy,
      {
        commandId: request.commandId,
        mode: family === 'wood' ? request.woodMode : 'extract',
        workerCap: Math.min(10, request.workerCap),
        featureIds: request[family],
        ...(family === 'wood' && request.woodTrees ? { woodTrees: request.woodTrees } : {}),
      },
      pathFor,
    );
    const origin = { cellX: village.anchorCellX, cellY: village.anchorCellY };
    selection.included.sort(
      (a, b) => worksiteTargetDistance(a, origin, village) - worksiteTargetDistance(b, origin, village),
    );
    preview[family] = selection.included.map((i) => i.featureId);
    for (const item of selection.included) if (item.treeIndices) designated.set(item.featureId, item.treeIndices);
    preview.excluded.push(
      ...selection.excluded.map((i) => ({
        key: i.featureId,
        reason: i.reason,
        ...(i.treeIndex !== undefined ? { treeIndex: i.treeIndex } : {}),
      })),
    );
    for (const id of preview[family]) {
      const deposit = await depositFor(id);
      // No threshold any more: every tree is cut to nothing (docs/SPEC-BOIS-ARBRE-UNITE.md).
      preview.estimates[family] += designated.has(id)
        ? await designatedWood(tx, village.worldId, id, designated.get(id)!)
        : Math.max(0, deposit.remainingAmount);
    }
  }
  if (designated.size)
    preview.woodTrees = preview.wood.flatMap((featureId) =>
      designated.has(featureId) ? [{ featureId, treeIndices: designated.get(featureId)! }] : [],
    );
  const gardenCap = preview.gardens.length ? 1 : 0;
  const woodCap = preview.wood.length ? Math.min(10, request.activityCaps?.wood ?? 10) : 0;
  const stoneCap = preview.stone.length ? Math.min(10, request.activityCaps?.stone ?? 10) : 0;
  preview.workforce.structuralMax = Math.min(population.total, gardenCap + woodCap + stoneCap, request.workerCap);
  const lots: Partial<Record<'wood' | 'stone', { id: string; amount: number; transportMs: number }>> = {};
  for (const family of ['wood', 'stone'] as const)
    for (const id of preview[family]) {
      const deposit = await depositFor(id);
      // A wood lot takes one tree: its size is that tree's free wood.
      const work =
        family === 'wood' && deposit.availableAmount >= 1
          ? await nextWoodWork(
              tx,
              village.worldId,
              id,
              'cut',
              await readWoodlandTrees(tx, village.worldId, id, designated.get(id)),
              deposit.availableAmount,
            )
          : null;
      const amount =
        family === 'wood'
          ? work?.kind === 'lot'
            ? work.amount
            : 0
          : Math.min(100, deposit.availableAmount, deposit.remainingAmount);
      if (amount < 1) continue;
      const path = await pathFor(id);
      if (path) {
        lots[family] = { id, amount, transportMs: travelDuration(path, village) };
        break;
      }
    }
  const preferred = projectedCohorts.filter(
    (c) => withoutAssignment(c) && c.activity === 'idle' && (!request.cohortId || c.id === request.cohortId),
  );
  preview.workforce.availableNow = preferred.reduce((sum, cohort) => sum + cohort.memberCount, 0);
  // Simulate disjoint first teams on copies: preview never reserves a person.
  const pool = preferred.map((c) => ({ ...c }));
  let used = 0;
  const consume = (team: ReturnType<typeof workingTeam>) => {
    let remaining = team.count;
    for (const c of team.cohorts) {
      const take = Math.min(c.memberCount, remaining);
      c.memberCount -= take;
      remaining -= take;
    }
    used += team.count;
    return team.count;
  };
  if (plan && gardenCap && request.workerCap > 0)
    preview.workforce.allocation.gardens = consume(workingTeam(pool, 1, () => plan.durationMs));
  const openSites = Number(woodCap > 0) + Number(stoneCap > 0);
  for (const family of ['wood', 'stone'] as const) {
    const lot = lots[family],
      childCap = family === 'wood' ? woodCap : stoneCap;
    const cap = request.activityCaps
      ? Math.min(childCap, request.workerCap - used)
      : exploitationAdmissionCap(
          request.workerCap,
          used,
          openSites,
          false,
          childCap,
          preview.workforce.allocation.gardens > 0,
        );
    if (lot)
      preview.workforce.allocation[family] = consume(
        workingTeam(pool, cap, (count) => stoneExtractionDuration(count, lot.amount) + 2 * lot.transportMs),
      );
  }
  preview.workforce.autoWorkerCap = used;
  preview.workforce.reason =
    preview.workforce.structuralMax === 0
      ? 'no-targets'
      : used === 0
        ? request.cohortId
          ? 'cohort-unavailable'
          : 'no-eligible-workers'
        : null;
  return { preview, plan, population, lots };
}

export async function previewVillageExploitation(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  rawRequest: ExploitationRequest,
): Promise<ExploitationPreview> {
  return withVillageProjection(db, accountId, worldSlug, villageId, (tx, economy, village) =>
    previewExploitation(tx, village, economy, accountId, rawRequest),
  );
}

export async function previewExploitation(
  tx: Transaction<Database>,
  village: OwnedVillage,
  economy: VillageEconomy,
  accountId: string,
  request: ExploitationRequest,
): Promise<ExploitationPreview> {
  return (await prepareExploitation(tx, village, economy, accountId, canonicalExploitation(request, village))).preview;
}

export async function startVillageExploitation(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  rawRequest: ExploitationRequest,
): Promise<VillageState>;
export async function startVillageExploitation(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  rawRequest: ExploitationRequest,
  afterWrites: AfterConstructionWrites,
): Promise<ConstructionCommit>;
export async function startVillageExploitation(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  rawRequest: ExploitationRequest,
  afterWrites?: AfterConstructionWrites,
): Promise<VillageState | ConstructionCommit> {
  return db.transaction().execute(async (tx): Promise<VillageState | ConstructionCommit> => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const request = canonicalExploitation(rawRequest, village);
    const economy = await beginVillageEconomy(
      tx,
      village.worldId,
      villageId,
      undefined,
      [],
      [...request.wood, ...request.stone],
    );
    const previous = await tx
      .selectFrom('exploitationOrders')
      .select(['id', 'request'])
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', villageId)
      .where('commandId', '=', request.commandId)
      .executeTakeFirst();
    if (previous) {
      if (!isDeepStrictEqual(previous.request, request))
        throw new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette intention a déjà été utilisée différemment.');
      // A V2 replay publishes nothing; its effects were sent with the original.
      if (afterWrites) return { worldId: village.worldId, villageId, through: economy.through };
      return state(tx, accountId, worldSlug, economy);
    }
    if (!request.gardens.length && !request.wood.length && !request.stone.length)
      throw new HttpError(400, 'EXPLOITATION_EMPTY', 'Sélectionner au moins une ressource.');
    const prepared = await prepareExploitation(tx, village, economy, accountId, request);
    if (prepared.preview.excluded.length)
      throw new HttpError(
        409,
        'EXPLOITATION_SELECTION_CHANGED',
        'La sélection a changé. Vérifier le récapitulatif actualisé ; aucune activité n’a été lancée.',
      );
    if (request.workerCap > prepared.population.total)
      throw new HttpError(409, 'EXPLOITATION_CAP_INVALID', 'Le plafond dépasse la population totale du village.');
    if (request.initialAdmission === 'required' && prepared.preview.workforce.autoWorkerCap < 1)
      throw new HttpError(
        409,
        'EXPLOITATION_INITIAL_DEPARTURE_UNAVAILABLE',
        'Aucune équipe ne peut partir maintenant avec assez d’énergie pour terminer un premier lot et revenir.',
      );
    const initial = request.cohortId
      ? prepared.population.cohorts?.find((c) => c.id === request.cohortId && c.activity === 'idle' && !c.assignmentId)
      : null;
    if (request.cohortId && !initial)
      throw new HttpError(409, 'EXPLOITATION_COHORT_CHANGED', 'La cohorte choisie n’est plus disponible.');
    if (initial) {
      const durations = prepared.plan ? [prepared.plan.durationMs] : [];
      for (const family of ['wood', 'stone'] as const) {
        const lot = prepared.lots[family];
        const count = Math.min(10, request.workerCap, initial.memberCount, request.activityCaps?.[family] ?? 10);
        if (lot && count > 0) durations.push(stoneExtractionDuration(count, lot.amount) + 2 * lot.transportMs);
      }
      const cohorts = await materializeCohorts(tx, village.worldId, village.villageId, economy.through);
      if (!durations.some((duration) => eligibleWorkers(cohorts, duration).some((c) => c.id === initial.id)))
        throw new HttpError(
          409,
          'EXPLOITATION_COHORT_ENERGY',
          'La cohorte choisie ne peut terminer aucun premier lot et revenir.',
        );
    }
    const caps = request.activityCaps;
    if (
      caps &&
      (caps.gardens + caps.wood + caps.stone > request.workerCap ||
        (request.gardens.length > 0 && caps.gardens !== 1) ||
        (request.wood.length > 0 && caps.wood < 1) ||
        (request.stone.length > 0 && caps.stone < 1))
    )
      throw new HttpError(
        400,
        'EXPLOITATION_CAP_INVALID',
        'Les plafonds détaillés doivent respecter le budget commun et permettre chaque activité sélectionnée.',
      );
    const deadline = request.durationMs === null ? null : new Date(economy.through.getTime() + request.durationMs);
    if (deadline && !Number.isFinite(deadline.getTime()))
      throw new HttpError(400, 'EXPLOITATION_DURATION_INVALID', 'Durée invalide.');
    const order = await tx
      .insertInto('exploitationOrders')
      .values({
        worldId: village.worldId,
        villageId,
        commandId: request.commandId,
        request: JSON.stringify(request),
        workerCap: request.workerCap,
        confirmedAt: economy.through,
        deadline,
        cohortId: request.cohortId,
        initialRemaining: initial ? Math.min(request.workerCap, initial.memberCount) : 0,
        gardenStatus: request.gardens.length ? 'pending' : 'completed',
        gardenPlan: prepared.plan ? JSON.stringify(prepared.plan) : null,
        nextWakeAt: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const family of ['wood', 'stone'] as const)
      if (request[family].length) {
        // Every case was accepted (no exclusion): the trees kept for each.
        const kept = new Map(prepared.preview.woodTrees?.map((item) => [item.featureId, item.treeIndices]));
        await createWorksite(
          tx,
          economy,
          {
            commandId: randomUUID(),
            mode: family === 'wood' ? request.woodMode : 'extract',
            workerCap: caps?.[family] ?? 10,
            featureIds: request[family],
          },
          request[family].map((featureId) => ({
            featureId,
            treeIndices: family === 'wood' ? (kept.get(featureId) ?? null) : null,
          })),
          order.id,
        );
      }
    const departed = (mobilized: number | undefined) => {
      if (request.initialAdmission === 'required' && !mobilized)
        throw new HttpError(
          409,
          'EXPLOITATION_INITIAL_DEPARTURE_UNAVAILABLE',
          'Aucune équipe ne peut partir maintenant ; aucune activité n’a été lancée.',
        );
    };
    // V2: the admission runs in the commit finalizer; the order alone is
    // read back before the terminal publication, in the same transaction.
    if (afterWrites)
      return villageCommandResult(
        tx,
        accountId,
        worldSlug,
        village,
        economy,
        'commit',
        undefined,
        async (tx, economy) => {
          departed((await readExploitationOrders(tx, economy, undefined, [order.id]))[0]?.mobilized);
          await afterWrites(tx, economy);
        },
      );
    const snapshot = await state(tx, accountId, worldSlug, economy);
    departed(snapshot.village.exploitationOrders?.find((item) => item.id === order.id)?.mobilized);
    return snapshot;
  });
}

/** Selects the targets of a worksite or of a queue. A wood case may designate
 * some of its trees (docs/SPEC-BOIS-ARBRE-UNITE.md, slice 2c): a tree the case
 * does not have is refused (`tree-not-found`), a tree with nothing left to do
 * in the mode is left out, and a case left without any tree is `depleted`.
 * With `mergeWoodQueue`, a case already in the village's wood queue is not
 * `already-assigned` while the designation adds trees to it. */
export async function prepareWorksiteSelection(
  tx: Transaction<Database>,
  village: OwnedVillage,
  economy: VillageEconomy,
  request: StartExtractionWorksiteRequest,
  pathFor = (id: string) => stoneTravelPath(tx, village, id),
  mergeWoodQueue = false,
): Promise<ExtractionWorksiteSelection> {
  const included: ExtractionWorksiteSelection['included'] = [],
    excluded: ExtractionWorksiteSelection['excluded'] = [];
  if (!request.featureIds.length) return { included, excluded };
  const designations = woodDesignations(request.featureIds, request.woodTrees);
  const accessContext = await readDepositAccessContext(tx, village);
  const seen = new Set<string>();
  for (const rawId of request.featureIds) {
    const featureId = rawId.toLowerCase();
    if (seen.has(featureId)) {
      excluded.push({ featureId, reason: 'duplicate' });
      continue;
    }
    seen.add(featureId);
    let details;
    try {
      details = await readDepositAccess(tx, village, featureId, accessContext);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) {
        excluded.push({ featureId, reason: 'not-found' });
        continue;
      }
      throw error;
    }
    if (details.deposit.resourceCode !== (request.mode === 'extract' ? 'stone' : 'wood')) {
      excluded.push({ featureId, reason: 'resource-mismatch' });
      continue;
    }
    // A clearing still removes the stumps of a case without wood.
    if (details.deposit.cleared || (request.mode !== 'clear' && details.deposit.remainingAmount === 0)) {
      excluded.push({ featureId, reason: 'depleted' });
      continue;
    }
    // Designated trees: in the player's order, never sorted.
    let treeIndices: number[] | null = null;
    const designation = details.deposit.resourceCode === 'wood' ? designations.get(featureId) : undefined;
    let trees: Awaited<ReturnType<typeof readWoodlandTrees>> | undefined;
    if (designation) {
      trees = await readWoodlandTrees(tx, village.worldId, featureId);
      const { kept, unknown } = designatedTrees(
        designation,
        trees.all,
        trees.records,
        request.mode === 'clear' ? 'clear' : 'cut',
      );
      excluded.push(...unknown.map((treeIndex) => ({ featureId, reason: 'tree-not-found', treeIndex })));
      if (!kept.length) {
        // Only stumps when cutting, only removed stumps when clearing.
        if (unknown.length < designation.length) excluded.push({ featureId, reason: 'depleted' });
        continue;
      }
      treeIndices = kept;
    }
    const eligibility = details.eligibility;
    if (!eligibility.inRange || eligibility.protected || !eligibility.onBoundary) {
      excluded.push({
        featureId,
        reason: !eligibility.inRange ? 'out-of-range' : eligibility.protected ? 'protected' : 'interior',
      });
      continue;
    }
    const existing = await tx
      .selectFrom('extractionWorksiteTargets as t')
      .innerJoin('extractionWorksites as s', (join) =>
        join.onRef('s.worldId', '=', 't.worldId').onRef('s.id', '=', 't.worksiteId'),
      )
      .select(['t.treeIndices', 't.clearTreeIndices', 's.poolResource'])
      .where('t.worldId', '=', economy.worldId)
      .where('t.villageId', '=', economy.villageId)
      .where('t.featureId', '=', featureId)
      .where('t.status', '=', 'pending')
      .executeTakeFirst();
    if (existing) {
      // A case already in the wood queue gains the trees it does not hold yet;
      // a clearing, those it does not clear yet (slice 2e).
      const mode = request.mode === 'clear' ? 'clear' : 'cut';
      const candidates =
        mode === 'clear' && treeIndices === null
          ? designatedTrees(
              (trees ??= await readWoodlandTrees(tx, village.worldId, featureId)).all,
              trees.all,
              trees.records,
              'clear',
            ).kept
          : [];
      const added =
        mergeWoodQueue && details.deposit.resourceCode === 'wood' && existing.poolResource === 'wood'
          ? queueContribution(existing, mode, treeIndices, candidates)
          : [];
      if (added !== null && !added.length) {
        excluded.push({ featureId, reason: 'already-assigned' });
        continue;
      }
      // Already queued, hence already routed: no new route search.
      included.push({
        featureId,
        cellX: details.deposit.cellX,
        cellY: details.deposit.cellY,
        ...(added ? { treeIndices: added } : {}),
      });
      continue;
    }
    // Every clearing is work on site now: stumps are removed one by one.
    let path: TravelCell[] | undefined;
    try {
      path = await pathFor(featureId);
    } catch (error) {
      if (!(error instanceof HttpError && error.code === 'DESTINATION_UNREACHABLE')) throw error;
    }
    if (!path) {
      excluded.push({ featureId, reason: 'unreachable' });
      continue;
    }
    included.push({
      featureId,
      cellX: details.deposit.cellX,
      cellY: details.deposit.cellY,
      ...(treeIndices ? { treeIndices } : {}),
    });
  }
  return { included, excluded };
}

export async function changeVillageWorksite(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  worksiteId: string,
  request: ChangeExtractionWorksiteRequest,
): Promise<{ villageState: VillageState; worksite: VillageState['village']['worksites'][number] }>;
export async function changeVillageWorksite(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  worksiteId: string,
  request: ChangeExtractionWorksiteRequest,
  afterWrites: AfterConstructionWrites,
): Promise<ConstructionCommit>;
export async function changeVillageWorksite(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  worksiteId: string,
  request: ChangeExtractionWorksiteRequest,
  afterWrites?: AfterConstructionWrites,
) {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    await changeWorksite(tx, economy, worksiteId, request);
    if (afterWrites)
      return villageCommandResult(tx, accountId, worldSlug, village, economy, 'commit', undefined, afterWrites);
    const villageState = await state(tx, accountId, worldSlug, economy);
    const worksite = villageState.village.worksites.find((site) => site.id === worksiteId);
    if (!worksite) throw new Error('Changed worksite missing from snapshot');
    return { villageState, worksite };
  });
}

export async function discoverBuildingSuppliesInTransaction(
  tx: Transaction<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
): Promise<VillageState>;
export async function discoverBuildingSuppliesInTransaction(
  tx: Transaction<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
  afterWrites: AfterConstructionWrites,
): Promise<ConstructionCommit>;
export async function discoverBuildingSuppliesInTransaction(
  tx: Transaction<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
  afterWrites?: AfterConstructionWrites,
): Promise<VillageState | ConstructionCommit> {
  const village = await ownedVillage(tx, accountId, worldSlug, villageId);
  if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
  const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
  // The V2 contract answers with the commit's effects instead of a village state.
  const reply = () =>
    afterWrites
      ? villageCommandResult(tx, accountId, worldSlug, village, economy, 'commit', undefined, afterWrites)
      : state(tx, accountId, worldSlug, economy);
  const supply = await tx
    .selectFrom('buildingHiddenSupplies')
    .selectAll()
    .where('worldId', '=', village.worldId)
    .where('villageId', '=', village.villageId)
    .where('buildingId', '=', buildingId)
    .forUpdate()
    .executeTakeFirst();
  if (!supply) throw new HttpError(404, 'SUPPLIES_NOT_FOUND', 'Réserves introuvables.');
  const accomplishment = await tx
    .selectFrom('villageAccomplishments')
    .select('completedAt')
    .where('worldId', '=', village.worldId)
    .where('villageId', '=', village.villageId)
    .where('code', '=', 'town-hall-supplies')
    .executeTakeFirst();
  if (accomplishment) {
    if (!supply.claimedAt) throw new Error('Town-hall supplies accomplishment has no matching claim');
    return reply();
  }
  if (supply.claimedAt) throw new Error('Claimed town-hall supplies have no matching accomplishment');
  await tx
    .insertInto('villageAccomplishments')
    .values({
      worldId: village.worldId,
      villageId: village.villageId,
      code: 'town-hall-supplies',
      completedAt: economy.through,
    })
    .execute();
  await tx
    .updateTable('buildingHiddenSupplies')
    .set({ claimedAt: economy.through })
    .where('worldId', '=', village.worldId)
    .where('villageId', '=', village.villageId)
    .where('buildingId', '=', buildingId)
    .execute();
  await tx
    .updateTable('villageResources')
    .set({ amount: sql`amount + ${supply.amount}::bigint` })
    .where('worldId', '=', village.worldId)
    .where('villageId', '=', village.villageId)
    .where('resourceCode', '=', supply.resourceCode)
    .execute();
  return reply();
}

export async function discoverBuildingSupplies(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
): Promise<VillageState> {
  return db
    .transaction()
    .execute((tx) => discoverBuildingSuppliesInTransaction(tx, accountId, worldSlug, villageId, buildingId));
}

/** Visual discovery is reported by the client; ownership, time and uniqueness are authoritative. */
export async function discoverCatEyes(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
): Promise<{ newlyCompleted: boolean; villageState: VillageState }>;
export async function discoverCatEyes(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  afterWrites: AfterConstructionWrites,
): Promise<ConstructionCommit>;
export async function discoverCatEyes(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  afterWrites?: AfterConstructionWrites,
) {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    const inserted = await tx
      .insertInto('villageAccomplishments')
      .values({
        worldId: village.worldId,
        villageId: village.villageId,
        code: 'cat-eyes',
        completedAt: economy.through,
      })
      .onConflict((oc) => oc.columns(['worldId', 'villageId', 'code']).doNothing())
      .returning('code')
      .execute();
    if (afterWrites)
      return villageCommandResult(tx, accountId, worldSlug, village, economy, 'commit', undefined, afterWrites);
    return { newlyCompleted: inserted.length > 0, villageState: await state(tx, accountId, worldSlug, economy) };
  });
}
