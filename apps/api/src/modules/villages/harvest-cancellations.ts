import type { Kysely, Transaction } from 'kysely';
import {
  canonicalWoodTrees,
  designatedQueue,
  treeWood,
  withdrawGesture,
  type HarvestCancelReceipt,
  type HarvestIntent,
  type HarvestReceipt,
  type WoodMode,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { readWoodlandTrees, type WoodlandTrees } from '../deposits/woodland.js';
import { beginVillageEconomy, type VillageEconomy } from './reconcile-economy.js';
import { ownedVillage } from './service.js';

/** « Annuler » a gesture of the wood queue (slice 2e of
 * docs/PLAN-BOIS-ARBRE-TRANCHE-2.md, docs/SPEC-GRAMMAIRE-GESTUELLE.md): its
 * trees and stumps not yet taken leave the queue; a tree a lot of the village
 * works on stays, with its mode. Only this gesture's share of each case is
 * withdrawn: another gesture's trees stay. A case left without any share leaves
 * the queue. The first receipt is stored: a replay answers it unchanged and
 * changes nothing. The 15 s of the button are the interface's; the server
 * cancels as long as something is left to withdraw. Only the wood of the
 * gesture is withdrawn. */
export async function cancelHarvestIntent(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  commandId: string,
): Promise<HarvestCancelReceipt> {
  return db.transaction().execute((tx) => cancelHarvestIntentIn(tx, accountId, worldSlug, villageId, commandId));
}

/** Locks: the village, then the cases of its queue by UUID (beginVillageEconomy),
 * after which `through` is read and due lots are settled. Only rows of this
 * village's queue are written; trees and notifications are read, never locked. */
export async function cancelHarvestIntentIn(
  tx: Transaction<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  rawCommandId: string,
): Promise<HarvestCancelReceipt> {
  const commandId = rawCommandId.toLowerCase();
  const village = await ownedVillage(tx, accountId, worldSlug, villageId);
  const economy = await beginVillageEconomy(tx, village.worldId, village.villageId);
  const scope = { worldId: village.worldId, villageId: village.villageId, commandId };
  const previous = await tx
    .selectFrom('harvestIntentCancellations')
    .select('receipt')
    .where('worldId', '=', scope.worldId)
    .where('villageId', '=', scope.villageId)
    .where('commandId', '=', commandId)
    .executeTakeFirst();
  if (previous) return previous.receipt;
  const intent = await tx
    .selectFrom('harvestIntents')
    .select(['request', 'receipt'])
    .where('worldId', '=', scope.worldId)
    .where('villageId', '=', scope.villageId)
    .where('commandId', '=', commandId)
    .executeTakeFirst();
  let receipt: HarvestCancelReceipt;
  if (intent) receipt = await withdraw(tx, economy, commandId, intent.request, intent.receipt);
  else {
    // Another village's gesture is not found here: its world and village differ.
    const submission = await tx
      .selectFrom('harvestSubmissions')
      .select(['request', 'receipt'])
      .where('worldId', '=', scope.worldId)
      .where('villageId', '=', scope.villageId)
      .where('commandId', '=', commandId)
      .executeTakeFirst();
    if (!submission) throw new HttpError(404, 'HARVEST_INTENT_NOT_FOUND', 'Geste introuvable.');
    // Refused as a whole: nothing was queued. Not processed yet: its wood never will be.
    receipt = submission.receipt
      ? { commandId, trees: [] }
      : { commandId, beforeQueue: true, trees: await designatedBefore(tx, scope.worldId, submission.request) };
  }
  await tx
    .insertInto('harvestIntentCancellations')
    .values({ ...scope, receipt: JSON.stringify(receipt) })
    .execute();
  return receipt;
}

/** Trees a gesture designated, before it was processed: its wood is never queued. */
async function designatedBefore(tx: Transaction<Database>, worldId: string, request: HarvestIntent) {
  const designated = new Map(canonicalWoodTrees(request.woodTrees)?.map((d) => [d.featureId, d.treeIndices]));
  const trees: HarvestCancelReceipt['trees'] = [];
  for (const featureId of [...new Set(request.wood.map((id) => id.toLowerCase()))].sort()) {
    let indices = designated.get(featureId);
    if (!indices)
      try {
        indices = (await readWoodlandTrees(tx, worldId, featureId)).all;
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 404) continue;
        throw error;
      }
    trees.push(...indices.map((treeIndex) => ({ featureId, treeIndex, outcome: 'removed' as const })));
  }
  return trees;
}

