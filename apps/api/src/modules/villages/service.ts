import {fixedBuildingFootprint,withinBuildReach,BUILD_REACH as BUILD_RADIUS} from '@arbestra/contracts';
import {readRc1Ground} from '../worlds/rc1-ground.js';
import {naturalFeaturesQuery} from '../worlds/natural-features.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import type {
  BuildingType,
  BuildingTypeDefinition,
  VillageState,
  ExtractionResponse,
  TravelCell,
  StartExtractionWorksiteRequest,
  ChangeExtractionWorksiteRequest,
  ExtractionWorksiteSelection,
} from '@arbestra/contracts';
import { buildTravelNetwork, exploitationAdmissionCap,travelDuration,refineTravelRoute } from '@arbestra/contracts';
import {readInfrastructure,readNavigationInfrastructure,factoryCapability,assertNoInfrastructure} from './infrastructure.js';
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
  projectGardenPlots,
  projectVillageResource,
} from './economy.js';
import { beginVillageEconomy, reconcileVillageEconomy, type VillageEconomy } from './reconcile-economy.js';
import { normalizeSpatialSelection, scaledCosts, type SpatialCell } from './spatial-selection.js';
import { advanceEnergy, beginRest, displayedEnergy, feedEnergy, type EnergyState } from '../population/energy.js';
import { startGardenHarvest } from '../population/garden-harvest.js';
import {startGardenTour} from '../population/garden-tour.js';
import {planGardenTour} from '@arbestra/contracts';
import {housingCapacity} from '../population/housing.js';
import {reconcileRestHousing} from '../population/work.js';
import { eligibleWorkers, materializeCohorts, withoutAssignment, workingTeam } from '../population/work.js';
import { admitScience, scienceSnapshot, scienceCommand } from '../science/service.js';
import type { ScienceCommand } from '@arbestra/contracts';
import { recognizedDepositRoute, hasRecognizedDepositAccess } from '../science/deposit-access.js';
import { knownGeography } from '../science/knowledge.js';
import { clearWoodland, claimWoodlandCell } from '../deposits/woodland.js';
import { startStoneExtraction, stoneDepositDetails, readExtraction, readStoneDeposit, safeAmount, stoneExtractionDuration } from '../deposits/stone-extractions.js';
import { admitWorksites, changeWorksite, createWorksite, readWorksites } from '../deposits/worksites.js';
import { admitExploitationGardens, readExploitationOrders } from './exploitation-budget.js';
import { commandProcessing, previewProcessing, processingSnapshot } from './processing.js';
import { commandMarket, previewMarket, marketSnapshot } from './market.js';
import type { MarketCommand, MarketRequest } from '@arbestra/contracts';
import type { ProcessingCommand } from '@arbestra/contracts';
import type { ExploitationRequest, ExploitationPreview } from '@arbestra/contracts';

