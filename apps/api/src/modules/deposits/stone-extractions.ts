import { sql, type Transaction } from 'kysely';
import type { DepositDetails, Extraction, StoneDeposit } from '@arbestra/contracts';
import type { TravelCell } from '@arbestra/contracts';

import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { assignWorkers, eligibleWorkers, materializeCohorts, releaseWorkers } from '../population/work.js';
import { beginRest, canWorkFor } from '../population/energy.js';
import { normalizeCell, toroidalChebyshev } from '../worlds/coordinates.js';
import type { VillageEconomy } from '../villages/reconcile-economy.js';
import { materializeWoodland } from './woodland.js';
import { hasRecognizedDepositAccess } from '../science/deposit-access.js';

export const COMPLETE_STONE_EXTRACTION_TASK = 'deposit.extraction.complete';
export const STONE_EXTRACTION_LOT = 100;
export const STONE_EXTRACTION_MAX_WORKERS = 10;
const STONE_EXTRACTION_BASE_MS = 600_000;

export interface ExtractionVillage {
  worldId: string;
  villageId: string;
  widthCells: number;
  heightCells: number;
}

export function stoneExtractionDuration(workerCount: number, amount = STONE_EXTRACTION_LOT): number {
  return Math.ceil(STONE_EXTRACTION_BASE_MS * amount / (STONE_EXTRACTION_LOT * workerCount));
}

async function isWithinVillageRange(tx: Transaction<Database>, village: ExtractionVillage, cellX: number, cellY: number): Promise<boolean> {
  const cells = await tx.selectFrom('worldCellOccupancies').innerJoin('buildings', (join) => join
    .onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId')
    .onRef('buildings.id', '=', 'worldCellOccupancies.buildingId'))
    .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY'])
    .where('worldCellOccupancies.worldId', '=', village.worldId).where('buildings.villageId', '=', village.villageId)
    .where('buildings.status', '=', 'completed').where('worldCellOccupancies.pendingExpansionId', 'is', null).execute();
  return cells.some((cell) => toroidalChebyshev(cell.cellX, cell.cellY, cellX, cellY, village.widthCells, village.heightCells) <= 8)
    || await hasRecognizedDepositAccess(tx, village.worldId, village.villageId, { cellX, cellY });
}

async function isOnStoneBoundary(tx: Transaction<Database>, village: ExtractionVillage, cellX: number, cellY: number): Promise<boolean> {
  const neighbours = [
    [cellX - 1, cellY], [cellX + 1, cellY], [cellX, cellY - 1], [cellX, cellY + 1],
  ].map(([x, y]) => ({ cellX: normalizeCell(x!, village.widthCells), cellY: normalizeCell(y!, village.heightCells) }));
  const occupied = await tx.selectFrom('stoneDeposits').select(['cellX', 'cellY', 'remainingAmount'])
    .where('worldId', '=', village.worldId).where((eb) => eb.or(neighbours.map((cell) => eb.and([
      eb('cellX', '=', cell.cellX), eb('cellY', '=', cell.cellY),
    ])))).execute();
  return neighbours.some((cell) => !occupied.some((stone) => stone.cellX === cell.cellX && stone.cellY === cell.cellY && Number(stone.remainingAmount) > 0));
}

async function isProtected(tx: Transaction<Database>, village: ExtractionVillage, cellX: number, cellY: number): Promise<boolean> {
  const clearings = await tx.selectFrom('worldClearings').select(['centerCellX', 'centerCellY', 'innerRadius', 'status'])
    .where('worldId', '=', village.worldId).where('status', '=', 'protected').execute();
  return clearings.some((clearing) => toroidalChebyshev(cellX, cellY, clearing.centerCellX, clearing.centerCellY,
    village.widthCells, village.heightCells) <= clearing.innerRadius);
}

export function safeAmount(value: string | number): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Unsafe economic integer');
  return amount;
}

