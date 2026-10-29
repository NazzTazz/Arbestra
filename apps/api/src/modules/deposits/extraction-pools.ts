import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql, type Transaction } from 'kysely';
import {
  designatedQueue,
  extractionPoolCaps,
  extractionPoolSettings,
  targetDesignations,
  type ExtractionPool,
  type ExtractionPoolCommand,
  type QueueDesignation,
  type WoodMode,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { VillageEconomy } from '../villages/reconcile-economy.js';
import { HttpError } from '../../errors.js';
import { createWorksite, WAKE_EXTRACTION_WORKSITE_TASK } from './worksites.js';
import { readWoodlandTrees } from './woodland.js';

type Resource = 'wood' | 'stone';
export async function ensureExtractionPool(tx: Transaction<Database>, ctx: VillageEconomy, resource: Resource) {
  await tx
    .insertInto('extractionPools')
    .values({ worldId: ctx.worldId, villageId: ctx.villageId, resourceCode: resource, siteCount: 1, workerCap: 5 })
    .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doNothing())
    .execute();
  const pool = await tx
    .selectFrom('extractionPools')
    .selectAll()
    .where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId)
    .where('resourceCode', '=', resource)
    .executeTakeFirstOrThrow();
  return pool;
}

async function syncPoolSites(
  tx: Transaction<Database>,
  ctx: VillageEconomy,
  pool: { resourceCode: Resource; siteCount: number; workerCap: number },
) {
  const sites = await tx
    .selectFrom('extractionWorksites')
    .selectAll()
    .where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId)
    .where('poolResource', '=', pool.resourceCode)
    .orderBy('createdAt')
    .orderBy('id')
    .execute();
  const caps = extractionPoolCaps(pool.siteCount, pool.workerCap);
  // Keep one durable owner of the common queue even while the pool is paused.
  while (sites.length < Math.max(1, pool.siteCount)) {
    const id = await createWorksite(
      tx,
      ctx,
      {
        commandId: randomUUID(),
        mode: pool.resourceCode === 'wood' ? 'cut' : 'extract',
        workerCap: caps[sites.length] ?? 1,
        featureIds: [],
      },
      [],
      undefined,
      pool.resourceCode,
      pool.siteCount === 0,
    );
    sites.push(
      await tx
        .selectFrom('extractionWorksites')
        .selectAll()
        .where('worldId', '=', ctx.worldId)
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
  }
  const active = await tx
    .selectFrom('depositExtractions')
    .select('worksiteId')
    .where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId)
    .where('status', '=', 'in-progress')
    .execute();
  for (const [i, site] of sites.entries()) {
    const status =
      i < pool.siteCount ? 'running' : active.some((e) => e.worksiteId === site.id) ? 'stopping' : 'stopped';
    const workerCap = caps[i] ?? site.workerCap;
    if (status !== site.status || workerCap !== site.workerCap)
      await tx
        .updateTable('extractionWorksites')
        .set({
          status,
          workerCap,
          waitReason: null,
          nextWakeAt: null,
          wakeVersion: sql`wake_version+1`,
          updatedAt: ctx.through,
        })
        .where('worldId', '=', ctx.worldId)
        .where('id', '=', site.id)
        .execute();
  }
}

export async function changeExtractionPool(
  tx: Transaction<Database>,
  ctx: VillageEconomy,
  command: ExtractionPoolCommand,
) {
  const pool = await ensureExtractionPool(tx, ctx, command.resource);
  let settings;
  try {
    settings = extractionPoolSettings(pool, command.action);
  } catch {
    throw new HttpError(
      409,
      'POOL_WORKFORCE_LIMIT',
      'Ajustez les habitants : 1 à 10 par chantier, huit chantiers au maximum.',
    );
  }
  const { siteCount, workerCap } = settings;
  const other = await tx
    .selectFrom('extractionWorksites')
    .select('id')
    .where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId)
    .where('status', 'in', ['running', 'paused', 'stopping'])
    .where((e) => e.or([e('poolResource', 'is', null), e('poolResource', '!=', command.resource)]))
    .execute();
  if (other.length + siteCount > 8)
    throw new HttpError(409, 'WORKSITE_LIMIT', 'Huit chantiers ouverts au maximum dans le village.');
  await tx
    .updateTable('extractionPools')
    .set({ siteCount, workerCap })
    .where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId)
    .where('resourceCode', '=', command.resource)
    .execute();
  await syncPoolSites(tx, ctx, { resourceCode: command.resource, siteCount, workerCap });
  await wakeExtractionPool(tx, ctx, command.resource);
}