const CELL_SIZE = 2.5;
const SNAPSHOT_SIZE = 64;
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
  tx: Transaction<Database>,
  accountId: string,
  worldSlug: string,
  villageId?: string,
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
    .where(eb => villageId ? eb('villages.id', '=', villageId) : sql<boolean>`true`)
    .orderBy('villages.id')
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
  const [types, levels, costs, production, recipes, variantCosts] = await Promise.all([
    tx.selectFrom('buildingTypes').selectAll().execute(),
    tx.selectFrom('buildingTypeLevels').selectAll().execute(),
    tx.selectFrom('buildingLevelCosts').selectAll().execute(),
    tx.selectFrom('buildingLevelProduction').selectAll().execute(),
    tx.selectFrom('processingRecipes').selectAll().execute(),
    tx.selectFrom('buildingVariantCosts').selectAll().execute(),
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
        variantCosts: variantCosts.filter(c=>c.buildingTypeCode===type.code&&c.level===level.level)
          .map(c=>({variant:c.variant,resourceCode:c.resourceCode,amount:Number(c.amount),...(c.replacesResourceCode?{replacesResourceCode:c.replacesResourceCode}:{})})),
        ...Object.fromEntries(recipes.filter(recipe => recipe.buildingTypeCode === type.code && recipe.level === level.level)
          .map(recipe => ['processing', { version:recipe.version,inputResource:recipe.inputResource,inputAmount:recipe.inputAmount,
            outputResource:recipe.outputResource,outputAmount:recipe.outputAmount,workMs:recipe.workMs,workerCap:recipe.workerCap }])),
        costs: costs
          .filter(
            (cost) =>
              cost.buildingTypeCode === type.code && cost.level === level.level,
          )
          .map((cost) => ({
            resourceCode: cost.resourceCode,
            amount: number(cost.amount),
          })),
        production: (type.productionMode === 'processing' ? [] : production)
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
  rc1?: Awaited<ReturnType<typeof readRc1Ground>>;
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
  if(village.generationVersion===3){
    const ground=await readRc1Ground(tx,village.worldId),terrainCodes:number[]=[],elevations:number[]=[];
    for(let y=0;y<SNAPSHOT_SIZE;y++)for(let x=0;x<SNAPSHOT_SIZE;x++){const c=ground.cell(originCellX+x,originCellY+y);terrainCodes.push(c.code);elevations.push(c.elevation);}
    return {rc1:ground,originCellX,originCellY,terrainCodes,elevations,terrainAt(x,y){const dx=normalizeCell(x-originCellX,village.widthCells),dy=normalizeCell(y-originCellY,village.heightCells);return dx<SNAPSHOT_SIZE&&dy<SNAPSHOT_SIZE?terrainCodes[dy*SNAPSHOT_SIZE+dx]:undefined;}};
  }
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

/** Route beyond the visual snapshot, using real world chunks and occupancy in a bounded corridor. */
export async function stoneTravelPath(tx: Transaction<Database>, village: OwnedVillage, featureId: string,
  visiblePath?: TravelCell[]): Promise<TravelCell[] | undefined> {
  const deposit = await tx.selectFrom('resourceDeposits').select(['cellX', 'cellY', 'remainingAmount', 'resourceCode'])
    .where('worldId', '=', village.worldId).where('featureId', '=', featureId).executeTakeFirst();
  if (!deposit || Number(deposit.remainingAmount) <= 0) return undefined;
  const recognized = await recognizedDepositRoute(tx, village.worldId, village.villageId, deposit);
  if (recognized) return refineVillagePath(tx,village,recognized,featureId);
  if (await hasRecognizedDepositAccess(tx, village.worldId, village.villageId, deposit)) return undefined;
  if (visiblePath) return refineVillagePath(tx,village,visiblePath,featureId);
  const dx = wrappedDelta(deposit.cellX, village.anchorCellX, village.widthCells);
  const dy = wrappedDelta(deposit.cellY, village.anchorCellY, village.heightCells);
  // World-reach commands can target arbitrarily remote cells. Keep this case bounded
  // until long-distance navigation has a chunk-level planner.
  if (Math.abs(dx) + Math.abs(dy) > 128) {
    const path: TravelCell[] = [{ cellX: village.anchorCellX, cellY: village.anchorCellY }];
    for (let i = 1; i <= Math.abs(dx); i++) path.push({
      cellX: normalizeCell(village.anchorCellX + Math.sign(dx) * i, village.widthCells),
      cellY: village.anchorCellY,
    });
    for (let i = 1; i <= Math.abs(dy); i++) path.push({
      cellX: deposit.cellX,
      cellY: normalizeCell(village.anchorCellY + Math.sign(dy) * i, village.heightCells),
    });
    return refineVillagePath(tx,village,path,featureId);
  }
  const width = Math.min(village.widthCells, Math.abs(dx) + 17);
  const height = Math.min(village.heightCells, Math.abs(dy) + 17);
  const originCellX = normalizeCell(village.anchorCellX + Math.min(0, dx) - 8, village.widthCells);
  const originCellY = normalizeCell(village.anchorCellY + Math.min(0, dy) - 8, village.heightCells);
  const xs = Array.from({ length: width }, (_, i) => normalizeCell(originCellX + i, village.widthCells));
  const ys = Array.from({ length: height }, (_, i) => normalizeCell(originCellY + i, village.heightCells));
  const wanted = new Map<string, { chunkX: number; chunkY: number }>();
  for (const y of ys) for (const x of xs) {
    const chunkX = Math.floor(x / village.chunkSize), chunkY = Math.floor(y / village.chunkSize);
    wanted.set(`${chunkX}:${chunkY}`, { chunkX, chunkY });
  }
  const [chunks, occupied] = await Promise.all([
    tx.selectFrom('worldChunks').select(['chunkX', 'chunkY', 'terrainCodes'])
      .where('worldId', '=', village.worldId)
      .where((eb) => eb.or([...wanted.values()].map(({ chunkX, chunkY }) => eb.and([
        eb('chunkX', '=', chunkX), eb('chunkY', '=', chunkY),
      ])))).execute(),
    tx.selectFrom('worldCellOccupancies').select(['cellX', 'cellY'])
      .where('worldId', '=', village.worldId).where('cellX', 'in', xs).where('cellY', 'in', ys).execute(),
  ]);
  const rc1=village.generationVersion===3?await readRc1Ground(tx,village.worldId):null;
  const byChunk = new Map(chunks.map((chunk) => [`${chunk.chunkX}:${chunk.chunkY}`, chunk]));
  const terrainCodes = ys.flatMap((y) => xs.map((x) => {
    if(rc1)return rc1.cell(x,y).code;
    const chunk = byChunk.get(`${Math.floor(x / village.chunkSize)}:${Math.floor(y / village.chunkSize)}`);
    if (!chunk) throw new HttpError(409, 'WORLD_NOT_READY', 'Le terrain de ce monde est en préparation.');
    return chunk.terrainCodes[(y % village.chunkSize) * village.chunkSize + (x % village.chunkSize)]!;
  }));
  const routeState = {
    world: { widthCells: village.widthCells, heightCells: village.heightCells },
    village: { anchorCellX: village.anchorCellX, anchorCellY: village.anchorCellY },
    region: { originCellX, originCellY, width, height, terrainCodes,
      features: [{ id: featureId, cellX: deposit.cellX, cellY: deposit.cellY,
        type: deposit.resourceCode === 'wood' ? 'woodland' : 'stone_outcrop', deposit: { state: 'available' } }] },
    cells: occupied.map((cell) => ({ ...cell, footprint: {} })),
  } as unknown as Pick<VillageState, 'world' | 'village' | 'region' | 'cells'>;
  const path=buildTravelNetwork(routeState, [featureId],rc1?.navigation).find((route) => route.id === featureId)?.cells;
  return path?refineVillagePath(tx,village,path,featureId):undefined;
}

export async function refineVillagePath(tx:Transaction<Database>,village:Pick<OwnedVillage,'worldId'|'villageId'|'anchorCellX'|'anchorCellY'|'widthCells'|'heightCells'|'chunkSize'|'generationVersion'>,path:TravelCell[],id:string):Promise<TravelCell[]>{
  const full=village as OwnedVillage,ground=await snapshot(tx,full),features=await featuresInSnapshot(tx,full,ground);
  const rows=await tx.selectFrom('worldCellOccupancies').leftJoin('buildings',join=>join.onRef('buildings.id','=','worldCellOccupancies.buildingId').onRef('buildings.worldId','=','worldCellOccupancies.worldId'))
    .select(['worldCellOccupancies.cellX','worldCellOccupancies.cellY','worldCellOccupancies.role','buildings.id','buildings.villageId','buildings.buildingType','buildings.visualLayout','buildings.quarterTurns'])
    .where('worldCellOccupancies.worldId','=',village.worldId).where('worldCellOccupancies.buildingId','is not',null).execute();
  const context={world:village,village:{anchorCellX:village.anchorCellX,anchorCellY:village.anchorCellY,
    townHallBuildingId:rows.find(r=>r.villageId===village.villageId&&r.buildingType==='town-hall')?.id},
    region:{originCellX:ground.originCellX,originCellY:ground.originCellY,width:64,height:64,terrainCodes:ground.terrainCodes,
      features:features.map(f=>({...f,type:f.featureTypeCode,deposit:{blocksCell:f.blocksCell,cleared:f.cleared,state:Number(f.remainingAmount)===0?'depleted':'available'}}))},
    cells:rows.map(r=>({cellX:r.cellX,cellY:r.cellY,footprint:{buildingId:r.id},building:r.role==='anchor'?{id:r.id,type:r.buildingType,visualLayout:r.visualLayout,quarterTurns:r.visualLayout?.quarterTurns??r.quarterTurns}:null})),
    infrastructure:await readNavigationInfrastructure(tx,village)} as unknown as Pick<VillageState,'world'|'village'|'region'|'cells'|'infrastructure'>;
  const rc1=ground.rc1;
  const route=refineTravelRoute(context,{id,kind:'stone',cells:path,destination:path.at(-1)!},new Set(),undefined,rc1?.navigation);
  if(!route)throw new HttpError(409,'DESTINATION_UNREACHABLE','Aucun accès praticable depuis le village.');return route.cells;
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
  const endX = ground.originCellX + SNAPSHOT_SIZE;
  const endY = ground.originCellY + SNAPSHOT_SIZE;
  const xs=endX<=village.widthCells?[[ground.originCellX,endX]]:[[ground.originCellX,village.widthCells],[0,endX-village.widthCells]];
  const ys=endY<=village.heightCells?[[ground.originCellY,endY]]:[[ground.originCellY,village.heightCells],[0,endY-village.heightCells]];
  return naturalFeaturesQuery(tx,village.worldId,xs.flatMap(([minX,maxX])=>ys.map(([minY,maxY])=>({minX:minX!,maxX:maxX!,minY:minY!,maxY:maxY!})))).execute();
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

export async function state(
  tx: Transaction<Database>,
  accountId: string,
  worldSlug: string,
  existingEconomy?: VillageEconomy,
  admit = true,
): Promise<VillageState> {
  const village = await ownedVillage(tx, accountId, worldSlug, existingEconomy?.villageId);
  const economy = existingEconomy ?? await beginVillageEconomy(tx, village.worldId, village.villageId);
  if (economy.worldId !== village.worldId || economy.villageId !== village.villageId)
    throw new Error('Village economy context does not match the requested village');
  // This second pass uses the same bound and only matters for a zero-duration
  // transition created by the command before its snapshot is assembled.
  await reconcileVillageEconomy(tx, economy);
  if (admit) {
    await admitExploitationGardens(tx, economy);
    await admitWorksites(tx, economy, village, featureId => stoneTravelPath(tx, village, featureId));
    await admitScience(tx, economy);
  }
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
        'buildings.visualLayout',
        'buildings.quarterTurns',
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
      safeAmount(projected.amount);
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
  const [cohorts, housingRows, harvestRows, extractionRows, projectedPlots] = await Promise.all([
    reconcileRestHousing(tx,village.worldId,village.villageId,at),
    tx.selectFrom('buildings').select(['id','buildingType', 'level']).where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId).where(eb=>eb.or([eb('status','=','completed'),eb.and([
        eb('buildingType','=','town-hall'),eb('targetLevel','is not',null)])])).execute(),
    tx.selectFrom('gardenHarvests').selectAll().where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId).where('status', '=', 'in-progress').execute(),
    tx.selectFrom('depositExtractions').selectAll().where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId).where('status', '=', 'in-progress').execute(),
    projectGardenPlots(tx, village.worldId, village.villageId, at),
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
    housingCapacity: housingRows.reduce((total, row) => total + housingCapacity(row.buildingType,row.level), 0),
    cohorts: projectedCohorts.map(c=>({id:c.id,memberCount:c.memberCount,activity:c.energy.activity,
      restBuildingId:c.restBuildingId,restingSince:c.energy.restingSince?.toISOString()??null,
      energy: displayedEnergy(c.energy), cartographer: c.cartographer,
      assignmentId: c.harvestId ?? c.extractionId ?? c.scienceActivityId ?? c.processingLotId,
      assignmentKind: c.harvestId ? 'garden' as const : c.extractionId ? 'extraction' as const : c.scienceActivityId ? 'science' as const : c.processingLotId ? 'processing' as const : null })),
    restHousing: housingRows.filter(b=>housingCapacity(b.buildingType,b.level)>0).map(b=>({buildingId:b.id,capacity:housingCapacity(b.buildingType,b.level),
      restingCount:projectedCohorts.filter(c=>c.restBuildingId===b.id).reduce((n,c)=>n+c.memberCount,0)})),
    restingWithoutHousing:projectedCohorts.filter(c=>c.energy.activity==='resting'&&withoutAssignment(c)&&c.restBuildingId===null).reduce((n,c)=>n+c.memberCount,0),
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
  const harvestByPlot = new Map(harvestRows.filter((item) => item.plotCellX !== null)
    .flatMap(item=>(item.stops.length?item.stops:[{cellX:item.plotCellX!,cellY:item.plotCellY!}])
      .map(plot=>[worldCellKey(plot.cellX,plot.cellY),item] as const)));
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
      .filter((row) => (row.status === 'completed'||row.buildingType==='town-hall'&&row.targetLevel!==null) && row.pendingExpansionId === null)
      .map((row) => ({ cellX: row.cellX, cellY: row.cellY })),
    village,
  );
  const occupied = new Map(
    occupancyRows.map((row) => [worldCellKey(row.cellX, row.cellY), row]),
  );
  const visible = new Set([...available, ...occupied.keys()]);
  const features = await featuresInSnapshot(tx, village, ground);
  const featureCells = new Set(
    features.filter(feature => feature.resourceCode ? feature.blocksCell : feature.featureState !== 'depleted').map((feature) => worldCellKey(feature.cellX, feature.cellY)),
  );
  const wood = resources.find((item) => item.code === 'wood'),
    carrot = resources.find((item) => item.code === 'carrot');
  if (!wood || !carrot || !wood.productionUpdatedAt)
    throw new Error('Village resource seed is incomplete');
  const townHallBuildingId=occupancyRows.find(row=>row.buildingType==='town-hall')?.buildingId;
  const villageState: VillageState = {
    science: await scienceSnapshot(tx, economy),
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
      ...(townHallBuildingId?{townHallBuildingId}:{}),
      resources,
      wood: wood.amount,
      carrots: carrot.amount,
      woodProductionPerHour: wood.productionPerHour,
      woodProductionUpdatedAt: wood.productionUpdatedAt,
      population,
      accomplishments: accomplishmentRows.map((item) => ({ code: item.code, completedAt: item.completedAt.toISOString() })),
      extractions: await Promise.all(extractionRows.map((row) => readExtraction(tx, village.worldId, village.villageId, row.id))),
      worksites: await readWorksites(tx, village.worldId, village.villageId),
      exploitationOrders: await readExploitationOrders(tx, economy),
      processingOrders: await processingSnapshot(tx, economy),
      market: await marketSnapshot(tx, economy),
    },
    buildingTypes: definitions,
    travelRoutes: [],
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
        deposit: feature.initialAmount !== null ? {
          featureId: feature.id, resourceCode: feature.resourceCode!, blocksCell: feature.blocksCell!, cleared: feature.cleared ?? false, cellX: feature.cellX, cellY: feature.cellY,
          initialAmount: safeAmount(feature.initialAmount!), remainingAmount: safeAmount(feature.remainingAmount!),
          reservedAmount: safeAmount(feature.reservedAmount!), availableAmount: safeAmount(feature.remainingAmount!) - safeAmount(feature.reservedAmount!),
          state: feature.cleared || feature.featureState === 'depleted' ? 'depleted' as const : 'available' as const,
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
          gardenExpansions = [...new Set(pendingCells.flatMap((item) => item.pendingExpansionId ? [item.pendingExpansionId] : []))]
            .flatMap((id) => { const item = expansionById.get(id); return item ? [{ id, startedAt: item.startedAt.toISOString(),
              completesAt: item.completesAt.toISOString(), cells: pendingCells.filter((cell) => cell.pendingExpansionId === id)
                .map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })) }] : []; })
            .sort((a, b) => a.completesAt.localeCompare(b.completesAt) || a.id.localeCompare(b.id)),
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
                  visualLayout: row.visualLayout,
                  quarterTurns: row.visualLayout?.quarterTurns??row.quarterTurns,
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
                              completesAt: harvest.completesAt.toISOString(), reservedCarrots: harvest.stops.find(s=>s.cellX===plot.cellX&&s.cellY===plot.cellY)?.reservedCarrots??number(harvest.reservedCarrots),
                              transportMs: harvest.transportMs, path: harvest.pathCells ?? [],
                              stops:harvest.stops,returnPath:harvest.returnPathCells??[] } : null };
                        }),
                        expansion: gardenExpansions[0] ?? null,
                        expansions: gardenExpansions,
                        harvest: [...(componentBuildings.get(logicalBuildingId) ?? new Set([row.buildingId]))]
                          .map((id) => legacyHarvestByBuilding.get(id)).find(Boolean) ? (() => {
                          const harvest = [...(componentBuildings.get(logicalBuildingId) ?? new Set([row.buildingId]))]
                            .map((id) => legacyHarvestByBuilding.get(id)).find(Boolean)!;
                          return {
                            id: harvest.id, startedAt: harvest.startedAt.toISOString(),
                            completesAt: harvest.completesAt.toISOString(), workerCount: harvest.workerCount,
                            reservedCarrots: number(harvest.reservedCarrots),
                            transportMs: harvest.transportMs, path: harvest.pathCells ?? [],
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
            (!ground.rc1 || !ground.rc1.field.surfaceReason({x:cellX,y:cellY,halfWidth:.5,halfHeight:.5},null,.125) && !ground.rc1.field.intersectsTree({x:cellX,y:cellY,halfWidth:.5,halfHeight:.5})) &&
            !protectedCell(cellX, cellY, protectedRows, village),
        };
      })
      .filter((cell) => cell.canBuild || cell.footprint !== null),
  };
  villageState.infrastructure=await readInfrastructure(tx,village.worldId,village.villageId);
  villageState.factoryEnabled=await factoryCapability(tx,village.worldId);
  villageState.travelRoutes = buildTravelNetwork({...villageState,infrastructure:await readNavigationInfrastructure(tx,village,villageState.infrastructure)},[],ground.rc1?.navigation);
  // Reuse committed mission paths; do not search routes to every woodland in the snapshot.
  for (const extraction of villageState.village.extractions) if (extraction.resourceCode === 'wood' && extraction.path.length) {
    villageState.travelRoutes.push({ id: extraction.featureId, kind: 'wood',
      destination: { cellX: extraction.cellX, cellY: extraction.cellY }, cells: extraction.path });
  }
  return villageState;
}

