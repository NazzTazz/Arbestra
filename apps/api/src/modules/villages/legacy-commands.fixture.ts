/** Test fixtures only: historical commands and reads whose HTTP routes were
 * removed (single gestures on 24 October 2026, the V1 village read and its
 * replies in lot I.3). Each wraps the live domain functions (the same ones the
 * V2 commands use) in its own economic transaction and returns the complete
 * village state, so existing scenario tests keep their assertions. Never
 * import from production code. */

import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import {
  fixedBuildingFootprint,
  pendingHarvestReceipt,
  planGardenTour,
  travelDuration,
  type BuildingType,
  type ExpeditionReceipt,
  type ExploitationRequest,
  type ExtractionResponse,
  type HarvestReceipt,
  type HudWorkforceConfirmation,
  type HudWorkforceIntent,
  type HudWorkforceState,
  type ProcessingCommand,
  type StartExtractionWorksiteRequest,
  type TradeCommand,
  type TravelCell,
  type VillageState,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { normalizeCell, worldCellKey } from '../worlds/coordinates.js';
import { clearWoodland } from '../deposits/woodland.js';
import {
  readExtraction,
  readStoneDeposit,
  startStoneExtraction,
  stoneDepositDetails,
} from '../deposits/stone-extractions.js';
import { createWorksite } from '../deposits/worksites.js';
import { startGardenHarvest } from '../population/garden-harvest.js';
import { startGardenTour } from '../population/garden-tour.js';
import {
  beginProcessingCommand,
  beginVillageEconomy,
  type ReconciliationBudget,
  type VillageEconomy,
} from './reconcile-economy.js';
import {
  admitVillageWork,
  discoverBuildingSuppliesInTransaction as discoverBuildingSuppliesCommit,
  expandGarden as expandGardenCommit,
  ownedVillage,
  prepareWorksiteSelection,
  startVillageExploitation as startVillageExploitationCommit,
  state,
  stoneTravelPath,
  upgradeBuilding as upgradeBuildingCommit,
  withVillageProjection,
  type AfterConstructionWrites,
  type ConstructionCommit,
} from './service.js';
import { readRc1Source } from '../worlds/rc1-source.js';
import type { readRc1Ground } from '../worlds/rc1-ground.js';
import { networkJob, type NetworkJob, type TravelNetworkExecutor } from '../navigation/network-job.js';
import type { NavigationExecutor } from '../navigation/compute.js';
import { advanceEnergy } from '../population/energy.js';
import { energyState, reconcileRestHousing, withoutAssignment } from '../population/work.js';
import { readExtractionPools } from '../deposits/extraction-pools.js';
import { projectVillageResources } from './economy.js';
import { requestEconomyCatchup, ScopeCatchingUp } from './economy-catchup.js';
import { commandProcessing } from './processing.js';
import { placeBuilding } from './construction.js';
import { applyIntent, conflict, findReceipt } from './hud-workforce.js';
import { commandPlayerMarket as commandPlayerMarketCommit } from './trade-service.js';
import type { SpatialCell } from './spatial-selection.js';

export async function harvestGardenSelection(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  cells: TravelCell[],
  commandId: string,
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    if (!cells.length || cells.length > 100)
      throw new HttpError(400, 'INVALID_HARVEST_SELECTION', 'Sélectionner entre une et cent parcelles.');
    const targets = [
      ...new Map(
        cells.map((c) => {
          const p = {
            cellX: normalizeCell(c.cellX, village.widthCells),
            cellY: normalizeCell(c.cellY, village.heightCells),
          };
          return [worldCellKey(p.cellX, p.cellY), p];
        }),
      ).values(),
    ];
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    const receipt = await tx
      .selectFrom('gardenHarvests')
      .selectAll()
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', villageId)
      .where('commandId', '=', commandId)
      .executeTakeFirst();
    if (receipt) {
      const old = receipt.stops.length ? receipt.stops : [{ cellX: receipt.plotCellX, cellY: receipt.plotCellY }];
      if (JSON.stringify(old.map((p) => [p.cellX, p.cellY])) !== JSON.stringify(targets.map((p) => [p.cellX, p.cellY])))
        throw new HttpError(
          409,
          'COMMAND_ID_CONFLICT',
          'Cette intention a déjà été utilisée pour une autre sélection.',
        );
      return state(tx, accountId, worldSlug, economy);
    }
    const snapshot = await state(tx, accountId, worldSlug, economy);
    const gardenPlots = snapshot.cells.flatMap(
      (c) => c.building?.garden?.plots.map((p) => ({ plot: p, legacy: c.building!.garden!.harvest })) ?? [],
    );
    if (targets.some((t) => gardenPlots.some((p) => p.plot.cellX === t.cellX && p.plot.cellY === t.cellY && p.legacy)))
      throw new HttpError(
        409,
        'GARDEN_HARVEST_IN_PROGRESS',
        'Une récolte existante est encore en cours sur ce Jardin.',
      );
    if (targets.some((t) => !gardenPlots.some((p) => p.plot.cellX === t.cellX && p.plot.cellY === t.cellY)))
      throw new HttpError(404, 'GARDEN_PLOT_NOT_READY', 'Une parcelle sélectionnée n’appartient pas à ce village.');
    const plan = planGardenTour(
      snapshot.travelRoutes,
      { cellX: village.anchorCellX, cellY: village.anchorCellY },
      targets,
      village,
    );
    if (!plan) throw new HttpError(409, 'DESTINATION_UNREACHABLE', 'Aucun chemin praticable pour cette tournée.');
    await startGardenTour(tx, village.worldId, villageId, commandId, economy.through, plan);
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
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    const at = economy.through;
    const plots = await tx
      .selectFrom('gardenPlots')
      .select(['buildingId', 'cellX', 'cellY'])
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId)
      .execute();
    const legacyCommandId = typeof cellXOrCommandId === 'string' ? cellXOrCommandId : commandId;
    const oldReceipt = await tx
      .selectFrom('gardenHarvests')
      .select(['plotCellX', 'plotCellY', 'stops'])
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId)
      .where('commandId', '=', legacyCommandId)
      .executeTakeFirst();
    const fallback = plots.find((plot) => plot.buildingId === buildingId);
    const x = normalizeCell(
      typeof cellXOrCommandId === 'number' ? cellXOrCommandId : (fallback?.cellX ?? -1),
      village.widthCells,
    );
    const y = normalizeCell(typeof cellY === 'number' ? cellY : (fallback?.cellY ?? -1), village.heightCells);
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
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next = byCell.get(
          worldCellKey(
            normalizeCell(current.cellX + dx, village.widthCells),
            normalizeCell(current.cellY + dy, village.heightCells),
          ),
        );
        if (next && !visited.has(worldCellKey(next.cellX, next.cellY))) {
          visited.add(worldCellKey(next.cellX, next.cellY));
          queue.push(next);
        }
      }
    }
    const target = byCell.get(worldCellKey(x, y));
    if (!target || !visited.has(worldCellKey(x, y)))
      throw new HttpError(404, 'GARDEN_PLOT_NOT_READY', 'Cette parcelle n’appartient pas à ce Jardin.');
    const componentIds = [
      ...new Set(
        plots.filter((plot) => visited.has(worldCellKey(plot.cellX, plot.cellY))).map((plot) => plot.buildingId),
      ),
    ];
    const legacyHarvest = await tx
      .selectFrom('gardenHarvests')
      .select('id')
      .where('worldId', '=', village.worldId)
      .where('buildingId', 'in', componentIds)
      .where('plotCellX', 'is', null)
      .where('status', '=', 'in-progress')
      .executeTakeFirst();
    if (legacyHarvest)
      throw new HttpError(
        409,
        'GARDEN_HARVEST_IN_PROGRESS',
        'Une récolte existante est encore en cours sur ce Jardin.',
      );
    const routes = (await state(tx, accountId, worldSlug, economy)).travelRoutes;
    const path = routes.find(
      (route) => route.kind === 'garden' && route.destination.cellX === x && route.destination.cellY === y,
    )?.cells;
    if (!path) throw new HttpError(409, 'DESTINATION_UNREACHABLE', 'Aucun chemin praticable vers cette parcelle.');
    await startGardenHarvest(
      tx,
      village.worldId,
      village.villageId,
      target.buildingId,
      x,
      y,
      legacyCommandId,
      at,
      path,
      travelDuration(path, village),
    );
    return state(tx, accountId, worldSlug, economy);
  });
}

