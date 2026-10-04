import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { ExtractionWorksite, StartExtractionWorksiteRequest, ChangeExtractionWorksiteRequest, TravelCell } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { materializeCohorts, workingTeam } from '../population/work.js';
import { millisecondsUntilRested } from '../population/energy.js';
import { consumeInitialWorkers, worksiteOrderBudget } from '../villages/exploitation-budget.js';
import type { VillageEconomy } from '../villages/reconcile-economy.js';
import { clearWoodland } from './woodland.js';
import { readExtraction, readStoneDeposit, startStoneExtraction, stoneDepositDetails, stoneExtractionDuration } from './stone-extractions.js';

export const WAKE_EXTRACTION_WORKSITE_TASK = 'deposit.worksite.wake';
const WAIT_MS = 60_000;
const MAX_ACTIVE_WORKSITES = 8;

export async function readWorksites(tx: Transaction<Database>, worldId: string, villageId: string): Promise<ExtractionWorksite[]> {
  const rows = await tx.selectFrom('extractionWorksites').selectAll().where('worldId', '=', worldId)
    .where('villageId', '=', villageId).orderBy('createdAt', 'desc').limit(32).execute();
  return Promise.all(rows.map(async row => {
    const [targets, active] = await Promise.all([
      tx.selectFrom('extractionWorksiteTargets').innerJoin('resourceDeposits', join => join
        .onRef('resourceDeposits.worldId', '=', 'extractionWorksiteTargets.worldId')
        .onRef('resourceDeposits.featureId', '=', 'extractionWorksiteTargets.featureId'))
        .select(['extractionWorksiteTargets.featureId', 'extractionWorksiteTargets.status', 'extractionWorksiteTargets.reason',
          'resourceDeposits.cellX', 'resourceDeposits.cellY'])
        .where('worksiteId', '=', row.id).orderBy('ordinal').execute(),
      tx.selectFrom('depositExtractions').select('id').where('worksiteId', '=', row.id)
        .where('status', '=', 'in-progress').executeTakeFirst(),
    ]);
    return { id: row.id, resourceCode: row.resourceCode, mode: row.mode, status: row.status,
      workerCap: row.workerCap, deliveredAmount: Number(row.deliveredAmount), waitReason: row.waitReason,
      nextWakeAt: row.nextWakeAt?.toISOString() ?? null, targets,
      activeExtraction: active ? await readExtraction(tx, worldId, villageId, active.id) : null };
  }));
}

export async function createWorksite(tx: Transaction<Database>, economy: VillageEconomy,
  request: StartExtractionWorksiteRequest, acceptedFeatureIds = request.featureIds, exploitationOrderId?: string): Promise<string> {
  const existing = await tx.selectFrom('extractionWorksites').selectAll().where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId).where('commandId', '=', request.commandId).executeTakeFirst();
  if (existing) {
    if (existing.mode !== request.mode || existing.requestedWorkerCap !== request.workerCap
      || existing.requestedFeatureIds.join(',') !== request.featureIds.map(id => id.toLowerCase()).join(','))
      throw new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette intention a déjà été utilisée différemment.');
    return existing.id;
  }
  if (new Set(request.featureIds.map(id => id.toLowerCase())).size !== request.featureIds.length)
    throw new HttpError(400, 'WORKSITE_DUPLICATE_TARGET', 'Bosquet sélectionné plusieurs fois.');
  const active = await tx.selectFrom('extractionWorksites').select('id').where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId).where('status', 'in', ['running', 'paused', 'stopping']).execute();
  if (active.length >= MAX_ACTIVE_WORKSITES) throw new HttpError(409, 'WORKSITE_LIMIT', 'Trop de chantiers actifs.');
  const resourceCode = request.mode === 'extract' ? 'stone' : 'wood';
  const created = await tx.insertInto('extractionWorksites').values({ worldId: economy.worldId, villageId: economy.villageId,
    commandId: request.commandId, requestedFeatureIds: request.featureIds.map(id => id.toLowerCase()), exploitationOrderId: exploitationOrderId ?? null,
    resourceCode, mode: request.mode, status: 'running', workerCap: request.workerCap,
    requestedWorkerCap: request.workerCap,
    deliveredAmount: 0, waitReason: null, nextWakeAt: null, lastDepartureAt: null,
    updatedAt: economy.through }).returning('id').executeTakeFirstOrThrow();
  await tx.insertInto('extractionWorksiteTargets').values(acceptedFeatureIds.map((featureId, ordinal) => ({
    worksiteId: created.id, worldId: economy.worldId, villageId: economy.villageId,
    featureId: featureId.toLowerCase(), ordinal, status: 'pending' as const,
    admittedAt: null, thresholdReachedAt: null, completedAt: null, reason: null,
  }))).execute();
  return created.id;
}