async function definition(
  tx: Transaction<Database>,
  buildingType: string,
  level: number,
  houseVariant: 'stone'|'logs'|'beams' = 'stone',
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
    tx.selectFrom('buildingVariantCosts').select(['resourceCode','amount','replacesResourceCode'])
      .where('buildingTypeCode','=',buildingType).where('level','=',level).where('variant','=',houseVariant).execute(),
  ]);
  const combined=new Map(costs.map(c=>[c.resourceCode,Number(c.amount)]));
  for(const c of variants){if(c.replacesResourceCode)combined.delete(c.replacesResourceCode);combined.set(c.resourceCode,(combined.get(c.resourceCode)??0)+Number(c.amount));}
  return { ...row, costs:[...combined].map(([resourceCode,amount])=>({resourceCode,amount})), production };
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
async function assertBuildable(tx:Transaction<Database>,village:OwnedVillage,cellX:number,cellY:number){
  return assertBuildableCells(tx,village,[{cellX,cellY}]);
}
/** One command context for the whole footprint, after the village/spatial locks. */
async function assertBuildableCells(tx:Transaction<Database>,village:OwnedVillage,cells:readonly SpatialCell[]){
  if(!cells.length)return;
  await assertNoInfrastructure(tx,village.worldId,cells,village);
  const ground=await snapshot(tx,village),protectedRows=await clearings(tx,village.worldId);
  const occupied=await tx.selectFrom('worldCellOccupancies').select(['cellX','cellY']).where('worldId','=',village.worldId)
    .where(eb=>eb.or(cells.map(c=>eb.and([eb('cellX','=',c.cellX),eb('cellY','=',c.cellY)])))).execute();
  const occupiedKeys=new Set(occupied.map(c=>worldCellKey(c.cellX,c.cellY)));
  const footprints=await tx.selectFrom('worldCellOccupancies').innerJoin('buildings',j=>j.onRef('buildings.id','=','worldCellOccupancies.buildingId').onRef('buildings.worldId','=','worldCellOccupancies.worldId'))
    .select(['worldCellOccupancies.cellX','worldCellOccupancies.cellY','worldCellOccupancies.pendingExpansionId'])
    .where('worldCellOccupancies.worldId','=',village.worldId).where('buildings.villageId','=',village.villageId)
    .where(eb=>eb.or([eb('buildings.status','=','completed'),eb.and([eb('buildings.buildingType','=','town-hall'),eb('buildings.targetLevel','is not',null)])])).execute();
  const sources=footprints.filter(c=>c.pendingExpansionId===null);
  for(const {cellX,cellY} of cells){
    const surface={x:cellX,y:cellY,halfWidth:.5,halfHeight:.5};
    if(ground.terrainAt(cellX,cellY)!==TERRAIN.grassland || ground.rc1&&(ground.rc1.field.surfaceReason(surface,null,.125)||ground.rc1.field.intersectsTree(surface)))
      throw new HttpError(409,'TERRAIN_NOT_BUILDABLE','Cette emprise rencontre un obstacle naturel.');
    if(occupiedKeys.has(worldCellKey(cellX,cellY)))throw new HttpError(409,'CELL_OCCUPIED','Cette case est déjà occupée.');
    if(protectedCell(cellX,cellY,protectedRows,village))throw new HttpError(409,'CLEARING_PROTECTED','Cette clairière est protégée.');
    if(!withinBuildReach({cellX,cellY},sources,village))throw new HttpError(409,'OUTSIDE_VILLAGE_REACH','Cette case est trop éloignée de votre village.');
  }
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
  if (row) await claimWoodlandCell(tx, worldId, cellX, cellY);
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
    await claimWoodlandCell(tx, worldId, cell.cellX, cell.cellY);
    if (!row) throw new HttpError(409, 'CELL_OCCUPIED', 'Au moins une case vient d’être réservée.');
  }
}

export function getVillageState(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId?: string,
) {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    return state(tx, accountId, worldSlug, await beginVillageEconomy(tx, village.worldId, village.villageId));
  });
}

export async function commandVillageScience(db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, command: ScienceCommand): Promise<VillageState> {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    await scienceCommand(tx, economy, command);
    return state(tx, accountId, worldSlug, economy);
  });
}

export async function commandVillageProcessing(db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, command: ProcessingCommand): Promise<VillageState> {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    await commandProcessing(tx, economy, command);
    return state(tx, accountId, worldSlug, economy);
  });
}

export async function commandVillageMarket(db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, command: MarketCommand): Promise<VillageState> {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    await commandMarket(tx, economy, command);
    return state(tx, accountId, worldSlug, economy);
  });
}
export async function previewVillageMarket(db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, request: MarketRequest) {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    return previewMarket(tx, economy, request);
  });
}

export async function previewVillageProcessing(db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, buildingId: string, workerCount: number, orderId?: string) {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    return previewProcessing(tx, economy, buildingId, workerCount, orderId);
  });
}

