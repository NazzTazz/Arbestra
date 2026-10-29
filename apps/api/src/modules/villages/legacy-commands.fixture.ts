/** Test fixtures only: historical single-gesture commands whose HTTP routes
 * were removed on 24 October 2026. Each wraps the live domain functions
 * (the same ones exploitation orders and worksites use) in its own economic
 * transaction and returns the complete village state, so existing scenario
 * tests keep their assertions. Never import from production code. */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import {
  planGardenTour,
  travelDuration,
  type ExtractionResponse,
  type StartExtractionWorksiteRequest,
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
import { beginVillageEconomy } from './reconcile-economy.js';
import { ownedVillage, prepareWorksiteSelection, state, stoneTravelPath } from './service.js';

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
