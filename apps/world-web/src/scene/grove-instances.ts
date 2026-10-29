import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { GroveSlot, TreePiece } from './grove-trees';

/** Where a grove tree stands, in the coordinates of its chunk root (scene units). */
export interface SlotPlacement {
  x: number;
  y: number;
  z: number;
  yaw: number;
}
/** What a tree shows beyond its server state: masked while a worksite fells it, tinted while queued for clearing. */
export interface TreeLook {
  masked: boolean;
  tint: boolean;
}
/** Trees and stumps queued for clearing read slightly red (docs/SPEC-GRAMMAIRE-GESTUELLE.md §1). */
export const CLEAR_TINT: readonly [number, number, number, number] = [1.3, 0.74, 0.68, 1];
const PLAIN: readonly [number, number, number, number] = [1, 1, 1, 1];

/** One piece of the tree kit for one grove: an instance per tree using it. */
export interface GrovePiece {
  matrices: Float32Array;
  colours: Float32Array;
  /** Grove slot and server tree index of each instance, for picking. */
  slots: number[];
  trees: Array<number | null>;
  /** Instances drawing something: a piece with none is not drawn at all (no draw call). */
  shown: number;
  visible: Uint8Array;
}
type Ref = { piece: TreePiece; i: number };

/** Below this share a trunk still shows, so a felled tree with wood left is never invisible. */
const LYING_MIN = 0.12;

/**
 * The thin instances of one grove, three per tree: its trunk (upright while
 * standing, lying while felled), its foliage and its stump. A tree's state
 * shows by writing its own three instances (a hidden one is scaled to nothing
 * at the tree's foot, so the grove's bounds stay local): a change of tree
 * costs O(changed trees), never a rebuild of the grove (AGENTS.md, Performance).
 */
export class GroveInstances {
  readonly pieces = new Map<TreePiece, GrovePiece>();
  readonly #refs: Array<{ fut: Ref; feuillage: Ref; stump: Ref }> = [];
  readonly #placements: SlotPlacement[];
  readonly #applied: string[];
  #slots: readonly GroveSlot[];
  /** Tree looks written since construction, for tests and diagnostics. */
  writes = 0;
  constructor(slots: readonly GroveSlot[], placement: (slot: GroveSlot) => SlotPlacement) {
    this.#slots = slots;
    const counts = new Map<TreePiece, number>();
    const take = (piece: TreePiece): Ref => {
      const i = counts.get(piece) ?? 0;
      counts.set(piece, i + 1);
      return { piece, i };
    };
    for (const slot of slots)
      this.#refs.push({
        fut: take(`${slot.variant}-fut`),
        feuillage: take(`${slot.variant}-feuillage`),
        stump: take(slot.stumpPiece),
      });
    for (const [piece, count] of counts)
      this.pieces.set(piece, {
        matrices: new Float32Array(count * 16),
        colours: new Float32Array(count * 4),
        slots: new Array<number>(count),
        trees: new Array<number | null>(count),
        shown: 0,
        visible: new Uint8Array(count),
      });
    for (const [j, refs] of this.#refs.entries())
      for (const ref of [refs.fut, refs.feuillage, refs.stump]) {
        const piece = this.pieces.get(ref.piece)!;
        piece.slots[ref.i] = slots[j]!.index;
        piece.trees[ref.i] = slots[j]!.treeIndex;
      }
    this.#placements = slots.map(placement);
    this.#applied = slots.map(() => '');
  }
  get slots(): readonly GroveSlot[] {
    return this.#slots;
  }
  /** The look a tree is drawn with: changes exactly when one of its instances must be rewritten. */
  static key(slot: GroveSlot, look: TreeLook): string {
    return `${slot.state}:${slot.state === 'felled' ? Math.max(LYING_MIN, slot.lying).toFixed(3) : ''}:${look.masked ? 1 : 0}:${look.tint ? 1 : 0}`;
  }
  /**
   * Draws each tree whose look changed since the last call (`slots` in the
   * same drawn order as at construction, with their new server state).
   * Returns the instances touched, for partial GPU uploads.
   */
  apply(look: (slot: GroveSlot) => TreeLook, slots: readonly GroveSlot[] = this.#slots): Ref[] {
    this.#slots = slots;
    const touched: Ref[] = [];
    const scaling = new Vector3(),
      position = new Vector3(),
      turn = new Quaternion(),
      side = new Quaternion(),
      lying = new Quaternion(),
      matrix = new Matrix();
    Quaternion.RotationAxisToRef(Vector3.RightReadOnly, Math.PI / 2, side);
    const write = (ref: Ref, shown: boolean, rotation: Quaternion, colour: readonly number[]) => {
      const piece = this.pieces.get(ref.piece)!;
      // A hidden instance collapses on its tree: nothing drawn, nothing picked, bounds kept local.
      if (!shown) scaling.set(0, 0, 0);
      piece.shown += (shown ? 1 : 0) - piece.visible[ref.i]!;
      piece.visible[ref.i] = shown ? 1 : 0;
      Matrix.ComposeToRef(scaling, rotation, position, matrix);
      matrix.copyToArray(piece.matrices, ref.i * 16);
      piece.colours.set(colour, ref.i * 4);
      touched.push(ref);
    };
    for (const [j, slot] of slots.entries()) {
      const wanted = look(slot),
        key = GroveInstances.key(slot, wanted);
      if (this.#applied[j] === key) continue;
      this.#applied[j] = key;
      this.writes++;
      const at = this.#placements[j]!,
        { tree } = slot,
        refs = this.#refs[j]!,
        colour = wanted.tint ? CLEAR_TINT : PLAIN,
        standing = slot.state === 'standing',
        felled = slot.state === 'felled';
      Quaternion.RotationAxisToRef(Vector3.UpReadOnly, at.yaw, turn);
      // Trunk: upright while standing; felled, on its side and as long as its wood left.
      if (felled) {
        turn.multiplyToRef(side, lying);
        scaling.set(tree.scale, tree.heightScale * Math.max(LYING_MIN, slot.lying), tree.scale);
        position.set(at.x, at.y + 0.19 * tree.scale, at.z);
        write(refs.fut, !wanted.masked, lying, colour);
      } else {
        scaling.set(tree.scale, tree.heightScale, tree.scale);
        position.set(at.x, at.y, at.z);
        write(refs.fut, standing && !wanted.masked, turn, colour);
      }
      scaling.set(tree.scale, tree.heightScale, tree.scale);
      position.set(at.x, at.y, at.z);
      write(refs.feuillage, standing && !wanted.masked, turn, colour);
      scaling.set(tree.scale, tree.heightScale, tree.scale);
      write(refs.stump, felled || slot.state === 'stump', turn, colour);
    }
    return touched;
  }
}
