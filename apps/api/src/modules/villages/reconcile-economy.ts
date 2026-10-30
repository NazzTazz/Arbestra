import { hasActiveLeveling, completeLevelingAt } from './leveling.js';
import { devTime } from '../operations/dev-timing.js';
import { advancePopulationGrowth } from '../population/growth.js';
import { reconcileRestHousing } from '../population/work.js';
import { sql, type Transaction } from 'kysely';

import type { Database } from '../../database/schema.js';
import { materializeBuildingBuffer, materializeVillageResource } from './economy.js';
import { completeGardenHarvestAt } from '../population/garden-harvest.js';
import { completeStoneExtractionAt } from '../deposits/stone-extractions.js';
import { completeScienceAt } from '../science/service.js';
import { completeProcessingAt } from './processing.js';
import { deliverMarketAt } from './market.js';
import { completeTradeAt } from './trade-economy.js';
import type { ProcessingCommand } from '@arbestra/contracts';
import { isDeepStrictEqual } from 'node:util';
import { HttpError } from '../../errors.js';

export interface VillageEconomy {
  worldId: string;
  villageId: string;
  through: Date;
}

export interface ReconciliationBudget {
  maxTransitions: number;
  maxWorkMs: number;
}
export interface ReconciliationProgress {
  complete: boolean;
  transitions: number;
  lastTransitionAt: Date | null;
}
export const COMMAND_CATCHUP_BUDGET: Readonly<ReconciliationBudget> = { maxTransitions: 64, maxWorkMs: 200 };

type DueTransition =
  | { id: string; through: Date; type: 'leveling' }
  | { id: string; through: Date; type: 'construction' }
  | { id: string; through: Date; type: 'expansion' }
  | { id: string; through: Date; type: 'harvest' }
  | { id: string; through: Date; type: 'extraction' }
  | { id: string; through: Date; type: 'science' }
  | { id: string; through: Date; type: 'processing' }
  | { id: string; through: Date; type: 'market' | 'trade-offer' | 'trade-delivery' };

/** Workshop commands have no route/terrain decision. Discover due economic
 * predecessors under the village lock before deciding whether their shared
 * spatial/deposit preparation is necessary. No business mutation precedes
 * that decision. The slow closure retains the established lock order and H. */