/** Whether a tree has work left in a mode: its wood (cut), or also its stump (clear). */
function hasWork(trees: WoodlandTrees, treeIndex: number, mode: WoodMode) {
  const { state } = treeWood(trees.records.get(treeIndex));
  return mode === 'cut' ? state === 'standing' || state === 'felled' : state !== 'removed';
}

async function withdraw(
  tx: Transaction<Database>,
  economy: VillageEconomy,
  commandId: string,
  request: HarvestIntent,
  intentReceipt: HarvestReceipt,
): Promise<HarvestCancelReceipt> {
  const accepted = intentReceipt.accepted.filter((a) => a.resource === 'wood');
  if (!accepted.length) return { commandId, trees: [] };
  const featureIds = accepted.map((a) => a.key);
  const [targets, busy] = await Promise.all([
    tx
      .selectFrom('extractionWorksiteTargets as t')
      .innerJoin('extractionWorksites as s', (join) =>
        join.onRef('s.worldId', '=', 't.worldId').onRef('s.id', '=', 't.worksiteId'),
      )
      .select(['t.worksiteId', 't.featureId', 't.treeIndices', 't.clearTreeIndices', 't.designations'])
      .where('t.worldId', '=', economy.worldId)
      .where('t.villageId', '=', economy.villageId)
      .where('s.villageId', '=', economy.villageId)
      .where('s.poolResource', '=', 'wood')
      .where('t.status', '=', 'pending')
      .where('t.featureId', 'in', featureIds)
      .execute(),
    // Taken: a lot of this village is reserved or under way on the tree.
    tx
      .selectFrom('depositExtractions')
      .select(['featureId', 'treeIndex'])
      .where('worldId', '=', economy.worldId)
      .where('villageId', '=', economy.villageId)
      .where('resourceCode', '=', 'wood')
      .where('status', '=', 'in-progress')
      .where('featureId', 'in', featureIds)
      .execute(),
  ]);
  const mode: WoodMode = request.woodMode ?? 'cut';
  const receipt: HarvestCancelReceipt = { commandId, trees: [] };
  for (const share of accepted) {
    const featureId = share.key;
    const trees = await readWoodlandTrees(tx, economy.worldId, featureId);
    const taken = new Set(
      busy.flatMap((lot) => (lot.featureId === featureId && lot.treeIndex !== null ? [lot.treeIndex] : [])),
    );
    const target = targets.find((t) => t.featureId === featureId);
    let queue = target ? { treeIndices: target.treeIndices, clearTreeIndices: target.clearTreeIndices } : null,
      found = false;
    if (target?.designations) {
      const left = withdrawGesture(target.designations, commandId, taken, trees.all);
      found = left.found;
      if (found && !left.designations.length) {
        // Nothing left: the case leaves the queue, no empty target waits for people.
        await tx
          .deleteFrom('extractionWorksiteTargets')
          .where('worldId', '=', economy.worldId)
          .where('worksiteId', '=', target.worksiteId)
          .where('featureId', '=', featureId)
          .where('status', '=', 'pending')
          .execute();
        queue = null;
      } else if (found) {
        queue = designatedQueue(left.designations, trees.all);
        await tx
          .updateTable('extractionWorksiteTargets')
          .set({ ...queue, designations: JSON.stringify(left.designations) })
          .where('worldId', '=', economy.worldId)
          .where('worksiteId', '=', target.worksiteId)
          .where('featureId', '=', featureId)
          .where('status', '=', 'pending')
          .execute();
      }
    }
    const queued = (treeIndex: number) =>
      queue !== null &&
      (queue.treeIndices === null ? trees.all.includes(treeIndex) : queue.treeIndices.includes(treeIndex));
    for (const treeIndex of share.treeIndices ?? trees.all) {
      const after: WoodMode = queue?.clearTreeIndices?.includes(treeIndex) ? 'clear' : 'cut';
      receipt.trees.push(
        queued(treeIndex) && taken.has(treeIndex)
          ? { featureId, treeIndex, outcome: 'in-progress', mode: after }
          : queued(treeIndex) && hasWork(trees, treeIndex, after)
            ? { featureId, treeIndex, outcome: 'queued', mode: after }
            : found && !taken.has(treeIndex) && hasWork(trees, treeIndex, mode)
              ? { featureId, treeIndex, outcome: 'removed' }
              : { featureId, treeIndex, outcome: 'not-queued' },
      );
    }
  }
  return receipt;
}
