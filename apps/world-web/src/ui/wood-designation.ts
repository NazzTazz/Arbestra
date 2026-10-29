import type { HarvestIntent } from '@arbestra/contracts';
import type { Cell } from '../scene/construction-selection';

/** A tree a gesture designated: its case (and the case's cell), its server index (null: the whole case). */
export interface DesignatedTree extends Cell {
  featureId: string;
  treeIndex: number | null;
}

/**
 * Adds one tree of a wood case to a gesture's intent, in the order designated
 * (`woodTrees`, docs/SPEC-GRAMMAIRE-GESTUELLE.md §1): each tree once; a tree
 * the server cannot name stands for its whole case, which then takes no
 * designation (every tree of the case). Bounded by the contract (64 cases,
 * 256 trees a case). Returns whether the intent changed.
 */
export function designateTree(
  draft: { intent: HarvestIntent; trees?: DesignatedTree[] },
  tree: DesignatedTree,
): boolean {
  const { intent } = draft,
    id = tree.featureId,
    trees = (draft.trees ??= []);
  if (trees.some((t) => t.featureId === id && t.treeIndex === null)) return false;
  if (!intent.wood.includes(id)) {
    if (intent.wood.length >= 64) return false;
    intent.wood.push(id);
  }
  if (tree.treeIndex === null) {
    const others = (intent.woodTrees ?? []).filter((entry) => entry.featureId !== id);
    if (others.length) intent.woodTrees = others;
    else delete intent.woodTrees;
    draft.trees = [...trees.filter((t) => t.featureId !== id), { ...tree }];
    return true;
  }
  const designations = (intent.woodTrees ??= []);
  let entry = designations.find((e) => e.featureId === id);
  if (!entry) {
    if (designations.length >= 64) return false;
    designations.push((entry = { featureId: id, treeIndices: [] }));
  }
  if (entry.treeIndices.includes(tree.treeIndex) || entry.treeIndices.length >= 256) return false;
  entry.treeIndices.push(tree.treeIndex);
  trees.push({ ...tree });
  return true;
}