export async function readStoneDeposit(tx: Transaction<Database>, worldId: string, featureId: string): Promise<StoneDeposit> {
  const row = await tx.selectFrom('resourceDeposits').selectAll().where('worldId', '=', worldId)
    .where('featureId', '=', featureId).executeTakeFirst();
  if (!row) throw new HttpError(404, 'DEPOSIT_NOT_FOUND', 'Gisement introuvable.');
  const remainingAmount = safeAmount(row.remainingAmount), reservedAmount = safeAmount(row.reservedAmount);
  const wood = row.resourceCode === 'wood' ? await tx.selectFrom('woodlandDeposits').selectAll()
    .where('worldId', '=', worldId).where('featureId', '=', featureId).executeTakeFirstOrThrow() : null;
  return { featureId, resourceCode: row.resourceCode, blocksCell: row.blocksCell, cellX: row.cellX, cellY: row.cellY,
    initialAmount: safeAmount(row.initialAmount), remainingAmount, reservedAmount,
    availableAmount: remainingAmount - reservedAmount, state: row.cleared || remainingAmount === 0 ? 'depleted' : 'available',
    ...(wood ? { cleared: wood.cleared, canClear: !wood.cleared && !row.blocksCell,
      regrowthPerHour: Number(wood.initialAmount) * 3_600_000 / Number(wood.regrowthPeriodMs) } : {}),
    revision: safeAmount(row.revision), updatedAt: row.updatedAt.toISOString() };
}

export async function readExtraction(tx: Transaction<Database>, worldId: string, villageId: string, id: string): Promise<Extraction> {
  const row = await tx.selectFrom('depositExtractions').selectAll().where('worldId', '=', worldId)
    .where('villageId', '=', villageId).where('id', '=', id).executeTakeFirstOrThrow();
  const deposit = await readStoneDeposit(tx, worldId, row.featureId);
  return { id: row.id, resourceCode: row.resourceCode, featureId: row.featureId, cellX: deposit.cellX, cellY: deposit.cellY,
    workerCount: row.workerCount, reservedAmount: safeAmount(row.reservedAmount),
    status: row.status, startedAt: row.startedAt.toISOString(), completesAt: row.completesAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    transportMs: row.transportMs, path: row.pathCells ?? [] };
}

async function access(tx: Transaction<Database>, village: ExtractionVillage, deposit: StoneDeposit) {
  return { inRange: await isWithinVillageRange(tx, village, deposit.cellX, deposit.cellY),
    protected: await isProtected(tx, village, deposit.cellX, deposit.cellY),
    onBoundary: deposit.resourceCode === 'wood' || await isOnStoneBoundary(tx, village, deposit.cellX, deposit.cellY) };
}

function refusal(deposit: StoneDeposit, eligibility: Awaited<ReturnType<typeof access>>): string | null {
  if (deposit.state === 'depleted') return 'DEPOSIT_DEPLETED';
  if (!eligibility.inRange) return 'DEPOSIT_OUT_OF_RANGE';
  if (eligibility.protected) return 'DEPOSIT_PROTECTED';
  if (!eligibility.onBoundary) return 'DEPOSIT_INTERIOR';
  return deposit.availableAmount === 0 ? 'DEPOSIT_FULLY_COMMITTED' : null;
}