export async function wakeExtractionPool(tx: Transaction<Database>, ctx: VillageEconomy, resource: Resource) {
  // New notification only: existing scheduler tasks are never modified here.
  const site = await tx
    .selectFrom('extractionWorksites')
    .select(['id', 'wakeVersion'])
    .where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId)
    .where('poolResource', '=', resource)
    .where('status', '=', 'running')
    .orderBy('id')
    .executeTakeFirst();
  if (site)
    await tx
      .insertInto('scheduledTasks')
      .values({
        worldId: ctx.worldId,
        taskType: WAKE_EXTRACTION_WORKSITE_TASK,
        subjectId: randomUUID(),
        payload: { worksiteId: site.id, version: site.wakeVersion },
        dueAt: ctx.through,
        availableAt: ctx.through,
        completedAt: null,
        lastError: null,
      })
      .execute();
}

/** The queue of a wood case from its shares; reads the case's trees only
 * when a share clears it whole. */
async function woodQueue(tx: Transaction<Database>, worldId: string, featureId: string, shares: QueueDesignation[]) {
  const all = shares.some((share) => share.mode === 'clear' && share.treeIndices === null)
    ? (await readWoodlandTrees(tx, worldId, featureId)).all
    : [];
  return designatedQueue(shares, all);
}

/** Queues targets in the resource's common queue. A wood target records the
 * share of the gesture that queued it (slice 2e), so that cancelling a gesture
 * withdraws its own trees only. A case already queued gains the newly
 * designated trees after its own, in their order; a case designated whole
 * takes all of its trees; a clearing takes further the trees queued for their
 * wood (docs/SPEC-BOIS-ARBRE-UNITE.md). Without gesture, the share has no
 * command: it is never withdrawn. */
export async function appendPoolTargets(
  tx: Transaction<Database>,
  ctx: VillageEconomy,
  resource: Resource,
  targets: ReadonlyArray<string | { featureId: string; treeIndices?: number[] | null }>,
  gesture: { commandId: string | null; mode: WoodMode } = { commandId: null, mode: 'cut' },
) {
  const pool = await ensureExtractionPool(tx, ctx, resource);
  await syncPoolSites(tx, ctx, pool);
  const sites = await tx
    .selectFrom('extractionWorksites')
    .select('id')
    .where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId)
    .where('poolResource', '=', resource)
    .orderBy('createdAt')
    .orderBy('id')
    .execute();
  const pending = await tx
    .selectFrom('extractionWorksiteTargets')
    .select(['worksiteId', 'featureId', 'treeIndices', 'clearTreeIndices', 'designations'])
    .where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId)
    .where(
      'worksiteId',
      'in',
      sites.map((s) => s.id),
    )
    .where('status', '=', 'pending')
    .execute();
  const wanted = targets.map((target) =>
    typeof target === 'string'
      ? { featureId: target, treeIndices: null }
      : { featureId: target.featureId, treeIndices: resource === 'wood' ? (target.treeIndices ?? null) : null },
  );
  const share = (treeIndices: number[] | null): QueueDesignation => ({
    commandId: gesture.commandId,
    mode: gesture.mode,
    treeIndices,
  });
  const fresh: Array<
    (typeof wanted)[number] & { clearTreeIndices: number[] | null; shares: QueueDesignation[] | null }
  > = [];
  for (const target of wanted) {
    const queued = pending.find((t) => t.featureId === target.featureId);
    if (!queued) {
      const shares = resource === 'wood' ? [share(target.treeIndices)] : null;
      const queue = shares ? await woodQueue(tx, ctx.worldId, target.featureId, shares) : null;
      fresh.push({ ...target, clearTreeIndices: queue?.clearTreeIndices ?? null, shares });
      continue;
    }
    if (resource !== 'wood') continue;
    // The queued trees stay first; a share that changes nothing is not kept.
    const shares = [...targetDesignations(queued), share(target.treeIndices)];
    const queue = await woodQueue(tx, ctx.worldId, target.featureId, shares);
    if (
      isDeepStrictEqual(queue, {
        treeIndices: queued.treeIndices,
        clearTreeIndices: queued.clearTreeIndices,
      })
    )
      continue;
    await tx
      .updateTable('extractionWorksiteTargets')
      .set({ ...queue, designations: JSON.stringify(shares) })
      .where('worldId', '=', ctx.worldId)
      .where('worksiteId', '=', queued.worksiteId)
      .where('featureId', '=', queued.featureId)
      .where('status', '=', 'pending')
      .execute();
  }
  if (pending.length + fresh.length > 64)
    throw new HttpError(409, 'WORKSITE_TARGET_LIMIT', '64 cibles en attente au maximum par ressource.');
  const owner = sites[0]!.id;
  const last = await tx
    .selectFrom('extractionWorksiteTargets')
    .select(sql<number>`coalesce(max(ordinal),-1)::integer`.as('ordinal'))
    .where('worldId', '=', ctx.worldId)
    .where('worksiteId', '=', owner)
    .executeTakeFirstOrThrow();
  for (const [i, { featureId, treeIndices, clearTreeIndices, shares }] of fresh.entries()) {
    const designations = shares ? JSON.stringify(shares) : null;
    await tx
      .insertInto('extractionWorksiteTargets')
      .values({
        worldId: ctx.worldId,
        villageId: ctx.villageId,
        worksiteId: owner,
        featureId,
        ordinal: last.ordinal + i + 1,
        status: 'pending',
        admittedAt: null,
        thresholdReachedAt: null,
        completedAt: null,
        reason: null,
        treeIndices,
        clearTreeIndices,
        designations,
      })
      .onConflict((c) =>
        c.columns(['worksiteId', 'featureId']).doUpdateSet({
          ordinal: last.ordinal + i + 1,
          status: 'pending',
          admittedAt: null,
          thresholdReachedAt: null,
          completedAt: null,
          reason: null,
          // A finished target queued again takes its new designation.
          treeIndices,
          clearTreeIndices,
          designations,
        }),
      )
      .execute();
  }
  await wakeExtractionPool(tx, ctx, resource);
}

