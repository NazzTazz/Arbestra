import {
  canonicalWoodTrees,
  nextStump,
  nextWoodLot,
  treeWood,
  WOOD_PER_TREE,
  woodlandTreeIndices,
  type TreeRecord,
  type WoodlandTreeState,
  type WoodTreeDesignation,
} from '@arbestra/contracts';
import { sql, type Expression, type Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';

/** The tree as the wood harvest unit (docs/SPEC-BOIS-ARBRE-UNITE.md). A case
 * (woodland_deposits) holds the sum of its trees: remaining, reserved and cut
 * wood are kept on it in the same statement as the tree they change, under the
 * case lock, so readers and the journal keep working per case. Nothing here
 * regrows or writes on a read: only the village owning a lot debits it, at its
 * deadline, and the last stump removed clears the case. */

/** Trees a command designates, by case (slice 2c): each designated case must
 * also be selected, its trees kept in the player's order. A selected case
 * without designation means all of its trees. */
export function woodDesignations(
  wood: readonly string[],
  woodTrees: readonly WoodTreeDesignation[] | undefined,
): Map<string, number[]> {
  const selected = new Set(wood.map((id) => id.toLowerCase())),
    designations = new Map<string, number[]>();
  for (const entry of canonicalWoodTrees(woodTrees) ?? []) {
    if (!selected.has(entry.featureId))
      throw new HttpError(400, 'WOOD_TREES_OUTSIDE_SELECTION', 'Des arbres désignés sont hors de la sélection.');
    designations.set(entry.featureId, entry.treeIndices);
  }
  return designations;
}

/** Per-tree state of a wood case for readers (slice 2d): the trees with a row
 * only (felled, reserved, stump, removed stump), the lots due and not yet
 * debited by their village shown as cut, exactly like `resource_deposits`. */
export function woodlandTreeStatesSql(worldId: Expression<unknown> | string, featureId: Expression<unknown> | string) {
  return sql<RawWoodlandTreeState[] | null>`(select jsonb_agg(jsonb_build_object(
      'treeIndex',t.tree_index,
      'remainingAmount',t.remaining_amount-coalesce(due.amount,0),
      'reservedAmount',t.reserved_amount-coalesce(due.amount,0),
      'felledAt',t.felled_at,
      'stumpRemoved',t.stump_removed_at is not null or coalesce(due.stump,false)) order by t.tree_index)
    from woodland_trees t left join lateral (
      select sum(e.reserved_amount)::integer as amount,bool_or(e.reserved_amount=0) as stump from deposit_extractions e
      where e.world_id=t.world_id and e.feature_id=t.feature_id and e.tree_index=t.tree_index
        and e.resource_code='wood' and e.wood_debited_at is null
        and e.completes_at<=coalesce(nullif(current_setting('arbestra.economy_through',true),'')::timestamptz,statement_timestamp())
    ) due on true
    where t.world_id=${worldId} and t.feature_id=${featureId})`;
}
export interface RawWoodlandTreeState {
  treeIndex: number;
  remainingAmount: number;
  reservedAmount: number;
  felledAt: string;
  stumpRemoved: boolean;
}
/** `{ trees }` for a deposit projection, nothing when every tree stands untouched. */
export function woodlandTreesField(raw: readonly RawWoodlandTreeState[] | null | undefined): {
  trees?: WoodlandTreeState[];
} {
  if (!raw?.length) return {};
  return {
    trees: raw.map((tree) => ({
      treeIndex: tree.treeIndex,
      remainingAmount: tree.remainingAmount,
      reservedAmount: tree.reservedAmount,
      felledAt: new Date(tree.felledAt).toISOString(),
      stumpRemoved: tree.stumpRemoved,
    })),
  };
}
/** Per-tree state of one case, for its details sheet. */
export async function readWoodlandTreeStates(tx: Transaction<Database>, worldId: string, featureId: string) {
  const row = await tx.selectNoFrom(woodlandTreeStatesSql(worldId, featureId).as('trees')).executeTakeFirstOrThrow();
  return woodlandTreesField(row.trees);
}

export interface WoodlandTrees {
  /** Every tree of the case, in the default designation order. */
  all: number[];
  /** Trees a target aims at: its own designation, or every tree. */
  designated: number[];
  records: Map<number, TreeRecord>;
}

/** Read-only. Writers hold the case lock before calling it. */
export async function readWoodlandTrees(
  tx: Transaction<Database>,
  worldId: string,
  featureId: string,
  designation?: readonly number[] | null,
): Promise<WoodlandTrees> {
  const row = await sql<{
    variantSeed: number;
    initialAmount: string | null;
    sourceKey: string | null;
    treeIndices: number[] | null;
    removedIndices: number[] | null;
    trees: Array<{ treeIndex: number; remainingAmount: number; reservedAmount: number; stumpRemoved: boolean }>;
  }>`select f.variant_seed,(select d.initial_amount from woodland_deposits d
        where d.world_id=f.world_id and d.feature_id=f.id) as initial_amount,r.source_key,r.tree_indices,r.removed_indices,
      coalesce((select jsonb_agg(jsonb_build_object('treeIndex',t.tree_index,'remainingAmount',t.remaining_amount,
        'reservedAmount',t.reserved_amount,'stumpRemoved',t.stump_removed_at is not null) order by t.tree_index)
        from woodland_trees t where t.world_id=f.world_id and t.feature_id=f.id),'[]') as trees
    from world_features f left join world_rc1_resources r on r.world_id=f.world_id and r.feature_id=f.id
    where f.world_id=${worldId} and f.id=${featureId}`.execute(tx);
  const found = row.rows[0];
  if (!found) throw new HttpError(404, 'WOODLAND_NOT_FOUND', 'Bosquet introuvable.');
  const all = woodlandTreeIndices({
    rc1:
      found.sourceKey === null
        ? null
        : {
            sourceKey: found.sourceKey,
            treeIndices: found.treeIndices ?? [],
            removedIndices: found.removedIndices ?? [],
          },
    variantSeed: found.variantSeed,
    initialAmount: found.initialAmount === null ? null : Number(found.initialAmount),
  });
  const members = new Set(all);
  return {
    all,
    designated: designation ? designation.filter((i) => members.has(i)) : all,
    records: new Map(found.trees.map((t) => [t.treeIndex, t])),
  };
}

/** Wood left on the designated trees of a case (an estimate: lots of other
 * villages due and not yet debited still count). */
export async function designatedWood(
  tx: Transaction<Database>,
  worldId: string,
  featureId: string,
  designation: readonly number[],
) {
  const trees = await readWoodlandTrees(tx, worldId, featureId, designation);
  return trees.designated.reduce((sum, index) => sum + treeWood(trees.records.get(index)).remaining, 0);
}

/** Trees whose stump a lot is removing right now, any village. */
async function stumpsInProgress(tx: Transaction<Database>, worldId: string, featureId: string) {
  const rows = await tx
    .selectFrom('depositExtractions')
    .select('treeIndex')
    .where('worldId', '=', worldId)
    .where('featureId', '=', featureId)
    .where('resourceCode', '=', 'wood')
    .where('status', '=', 'in-progress')
    .where('treeIndex', 'is not', null)
    .where('reservedAmount', '=', '0')
    .execute();
  return new Set(rows.map((r) => r.treeIndex!));
}

export type WoodWork =
  /** A lot of wood (1 to 100) on one tree, or the removal of one stump (0). */
  | { kind: 'lot'; treeIndex: number; amount: number }
  /** Wood left on the designated trees is reserved by other lots. */
  | { kind: 'wait' }
  /** Nothing left to do on the designated trees for this mode. */
  | { kind: 'done' };

/** Next work on a case: wood first, then the stumps to clear one by one: all
 * designated trees in `clear` mode; in `cut` mode, those of `clearTrees` (a
 * queued target mixing both, slice 2e). With `caseAvailable` (the case's free
 * wood, as departures check it), a lot never takes more than the case holds:
 * admission and departure share one bound, so a lot admitted is a lot that can leave. */
export async function nextWoodWork(
  tx: Transaction<Database>,
  worldId: string,
  featureId: string,
  mode: 'cut' | 'clear',
  trees: WoodlandTrees,
  caseAvailable?: number,
  clearTrees?: readonly number[] | null,
): Promise<WoodWork> {
  const lot = nextWoodLot(trees.designated, trees.records);
  if (lot) {
    if (caseAvailable === undefined) return { kind: 'lot', ...lot };
    const amount = Math.min(lot.amount, Math.floor(caseAvailable));
    return amount >= 1 ? { kind: 'lot', treeIndex: lot.treeIndex, amount } : { kind: 'wait' };
  }
  if (trees.designated.some((i) => treeWood(trees.records.get(i)).remaining > 0)) return { kind: 'wait' };
  const clearing =
    mode === 'clear'
      ? trees.designated
      : clearTrees?.length
        ? trees.designated.filter((i) => clearTrees.includes(i))
        : [];
  if (!clearing.length) return { kind: 'done' };
  const stump = nextStump(clearing, trees.records, await stumpsInProgress(tx, worldId, featureId));
  if (stump !== null) return { kind: 'lot', treeIndex: stump, amount: 0 };
  return clearing.some((i) => treeWood(trees.records.get(i)).state !== 'removed') ? { kind: 'wait' } : { kind: 'done' };
}

/** Reserves a lot on its tree and on the case. The caller holds the case lock;
 * the tree row is taken after it. The first lot fells a standing tree. */
export async function reserveWoodLot(
  tx: Transaction<Database>,
  worldId: string,
  featureId: string,
  lot: { treeIndex: number; amount: number },
  through: Date,
) {
  if (lot.amount === 0) {
    // A stump removal reserves no wood: its in-progress lot marks the stump busy.
    const stump = await tx
      .selectFrom('woodlandTrees')
      .select('treeIndex')
      .where('worldId', '=', worldId)
      .where('featureId', '=', featureId)
      .where('treeIndex', '=', lot.treeIndex)
      .where('remainingAmount', '=', 0)
      .where('reservedAmount', '=', 0)
      .where('stumpRemovedAt', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!stump) throw new Error('Woodland stump reservation invariant failed');
    return;
  }
  const tree =
    await sql`insert into woodland_trees(world_id,feature_id,tree_index,remaining_amount,reserved_amount,felled_at,updated_at)
    values(${worldId},${featureId},${lot.treeIndex},${WOOD_PER_TREE},${lot.amount},${through},${through})
    on conflict(world_id,feature_id,tree_index) do update set reserved_amount=woodland_trees.reserved_amount+excluded.reserved_amount,
      revision=woodland_trees.revision+1,updated_at=excluded.updated_at
    where woodland_trees.stump_removed_at is null
      and woodland_trees.remaining_amount-woodland_trees.reserved_amount>=excluded.reserved_amount`.execute(tx);
  if (Number(tree.numAffectedRows) !== 1) throw new Error('Woodland tree reservation invariant failed');
  const reserved = await tx
    .updateTable('woodlandDeposits')
    .set({
      reservedAmount: sql`reserved_amount + ${lot.amount}::bigint`,
      revision: sql`revision + 1`,
      updatedAt: sql`statement_timestamp()`,
    })
    .where('worldId', '=', worldId)
    .where('featureId', '=', featureId)
    .where('cleared', '=', false)
    .where(sql<boolean>`remaining_amount - reserved_amount >= ${lot.amount}::bigint`)
    .executeTakeFirst();
  if (Number(reserved.numUpdatedRows) !== 1) throw new Error('Woodland reservation invariant failed');
}

/** The owner debits its own lot at its deadline: the tree loses the wood (or its
 * stump), the case its sum, the cut counter gains the lot. A lot already folded
 * by the former shared materialization only credits its village. Clears the
 * case when its last stump is gone. The caller holds the village and case locks. */
export async function debitWoodLot(
  tx: Transaction<Database>,
  extraction: {
    worldId: string;
    featureId: string;
    id: string;
    treeIndex: number | null;
    reservedAmount: string | number;
    woodDebitedAt: Date | null;
  },
  through: Date,
) {
  if (extraction.woodDebitedAt) return;
  const { worldId, featureId } = extraction,
    amount = Number(extraction.reservedAmount);
  if (extraction.treeIndex !== null) {
    const tree = await tx
      .updateTable('woodlandTrees')
      .set(
        amount > 0
          ? {
              remainingAmount: sql`remaining_amount - ${amount}`,
              reservedAmount: sql`reserved_amount - ${amount}`,
              revision: sql`revision + 1`,
              updatedAt: through,
            }
          : { stumpRemovedAt: through, revision: sql`revision + 1`, updatedAt: through },
      )
      .where('worldId', '=', worldId)
      .where('featureId', '=', featureId)
      .where('treeIndex', '=', extraction.treeIndex)
      .where('stumpRemovedAt', 'is', null)
      .where((eb) =>
        amount > 0
          ? eb.and([eb('reservedAmount', '>=', amount), eb('remainingAmount', '>=', amount)])
          : eb.and([eb('remainingAmount', '=', 0), eb('reservedAmount', '=', 0)]),
      )
      .executeTakeFirst();
    if (Number(tree.numUpdatedRows) !== 1) throw new Error('Woodland tree debit invariant failed');
  }
  const debited = await tx
    .updateTable('woodlandDeposits')
    .set({
      remainingAmount: sql`remaining_amount - ${amount}::bigint`,
      reservedAmount: sql`reserved_amount - ${amount}::bigint`,
      cutAmount: sql`cut_amount + ${amount}::bigint`,
      revision: sql`revision + 1`,
      updatedAt: through,
    })
    .where('worldId', '=', worldId)
    .where('featureId', '=', featureId)
    .where('reservedAmount', '>=', String(amount))
    .where('remainingAmount', '>=', String(amount))
    .executeTakeFirst();
  if (Number(debited.numUpdatedRows) !== 1) throw new Error('Woodland debit invariant failed');
  await tx
    .updateTable('depositExtractions')
    .set({ woodDebitedAt: through })
    .where('worldId', '=', worldId)
    .where('id', '=', extraction.id)
    .execute();
  if (amount === 0 || extraction.treeIndex === null) await clearWhenBare(tx, worldId, featureId, through);
}

/** A case becomes buildable once no tree and no stump is left on it: it is
 * cleared, its trunks leave the navigation and its occupancy goes. */
async function clearWhenBare(tx: Transaction<Database>, worldId: string, featureId: string, through: Date) {
  const trees = await readWoodlandTrees(tx, worldId, featureId);
  if (trees.all.every((i) => treeWood(trees.records.get(i)).state === 'removed'))
    await clearCase(tx, worldId, featureId, through);
}

async function clearCase(tx: Transaction<Database>, worldId: string, featureId: string, through: Date) {
  const cleared = await tx
    .updateTable('woodlandDeposits')
    .set({ cleared: true, revision: sql`revision+1`, updatedAt: through })
    .where('worldId', '=', worldId)
    .where('featureId', '=', featureId)
    .where('cleared', '=', false)
    .executeTakeFirst();
  if (!Number(cleared.numUpdatedRows)) return;
  await tx
    .deleteFrom('worldCellOccupancies')
    .where('worldId', '=', worldId)
    .where('featureId', '=', featureId)
    .where('buildingId', 'is', null)
    .execute();
  await tx
    .updateTable('worldFeatures')
    .set({ state: 'depleted', updatedAt: sql`${through}` })
    .where('worldId', '=', worldId)
    .where('id', '=', featureId)
    .execute();
}

/** Finishes the clearing of a case already bare of trees and stumps. The caller
 * holds the village and case locks; removing a stump is a lot, not this call. */
export async function clearWoodland(tx: Transaction<Database>, worldId: string, featureId: string, through: Date) {
  const wood = await tx
    .selectFrom('woodlandDeposits')
    .select('cleared')
    .where('worldId', '=', worldId)
    .where('featureId', '=', featureId)
    .executeTakeFirst();
  if (!wood) throw new HttpError(404, 'WOODLAND_NOT_FOUND', 'Bosquet introuvable.');
  if (wood.cleared) return;
  const trees = await readWoodlandTrees(tx, worldId, featureId);
  if (!trees.all.every((i) => treeWood(trees.records.get(i)).state === 'removed'))
    throw new HttpError(
      409,
      'WOODLAND_NOT_CLEARABLE',
      'Abattez chaque arbre et retirez chaque souche avant de défricher.',
    );
  await clearCase(tx, worldId, featureId, through);
}

/** A validated construction claims a liberated woodland cell permanently. Since
 * a case stays occupied until cleared, this only settles cells freed before the
 * tree as harvest unit (docs/SPEC-BOIS-ARBRE-UNITE.md). */
export async function claimWoodlandCell(tx: Transaction<Database>, worldId: string, cellX: number, cellY: number) {
  await tx
    .updateTable('woodlandDeposits')
    .set({
      cleared: true,
      remainingAmount: sql`reserved_amount`,
      revision: sql`revision+1`,
      updatedAt: sql`statement_timestamp()`,
    })
    .where('worldId', '=', worldId)
    .where('cellX', '=', cellX)
    .where('cellY', '=', cellY)
    .where('cleared', '=', false)
    .execute();
}