/** Caller holds village and target locks, after reconciling that village to H. */
export async function stoneDepositDetails(tx: Transaction<Database>, village: ExtractionVillage, economy: VillageEconomy, featureId: string, transportMs = 0, pathReachable = true): Promise<DepositDetails> {
  const deposit = await readStoneDeposit(tx, village.worldId, featureId);
  const eligibility = await access(tx, village, deposit);
  const reason = refusal(deposit, eligibility);
  const activeWood = deposit.resourceCode === 'wood' && await tx.selectFrom('depositExtractions').select('id')
    .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).where('featureId', '=', featureId)
    .where('status', '=', 'in-progress').executeTakeFirst();
  const cohorts = await materializeCohorts(tx, village.worldId, village.villageId, economy.through);
  const workerOptions = Array.from({ length: STONE_EXTRACTION_MAX_WORKERS }, (_, i) => {
    const workerCount = i + 1, durationMs = stoneExtractionDuration(workerCount) + transportMs * 2;
    const availableWorkers = eligibleWorkers(cohorts, durationMs).reduce((sum, row) => sum + row.memberCount, 0);
    const reasonCode = reason ?? (activeWood ? 'WOODLAND_MISSION_IN_PROGRESS' : !pathReachable ? 'DESTINATION_UNREACHABLE' : availableWorkers < workerCount ? 'WORKERS_UNAVAILABLE' : null);
    return { workerCount, durationMs, availableWorkers, canStart: reasonCode === null, reasonCode };
  });
  return { serverTime: economy.through.toISOString(), deposit, transportMs,
    eligibility: { ...eligibility, lotAmount: Math.min(STONE_EXTRACTION_LOT, deposit.availableAmount), workerOptions } };
}

export async function startStoneExtraction(
  tx: Transaction<Database>, village: ExtractionVillage, economy: VillageEconomy,
  featureId: string, commandId: string, workerCount: number,
  path: TravelCell[] = [], transportMs = 0,
  worksite?: { id: string; amount: number },
): Promise<string> {
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > STONE_EXTRACTION_MAX_WORKERS)
    throw new HttpError(400, 'EXTRACTION_WORKER_COUNT_INVALID', 'Effectif d’extraction invalide.');
  const repeated = await tx.selectFrom('depositExtractions').selectAll().where('worldId', '=', village.worldId)
    .where('villageId', '=', village.villageId).where('commandId', '=', commandId).executeTakeFirst();
  if (repeated) {
    if (repeated.featureId !== featureId.toLowerCase() || repeated.workerCount !== workerCount)
      throw new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette intention a déjà été utilisée différemment.');
    return repeated.id;
  }
  const deposit = await readStoneDeposit(tx, village.worldId, featureId);
  if (deposit.resourceCode === 'wood' && await tx.selectFrom('depositExtractions').select('id')
    .where('worldId', '=', village.worldId).where('villageId', '=', village.villageId).where('featureId', '=', featureId)
    .where('status', '=', 'in-progress').executeTakeFirst())
    throw new HttpError(409, 'WOODLAND_MISSION_IN_PROGRESS', 'Une coupe est déjà en cours sur ce bosquet pour votre village.');
  const reason = refusal(deposit, await access(tx, village, deposit));
  if (reason) throw new HttpError(409, reason, 'Ce gisement ne peut pas être exploité actuellement.');
  const available = deposit.availableAmount;
  const amount = worksite?.amount ?? Math.min(STONE_EXTRACTION_LOT, available);
  if (amount < 1 || amount > STONE_EXTRACTION_LOT || amount > available) throw new HttpError(409, 'DEPOSIT_FULLY_COMMITTED', 'Lot indisponible.');
  const durationMs = stoneExtractionDuration(workerCount, worksite ? amount : STONE_EXTRACTION_LOT) + transportMs * 2;
  const cohorts = await materializeCohorts(tx, village.worldId, village.villageId, economy.through);
  const candidates = eligibleWorkers(cohorts, durationMs);
  if (candidates.reduce((total, cohort) => total + cohort.memberCount, 0) < workerCount)
    throw new HttpError(409, 'WORKERS_UNAVAILABLE', 'Habitants disponibles et reposés insuffisants.');
  const extraction = await tx.insertInto('depositExtractions').values({ worldId: village.worldId, villageId: village.villageId,
    featureId, resourceCode: deposit.resourceCode, commandId, worksiteId: worksite?.id ?? null, status: 'in-progress', startedAt: economy.through,
    completesAt: new Date(economy.through.getTime() + durationMs), completedAt: null,
    workerCount, reservedAmount: amount,
    transportMs, pathCells: sql`${JSON.stringify(path)}::jsonb` }).returning('id').executeTakeFirstOrThrow();
  await assignWorkers(tx, candidates, workerCount, { harvestId: null, extractionId: extraction.id });
  const reserved = await tx.updateTable(deposit.resourceCode === 'wood' ? 'woodlandDeposits' : 'stoneDeposits').set({ reservedAmount: sql`reserved_amount + ${amount}::bigint`,
    revision: sql`revision + 1`, updatedAt: sql`statement_timestamp()` }).where('worldId', '=', village.worldId)
    .where('featureId', '=', featureId).where(sql<boolean>`remaining_amount - reserved_amount >= ${amount}::bigint`).executeTakeFirst();
  if (Number(reserved.numUpdatedRows) !== 1) throw new Error('Stone deposit reservation invariant failed');
  const dueAt = new Date(economy.through.getTime() + durationMs);
  await tx.insertInto('scheduledTasks').values({ worldId: village.worldId, taskType: COMPLETE_STONE_EXTRACTION_TASK,
    subjectId: extraction.id, payload: {}, dueAt, availableAt: dueAt, lastError: null, completedAt: null }).execute();
  return extraction.id;
}