export async function startVillageStoneExtraction(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  featureId: string,
  commandId: string,
  workerCount: number,
): Promise<ExtractionResponse> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId, featureId);
    const previous = await tx
      .selectFrom('depositExtractions')
      .select('id')
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId)
      .where('commandId', '=', commandId)
      .executeTakeFirst();
    if (!previous) {
      const eligibility = await stoneDepositDetails(tx, village, economy, featureId);
      const reason = eligibility.eligibility.workerOptions[0]?.reasonCode;
      if (reason && reason !== 'WORKERS_UNAVAILABLE')
        throw new HttpError(409, reason, 'Ce gisement ne peut pas être exploité actuellement.');
    }
    const path = previous ? [] : await stoneTravelPath(tx, village, featureId);
    if (!path) throw new HttpError(409, 'DESTINATION_UNREACHABLE', 'Aucun chemin praticable vers ce gisement.');
    const id = await startStoneExtraction(
      tx,
      village,
      economy,
      featureId,
      commandId,
      workerCount,
      path,
      travelDuration(path, village),
    );
    return {
      villageState: await state(tx, accountId, worldSlug, economy),
      extraction: await readExtraction(tx, village.worldId, village.villageId, id),
      deposit: await readStoneDeposit(tx, village.worldId, featureId),
    };
  });
}