/** Explicit administrative pilot conversion. No catalog upgrade, cost or implicit migration. */
export async function configureTownHallFactory(db:Kysely<Database>,accountId:string,worldSlug:string,villageId:string,cellX:number,cellY:number,apply=true,entranceFace:'-x'|'+x'='-x'){
  let preview:unknown;
  const previewRollback=new Error('FACTORY_PREVIEW_ROLLBACK');
  try{return await db.transaction().execute(async tx=>{
    const village=await ownedVillage(tx,accountId,worldSlug);
    if(village.villageId!==villageId)throw new HttpError(404,'VILLAGE_NOT_FOUND','Village introuvable.');
    const x=normalizeCell(cellX,village.widthCells),y=normalizeCell(cellY,village.heightCells);
    const economy=await beginVillageEconomy(tx,village.worldId,villageId,undefined,[{cellX:x,cellY:y}],[],true);
    await reconcileVillageEconomy(tx,economy);
    const hall=await tx.selectFrom('buildings').selectAll().where('worldId','=',village.worldId).where('villageId','=',villageId).where('buildingType','=','town-hall').forUpdate().executeTakeFirstOrThrow();
    if(hall.status!=='completed')throw new HttpError(409,'BUILDING_BUSY','Hôtel de ville en travaux.');
    const cells=await tx.selectFrom('worldCellOccupancies').select(['cellX','cellY','role']).where('worldId','=',village.worldId).where('buildingId','=',hall.id).execute();
    const anchor=cells.find(c=>c.role==='anchor')!;
    if(hall.visualLayout){if(cells.some(c=>c.cellX===x&&c.cellY===y)){preview={buildingId:hall.id,cells,layout:hall.visualLayout,alreadyConfigured:true};if(!apply)throw previewRollback;return preview;}throw new HttpError(409,'LAYOUT_ALREADY_SET','Implantation déjà configurée.');}
    if(cells.length!==1||toroidalManhattan(anchor.cellX,anchor.cellY,x,y,village.widthCells,village.heightCells)!==1)throw new HttpError(409,'INVALID_FOOTPRINT','Une cellule voisine est requise.');
    if(Math.abs(wrappedDelta(x,village.anchorCellX,village.widthCells))>32||Math.abs(wrappedDelta(y,village.anchorCellY,village.heightCells))>32)throw new HttpError(409,'OUTSIDE_VILLAGE_REACH','Hors du périmètre historique.');
    await assertBuildable(tx,village,x,y);
    const ground=await snapshot(tx,village);
    const elevation=(cx:number,cy:number)=>{const dx=normalizeCell(cx-ground.originCellX,village.widthCells),dy=normalizeCell(cy-ground.originCellY,village.heightCells);return ground.elevations[dy*SNAPSHOT_SIZE+dx]!;};
    if(Math.abs(elevation(x,y)-elevation(anchor.cellX,anchor.cellY))>1)throw new HttpError(409,'UNEVEN_TERRAIN','Emprise trop inclinée.');
    const quarterTurns=x===anchor.cellX?0:1;
    const layout={recipe:'town-hall' as const,version:1 as const,quarterTurns,entranceFace,offset:[0,0] as [number,number]};
    preview={buildingId:hall.id,cells:[anchor,{cellX:x,cellY:y,role:'extension'}],layout};
    if(!apply)throw previewRollback;
    await reserve(tx,village.worldId,x,y,hall.id,'extension');
    await tx.updateTable('buildings').set({visualLayout:layout}).where('worldId','=',village.worldId).where('id','=',hall.id).executeTakeFirstOrThrow();
    return preview;
  });}catch(error){if(error===previewRollback)return preview;throw error;}
}
const universityCampusCells=(anchor:SpatialCell,quarterTurns=0)=>fixedBuildingFootprint('university',anchor,quarterTurns);

/** Conservative adaptation of existing campuses; village/business locks are already held. */
async function ensureUniversityCampus(tx: Transaction<Database>, village: OwnedVillage, buildingId: string, anchor: SpatialCell) {
  const building=await tx.selectFrom('buildings').select('quarterTurns').where('worldId','=',village.worldId).where('id','=',buildingId).where('villageId','=',village.villageId).executeTakeFirstOrThrow();
  const cells = universityCampusCells(anchor,building.quarterTurns).map(c => ({ cellX: normalizeCell(c.cellX, village.widthCells), cellY: normalizeCell(c.cellY, village.heightCells) }));
  const existing = await tx.selectFrom('worldCellOccupancies').select(['cellX', 'cellY']).where('worldId', '=', village.worldId).where('buildingId', '=', buildingId).execute();
  const expected = new Set(cells.map(c => worldCellKey(c.cellX, c.cellY)));
  if (existing.some(c => !expected.has(worldCellKey(c.cellX, c.cellY))))
    throw new HttpError(409, 'INVALID_BUILDING_FOOTPRINT', 'L’emprise existante ne correspond pas à ce campus.');
  const occupied = new Set(existing.map(c => worldCellKey(c.cellX, c.cellY)));
  const added = cells.filter(c => !occupied.has(worldCellKey(c.cellX, c.cellY)));
  if (!added.length) return;
  const ground = await snapshot(tx, village);
  const heights = cells.map(c => ground.elevations[normalizeCell(c.cellY - ground.originCellY, village.heightCells) * SNAPSHOT_SIZE + normalizeCell(c.cellX - ground.originCellX, village.widthCells)]!);
  if (heights.some(h => !Number.isFinite(h)) || Math.max(...heights) - Math.min(...heights) > 1)
    throw new HttpError(409, 'UNEVEN_TERRAIN', 'L’Université demande une emprise plane.');
  await assertBuildableCells(tx,village,added);
  await reserveSelection(tx, village.worldId, buildingId, anchor, added, null, false);
}

/** Explicit deployment/recipe adaptation, never performed by a snapshot read. */
export async function adaptUniversityCampus(db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, buildingId: string): Promise<void> {
  await db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const anchor = await tx.selectFrom('worldCellOccupancies').innerJoin('buildings', 'buildings.id', 'worldCellOccupancies.buildingId')
      .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY'])
      .where('worldCellOccupancies.worldId', '=', village.worldId).where('worldCellOccupancies.buildingId', '=', buildingId)
      .where('buildings.villageId', '=', village.villageId).where('buildings.buildingType', '=', 'university').where('worldCellOccupancies.role', '=', 'anchor').executeTakeFirst();
    if (!anchor) throw new HttpError(404, 'BUILDING_NOT_FOUND', 'Université introuvable.');
    const cells = universityCampusCells(anchor).map(c => ({ cellX: normalizeCell(c.cellX, village.widthCells), cellY: normalizeCell(c.cellY, village.heightCells) }));
    await beginVillageEconomy(tx, village.worldId, village.villageId, undefined, cells,[],true);
    await tx.selectFrom('buildings').select('id').where('worldId', '=', village.worldId).where('id', '=', buildingId).forUpdate().executeTakeFirstOrThrow();
    await ensureUniversityCampus(tx, village, buildingId, anchor);
  });
}

type ExpectedCost = { resourceCode: string; amount: number };
type CostLike = { resourceCode: string; amount: string | number };
type BuildingCommandType = 'construct' | 'upgrade' | 'expand';

function canonicalCosts(costs: ExpectedCost[] | undefined): ExpectedCost[] {
  return [...(costs ?? [])].map(cost => ({ resourceCode: cost.resourceCode, amount: cost.amount }))
    .sort((a, b) => a.resourceCode.localeCompare(b.resourceCode));
}

function assertAcceptedCosts(actual: CostLike[], expected: ExpectedCost[] | undefined): void {
  if (!expected?.length) return;
  const bounds = new Map(expected.map(cost => [cost.resourceCode, cost.amount]));
  if (actual.some(cost => Number(cost.amount) > (bounds.get(cost.resourceCode) ?? -1)))
    throw new HttpError(409, 'BUILDING_COST_CHANGED', 'Le coût a changé. Vérifier la palette avant de recommencer.');
}

async function claimBuildingCommand(tx: Transaction<Database>, village: OwnedVillage, commandId: string | undefined,
  commandType: BuildingCommandType, request: unknown): Promise<boolean> {
  if (!commandId) return false;
  const inserted = await tx.insertInto('buildingCommandReceipts').values({ worldId: village.worldId,
    villageId: village.villageId, commandId, commandType, request: JSON.stringify(request), buildingId: null })
    .onConflict(conflict => conflict.columns(['worldId', 'villageId', 'commandId']).doNothing())
    .returning('commandId').executeTakeFirst();
  if (inserted) return false;
  const existing = await tx.selectFrom('buildingCommandReceipts').select(['commandType', 'request'])
    .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).where('commandId', '=', commandId)
    .executeTakeFirstOrThrow();
  const comparable=(value:unknown)=>commandType==='construct'&&value&&typeof value==='object'?{quarterTurns:0,...value}:value;
  if (existing.commandType !== commandType || !isDeepStrictEqual(comparable(existing.request), comparable(request)))
    throw new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette intention de construction a déjà été utilisée différemment.');
  return true;
}