export async function beginProcessingCommand(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  command: ProcessingCommand,
  budget?: ReconciliationBudget,
): Promise<{ economy: VillageEconomy; reconciled: boolean; replay?: boolean; catchingUp?: boolean }> {
  const village = await tx
    .selectFrom('villages')
    .select(['id', 'economyActivatedAt'])
    .where('worldId', '=', worldId)
    .where('id', '=', villageId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const { through, request } = (
    await sql<{ through: Date; request: unknown | null }>`select statement_timestamp() as through,
    (select request from processing_command_receipts where world_id=${worldId} and village_id=${villageId}
      and command_id=${command.commandId}) as request`.execute(tx)
  ).rows[0]!;
  const economy = { worldId, villageId, through };
  // A concurrent identical request can commit while this command waits for
  // the village. Recheck before any catch-up, not merely before the lock.
  if (request) {
    if (!isDeepStrictEqual(request, command))
      throw new HttpError(409, 'COMMAND_REUSED', 'Identifiant de commande déjà utilisé.');
    return { economy, reconciled: false, replay: true };
  }
  if (command.action === 'pause' || command.action === 'cancel') {
    const due = await tx
      .selectFrom('processingLots')
      .select('id')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('orderId', '=', command.orderId)
      .where('completedAt', 'is', null)
      .where('completesAt', '<=', through)
      .executeTakeFirst();
    if (!due) return { economy, reconciled: false };
  } else if (village.economyActivatedAt && !(await readDueVillageTransitions(tx, economy, 1)).length) {
    // Growth can supply eligible workers even without any discrete completion.
    // Materialization/eligibility of existing cohorts remains in startLot.
    await sql`select set_config('arbestra.economy_through',${through.toISOString()},true)`.execute(tx);
    await advancePopulationGrowth(tx, worldId, villageId, through);
    return { economy, reconciled: false };
  }
  const prepared = await beginVillageEconomy(
    tx,
    worldId,
    villageId,
    undefined,
    [],
    [],
    false,
    [villageId],
    undefined,
    budget,
  );
  return { economy: prepared, reconciled: true, ...(prepared.catchup?.complete === false ? { catchingUp: true } : {}) };
}

/** A single round trip for all due kinds. Keep sorting at JS date precision,
 * exactly like successor insertion below; category order is never event order. */
export async function readDueVillageTransitions(
  transaction: Transaction<Database>,
  economy: VillageEconomy,
  limit?: number,
): Promise<DueTransition[]> {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 65))
    throw Error('Invalid transition limit');
  const { worldId, villageId, through } = economy;
  const result = await sql<DueTransition>`select * from (
    select id, construction_completes_at as through, 'construction'::text as type from buildings
      where world_id=${worldId} and village_id=${villageId} and status='under-construction' and construction_completes_at<=${through}
    union all select id, completes_at, 'expansion' from building_expansions
      where world_id=${worldId} and village_id=${villageId} and status='under-construction' and completes_at<=${through}
    union all select id, completes_at, 'harvest' from garden_harvests
      where world_id=${worldId} and village_id=${villageId} and status='in-progress' and completes_at<=${through}
    union all select id, completes_at, 'extraction' from deposit_extractions
      where world_id=${worldId} and village_id=${villageId} and status='in-progress' and completes_at<=${through}
    union all select id, completes_at, 'science' from science_activities
      where world_id=${worldId} and village_id=${villageId} and status='in-progress' and completes_at<=${through}
    union all select id, completes_at, 'processing' from processing_lots
      where world_id=${worldId} and village_id=${villageId} and completed_at is null and completes_at<=${through}
    union all select id, completes_at, 'market' from market_exchanges
      where world_id=${worldId} and village_id=${villageId} and completed_at is null and completes_at<=${through}
    union all select id, oracle_at, 'trade-offer' from trade_offers
      where world_id=${worldId} and village_id=${villageId} and status='open' and oracle_eligible=true and oracle_at<=${through}
    union all select id, due_at, 'trade-delivery' from trade_deliveries
      where world_id=${worldId} and village_id=${villageId} and completed_at is null and due_at<=${through}
    union all select id, completes_at, 'leveling' from leveling_jobs
      where world_id=${worldId} and village_id=${villageId} and completed_at is null and completes_at<=${through}
    ) due ${limit === undefined ? sql`` : sql`order by date_trunc('milliseconds',through),id,type limit ${limit}`}
  `.execute(transaction);
  return result.rows.sort(
    (a, b) => a.through.getTime() - b.through.getTime() || a.id.localeCompare(b.id) || a.type.localeCompare(b.type),
  );
}