export async function clearVillageWoodland(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  featureId: string,
): Promise<VillageState> {
  return db.transaction().execute(async (tx) => {
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

export async function startVillageWorksite(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  request: StartExtractionWorksiteRequest,
) {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    if (village.villageId !== villageId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const economy = await beginVillageEconomy(
      tx,
      village.worldId,
      village.villageId,
      undefined,
      [],
      request.featureIds,
    );
    const previous = await tx
      .selectFrom('extractionWorksites')
      .select('id')
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', villageId)
      .where('commandId', '=', request.commandId)
      .executeTakeFirst();
    const selection = previous ? null : await prepareWorksiteSelection(tx, village, economy, request);
    if (selection && !selection.included.length)
      throw new HttpError(409, 'WORKSITE_NO_TARGETS', 'Aucun gisement accessible dans cette sélection.');
    const id = await createWorksite(
      tx,
      economy,
      request,
      // The trees kept from each designation, in their order.
      selection?.included,
    );
    const villageState = await state(tx, accountId, worldSlug, economy);
    const worksite = villageState.village.worksites.find((site) => site.id === id);
    if (!worksite) throw new Error('Created worksite missing from snapshot');
    return { villageState, worksite };
  });
}

// ---------------------------------------------------------------------------
// Lot I.3: what the V1 synchronization left to the tests.
// ---------------------------------------------------------------------------

type ReplyMode = 'snapshot' | 'commit';
type Reply<Mode extends ReplyMode> = Mode extends 'commit' ? ConstructionCommit : VillageState;
type ExpectedCost = { resourceCode: string; amount: number };

export async function readVillageProjection(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  compute?: TravelNetworkExecutor,
) {
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
    return networkJob(input, ground, known);
  });
  if (!projected) throw Error('Missing village projection');
  projected.travelRoutes.unshift(...routes); // Committed woodland paths were captured with the snapshot.
  return projected;
}

/** Read-side wakeup of the former `GET /village`: finishes the economic writes
 * (due work, admissions, rest housing) in one transaction. No production path
 * wakes the economy by reading any more. */
export async function reconcileVillageForRead(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId?: string,
): Promise<VillageEconomy> {
  const candidate = await ownedVillage(db, accountId, worldSlug, villageId);
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, candidate.villageId);
    if (village.generationVersion === 3) await readRc1Source(tx, village.worldId);
    const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
    // No command took place after begin: all due transitions are already at H.
    await admitVillageWork(tx, economy, village);
    await reconcileRestHousing(tx, village.worldId, village.villageId, economy.through);
    return economy;
  });
}

/** The complete village state: the wakeup, then a fresh coherent projection. */
export async function getVillageState(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId?: string,
  compute?: TravelNetworkExecutor,
) {
  const committed = await reconcileVillageForRead(db, accountId, worldSlug, villageId);
  return readVillageProjection(db, accountId, worldSlug, committed.villageId, compute);
}

/** A command in its commit form, answered with the village state read in the
 * same transaction after its writes (the historical "snapshot" reply). An exact
 * replay publishes nothing and reads no state there: the state at its bound is
 * then read apart, without writing (in the caller's transaction when `db` is one). */
async function snapshotReply(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  run: (afterWrites: AfterConstructionWrites) => Promise<ConstructionCommit>,
): Promise<VillageState> {
  const captured: { state?: VillageState } = {};
  const commit = await run(async (tx, economy) => {
    captured.state = await state(tx, accountId, worldSlug, economy);
  });
  return (
    captured.state ??
    db
      .transaction()
      .execute((tx) =>
        state(
          tx,
          accountId,
          worldSlug,
          { worldId: commit.worldId, villageId: commit.villageId, through: commit.through },
          false,
          true,
        ),
      )
  );
}

export function upgradeBuilding(
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
  return snapshotReply(db, accountId, worldSlug, villageId, (afterWrites) =>
    upgradeBuildingCommit(
      db,
      accountId,
      worldSlug,
      villageId,
      buildingId,
      extensionCellX,
      extensionCellY,
      durationOverride,
      commandId,
      expectedCosts,
      expectedLevel,
      afterWrites,
    ),
  );
}