async function finishBuildingCommand(tx: Transaction<Database>, village: OwnedVillage, commandId: string | undefined, buildingId: string): Promise<void> {
  if (!commandId) return;
  await tx.updateTable('buildingCommandReceipts').set({ buildingId }).where('worldId', '=', village.worldId)
    .where('villageId', '=', village.villageId).where('commandId', '=', commandId).execute();
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
  commandId?: string,
  expectedCosts?: ExpectedCost[],
  quarterTurns = 0, houseVariant: 'stone'|'logs'|'beams' = 'stone',
): Promise<VillageState> {
  if (buildingType === 'university' || buildingType === 'stonemason') {
    return constructBuildingArea(db,accountId,worldSlug,villageId,buildingType,{cellX,cellY},fixedBuildingFootprint(buildingType,{cellX,cellY},quarterTurns),durationOverride,commandId,expectedCosts,quarterTurns,houseVariant);
  }
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId)
      throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const x = normalizeCell(cellX, village.widthCells);
    const y = normalizeCell(cellY, village.heightCells);
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, undefined, [{ cellX: normalizeCell(cellX, village.widthCells), cellY: normalizeCell(cellY, village.heightCells) }],[],true);
    const at = economy.through;
    const commandRequest = { ...(houseVariant!=='stone'?{houseVariant}:{}), quarterTurns, buildingType, cellX: x, cellY: y, expectedCosts: canonicalCosts(expectedCosts) };
    if (await claimBuildingCommand(tx, village, commandId, 'construct', commandRequest)) return state(tx, accountId, worldSlug, economy);
    const item = await definition(tx, buildingType, 1, houseVariant);
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
    assertAcceptedCosts(item.costs, expectedCosts);
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
        quarterTurns, visualLayout: buildingType === 'dwelling' ? {recipe:houseVariant==='logs'?'log-house':houseVariant==='beams'?'beam-house':'stone-house',version:1,quarterTurns,entranceFace:'-z',offset:[0,0]} : null,
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
    await finishBuildingCommand(tx, village, commandId, building.id);
    return state(tx, accountId, worldSlug, economy);
  });
}
/** Construct a spatial building in one atomic selection. Non-spatial buildings
 * are deliberately kept on the existing single-cell command path. */
