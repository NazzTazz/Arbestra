import type { VillageState } from '@arbestra/contracts';

/**
 * The village's wood queue as the server exposes it (docs/SPEC-GRAMMAIRE-GESTUELLE.md
 * §3): pending targets of its wood worksites, the common pool first of all.
 * `treeIndices` lists the trees queued (null: every tree of the case);
 * `clearTreeIndices` those queued for clearing; a worksite in `clear` mode
 * clears all of its designated trees. Pure: the scene and the panels read it.
 */
export interface WoodCaseQueue {
  featureId: string;
  cellX: number;
  cellY: number;
  /** Every tree of the case is queued (its wood at least). */
  all: boolean;
  /** Trees queued, in their order (empty when `all`). */
  trees: number[];
  /** Every queued tree is to be cleared. */
  clearAll: boolean;
  /** Trees queued for clearing (empty when `clearAll`). */
  clear: number[];
  /** Changes whenever what this case shows changes. */
  signature: string;
}
export type WoodQueue = ReadonlyMap<string, WoodCaseQueue>;
type Worksite = VillageState['village']['worksites'][number];

/** Builds the queue of a village from its worksites: O(targets). */
export function woodQueue(worksites: readonly Worksite[] | undefined): Map<string, WoodCaseQueue> {
  const queue = new Map<string, WoodCaseQueue>();
  for (const site of worksites ?? []) {
    if (site.resourceCode !== 'wood') continue;
    // A worksite of its own that stops or ends takes nothing more from its targets;
    // the common pool keeps them whatever its owner's state.
    if (!site.poolResource && site.status !== 'running' && site.status !== 'paused') continue;
    for (const target of site.targets) {
      if (target.status !== 'pending') continue;
      const entry = queue.get(target.featureId) ?? {
        featureId: target.featureId,
        cellX: target.cellX,
        cellY: target.cellY,
        all: false,
        trees: [],
        clearAll: false,
        clear: [],
        signature: '',
      };
      const designated = target.treeIndices ?? null;
      if (designated === null) entry.all = true;
      else for (const index of designated) if (!entry.trees.includes(index)) entry.trees.push(index);
      if (site.mode === 'clear') {
        if (designated === null) entry.clearAll = true;
        else for (const index of designated) if (!entry.clear.includes(index)) entry.clear.push(index);
      } else
        for (const index of target.clearTreeIndices ?? []) if (!entry.clear.includes(index)) entry.clear.push(index);
      queue.set(target.featureId, entry);
    }
  }
  for (const entry of queue.values()) {
    if (entry.all) entry.trees = [];
    if (entry.clearAll) entry.clear = [];
    entry.signature = `${entry.all ? '*' : entry.trees.join(',')}|${entry.clearAll ? '*' : entry.clear.join(',')}`;
  }
  return queue;
}

/** What a queued tree is waiting for: its wood (`cut`), also its stump (`clear`), or nothing. */
export function queuedMode(queue: WoodQueue, featureId: string, treeIndex: number | null): 'cut' | 'clear' | null {
  const entry = queue.get(featureId);
  if (!entry) return null;
  if (treeIndex === null) return entry.all ? (entry.clearAll ? 'clear' : 'cut') : null;
  const queued = entry.all || entry.trees.includes(treeIndex);
  if (!queued && !entry.clear.includes(treeIndex)) return null;
  return entry.clearAll || entry.clear.includes(treeIndex) ? 'clear' : 'cut';
}

/** Cases whose queue changed between two readings: only their groves are redrawn. */
export function changedCases(previous: WoodQueue, next: WoodQueue): string[] {
  const changed: string[] = [];
  for (const [id, entry] of next) if (previous.get(id)?.signature !== entry.signature) changed.push(id);
  for (const id of previous.keys()) if (!next.has(id)) changed.push(id);
  return changed;
}

/** Counts of a worksite's pending wood targets, for the Chantier panel. */
export function woodQueueCounts(site: Pick<Worksite, 'mode' | 'targets' | 'resourceCode'>): {
  cut: number;
  clear: number;
  wholeCases: number;
} {
  let cut = 0,
    clear = 0,
    wholeCases = 0;
  if (site.resourceCode !== 'wood') return { cut, clear, wholeCases };
  for (const target of site.targets) {
    if (target.status !== 'pending') continue;
    const trees = target.treeIndices ?? null;
    if (trees === null) {
      wholeCases++;
      continue;
    }
    const clearing = site.mode === 'clear' ? trees : (target.clearTreeIndices ?? []);
    const cleared = new Set(clearing);
    clear += cleared.size;
    cut += trees.filter((index) => !cleared.has(index)).length;
  }
  return { cut, clear, wholeCases };
}