export async function completeStoneExtractionAt(tx: Transaction<Database>, worldId: string, villageId: string, extractionId: string, through: Date): Promise<void> {
  const extraction = await tx.selectFrom('depositExtractions').selectAll().where('worldId', '=', worldId)
    .where('villageId', '=', villageId).where('id', '=', extractionId).forUpdate().executeTakeFirst();
  if (!extraction || extraction.status !== 'in-progress' || extraction.completesAt.getTime() !== through.getTime()) return;
  if (extraction.resourceCode === 'wood') await materializeWoodland(tx, worldId, extraction.featureId, through);
  const deposit = await tx.selectFrom(extraction.resourceCode === 'wood' ? 'woodlandDeposits' : 'stoneDeposits').selectAll().where('worldId', '=', worldId)
    .where('featureId', '=', extraction.featureId).forUpdate().executeTakeFirstOrThrow();
  const cohorts = await materializeCohorts(tx, worldId, villageId, through);
  const workers = cohorts.filter((cohort) => cohort.extractionId === extraction.id);
  if (workers.reduce((total, cohort) => total + cohort.memberCount, 0) !== extraction.workerCount)
    throw new Error('Stone extraction workforce invariant failed');
  const amount = Number(extraction.reservedAmount);
  if (extraction.resourceCode === 'stone' && (Number(deposit.reservedAmount) < amount || Number(deposit.remainingAmount) < amount))
    throw new Error('Stone extraction material invariant failed');
  const debited = extraction.resourceCode === 'wood' ? null : await tx.updateTable('stoneDeposits').set({ remainingAmount: sql`remaining_amount - ${amount}::bigint`,
    reservedAmount: sql`reserved_amount - ${amount}::bigint`, revision: sql`revision + 1`, updatedAt: sql`statement_timestamp()` })
    .where('worldId', '=', worldId).where('featureId', '=', extraction.featureId)
    .where('remainingAmount', '>=', String(amount)).where('reservedAmount', '>=', String(amount)).executeTakeFirstOrThrow();
  if (debited && Number(debited.numUpdatedRows) !== 1) throw new Error('Stone extraction material invariant failed');
  const credited = await tx.updateTable('villageResources').set({ amount: sql`amount + ${amount}::bigint` })
    .where('worldId', '=', worldId).where('villageId', '=', villageId).where('resourceCode', '=', extraction.resourceCode)
    .where('amount', '<=', String(Number.MAX_SAFE_INTEGER - amount)).executeTakeFirstOrThrow();
  if (Number(credited.numUpdatedRows) !== 1) throw new Error('Stone extraction credit invariant failed');
  await releaseWorkers(tx, workers, extraction.workerCount, through);
  if (extraction.worksiteId) {
    const site = await tx.selectFrom('extractionWorksites').select(['status', 'workerCap'])
      .where('id', '=', extraction.worksiteId).executeTakeFirstOrThrow();
    const target = await tx.selectFrom('extractionWorksiteTargets').select(['status', 'thresholdReachedAt'])
      .where('worksiteId', '=', extraction.worksiteId).where('featureId', '=', extraction.featureId)
      .executeTakeFirstOrThrow();
    const afterDeposit = await readStoneDeposit(tx, worldId, extraction.featureId);
    const threshold = extraction.resourceCode === 'wood' ? afterDeposit.initialAmount / 10 : 0;
    const finished = target.thresholdReachedAt !== null || afterDeposit.remainingAmount <= threshold || afterDeposit.cleared;
    if (target.status === 'pending' && finished) {
      await tx.updateTable('extractionWorksiteTargets').set({ status: 'completed', completedAt: through,
        reason: 'goal-reached' }).where('worksiteId', '=', extraction.worksiteId)
        .where('featureId', '=', extraction.featureId).execute();
      if (site.status === 'paused') {
        const remainingTarget = await tx.selectFrom('extractionWorksiteTargets').select('featureId')
          .where('worksiteId', '=', extraction.worksiteId).where('status', '=', 'pending').executeTakeFirst();
        if (!remainingTarget) await tx.updateTable('extractionWorksites').set({ status: 'completed', updatedAt: through.toISOString() })
          .where('id', '=', extraction.worksiteId).execute();
      }
    }
    if (site.status === 'running' && !finished) {
      const nextAmount = Math.min(STONE_EXTRACTION_LOT, Math.max(1, afterDeposit.availableAmount));
      const nextDuration = stoneExtractionDuration(Math.min(site.workerCap, extraction.workerCount), nextAmount)
        + 2 * extraction.transportMs;
      for (const worker of workers) {
        if (worker.activity === 'resting' || canWorkFor({ energy: worker.energy, progress: worker.energyProgress,
          activity: 'idle', restingSince: null, foodUsedSinceRest: worker.foodUsedSinceRest,
          updatedAt: through }, nextDuration)) continue;
        const rest = beginRest({ energy: worker.energy, progress: worker.energyProgress,
          activity: 'idle', restingSince: null, foodUsedSinceRest: worker.foodUsedSinceRest,
          updatedAt: through });
        if (rest) await tx.updateTable('populationCohorts').set({ activity: rest.activity, restingSince: rest.restingSince })
          .where('worldId', '=', worldId).where('id', '=', worker.id).execute();
      }
    }
  }
  await tx.updateTable('depositExtractions').set({ status: 'completed', completedAt: through }).where('id', '=', extraction.id).executeTakeFirstOrThrow();
  if (extraction.worksiteId) {
    await tx.updateTable('extractionWorksites').set({ deliveredAmount: sql`delivered_amount + ${amount}::bigint`, updatedAt: through.toISOString() })
      .where('worldId', '=', worldId).where('villageId', '=', villageId).where('id', '=', extraction.worksiteId).executeTakeFirstOrThrow();
  }
  if (extraction.resourceCode === 'wood') {
    await tx.insertInto('villageAccomplishments').values({ worldId, villageId, code: 'first-woodcut', completedAt: through })
      .onConflict(oc => oc.columns(['worldId', 'villageId', 'code']).doNothing()).execute();
    return;
  }
  const after = await tx.selectFrom('stoneDeposits').select('remainingAmount').where('worldId', '=', worldId)
    .where('featureId', '=', extraction.featureId).executeTakeFirstOrThrow();
  if (Number(after.remainingAmount) === 0) {
    await tx.updateTable('worldFeatures').set({ state: 'depleted', updatedAt: sql`transaction_timestamp()` })
      .where('worldId', '=', worldId).where('id', '=', extraction.featureId).execute();
    await tx.deleteFrom('worldCellOccupancies').where('worldId', '=', worldId).where('featureId', '=', extraction.featureId).execute();
  }
}
