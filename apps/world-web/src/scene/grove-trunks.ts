import type { NaturalFeature } from '@arbestra/contracts';
import { cellKey, type Cell } from './construction-selection';
import { groveSlots, type GroveSlot } from './grove-trees';

/** A grove trunk in the villagers' local way, in scene units. */
export interface GroveTrunk {
  featureId: string;
  /** Slot of the tree in its grove (drawn order). */
  index: number;
  x: number;
  z: number;
  radius: number;
}
export interface GroveTrunkSource {
  readonly world: { chunkSize: number };
  key(x: number, y: number): string;
  chunk(key: string): { features: NaturalFeature[] } | undefined;
  /** Changes whenever the chunk's features or deposits may have changed. */
  featureVersion(key: string): number;
  ground(x: number, y: number): { height: number } | null;
}
type Place = (
  feature: NaturalFeature,
  slot: GroveSlot,
  anchor: Cell,
  groundHeight: number,
) => {
  x: number;
  z: number;
};
type Cached = {
  version: number;
  space: number;
  features: Map<string, { signature: string; trunks: GroveTrunk[] }>;
  cells: Map<string, GroveTrunk[]>;
};
const NONE: readonly GroveTrunk[] = [];

/** What decides a grove's trunks: its trees, and which of them lost their stump. */
function trunkSignature(feature: NaturalFeature): string {
  const deposit = feature.deposit;
  return `${feature.cellX}:${feature.cellY}:${feature.rc1?.trees.length ?? -1}:${deposit?.cleared ? 1 : 0}:${(
    deposit?.trees ?? []
  )
    .filter((t) => t.stumpRemoved)
    .map((t) => t.treeIndex)
    .join(',')}`;
}

/**
 * The grove trunks that block the felling layouts and the villagers' local way
 * (docs/SPEC-BOIS-ARBRE-UNITE.md §2): a standing tree, a felled one and a
 * stump keep their trunk; a tree whose stump is removed leaves the way, as on
 * the server (slice 2e). Asked thousands of times a frame by the felling test:
 * a lookup is O(1) while its chunk is unchanged, and a chunk that changed only
 * recomputes the groves whose trees changed (AGENTS.md, Performance).
 */
export class GroveTrunkIndex {
  readonly #chunks = new Map<string, Cached>();
  /** Groves whose trunks were recomputed, for tests and diagnostics. */
  computed = 0;
  constructor(
    readonly source: GroveTrunkSource,
    private readonly place: Place,
  ) {}
  trunksAt(cell: Cell, spaceVersion: number): readonly GroveTrunk[] {
    const key = this.source.key(cell.cellX, cell.cellY),
      version = this.source.featureVersion(key);
    let cached = this.#chunks.get(key);
    if (!cached || cached.version !== version || cached.space !== spaceVersion) {
      cached = this.#refresh(key, version, spaceVersion, cached);
      this.#chunks.set(key, cached);
    }
    return cached.cells.get(cellKey(cell)) ?? NONE;
  }
  clear(): void {
    this.#chunks.clear();
  }
  #refresh(key: string, version: number, space: number, previous: Cached | undefined): Cached {
    const reuse = previous?.space === space ? previous.features : undefined,
      size = this.source.world.chunkSize,
      features = new Map<string, { signature: string; trunks: GroveTrunk[] }>(),
      cells = new Map<string, GroveTrunk[]>();
    for (const feature of this.source.chunk(key)?.features ?? []) {
      if (feature.type !== 'woodland') continue;
      const signature = trunkSignature(feature);
      let entry = reuse?.get(feature.id);
      if (entry?.signature !== signature) {
        const ground = this.source.ground(feature.cellX, feature.cellY);
        if (!ground) continue;
        this.computed++;
        const anchor = {
          cellX: Math.floor(feature.cellX / size) * size,
          cellY: Math.floor(feature.cellY / size) * size,
        };
        entry = {
          signature,
          trunks: groveSlots(feature)
            .filter((slot) => slot.state !== 'removed')
            .map((slot) => {
              const at = this.place(feature, slot, anchor, ground.height);
              return {
                featureId: feature.id,
                index: slot.index,
                x: at.x,
                z: at.z,
                radius: 0.19 * slot.tree.scale + 0.15,
              };
            }),
        };
      }
      features.set(feature.id, entry);
      const list = cells.get(cellKey(feature));
      if (list) list.push(...entry.trunks);
      else cells.set(cellKey(feature), [...entry.trunks]);
    }
    return { version, space, features, cells };
  }
}
