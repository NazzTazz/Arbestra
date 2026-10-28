/** The tree as the wood harvest unit (docs/SPEC-BOIS-ARBRE-UNITE.md):
 * shared rules of the server economy and of the grove rendering. */

/** Wood of a standing tree, as fixed by the RC1 doc. */
export const WOOD_PER_TREE = 500;
/** Wood carried by one lot: a standing tree makes five. */
export const WOOD_LOT = 100;
/** No tree is ever added closer than this to a building, road or terrace. */
export const ADDED_TREE_MARGIN_CELLS = 2;

export type TreeState = 'standing' | 'felled' | 'stump' | 'removed';
/** A tree's row; absent while it stands untouched. */
export interface TreeRecord {
  treeIndex: number;
  remainingAmount: number;
  reservedAmount: number;
  stumpRemoved: boolean;
}

export function treeWood(record: TreeRecord | undefined): {
  state: TreeState;
  remaining: number;
  reserved: number;
  available: number;
} {
  if (!record) return { state: 'standing', remaining: WOOD_PER_TREE, reserved: 0, available: WOOD_PER_TREE };
  const state: TreeState = record.stumpRemoved ? 'removed' : record.remainingAmount > 0 ? 'felled' : 'stump';
  return {
    state,
    remaining: record.remainingAmount,
    reserved: record.reservedAmount,
    available: Math.max(0, record.remainingAmount - record.reservedAmount),
  };
}

/** Trees of a cell in their RC1 order, without those removed at installation. */
export function cellTreeIndices(treeIndices: readonly number[], removedIndices: readonly number[]): number[] {
  const removed = new Set(removedIndices);
  return treeIndices.filter((index) => !removed.has(index));
}

/** Trees of a wood cell in a world without RC1 forest: 2 to 5, stable per cell. */
export function generatedTreeCount(variantSeed: number): number {
  return 2 + (Math.abs(Math.trunc(variantSeed)) % 4);
}

/** Trees of such a cell once it holds wood: 500 per tree. The conversion of an
 * existing world keeps the former count beside buildings, roads and terraces
 * (no tree added there), so the stored wood, not the seed, gives the count. */
export function proceduralTreeCount(feature: { variantSeed: number; initialAmount?: number | null }): number {
  return feature.initialAmount && feature.initialAmount > 0
    ? Math.max(1, Math.round(feature.initialAmount / WOOD_PER_TREE))
    : generatedTreeCount(feature.variantSeed);
}

/** Trees of a starter supplement (RC1 doc: two groves of three trees), drawn
 * by the historical layout around the cell. */
export const STARTER_TREE_COUNT = 3;

/** Every tree of a wood cell, in the default designation order: the RC1 trees
 * of the cell without those removed at installation; the three historical trees
 * of a starter supplement; 0 to N−1 in a world without RC1 forest (N from its
 * stored wood, else from its seed). Another RC1
 * cell without any tree has none. */
export function woodlandTreeIndices(input: {
  rc1: { sourceKey: string; treeIndices: readonly number[]; removedIndices: readonly number[] } | null;
  variantSeed: number;
  initialAmount?: number | null;
}): number[] {
  if (!input.rc1) return Array.from({ length: proceduralTreeCount(input) }, (_, i) => i);
  if (input.rc1.sourceKey.startsWith('starter:') && !input.rc1.treeIndices.length)
    return Array.from({ length: STARTER_TREE_COUNT }, (_, i) => i);
  return cellTreeIndices(input.rc1.treeIndices, input.rc1.removedIndices);
}

/** Next lot on the designated trees, in their order: the first with wood
 * available takes up to one lot; null when nothing is left to reserve. */
export function nextWoodLot(
  designated: readonly number[],
  records: ReadonlyMap<number, TreeRecord>,
): { treeIndex: number; amount: number } | null {
  for (const treeIndex of designated) {
    const { available } = treeWood(records.get(treeIndex));
    if (available >= 1) return { treeIndex, amount: Math.min(WOOD_LOT, available) };
  }
  return null;
}

/** Next stump to remove when clearing, in the designated order: a tree cut to
 * nothing, without reservation, its stump still there and not already being
 * removed (`busy`). Null when no stump is free. */
export function nextStump(
  designated: readonly number[],
  records: ReadonlyMap<number, TreeRecord>,
  busy: ReadonlySet<number>,
): number | null {
  for (const treeIndex of designated)
    if (
      treeWood(records.get(treeIndex)).state === 'stump' &&
      !records.get(treeIndex)!.reservedAmount &&
      !busy.has(treeIndex)
    )
      return treeIndex;
  return null;
}

/** Converts a grove of the former cell-wide stock: the share already cut
 * becomes stumps and one trunk on the ground, in the cell's tree order (a cell
 * half cut keeps half its trees standing). Former regrowth is abandoned. The
 * cut counter is recounted in trees of 500. */
export function convertCutGrove(input: { initialAmount: number; cutAmount: number; trees: readonly number[] }): {
  records: TreeRecord[];
  cutAmount: number;
} {
  const count = input.trees.length;
  if (!count || input.initialAmount <= 0) return { records: [], cutAmount: 0 };
  const share = Math.min(1, Math.max(0, input.cutAmount / input.initialAmount)) * count,
    stumps = Math.min(count, Math.floor(share + 1e-9)),
    entamed = share - stumps;
  const records: TreeRecord[] = input.trees
    .slice(0, stumps)
    .map((treeIndex) => ({ treeIndex, remainingAmount: 0, reservedAmount: 0, stumpRemoved: false }));
  let cut = stumps * WOOD_PER_TREE;
  if (stumps < count && entamed > 1e-9) {
    const remaining = Math.round(WOOD_PER_TREE * (1 - entamed));
    if (remaining < WOOD_PER_TREE) {
      records.push({
        treeIndex: input.trees[stumps]!,
        remainingAmount: remaining,
        reservedAmount: 0,
        stumpRemoved: false,
      });
      cut += WOOD_PER_TREE - remaining;
    }
  }
  return { records, cutAmount: cut };
}