export function expandGarden(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
  rawCells: SpatialCell[],
  durationOverride: number | null,
  commandId?: string,
  expectedCosts?: ExpectedCost[],
): Promise<VillageState> {
  return snapshotReply(db, accountId, worldSlug, villageId, (afterWrites) =>
    expandGardenCommit(
      db,
      accountId,
      worldSlug,
      villageId,
      buildingId,
      rawCells,
      durationOverride,
      commandId,
      expectedCosts,
      afterWrites,
    ),
  );
}

export function startVillageExploitation(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  rawRequest: ExploitationRequest,
): Promise<VillageState> {
  return snapshotReply(db, accountId, worldSlug, villageId, (afterWrites) =>
    startVillageExploitationCommit(db, accountId, worldSlug, villageId, rawRequest, afterWrites),
  );
}

/** Inside the caller's transaction. Even the already-claimed path ends in the
 * commit's finalizer, so the state is always read. */
export async function discoverBuildingSuppliesInTransaction(
  tx: Transaction<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  buildingId: string,
): Promise<VillageState> {
  const captured: { state?: VillageState } = {};
  await discoverBuildingSuppliesCommit(tx, accountId, worldSlug, villageId, buildingId, async (t, economy) => {
    captured.state = await state(t, accountId, worldSlug, economy);
  });
  if (!captured.state) throw Error('Supplies command did not reach its finalizer');
  return captured.state;
}

export function discoverBuildingSupplies(
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

export function commandPlayerMarket(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  command: TradeCommand,
  compute?: NavigationExecutor,
): Promise<VillageState> {
  return snapshotReply(db, accountId, slug, villageId.toLowerCase(), (afterWrites) =>
    commandPlayerMarketCommit(db, accountId, slug, villageId, command, compute, afterWrites),
  );
}

/** The placement adapters share the bounded placement command. Only explicit
 * snapshot callers read the complete village afterwards. */
async function placementResult<Mode extends ReplyMode>(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  confirmed: Awaited<ReturnType<typeof placeBuilding>>,
  mode: Mode,
): Promise<Reply<Mode>> {
  if (mode === 'snapshot')
    return (await readVillageProjection(db, accountId, worldSlug, confirmed.villageId)) as Reply<Mode>;
  return {
    worldId: confirmed.worldId,
    villageId: confirmed.villageId,
    through: new Date(confirmed.commandTime),
    commandId: confirmed.commandId,
  } as Reply<Mode>;
}

export async function constructBuilding<Mode extends ReplyMode = 'snapshot'>(
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
): Promise<Reply<Mode>> {
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

export async function constructBuildingArea<Mode extends ReplyMode = 'snapshot'>(
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
): Promise<Reply<Mode>> {
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

/** Durable receipts are immutable. A retry only needs ownership and request equality. */
async function replayProcessing(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  command: ProcessingCommand,
): Promise<ConstructionCommit | undefined> {
  const village = await ownedVillage(db, accountId, worldSlug, villageId);
  const previous = await db
    .selectFrom('processingCommandReceipts')
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

export async function commandVillageProcessing<Mode extends ReplyMode = 'snapshot'>(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  command: ProcessingCommand,
  replyMode: Mode = 'snapshot' as Mode,
  budget?: ReconciliationBudget,
): Promise<Reply<Mode>> {
  if (replyMode === 'commit') {
    const replay = await replayProcessing(db, accountId, worldSlug, villageId, command);
    if (replay) return replay as Reply<Mode>;
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
        return { ...prepared.economy, commandId: command.commandId } as Reply<Mode>;
      }
      const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
      await commandProcessing(tx, economy, command);
      return (await state(tx, accountId, worldSlug, economy)) as Reply<Mode>;
    })
    .catch(async (error) => {
      // Kysely has completed ROLLBACK before this separate durable wakeup.
      if (error instanceof ScopeCatchingUp) await requestEconomyCatchup(db, accountId, worldSlug, villageId);
      throw error;
    });
}

/** Scoped snapshot at the command bound. No geography, catalogue or display navigation. */
async function hudState(tx: Transaction<Database>, ctx: VillageEconomy): Promise<HudWorkforceState> {
  const [cohorts, resources, extractionPools, sites] = await Promise.all([
    tx
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', ctx.worldId)
      .where('villageId', '=', ctx.villageId)
      .execute(),
    projectVillageResources(tx, ctx.worldId, ctx.villageId, ctx.through),
    readExtractionPools(tx, ctx.worldId, ctx.villageId),
    tx
      .selectFrom('extractionWorksites')
      .select('poolResource')
      .where('worldId', '=', ctx.worldId)
      .where('villageId', '=', ctx.villageId)
      .where('status', 'in', ['running', 'paused', 'stopping'])
      .execute(),
  ]);
  const population = { available: 0, working: 0, resting: 0, pendingRelease: { idle: 0, resting: 0 } };
  for (const cohort of cohorts) {
    const energy = advanceEnergy(energyState(cohort), ctx.through);
    if (energy.activity === 'idle' && withoutAssignment(cohort)) population.available += cohort.memberCount;
    if (energy.activity === 'working') population.working += cohort.memberCount;
    if (energy.activity === 'resting') population.resting += cohort.memberCount;
    if (cohort.pendingRelease) population.pendingRelease[cohort.pendingRelease] += cohort.memberCount;
  }
  const openWorksites = { wood: 0, stone: 0, other: 0 };
  for (const site of sites) openWorksites[site.poolResource ?? 'other']++;
  return {
    worldId: ctx.worldId,
    villageId: ctx.villageId,
    serverTime: ctx.through.toISOString(),
    // The contract still carries the V1 fence (a world count); V2 has none (removed in lot I.4).
    minimumRevision: 0,
    population,
    carrots: resources.find((r) => r.code === 'carrot')?.amount ?? 0,
    extractionPools,
    openWorksites,
  };
}

/** The historical HUD answer: the result with a scoped state at the command bound. */
export async function commandHudWorkforce(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  request: HudWorkforceIntent,
): Promise<HudWorkforceConfirmation> {
  const owner = await ownedVillage(db, accountId, slug, villageId);
  const known = await findReceipt(db, owner.worldId, villageId, request.command.commandId);
  if (known) {
    if (!isDeepStrictEqual(known.request, request)) throw conflict();
    // Lost HTTP responses must not repeat reconciliation, admissions or the display projection.
    // Ownership is checked again inside this coherent read-only snapshot.
    const hud = await withVillageProjection(db, accountId, slug, villageId, (tx, ctx) => hudState(tx, ctx));
    return { commandId: request.command.commandId, affected: known.affected, carrots: known.carrots, hud };
  }
  const confirmed = await db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, slug, villageId);
    const ctx = await beginVillageEconomy(tx, village.worldId, villageId);
    const result = await applyIntent(tx, ctx, request);
    return { ...result, commandId: request.command.commandId, hud: await hudState(tx, ctx) };
  });
  return confirmed;
}