/** The village row serializes all economic mutations for that village. */
export async function beginVillageEconomy(
  transaction: Transaction<Database>,
  worldId: string,
  villageId: string,
  depositFeatureId?: string,
  woodCells: Array<{ cellX: number; cellY: number }> = [],
  targetFeatureIds: string[] = [],
  navigationWrite = false,
  lockedPeers: string[] = [villageId],
  sharedThrough?: Date,
  reconciliationBudget?: ReconciliationBudget,
): Promise<VillageEconomy & { catchup?: ReconciliationProgress }> {
  return devTime('economy', async () => {
    await devTime('village_lock', () =>
      transaction
        .selectFrom('villages')
        .select('id')
        .where('worldId', '=', worldId)
        .where('id', '=', villageId)
        .forUpdate()
        .executeTakeFirstOrThrow(),
    );
    // Readers may admit trips, including automatic worksite relaunches. Acquire
    // before deposits; a spatial writer must never upgrade a shared lock later.
    navigationWrite ||= await hasActiveLeveling(transaction, worldId, lockedPeers);
    const navigationKey = `infrastructure:${worldId}`;
    await devTime('navigation_lock', async () => {
      if (navigationWrite)
        await sql`select pg_advisory_xact_lock(hashtextextended(${navigationKey},0))`.execute(transaction);
      else await sql`select pg_advisory_xact_lock_shared(hashtextextended(${navigationKey},0))`.execute(transaction);
    });
    // Read after waiting for the village lock: transaction_timestamp may be stale.
    const through =
      sharedThrough ??
      (await transaction.selectNoFrom(sql<Date>`statement_timestamp()`.as('through')).executeTakeFirstOrThrow())
        .through;
    const economy = { worldId, villageId, through };
    // Project every resource read in the command/snapshot at the same post-lock H.
    await sql`select set_config('arbestra.economy_through',${through.toISOString()},true)`.execute(transaction);
    const dueDeposits = await transaction
      .selectFrom('depositExtractions')
      .select('featureId')
      .where('worldId', '=', worldId)
      .where('villageId', 'in', lockedPeers)
      .where('status', '=', 'in-progress')
      .where('completesAt', '<=', through)
      .execute();
    const worksiteTargets = await transaction
      .selectFrom('extractionWorksiteTargets')
      .innerJoin('extractionWorksites', 'extractionWorksites.id', 'extractionWorksiteTargets.worksiteId')
      .select('extractionWorksiteTargets.featureId')
      .where('extractionWorksiteTargets.worldId', '=', worldId)
      .where('extractionWorksiteTargets.villageId', 'in', lockedPeers)
      .where('extractionWorksiteTargets.status', '=', 'pending')
      // A resume command can admit a new lot in this same transaction. Prelock
      // paused targets before that command, in the same order as running ones.
      .where((eb) =>
        eb.or([
          eb('extractionWorksites.status', 'in', ['running', 'paused']),
          eb('extractionWorksites.poolResource', 'is not', null),
        ]),
      )
      .execute();
    const depositIds = [
      ...new Set([
        ...dueDeposits.map((row) => row.featureId),
        ...worksiteTargets.map((row) => row.featureId),
        ...targetFeatureIds.map((id) => id.toLowerCase()),
        ...(depositFeatureId ? [depositFeatureId.toLowerCase()] : []),
      ]),
    ].sort(); // Canonical UUID strings have the same order as PostgreSQL UUID bytes.
    // Several villages may complete work on the same deposits. Acquiring the
    // shared rows in one global order prevents village X/Y lock inversions.
    if (depositIds.length)
      await transaction
        .selectFrom('stoneDeposits')
        .select('featureId')
        .where('worldId', '=', worldId)
        .where('featureId', 'in', depositIds)
        .orderBy('featureId')
        .forUpdate()
        .execute();
    // Wood cases by UUID: only those with a lot due, the targets this command or
    // a worksite may admit, and cells a construction may claim. A read writes
    // nothing on wood; each village debits its own lots at their deadlines and
    // takes trees only under a case it holds (docs/SPEC-BOIS-ARBRE-UNITE.md).
    if (depositIds.length || woodCells.length)
      await transaction
        .selectFrom('woodlandDeposits')
        .select('featureId')
        .where('worldId', '=', worldId)
        .where((eb) =>
          eb.or([
            ...(depositIds.length ? [eb('featureId', 'in', depositIds)] : []),
            ...woodCells.map((c) => eb.and([eb('cellX', '=', c.cellX), eb('cellY', '=', c.cellY)])),
          ]),
        )
        .orderBy('featureId')
        .forUpdate()
        .execute();
    const catchup = await reconcileVillageEconomy(transaction, economy, reconciliationBudget);
    if (!catchup.complete) return { ...economy, catchup };
    const version = await transaction
      .selectFrom('villages')
      .select('economyActivatedAt')
      .where('worldId', '=', worldId)
      .where('id', '=', villageId)
      .executeTakeFirstOrThrow();
    if (!version.economyActivatedAt) {
      // Old rates remain in the catalogue exclusively for this historical settlement.
      await materializeVillageResource(transaction, worldId, villageId, 'wood', through);
      await transaction
        .updateTable('villageResourceFlows')
        .set({ baseRatePerHour: 0 })
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('resourceCode', '=', 'wood')
        .execute();
      await transaction
        .updateTable('villages')
        .set({ economyActivatedAt: through })
        .where('worldId', '=', worldId)
        .where('id', '=', villageId)
        .execute();
    }
    return reconciliationBudget ? { ...economy, catchup } : economy;
  });
}