export async function constructBuildingArea(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string,
  buildingType: BuildingType, anchor: SpatialCell, rawCells: SpatialCell[], durationOverride: number | null,
  commandId?: string, expectedCosts?: ExpectedCost[], quarterTurns = 0, houseVariant: 'stone'|'logs'|'beams' = 'stone',
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, undefined, normalizeSpatialSelection(anchor, rawCells, village.widthCells, village.heightCells).cells,[],true);
    const at = economy.through;
    const selection = normalizeSpatialSelection(anchor, rawCells, village.widthCells, village.heightCells);
    const commandRequest = { ...(houseVariant!=='stone'?{houseVariant}:{}), quarterTurns, buildingType, anchor: selection.anchor, cells: selection.cells, expectedCosts: canonicalCosts(expectedCosts) };
    if (await claimBuildingCommand(tx, village, commandId, 'construct', commandRequest)) return state(tx, accountId, worldSlug, economy);
    const item = await definition(tx, buildingType, 1, houseVariant);
    if (!item.buildable) throw new HttpError(409, 'BUILDING_NOT_BUILDABLE', 'Ce bâtiment ne peut pas être construit directement.');
    if (item.code === 'university') {
      const expected=new Set(fixedBuildingFootprint('university',anchor,quarterTurns,village).map(c=>worldCellKey(c.cellX,c.cellY)));
      if (selection.cells.length !== 30 || selection.cells.some(c => !expected.has(worldCellKey(c.cellX, c.cellY))))
        throw new HttpError(400, 'INVALID_BUILDING_FOOTPRINT', 'L’Université occupe 5 × 6 cases autour de son ancre.');
      const ground = await snapshot(tx, village);
      const heights = selection.cells.map(c => ground.elevations[normalizeCell(c.cellY - ground.originCellY, village.heightCells) * SNAPSHOT_SIZE + normalizeCell(c.cellX - ground.originCellX, village.widthCells)]!);
      if (heights.some(h => !Number.isFinite(h)) || Math.max(...heights) - Math.min(...heights) > 1)
        throw new HttpError(409, 'UNEVEN_TERRAIN', 'L’Université demande une emprise plane.');
    } else if (item.code === 'stonemason') {
      const expected=new Set(fixedBuildingFootprint('stonemason',anchor,quarterTurns,village).map(c=>worldCellKey(c.cellX,c.cellY)));
      if (selection.cells.length !== 4 || selection.cells.some(c => !expected.has(worldCellKey(c.cellX,c.cellY))))
        throw new HttpError(400, 'INVALID_BUILDING_FOOTPRINT', 'Le tailleur occupe 2 × 2 cases.');
      const ground = await snapshot(tx, village);
      const heights = selection.cells.map(c => ground.elevations[normalizeCell(c.cellY-ground.originCellY,village.heightCells)*SNAPSHOT_SIZE+normalizeCell(c.cellX-ground.originCellX,village.widthCells)]!);
      if (heights.some(h => !Number.isFinite(h)) || Math.max(...heights)-Math.min(...heights)>1)
        throw new HttpError(409, 'UNEVEN_TERRAIN', 'Le tailleur demande une emprise plane.');
    } else if (item.code !== 'garden' && selection.cells.length !== 1)
      throw new HttpError(400, 'INVALID_BUILDING_FOOTPRINT', 'Ce bâtiment occupe exactement une case.');
    if (item.instanceLimitPerVillage !== null) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`${village.worldId}:${village.villageId}:${buildingType}`}, 0))`.execute(tx);
      const count = await tx.selectFrom('buildings').select(sql<number>`count(*)::integer`.as('count'))
        .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId)
        .where('buildingType', '=', buildingType).executeTakeFirstOrThrow();
      if (count.count >= item.instanceLimitPerVillage) throw new HttpError(409, 'BUILDING_LIMIT_REACHED', 'Limite atteinte pour ce bâtiment.');
    }
    await assertBuildableCells(tx,village,selection.cells);
    const actualCosts = scaledCosts(item.costs, item.code === 'garden' ? selection.cells.length : 1);
    assertAcceptedCosts(actualCosts, expectedCosts);
    await debit(tx, village.worldId, village.villageId, actualCosts, at);
    const completesAt = new Date(at.getTime() + (durationOverride ?? item.constructionDurationSeconds * 1_000));
    const building = await tx.insertInto('buildings').values({
      visualLayout: buildingType==='dwelling'?{recipe:houseVariant==='logs'?'log-house':houseVariant==='beams'?'beam-house':'stone-house',version:1,quarterTurns,entranceFace:'-z',offset:[0,0]}:null,
      quarterTurns, worldId: village.worldId, villageId: village.villageId, buildingType, level: 1, targetLevel: null,
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
    await finishBuildingCommand(tx, village, commandId, building.id);
    return state(tx, accountId, worldSlug, economy);
  });
}

export async function expandGarden(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string,
  buildingId: string, rawCells: SpatialCell[], durationOverride: number | null,
  commandId?: string, expectedCosts?: ExpectedCost[],
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, undefined, rawCells.map(c => ({ cellX: normalizeCell(c.cellX, village.widthCells), cellY: normalizeCell(c.cellY, village.heightCells) })),[],true);
    const at = economy.through;
    const canonicalSelection = normalizeSpatialSelection(rawCells[0]!, rawCells, village.widthCells, village.heightCells);
    const commandRequest = { buildingId, cells: canonicalSelection.cells, expectedCosts: canonicalCosts(expectedCosts) };
    if (await claimBuildingCommand(tx, village, commandId, 'expand', commandRequest)) return state(tx, accountId, worldSlug, economy);
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
    const selection = canonicalSelection;
    const occupiedRows = await tx.selectFrom('worldCellOccupancies')
      .leftJoin('buildings', (join) => join.onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId')
        .onRef('buildings.id', '=', 'worldCellOccupancies.buildingId'))
      .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY', 'worldCellOccupancies.pendingExpansionId',
        'buildings.buildingType', 'buildings.villageId', 'buildings.status'])
      .where('worldCellOccupancies.worldId', '=', village.worldId).execute();
    const occupiedAt = new Map(occupiedRows.map((item) => [worldCellKey(item.cellX, item.cellY), item]));
    const newCells: SpatialCell[] = [];
    for (const cell of selection.cells) {
      const occupied = occupiedAt.get(worldCellKey(cell.cellX, cell.cellY));
      if (!occupied) { newCells.push(cell); continue; }
      if (occupied.pendingExpansionId !== null || occupied.buildingType !== 'garden' || occupied.villageId !== village.villageId
        || occupied.status !== 'completed')
        throw new HttpError(409, 'CELL_OCCUPIED', 'Une case de la sélection est occupée ou encore en chantier.');
    }
    if (!selection.cells.some((cell) => activeCells.some((active) =>
      toroidalManhattan(active.cellX, active.cellY, cell.cellX, cell.cellY, village.widthCells, village.heightCells) <= 1,
    ))) throw new HttpError(409, 'INVALID_BUILDING_EXTENSION', 'L’extension doit toucher le jardin actif.');
    if (newCells.length === 0) return state(tx, accountId, worldSlug, economy);
    await assertBuildableCells(tx,village,newCells);
    const item = await definition(tx, 'garden', 1);
    const actualCosts = scaledCosts(item.costs, newCells.length);
    assertAcceptedCosts(actualCosts, expectedCosts);
    await debit(tx, village.worldId, village.villageId, actualCosts, at);
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
    await finishBuildingCommand(tx, village, commandId, building.id);
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
  commandId?: string,
  expectedCosts?: ExpectedCost[],
  expectedLevel?: number,
): Promise<VillageState> {
  // Compatibility for saved clients/tests from the old single-cell Garden UX.
  // The HTTP API uses /expansions; both paths now create the same expansion.
  if (extensionCellX !== undefined && extensionCellY !== undefined)
    return expandGarden(db, accountId, worldSlug, villageId, buildingId,
      [{ cellX: extensionCellX, cellY: extensionCellY }], durationOverride, commandId, expectedCosts);
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId)
      throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const campusAnchor = await tx.selectFrom('buildings').innerJoin('worldCellOccupancies', join =>
      join.onRef('worldCellOccupancies.worldId', '=', 'buildings.worldId').onRef('worldCellOccupancies.buildingId', '=', 'buildings.id'))
      .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY'])
      .where('buildings.worldId', '=', village.worldId).where('buildings.villageId', '=', village.villageId)
      .where('buildings.id', '=', buildingId).where('buildings.buildingType', '=', 'university').where('worldCellOccupancies.role', '=', 'anchor').executeTakeFirst();
    const campusCells = campusAnchor ? universityCampusCells(campusAnchor).map(c => ({
      cellX: normalizeCell(c.cellX, village.widthCells), cellY: normalizeCell(c.cellY, village.heightCells),
    })) : undefined;
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, undefined, campusCells,[],true);
    const at = economy.through;
    const commandRequest = { buildingId, expectedLevel: expectedLevel ?? null, expectedCosts: canonicalCosts(expectedCosts) };
    if (await claimBuildingCommand(tx, village, commandId, 'upgrade', commandRequest)) return state(tx, accountId, worldSlug, economy);
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
    if (expectedLevel !== undefined && building.level + 1 !== expectedLevel)
      throw new HttpError(409, 'BUILDING_LEVEL_CHANGED', 'Le niveau du bâtiment a changé. Vérifier la palette avant de recommencer.');
    const order = await tx.selectFrom('processingOrders').select('id').where('worldId', '=', village.worldId)
      .where('villageId', '=', villageId).where('buildingId', '=', buildingId).where('status', 'not in', ['completed','cancelled']).executeTakeFirst();
    if (order) throw new HttpError(409, 'PROCESSING_BUSY', 'Terminez ou annulez l’ordre de fabrication avant d’améliorer l’atelier.');
    if (building.buildingType === 'university') await ensureUniversityCampus(tx, village, building.id, building);
    const item = await definition(
      tx,
      building.buildingType,
      building.level + 1,
      building.visualLayout?.recipe==='log-house'?'logs':building.visualLayout?.recipe==='beam-house'?'beams':'stone',
    );
    assertAcceptedCosts(item.costs, expectedCosts);
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
    await finishBuildingCommand(tx, village, commandId, building.id);
    return state(tx, accountId, worldSlug, economy);
  });
}
export async function harvestGardenSelection(db:Kysely<Database>,accountId:string,worldSlug:string,villageId:string,cells:TravelCell[],commandId:string):Promise<VillageState>{
  return db.transaction().execute(async tx=>{
    const village=await ownedVillage(tx,accountId,worldSlug);
    if(village.villageId!==villageId)throw new HttpError(404,'VILLAGE_NOT_FOUND','Village introuvable.');
    if(!cells.length||cells.length>100)throw new HttpError(400,'INVALID_HARVEST_SELECTION','Sélectionner entre une et cent parcelles.');
    const targets=[...new Map(cells.map(c=>{const p={cellX:normalizeCell(c.cellX,village.widthCells),cellY:normalizeCell(c.cellY,village.heightCells)};return [worldCellKey(p.cellX,p.cellY),p];})).values()];
    const economy=await beginVillageEconomy(tx,village.worldId,village.villageId);
    const receipt=await tx.selectFrom('gardenHarvests').selectAll().where('worldId','=',village.worldId).where('villageId','=',villageId).where('commandId','=',commandId).executeTakeFirst();
    if(receipt){const old=receipt.stops.length?receipt.stops:[{cellX:receipt.plotCellX,cellY:receipt.plotCellY}];
      if(JSON.stringify(old.map(p=>[p.cellX,p.cellY]))!==JSON.stringify(targets.map(p=>[p.cellX,p.cellY])))throw new HttpError(409,'COMMAND_ID_CONFLICT','Cette intention a déjà été utilisée pour une autre sélection.');
      return state(tx,accountId,worldSlug,economy);}
    const snapshot=await state(tx,accountId,worldSlug,economy);
    const gardenPlots=snapshot.cells.flatMap(c=>c.building?.garden?.plots.map(p=>({plot:p,legacy:c.building!.garden!.harvest}))??[]);
    if(targets.some(t=>gardenPlots.some(p=>p.plot.cellX===t.cellX&&p.plot.cellY===t.cellY&&p.legacy)))throw new HttpError(409,'GARDEN_HARVEST_IN_PROGRESS','Une récolte existante est encore en cours sur ce Jardin.');
    if(targets.some(t=>!gardenPlots.some(p=>p.plot.cellX===t.cellX&&p.plot.cellY===t.cellY)))throw new HttpError(404,'GARDEN_PLOT_NOT_READY','Une parcelle sélectionnée n’appartient pas à ce village.');
    const plan=planGardenTour(snapshot.travelRoutes,{cellX:village.anchorCellX,cellY:village.anchorCellY},targets,village);
    if(!plan)throw new HttpError(409,'DESTINATION_UNREACHABLE','Aucun chemin praticable pour cette tournée.');
    await startGardenTour(tx,village.worldId,villageId,commandId,economy.through,plan);
    return state(tx,accountId,worldSlug,economy);
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
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId)
      throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    const at = economy.through;
    const plots = await tx.selectFrom('gardenPlots').select(['buildingId', 'cellX', 'cellY'])
      .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).execute();
    const legacyCommandId = typeof cellXOrCommandId === 'string' ? cellXOrCommandId : commandId;
    const oldReceipt = await tx.selectFrom('gardenHarvests').select(['plotCellX', 'plotCellY', 'stops'])
      .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId)
      .where('commandId', '=', legacyCommandId).executeTakeFirst();
    const fallback = plots.find((plot) => plot.buildingId === buildingId);
    const x = normalizeCell(typeof cellXOrCommandId === 'number' ? cellXOrCommandId : fallback?.cellX ?? -1, village.widthCells);
    const y = normalizeCell(typeof cellY === 'number' ? cellY : fallback?.cellY ?? -1, village.heightCells);
    if (oldReceipt) {
      if (oldReceipt.plotCellX === null) return state(tx, accountId, worldSlug, economy);
      if (oldReceipt.stops.length > 1 || oldReceipt.plotCellX !== x || oldReceipt.plotCellY !== y)
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
    const routes = (await state(tx, accountId, worldSlug, economy)).travelRoutes;
    const path = routes.find((route) => route.kind === 'garden' && route.destination.cellX === x && route.destination.cellY === y)?.cells;
    if (!path) throw new HttpError(409, 'DESTINATION_UNREACHABLE', 'Aucun chemin praticable vers cette parcelle.');
    await startGardenHarvest(tx, village.worldId, village.villageId, target.buildingId, x, y, legacyCommandId, at,
      path, travelDuration(path, village));
    return state(tx, accountId, worldSlug, economy);
  });
}

/** Starts a server-authoritative stone extraction. The feature UUID, not a viewport cell, is the target. */
export async function startVillageStoneExtraction(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string,
  featureId: string, commandId: string, workerCount: number,
): Promise<ExtractionResponse> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, featureId);
    const previous = await tx.selectFrom('depositExtractions').select('id').where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId).where('commandId', '=', commandId).executeTakeFirst();
    let woodland = false;
    if (!previous) {
      const eligibility = await stoneDepositDetails(tx, village, economy, featureId);
      woodland = eligibility.deposit.resourceCode === 'wood';
      const reason = eligibility.eligibility.workerOptions[0]?.reasonCode;
      if (reason && reason !== 'WORKERS_UNAVAILABLE')
        throw new HttpError(409, reason, 'Ce gisement ne peut pas être exploité actuellement.');
    }
    const path = previous ? [] : await stoneTravelPath(tx, village, featureId,
      woodland ? undefined : (await state(tx, accountId, worldSlug, economy)).travelRoutes
        .find((route) => route.kind === 'stone' && route.id === featureId)?.cells);
    if (!path) throw new HttpError(409, 'DESTINATION_UNREACHABLE', 'Aucun chemin praticable vers ce gisement.');
    const id = await startStoneExtraction(tx, village, economy, featureId, commandId, workerCount,
      path, travelDuration(path, village));
    return { villageState: await state(tx, accountId, worldSlug, economy),
      extraction: await readExtraction(tx, village.worldId, village.villageId, id),
      deposit: await readStoneDeposit(tx, village.worldId, featureId) };
  });
}

export async function getStoneDepositDetails(
  db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, featureId: string,
) {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const position = await tx.selectFrom('resourceDeposits').select(['cellX', 'cellY'])
      .where('worldId', '=', village.worldId).where('featureId', '=', featureId).executeTakeFirst();
    const knowledge = await knownGeography(tx, village.worldId, accountId, village.widthCells, village.heightCells);
    if (!position || !knowledge.known(position)) throw new HttpError(404, 'DEPOSIT_NOT_FOUND', 'Gisement inconnu.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, featureId);
    const woodland = (await readStoneDeposit(tx, village.worldId, featureId)).resourceCode === 'wood';
    const path = await stoneTravelPath(tx, village, featureId,
      woodland ? undefined : (await state(tx, accountId, worldSlug, economy)).travelRoutes
        .find((route) => route.kind === 'stone' && route.id === featureId)?.cells);
    return stoneDepositDetails(tx, village, economy, featureId, path ? travelDuration(path, village) : 0, Boolean(path));
  });
}

export async function clearVillageWoodland(db: Kysely<Database>, accountId: string, worldSlug: string,
  villageId: string, featureId: string): Promise<VillageState> {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, featureId);
    const details = await stoneDepositDetails(tx, village, economy, featureId);
    if (!details.eligibility.inRange || details.eligibility.protected)
      throw new HttpError(409, 'WOODLAND_ACCESS_DENIED', 'Ce bosquet est hors de portée ou protégé.');
    await clearWoodland(tx, village.worldId, featureId, economy.through);
    return state(tx, accountId, worldSlug, economy);
  });
}

function canonicalExploitation(request: ExploitationRequest, village: OwnedVillage): ExploitationRequest {
  return { ...request,
    cohortId: request.cohortId?.toLowerCase() ?? null,
    initialAdmission: request.initialAdmission ?? 'allow-wait',
    gardens: request.gardens.map(c => ({ cellX: normalizeCell(c.cellX, village.widthCells), cellY: normalizeCell(c.cellY, village.heightCells) })),
    wood: request.wood.map(id => id.toLowerCase()), stone: request.stone.map(id => id.toLowerCase()) };
}

export async function prepareExploitation(tx: Transaction<Database>, village: OwnedVillage, economy: VillageEconomy,
  accountId: string, request: ExploitationRequest) {
  // Snapshot without admissions: preview never sends idle people to work.
  const snapshot = await state(tx, accountId, village.worldSlug, economy, false);
  const preview: ExploitationPreview = { gardens: [], wood: [], stone: [], excluded: [], gardenReturnMs: null,
    estimates: { carrot: 0, wood: 0, stone: 0 }, workforce: { structuralMax: 0, autoWorkerCap: 0,
      availableNow: 0, allocation: { gardens: 0, wood: 0, stone: 0 }, reason: null } };
  const plots = snapshot.cells.flatMap(c => c.building?.garden?.plots.map(plot => ({ plot, building: c.building! })) ?? []);
  const seen = new Set<string>();
  for (const cell of request.gardens) {
    const key = `garden:${cell.cellX}:${cell.cellY}`;
    const p = plots.find(p => p.plot.cellX === cell.cellX && p.plot.cellY === cell.cellY);
    const reason = seen.has(key) ? 'duplicate' : !p ? 'not-found' : p.building.status !== 'completed' ? 'building-incomplete'
      : p.plot.harvest || p.building.garden?.harvest ? 'already-assigned' : p.plot.storedCarrots < 1 ? 'empty' : null;
    seen.add(key);
    if (reason) preview.excluded.push({ key, reason });
    else { preview.gardens.push(cell); preview.estimates.carrot += p!.plot.storedCarrots; }
  }
  const plan = preview.gardens.length ? planGardenTour(snapshot.travelRoutes,
    { cellX: village.anchorCellX, cellY: village.anchorCellY }, preview.gardens, village) : null;
  if (preview.gardens.length && !plan) {
    preview.excluded.push(...preview.gardens.map(p => ({ key: `garden:${p.cellX}:${p.cellY}`, reason: 'unreachable' })));
    preview.gardens = []; preview.estimates.carrot = 0;
  }
  preview.gardenReturnMs = plan?.durationMs ?? null;
  for (const family of ['wood', 'stone'] as const) {
    if (!request[family].length) continue;
    const selection = await prepareWorksiteSelection(tx, village, economy, { commandId: request.commandId,
      mode: family === 'wood' ? request.woodMode : 'extract', workerCap: Math.min(10, request.workerCap), featureIds: request[family] });
    preview[family] = selection.included.map(i => i.featureId);
    preview.excluded.push(...selection.excluded.map(i => ({ key: i.featureId, reason: i.reason })));
    for (const id of preview[family]) {
      const deposit = await readStoneDeposit(tx, economy.worldId, id);
      preview.estimates[family] += Math.max(0, Math.floor(deposit.remainingAmount - (family === 'wood' ? deposit.initialAmount / 10 : 0)));
    }
  }
  const gardenCap = preview.gardens.length ? 1 : 0;
  const woodCap = preview.wood.length ? Math.min(10, request.activityCaps?.wood ?? 10) : 0;
  const stoneCap = preview.stone.length ? Math.min(10, request.activityCaps?.stone ?? 10) : 0;
  preview.workforce.structuralMax = Math.min(snapshot.village.population.total, gardenCap + woodCap + stoneCap, request.workerCap);
  const lots: Partial<Record<'wood' | 'stone', { id: string; amount: number; transportMs: number }>> = {};
  for (const family of ['wood', 'stone'] as const) for (const id of preview[family]) {
    const deposit = await readStoneDeposit(tx, village.worldId, id);
    const path = await stoneTravelPath(tx, village, id);
    const amount = Math.min(100, deposit.availableAmount,
      Math.max(0, deposit.remainingAmount - (family === 'wood' ? deposit.initialAmount / 10 : 0)));
    const transportMs = path ? travelDuration(path, village) : Infinity;
    const previous = lots[family];
    if (path && amount > 0 && (!previous || transportMs < previous.transportMs || transportMs === previous.transportMs && id < previous.id))
      lots[family] = { id, amount, transportMs };
  }
  const cohorts = await tx.selectFrom('populationCohorts').selectAll().where('worldId', '=', village.worldId)
    .where('villageId', '=', village.villageId).orderBy('id').execute();
  const projectedCohorts = cohorts.map(cohort => {
    const energy = advanceEnergy({ energy: cohort.energy, progress: cohort.energyProgress, activity: cohort.activity,
      restingSince: cohort.restingSince, foodUsedSinceRest: cohort.foodUsedSinceRest, updatedAt: cohort.energyUpdatedAt }, economy.through);
    return { ...cohort, energy: energy.energy, energyProgress: energy.progress, activity: energy.activity,
      restingSince: energy.restingSince, foodUsedSinceRest: energy.foodUsedSinceRest, energyUpdatedAt: energy.updatedAt };
  });
  const preferred = projectedCohorts.filter(c => withoutAssignment(c) && c.activity === 'idle' && (!request.cohortId || c.id === request.cohortId));
  preview.workforce.availableNow = preferred.reduce((sum, cohort) => sum + cohort.memberCount, 0);
  // Simulate disjoint first teams on copies: preview never reserves a person.
  const pool = preferred.map(c => ({ ...c }));
  let used = 0;
  const consume = (team: ReturnType<typeof workingTeam>) => {
    let remaining = team.count;
    for (const c of team.cohorts) { const take = Math.min(c.memberCount, remaining); c.memberCount -= take; remaining -= take; }
    used += team.count;
    return team.count;
  };
  if (plan && gardenCap && request.workerCap > 0)
    preview.workforce.allocation.gardens = consume(workingTeam(pool, 1, () => plan.durationMs));
  const openSites = Number(woodCap > 0) + Number(stoneCap > 0);
  for (const family of ['wood', 'stone'] as const) {
    const lot = lots[family], childCap = family === 'wood' ? woodCap : stoneCap;
    const cap = request.activityCaps ? Math.min(childCap, request.workerCap - used)
      : exploitationAdmissionCap(request.workerCap, used, openSites, false, childCap, preview.workforce.allocation.gardens > 0);
    if (lot) preview.workforce.allocation[family] = consume(workingTeam(pool, cap,
      count => stoneExtractionDuration(count, lot.amount) + 2 * lot.transportMs));
  }
  preview.workforce.autoWorkerCap = used;
  preview.workforce.reason = preview.workforce.structuralMax === 0 ? 'no-targets'
    : used === 0 ? request.cohortId ? 'cohort-unavailable' : 'no-eligible-workers' : null;
  return { preview, plan, population: snapshot.village.population };
}

export async function previewVillageExploitation(db: Kysely<Database>, accountId: string, worldSlug: string,
  villageId: string, rawRequest: ExploitationRequest): Promise<ExploitationPreview> {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const request = canonicalExploitation(rawRequest, village);
    const economy = await beginVillageEconomy(tx, village.worldId, villageId, undefined, [], [...request.wood, ...request.stone]);
    return (await prepareExploitation(tx, village, economy, accountId, request)).preview;
  });
}

export async function startVillageExploitation(db: Kysely<Database>, accountId: string, worldSlug: string,
  villageId: string, rawRequest: ExploitationRequest): Promise<VillageState> {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const request = canonicalExploitation(rawRequest, village);
    const economy = await beginVillageEconomy(tx, village.worldId, villageId, undefined, [], [...request.wood, ...request.stone]);
    const previous = await tx.selectFrom('exploitationOrders').select(['id', 'request']).where('worldId', '=', village.worldId)
      .where('villageId', '=', villageId).where('commandId', '=', request.commandId).executeTakeFirst();
    if (previous) {
      if (!isDeepStrictEqual(previous.request, request)) throw new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette intention a déjà été utilisée différemment.');
      return state(tx, accountId, worldSlug, economy);
    }
    if (!request.gardens.length && !request.wood.length && !request.stone.length)
      throw new HttpError(400, 'EXPLOITATION_EMPTY', 'Sélectionner au moins une ressource.');
    const prepared = await prepareExploitation(tx, village, economy, accountId, request);
    if (prepared.preview.excluded.length) throw new HttpError(409, 'EXPLOITATION_SELECTION_CHANGED', 'La sélection a changé. Vérifier le récapitulatif actualisé ; aucune activité n’a été lancée.');
    if (request.workerCap > prepared.population.total) throw new HttpError(409, 'EXPLOITATION_CAP_INVALID', 'Le plafond dépasse la population totale du village.');
    if (request.initialAdmission === 'required' && prepared.preview.workforce.autoWorkerCap < 1)
      throw new HttpError(409, 'EXPLOITATION_INITIAL_DEPARTURE_UNAVAILABLE', 'Aucune équipe ne peut partir maintenant avec assez d’énergie pour terminer un premier lot et revenir.');
    const initial = request.cohortId ? prepared.population.cohorts?.find(c => c.id === request.cohortId && c.activity === 'idle' && !c.assignmentId) : null;
    if (request.cohortId && !initial) throw new HttpError(409, 'EXPLOITATION_COHORT_CHANGED', 'La cohorte choisie n’est plus disponible.');
    if (initial) {
      const durations = prepared.plan ? [prepared.plan.durationMs] : [];
      for (const family of ['wood', 'stone'] as const) for (const id of request[family]) {
        const deposit = await readStoneDeposit(tx, village.worldId, id);
        const path = await stoneTravelPath(tx, village, id);
        const amount = Math.min(100, deposit.availableAmount, Math.max(0, deposit.remainingAmount - (family === 'wood' ? deposit.initialAmount / 10 : 0)));
        const count = Math.min(10, request.workerCap, initial.memberCount, request.activityCaps?.[family] ?? 10);
        if (path && amount > 0 && count > 0) durations.push(stoneExtractionDuration(count, amount) + 2 * travelDuration(path, village));
      }
      const cohorts = await materializeCohorts(tx, village.worldId, village.villageId, economy.through);
      if (!durations.some(duration => eligibleWorkers(cohorts, duration).some(c => c.id === initial.id)))
        throw new HttpError(409, 'EXPLOITATION_COHORT_ENERGY', 'La cohorte choisie ne peut terminer aucun premier lot et revenir.');
    }
    const caps = request.activityCaps;
    if (caps && (caps.gardens + caps.wood + caps.stone > request.workerCap
      || request.gardens.length > 0 && caps.gardens !== 1 || request.wood.length > 0 && caps.wood < 1 || request.stone.length > 0 && caps.stone < 1))
      throw new HttpError(400, 'EXPLOITATION_CAP_INVALID', 'Les plafonds détaillés doivent respecter le budget commun et permettre chaque activité sélectionnée.');
    const deadline = request.durationMs === null ? null : new Date(economy.through.getTime() + request.durationMs);
    if (deadline && !Number.isFinite(deadline.getTime())) throw new HttpError(400, 'EXPLOITATION_DURATION_INVALID', 'Durée invalide.');
    const order = await tx.insertInto('exploitationOrders').values({ worldId: village.worldId, villageId, commandId: request.commandId,
      request: JSON.stringify(request), workerCap: request.workerCap, confirmedAt: economy.through, deadline,
      cohortId: request.cohortId, initialRemaining: initial ? Math.min(request.workerCap, initial.memberCount) : 0,
      gardenStatus: request.gardens.length ? 'pending' : 'completed', gardenPlan: prepared.plan ? JSON.stringify(prepared.plan) : null,
      nextWakeAt: null }).returning('id').executeTakeFirstOrThrow();
    for (const family of ['wood', 'stone'] as const) if (request[family].length) {
      await createWorksite(tx, economy, { commandId: randomUUID(), mode: family === 'wood' ? request.woodMode : 'extract',
        workerCap: caps?.[family] ?? 10, featureIds: request[family] }, request[family], order.id);
    }
    const snapshot = await state(tx, accountId, worldSlug, economy);
    if (request.initialAdmission === 'required' && !snapshot.village.exploitationOrders?.find(item => item.id === order.id)?.mobilized)
      throw new HttpError(409, 'EXPLOITATION_INITIAL_DEPARTURE_UNAVAILABLE', 'Aucune équipe ne peut partir maintenant ; aucune activité n’a été lancée.');
    return snapshot;
  });
}

export async function startVillageWorksite(db: Kysely<Database>, accountId: string, worldSlug: string,
  villageId: string, request: StartExtractionWorksiteRequest) {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, undefined, [], request.featureIds);
    const previous = await tx.selectFrom('extractionWorksites').select('id').where('worldId', '=', village.worldId)
      .where('villageId', '=', villageId).where('commandId', '=', request.commandId).executeTakeFirst();
    const selection = previous ? null : await prepareWorksiteSelection(tx, village, economy, request);
    if (selection && !selection.included.length)
      throw new HttpError(409, 'WORKSITE_NO_TARGETS', 'Aucun gisement accessible dans cette sélection.');
    const id = await createWorksite(tx, economy, request, selection?.included.map(item => item.featureId));
    const villageState = await state(tx, accountId, worldSlug, economy);
    const worksite = villageState.village.worksites.find(site => site.id === id);
    if (!worksite) throw new Error('Created worksite missing from snapshot');
    return { villageState, worksite };
  });
}

export async function prepareWorksiteSelection(tx: Transaction<Database>, village: OwnedVillage, economy: VillageEconomy,
  request: StartExtractionWorksiteRequest): Promise<ExtractionWorksiteSelection> {
  const included: ExtractionWorksiteSelection['included'] = [], excluded: ExtractionWorksiteSelection['excluded'] = [];
  const seen = new Set<string>();
  for (const rawId of request.featureIds) {
    const featureId = rawId.toLowerCase();
    if (seen.has(featureId)) { excluded.push({ featureId, reason: 'duplicate' }); continue; }
    seen.add(featureId);
    let details;
    try { details = await stoneDepositDetails(tx, village, economy, featureId); }
    catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) { excluded.push({ featureId, reason: 'not-found' }); continue; }
      throw error;
    }
    if (details.deposit.resourceCode !== (request.mode === 'extract' ? 'stone' : 'wood')) {
      excluded.push({ featureId, reason: 'resource-mismatch' }); continue;
    }
    if (details.deposit.cleared || request.mode === 'extract' && details.deposit.remainingAmount === 0) {
      excluded.push({ featureId, reason: 'depleted' }); continue;
    }
    const eligibility = details.eligibility;
    if (!eligibility.inRange || eligibility.protected || !eligibility.onBoundary) {
      excluded.push({ featureId, reason: !eligibility.inRange ? 'out-of-range' : eligibility.protected ? 'protected' : 'interior' });
      continue;
    }
    const existing = await tx.selectFrom('extractionWorksiteTargets').select('worksiteId')
      .where('worldId', '=', economy.worldId).where('villageId', '=', economy.villageId)
      .where('featureId', '=', featureId).where('status', '=', 'pending').executeTakeFirst();
    if (existing) { excluded.push({ featureId, reason: 'already-assigned' }); continue; }
    if (!(request.mode === 'clear' && details.deposit.canClear)
      && !await stoneTravelPath(tx, village, featureId)) {
      excluded.push({ featureId, reason: 'unreachable' }); continue;
    }
    included.push({ featureId, cellX: details.deposit.cellX, cellY: details.deposit.cellY });
  }
  return { included, excluded };
}

export async function previewVillageWorksite(db: Kysely<Database>, accountId: string, worldSlug: string,
  villageId: string, request: StartExtractionWorksiteRequest): Promise<ExtractionWorksiteSelection> {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, undefined, [], request.featureIds);
    return prepareWorksiteSelection(tx, village, economy, request);
  });
}

export async function changeVillageWorksite(db: Kysely<Database>, accountId: string, worldSlug: string,
  villageId: string, worksiteId: string, request: ChangeExtractionWorksiteRequest) {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    await changeWorksite(tx, economy, worksiteId, request);
    const villageState = await state(tx, accountId, worldSlug, economy);
    const worksite = villageState.village.worksites.find(site => site.id === worksiteId);
    if (!worksite) throw new Error('Changed worksite missing from snapshot');
    return { villageState, worksite };
  });
}

export async function discoverBuildingSuppliesInTransaction(
  tx: Transaction<Database>, accountId: string, worldSlug: string, villageId: string, buildingId: string,
): Promise<VillageState> {
  const village = await ownedVillage(tx, accountId, worldSlug, villageId);
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
        originVillageId: cohort.originVillageId, memberCount, ...values, harvestId: null, extractionId: null, cartographer: cohort.cartographer }).execute();
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
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
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
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    await populationCommand(tx, village, economy, commandId, count, 'rest');
    return state(tx, accountId, worldSlug, economy);
  });
}

/** Visual discovery is reported by the client; ownership, time and uniqueness are authoritative. */
export async function discoverCatEyes(db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string) {
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    const inserted = await tx.insertInto('villageAccomplishments').values({
      worldId: village.worldId, villageId: village.villageId, code: 'cat-eyes', completedAt: economy.through,
    }).onConflict(oc => oc.columns(['worldId', 'villageId', 'code']).doNothing()).returning('code').execute();
    return { newlyCompleted: inserted.length > 0, villageState: await state(tx, accountId, worldSlug, economy) };
  });
}