export async function changeWorksite(tx: Transaction<Database>, economy: VillageEconomy, worksiteId: string,
  request: ChangeExtractionWorksiteRequest): Promise<void> {
  const site = await tx.selectFrom('extractionWorksites').selectAll().where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId).where('id', '=', worksiteId).forUpdate().executeTakeFirst();
  if (!site) throw new HttpError(404, 'WORKSITE_NOT_FOUND', 'Chantier introuvable.');
  const receipt = await tx.selectFrom('extractionWorksiteCommands').selectAll().where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId).where('commandId', '=', request.commandId).executeTakeFirst();
  if (receipt) {
    if (receipt.worksiteId !== site.id || receipt.action !== request.action || receipt.workerCap !== (request.workerCap ?? null))
      throw new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette intention a déjà été utilisée différemment.');
    return;
  }
  if ((request.action === 'resume' && site.status !== 'paused')
    || (request.action === 'pause' && site.status !== 'running')
    || (request.action === 'stop' && site.status !== 'running' && site.status !== 'paused'))
    throw new HttpError(409, 'WORKSITE_STATE_CONFLICT', 'Cette action ne correspond plus à l’état du chantier.');
  const active = await tx.selectFrom('depositExtractions').select('id').where('worksiteId', '=', site.id)
    .where('status', '=', 'in-progress').executeTakeFirst();
  let status = site.status;
  if (request.action === 'pause' && status === 'running') status = 'paused';
  if (request.action === 'resume' && status === 'paused') status = 'running';
  if (request.action === 'stop' && (status === 'running' || status === 'paused')) status = active ? 'stopping' : 'stopped';
  if (request.action === 'set-cap' && (status === 'stopped' || status === 'completed' || status === 'stopping'))
    throw new HttpError(409, 'WORKSITE_CLOSED', 'Ce chantier ne peut plus changer d’effectif.');
  if (request.action === 'set-cap' && request.workerCap === undefined)
    throw new HttpError(400, 'WORKSITE_CAP_REQUIRED', 'Effectif requis.');
  await tx.updateTable('extractionWorksites').set({ status,
    workerCap: request.action === 'set-cap' ? request.workerCap! : site.workerCap,
    wakeVersion: sql`wake_version + 1`, nextWakeAt: null, waitReason: null, updatedAt: economy.through.toISOString() })
    .where('id', '=', site.id).execute();
  if (status === 'stopped') await tx.updateTable('extractionWorksiteTargets').set({ status: 'abandoned', reason: 'stopped', completedAt: economy.through })
    .where('worksiteId', '=', site.id).where('status', '=', 'pending').execute();
  await tx.insertInto('extractionWorksiteCommands').values({ worldId: economy.worldId, villageId: economy.villageId,
    commandId: request.commandId, worksiteId: site.id, action: request.action, workerCap: request.workerCap ?? null }).execute();
}

async function scheduleWake(tx: Transaction<Database>, site: { id: string; worldId: string; wakeVersion: number }, at: Date) {
  const version = site.wakeVersion + 1;
  await tx.updateTable('extractionWorksites').set({ nextWakeAt: at, wakeVersion: version })
    .where('id', '=', site.id).execute();
  await tx.insertInto('scheduledTasks').values({ worldId: site.worldId, taskType: WAKE_EXTRACTION_WORKSITE_TASK,
    subjectId: randomUUID(), payload: { worksiteId: site.id, version }, dueAt: at, availableAt: at,
    lastError: null, completedAt: null }).execute();
}