export async function poolAdmissionCap(
  tx: Transaction<Database>,
  ctx: VillageEconomy,
  resource: Resource,
  childCap: number,
) {
  const pool = await tx
    .selectFrom('extractionPools')
    .selectAll()
    .where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId)
    .where('resourceCode', '=', resource)
    .executeTakeFirstOrThrow();
  if (pool.siteCount === 0) return 0;
  const active = await tx
    .selectFrom('depositExtractions as e')
    .innerJoin('extractionWorksites as s', (j) =>
      j
        .onRef('s.worldId', '=', 'e.worldId')
        .onRef('s.villageId', '=', 'e.villageId')
        .onRef('s.id', '=', 'e.worksiteId'),
    )
    .select('e.workerCount')
    .where('e.worldId', '=', ctx.worldId)
    .where('e.villageId', '=', ctx.villageId)
    .where('s.poolResource', '=', resource)
    .where('e.status', '=', 'in-progress')
    .execute();
  return Math.min(childCap, Math.max(0, pool.workerCap - active.reduce((n, e) => n + e.workerCount, 0)));
}

export async function readExtractionPools(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  selected: readonly Resource[] = ['wood', 'stone'],
): Promise<ExtractionPool[]> {
  if (!selected.length) return [];
  const resources = [...new Set(selected)];
  const selectedSites = tx
    .selectFrom('extractionWorksites')
    .select('id')
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .where('poolResource', 'in', resources);
  const [pools, sites, targets, active] = await Promise.all([
    tx
      .selectFrom('extractionPools')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('resourceCode', 'in', resources)
      .execute(),
    tx
      .selectFrom('extractionWorksites')
      .select(['id', 'poolResource'])
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('poolResource', 'in', resources)
      .execute(),
    tx
      .selectFrom('extractionWorksiteTargets')
      .select(['worksiteId', 'featureId'])
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('status', '=', 'pending')
      .where('worksiteId', 'in', selectedSites)
      .execute(),
    tx
      .selectFrom('depositExtractions')
      .select(['worksiteId', 'workerCount'])
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('status', '=', 'in-progress')
      .where('worksiteId', 'in', selectedSites)
      .execute(),
  ]);
  return resources.map((resource) => {
    const pool = pools.find((p) => p.resourceCode === resource),
      ids = new Set(sites.filter((s) => s.poolResource === resource).map((s) => s.id));
    const missions = active.filter((e) => e.worksiteId && ids.has(e.worksiteId));
    return {
      resource,
      siteCount: pool?.siteCount ?? 1,
      workerCap: pool?.workerCap ?? 5,
      mobilized: missions.reduce((n, e) => n + e.workerCount, 0),
      activeSites: missions.length,
      pendingTargets: new Set(targets.filter((t) => ids.has(t.worksiteId)).map((t) => t.featureId)).size,
    };
  });
}