/** Requires the village lock and a context retained within this same transaction. */
export async function reconcileVillageEconomy(
  transaction: Transaction<Database>,
  economy: VillageEconomy,
  budget?: ReconciliationBudget,
): Promise<ReconciliationProgress> {
  if (
    budget &&
    (!Number.isInteger(budget.maxTransitions) ||
      budget.maxTransitions < 1 ||
      budget.maxTransitions > 64 ||
      !Number.isFinite(budget.maxWorkMs) ||
      budget.maxWorkMs <= 0 ||
      budget.maxWorkMs > 200)
  )
    throw Error('Invalid reconciliation budget');
  return devTime('reconcile', async () => {
    const started = performance.now();
    const due = await readDueVillageTransitions(transaction, economy, budget ? budget.maxTransitions + 1 : undefined);
    let transitions = 0,
      through: Date | null = null;
    while (due.length) {
      // Guarantee progress even when loading the bounded prefix consumed the
      // time allowance. Check time between transitions, never midway through
      // the first one; statement/lock timeouts bound an individual SQL call.
      if (
        budget &&
        (transitions >= budget.maxTransitions || (transitions > 0 && performance.now() - started >= budget.maxWorkMs))
      )
        return { complete: false, transitions, lastTransitionAt: through };
      const transition = due.shift()!;
      await advancePopulationGrowth(transaction, economy.worldId, economy.villageId, transition.through);
      if (transition.type === 'leveling')
        await completeLevelingAt(transaction, economy, transition.id, transition.through);
      else if (transition.type === 'construction')
        await completeConstructionAt(transaction, economy, transition.id, transition.through);
      else if (transition.type === 'expansion')
        await completeExpansionAt(transaction, economy, transition.id, transition.through);
      else if (transition.type === 'harvest')
        await completeGardenHarvestAt(
          transaction,
          economy.worldId,
          economy.villageId,
          transition.id,
          transition.through,
        );
      else if (transition.type === 'science')
        await completeScienceAt(transaction, economy, transition.id, transition.through);
      else if (transition.type === 'market')
        await deliverMarketAt(transaction, economy, transition.id, transition.through);
      else if (transition.type === 'trade-offer' || transition.type === 'trade-delivery')
        await completeTradeAt(
          transaction,
          economy,
          transition.id,
          transition.through,
          transition.type === 'trade-offer' ? 'offer' : 'delivery',
        );
      else if (transition.type === 'processing') {
        await completeProcessingAt(transaction, economy, transition.id, transition.through);
        // A newly admitted successor must compete with every already-due event.
        const successors = await transaction
          .selectFrom('processingLots')
          .select(['id', 'completesAt'])
          .where('worldId', '=', economy.worldId)
          .where('villageId', '=', economy.villageId)
          .where('completedAt', 'is', null)
          .where('completesAt', '<=', economy.through)
          .$if(!!budget, (q) =>
            q
              .orderBy(sql`date_trunc('milliseconds',completes_at)`)
              .orderBy('id')
              .limit(budget!.maxTransitions + 1),
          )
          .execute();
        for (const lot of successors)
          if (!due.some((event) => event.type === 'processing' && event.id === lot.id))
            due.push({ id: lot.id, through: lot.completesAt, type: 'processing' });
        due.sort(
          (a, b) =>
            a.through.getTime() - b.through.getTime() || a.id.localeCompare(b.id) || a.type.localeCompare(b.type),
        );
      } else
        await completeStoneExtractionAt(
          transaction,
          economy.worldId,
          economy.villageId,
          transition.id,
          transition.through,
        );
      transitions++;
      through = transition.through;
    }
    await advancePopulationGrowth(transaction, economy.worldId, economy.villageId, economy.through);
    // Completions release teams to rest or idleness: house them at H and keep
    // the next energy notification, as reads and commands did, so that a
    // worker task alone leaves the population reconciled. Only once every
    // transition up to H has been applied (never after a partial catch-up).
    if (transitions) await reconcileRestHousing(transaction, economy.worldId, economy.villageId, economy.through);
    return { complete: true, transitions, lastTransitionAt: through };
  });
}