async function completeTarget(tx: Transaction<Database>, site: { id: string }, featureId: string, through: Date,
  status: 'completed' | 'external', reason: string) {
  await tx.updateTable('extractionWorksiteTargets').set({ status, reason, completedAt: through })
    .where('worksiteId', '=', site.id).where('featureId', '=', featureId).where('status', '=', 'pending').execute();
}

/** Call only after due transitions and the caller's manual command, under village/resource locks. */
export async function admitWorksites(tx: Transaction<Database>, economy: VillageEconomy,
  village: { widthCells: number; heightCells: number },
  pathFor: (featureId: string) => Promise<TravelCell[] | undefined>): Promise<void> {
  const sites = await tx.selectFrom('extractionWorksites').selectAll().where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId).where('status', 'in', ['running', 'stopping'])
    .orderBy('lastDepartureAt', 'asc').orderBy('createdAt').orderBy('id').limit(MAX_ACTIVE_WORKSITES).execute();
  for (const site of sites) {
    const active = await tx.selectFrom('depositExtractions').select('id').where('worksiteId', '=', site.id)
      .where('status', '=', 'in-progress').executeTakeFirst();
    if (active) continue;
    if (site.status === 'stopping') {
      await tx.updateTable('extractionWorksites').set({ status: 'stopped', waitReason: null, nextWakeAt: null, updatedAt: economy.through.toISOString() })
        .where('id', '=', site.id).execute();
      await tx.updateTable('extractionWorksiteTargets').set({ status: 'abandoned', reason: 'stopped', completedAt: economy.through })
        .where('worksiteId', '=', site.id).where('status', '=', 'pending').execute();
      continue;
    }
    const targets = await tx.selectFrom('extractionWorksiteTargets').selectAll().where('worksiteId', '=', site.id)
      .where('status', '=', 'pending').orderBy('ordinal').limit(64).execute();
    if (!targets.length) {
      await tx.updateTable('extractionWorksites').set({ status: 'completed', waitReason: null, nextWakeAt: null, updatedAt: economy.through.toISOString() })
        .where('id', '=', site.id).execute();
      continue;
    }
    const candidates: Array<{ featureId: string; amount: number; path: TravelCell[]; distance: number }> = [];
    let waitingStock = false, waitingAccess = false;
    let waitingTarget: { featureId: string; distance: number } | null = null;
    for (const target of targets) {
      const deposit = await readStoneDeposit(tx, economy.worldId, target.featureId);
      if (deposit.resourceCode !== site.resourceCode || (site.resourceCode === 'wood' && deposit.cleared && !target.thresholdReachedAt)) {
        await completeTarget(tx, site, target.featureId, economy.through, 'external', 'unavailable');
        continue;
      }
      const threshold = site.resourceCode === 'stone' ? 0 : deposit.initialAmount / 10;
      if ((target.thresholdReachedAt && site.mode === 'cut') || deposit.remainingAmount <= threshold || deposit.cleared) {
        if (site.mode === 'clear' && !deposit.cleared) {
          const details = await stoneDepositDetails(tx, { ...village, worldId: economy.worldId, villageId: economy.villageId },
            economy, target.featureId);
          if (!details.eligibility.inRange || details.eligibility.protected) { waitingAccess = true; continue; }
          await clearWoodland(tx, economy.worldId, target.featureId, economy.through);
        }
        await completeTarget(tx, site, target.featureId, economy.through, 'completed', 'goal-reached');
        continue;
      }
      const path = await pathFor(target.featureId);
      if (!path) { waitingAccess = true; continue; }
      if (deposit.availableAmount < 1) {
        waitingStock = true;
        if (!waitingTarget || path.length - 1 < waitingTarget.distance)
          waitingTarget = { featureId: target.featureId, distance: path.length - 1 };
        continue;
      }
      candidates.push({ featureId: target.featureId, amount: Math.min(100, deposit.availableAmount),
        path, distance: path.length - 1 });
    }
    if (!candidates.length) {
      const remaining = await tx.selectFrom('extractionWorksiteTargets').select('featureId')
        .where('worksiteId', '=', site.id).where('status', '=', 'pending').execute();
      if (!remaining.length) {
        await tx.updateTable('extractionWorksites').set({ status: 'completed', waitReason: null, nextWakeAt: null, updatedAt: economy.through.toISOString() })
          .where('id', '=', site.id).execute();
      } else {
        const reason = waitingStock ? 'stock-reserved' : waitingAccess ? 'access' : 'waiting';
        if (waitingTarget) await tx.updateTable('extractionWorksiteTargets').set({ admittedAt: economy.through })
          .where('worksiteId', '=', site.id).where('featureId', '=', waitingTarget.featureId)
          .where('admittedAt', 'is', null).execute();
        await tx.updateTable('extractionWorksites').set({ waitReason: reason, updatedAt: economy.through.toISOString() }).where('id', '=', site.id).execute();
        const committed = waitingStock ? await tx.selectFrom('depositExtractions').select('completesAt')
          .where('worldId', '=', economy.worldId).where('featureId', 'in', remaining.map(row => row.featureId))
          .where('status', '=', 'in-progress').where('completesAt', '>', economy.through)
          .orderBy('completesAt').limit(1).executeTakeFirst() : null;
        const wakeAt = committed?.completesAt ?? new Date(economy.through.getTime() + WAIT_MS);
        if (!site.nextWakeAt || site.nextWakeAt <= economy.through || wakeAt < site.nextWakeAt)
          await scheduleWake(tx, site, wakeAt);
      }
      continue;
    }
    candidates.sort((a, b) => a.distance - b.distance || a.featureId.localeCompare(b.featureId));
    const next = candidates[0]!;
    await tx.updateTable('extractionWorksiteTargets').set({ admittedAt: economy.through })
      .where('worksiteId', '=', site.id).where('featureId', '=', next.featureId).where('admittedAt', 'is', null).execute();
    const transportMs = next.distance * 1_000;
    const budget = site.exploitationOrderId ? await worksiteOrderBudget(tx, economy, site.exploitationOrderId, site.resourceCode, site.workerCap) : { cap: site.workerCap };
    if (budget.cap < 1) {
      await tx.updateTable('extractionWorksites').set({ waitReason: 'shared-budget', updatedAt: economy.through }).where('id', '=', site.id).execute();
      continue;
    }
    const cohorts = await materializeCohorts(tx, economy.worldId, economy.villageId, economy.through);
    const workers = workingTeam(cohorts, budget.cap,
      count => stoneExtractionDuration(count, next.amount) + 2 * transportMs, budget.preferredCohortId).count;
    if (!workers) {
      const minimum = stoneExtractionDuration(site.workerCap, 1) + 2 * transportMs;
      const reason = minimum > 10 * 60 * 60 * 1_000 ? 'route-too-long' : 'workers-resting';
      await tx.updateTable('extractionWorksites').set({ waitReason: reason, updatedAt: economy.through.toISOString() }).where('id', '=', site.id).execute();
      const restDelay = cohorts.map(cohort => millisecondsUntilRested({ energy: cohort.energy,
        progress: cohort.energyProgress, activity: cohort.activity, restingSince: cohort.restingSince,
        foodUsedSinceRest: cohort.foodUsedSinceRest, updatedAt: cohort.energyUpdatedAt }))
        .filter((ms): ms is number => ms !== null).sort((a, b) => a - b)[0];
      const wakeAt = new Date(economy.through.getTime() + Math.max(WAIT_MS, restDelay ?? WAIT_MS));
      if (reason !== 'route-too-long' && (!site.nextWakeAt || site.nextWakeAt <= economy.through || wakeAt < site.nextWakeAt))
        await scheduleWake(tx, site, wakeAt);
      continue;
    }
    await startStoneExtraction(tx, { worldId: economy.worldId, villageId: economy.villageId,
      widthCells: village.widthCells, heightCells: village.heightCells }, economy, next.featureId, randomUUID(), workers,
      next.path, transportMs, { id: site.id, amount: next.amount, ...(budget.preferredCohortId ? { preferredCohortId: budget.preferredCohortId } : {}) });
    if (site.exploitationOrderId) await consumeInitialWorkers(tx, site.exploitationOrderId, workers);
    await tx.updateTable('extractionWorksites').set({ lastDepartureAt: economy.through, waitReason: null,
      nextWakeAt: null, wakeVersion: sql`wake_version + 1`, updatedAt: economy.through.toISOString() }).where('id', '=', site.id).execute();
  }
}