export async function readExpeditionReceipts(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  ids?: string[],
  before?: string,
): Promise<ExpeditionReceipt[]> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, slug, villageId);
    if (ids && (ids.length > 64 || ids.some((id) => !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))))
      throw new HttpError(400, 'EXPEDITION_IDS_INVALID', 'Identifiants invalides.');
    if (before && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(before))
      throw new HttpError(400, 'EXPEDITION_CURSOR_INVALID', 'Curseur invalide.');
    const query = () =>
      tx
        .selectFrom('expeditionSubmissions')
        .select(['receipt', 'receivedOrder'])
        .where('worldId', '=', village.worldId)
        .where('villageId', '=', villageId)
        .where('accountId', '=', accountId);
    if (ids) return (await query().where('commandId', 'in', ids).execute()).map((r) => r.receipt);
    const pending = await query()
      .where(sql<boolean>`receipt->>'status'='pending'`)
      .execute();
    let history = query().where(sql<boolean>`receipt->>'status'<>'pending'`);
    if (before) {
      const cursor = await query().where('commandId', '=', before).executeTakeFirst();
      if (!cursor) throw new HttpError(400, 'EXPEDITION_CURSOR_INVALID', 'Curseur invalide.');
      history = history.where('receivedOrder', '<', cursor.receivedOrder);
    }
    return [...pending, ...(await history.orderBy('receivedOrder', 'desc').limit(64).execute())].map((r) => r.receipt);
  });
}

export async function readHarvestReceipts(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  ids: string[],
): Promise<HarvestReceipt[]> {
  if (ids.length > 64 || ids.some((id) => !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)))
    throw new HttpError(400, 'HARVEST_IDS_INVALID', 'Identifiants invalides.');
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, slug, villageId);
    const rows = await tx
      .selectFrom('harvestSubmissions')
      .select(['commandId', 'receipt'])
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', villageId)
      .where('accountId', '=', accountId)
      .where('commandId', 'in', ids)
      .execute();
    return rows.map((r) => r.receipt ?? pendingHarvestReceipt(r.commandId));
  });
}