async function completeConstructionAt(
  transaction: Transaction<Database>,
  economy: VillageEconomy,
  buildingId: string,
  through: Date,
): Promise<void> {
  const building = await transaction
    .selectFrom('buildings')
    .select(['id', 'status', 'buildingType', 'constructionCompletesAt'])
    .where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId)
    .where('id', '=', buildingId)
    .forUpdate()
    .executeTakeFirst();
  if (
    !building ||
    building.status !== 'under-construction' ||
    !building.constructionCompletesAt ||
    building.constructionCompletesAt.getTime() !== through.getTime() ||
    building.constructionCompletesAt > economy.through
  )
    return;
  const directResources = await transaction
    .selectFrom('villageResourceFlows')
    .select('resourceCode')
    .where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId)
    .orderBy('resourceCode')
    .execute();
  for (const resource of directResources)
    await materializeVillageResource(transaction, economy.worldId, economy.villageId, resource.resourceCode, through);
  const buffers =
    building.buildingType === 'garden'
      ? []
      : await transaction
          .selectFrom('buildingResourceBuffers')
          .select('resourceCode')
          .where('worldId', '=', economy.worldId)
          .where('buildingId', '=', building.id)
          .orderBy('resourceCode')
          .execute();
  for (const buffer of buffers)
    await materializeBuildingBuffer(transaction, economy.worldId, building.id, buffer.resourceCode, through);
  await transaction
    .updateTable('buildings')
    .set({
      level: sql`coalesce(target_level, level)`,
      targetLevel: null,
      status: 'completed',
      completedAt: sql.ref('constructionCompletesAt'),
    })
    .where('id', '=', building.id)
    .where('status', '=', 'under-construction')
    .executeTakeFirstOrThrow();
  if (building.buildingType === 'dwelling' || building.buildingType === 'town-hall')
    await advancePopulationGrowth(transaction, economy.worldId, economy.villageId, through, true);
  if (building.buildingType === 'garden') {
    const cells = await transaction
      .selectFrom('worldCellOccupancies')
      .select(['cellX', 'cellY'])
      .where('worldId', '=', economy.worldId)
      .where('buildingId', '=', building.id)
      .where('pendingExpansionId', 'is', null)
      .orderBy('cellX')
      .orderBy('cellY')
      .execute();
    if (cells.length)
      await transaction
        .insertInto('gardenPlots')
        .values(
          cells.map((cell) => ({
            worldId: economy.worldId,
            villageId: economy.villageId,
            buildingId: building.id,
            cellX: cell.cellX,
            cellY: cell.cellY,
            storedAmount: 0,
            remainder: 0,
            productionUpdatedAt: through,
          })),
        )
        .onConflict((conflict) => conflict.columns(['worldId', 'cellX', 'cellY']).doNothing())
        .execute();
  }
}

async function completeExpansionAt(
  transaction: Transaction<Database>,
  economy: VillageEconomy,
  expansionId: string,
  through: Date,
): Promise<void> {
  const expansion = await transaction
    .selectFrom('buildingExpansions')
    .selectAll()
    .where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId)
    .where('id', '=', expansionId)
    .forUpdate()
    .executeTakeFirst();
  if (
    !expansion ||
    expansion.status !== 'under-construction' ||
    expansion.completesAt.getTime() !== through.getTime() ||
    expansion.completesAt > economy.through
  )
    return;
  // Garden buffers are historical after 015; existing plots keep their own
  // cursor and only the new plots start producing at this deadline.
  await transaction
    .updateTable('worldCellOccupancies')
    .set({ pendingExpansionId: null })
    .where('worldId', '=', economy.worldId)
    .where('pendingExpansionId', '=', expansion.id)
    .execute();
  await transaction
    .updateTable('buildingExpansions')
    .set({ status: 'completed', completedAt: through })
    .where('worldId', '=', economy.worldId)
    .where('id', '=', expansion.id)
    .where('status', '=', 'under-construction')
    .execute();
  const cells = await transaction
    .selectFrom('worldCellOccupancies')
    .select(['cellX', 'cellY'])
    .where('worldId', '=', economy.worldId)
    .where('buildingId', '=', expansion.buildingId)
    .where('pendingExpansionId', 'is', null)
    .execute();
  if (cells.length)
    await transaction
      .insertInto('gardenPlots')
      .values(
        cells.map((cell) => ({
          worldId: economy.worldId,
          villageId: economy.villageId,
          buildingId: expansion.buildingId,
          cellX: cell.cellX,
          cellY: cell.cellY,
          storedAmount: 0,
          remainder: 0,
          productionUpdatedAt: through,
        })),
      )
      .onConflict((conflict) => conflict.columns(['worldId', 'cellX', 'cellY']).doNothing())
      .execute();
}
