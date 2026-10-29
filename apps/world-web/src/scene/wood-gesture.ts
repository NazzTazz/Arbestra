/**
 * Pieces of the Exploitation gesture grammar (docs/SPEC-GRAMMAIRE-GESTUELLE.md
 * §1-§2) added to the existing harvest swipe, without a new interpreter: the
 * long press that switches cutting and clearing, and the trees a swipe
 * crosses between two pointer samples. Pure, so the scene's hot paths stay
 * bounded and testable.
 */

/** A primary press held this long inside its dead zone switches the mode. */
export const LONG_PRESS_MS = 450;
/** Screen pixels a press may drift and still be a press (the tap threshold). */
export const LONG_PRESS_DEAD_ZONE = 8;

/**
 * One press of the harvest gesture. A finger held still sends no event, so the
 * scene polls it once per frame (O(1)). Until the press leaves its dead zone or
 * is released, nothing is designated: a long press designates nothing.
 */
export class LongPress {
  #x = 0;
  #y = 0;
  #at = 0;
  /** `held`: a press that can no longer switch (disarmed), still a tap or a swipe. */
  #state: 'idle' | 'pressed' | 'held' | 'moved' | 'fired' = 'idle';
  start(x: number, y: number, at: number): void {
    this.#x = x;
    this.#y = y;
    this.#at = at;
    this.#state = 'pressed';
  }
  /** True once the press leaves its dead zone: the gesture becomes a swipe. */
  move(x: number, y: number): boolean {
    if (
      (this.#state === 'pressed' || this.#state === 'held') &&
      Math.hypot(x - this.#x, y - this.#y) >= LONG_PRESS_DEAD_ZONE
    )
      this.#state = 'moved';
    return this.#state === 'moved';
  }
  /** Polled once a frame: true exactly once, when the press has been held long enough. */
  poll(at: number): boolean {
    if (this.#state !== 'pressed' || at - this.#at < LONG_PRESS_MS) return false;
    this.#state = 'fired';
    return true;
  }
  /** The long press did not apply (no wood tool): the press goes on as a tap or a swipe. */
  disarm(): void {
    if (this.#state === 'pressed' || this.#state === 'fired') this.#state = 'held';
  }
  /** The press switched the mode: the rest of the gesture designates nothing. */
  get fired(): boolean {
    return this.#state === 'fired';
  }
  /** The press became a swipe. */
  get moved(): boolean {
    return this.#state === 'moved';
  }
  /** Still a press: not moved, not fired. */
  get pressed(): boolean {
    return this.#state === 'pressed' || this.#state === 'held';
  }
  end(): void {
    this.#state = 'idle';
  }
}

/** A designatable tree: its case, its server index (null: the case as a whole) and its foot, in cells. */
export interface GestureTree {
  featureId: string;
  treeIndex: number | null;
  /** Drawn order in its grove, unique per case even without a server index. */
  slot: number;
  x: number;
  y: number;
}

const wrap = (d: number, size: number) => d - Math.round(d / size) * size;

/**
 * Trees whose foot lies within `reach` cells of the swipe segment from `from`
 * to `to` (cell coordinates, on the torus), in the order the swipe meets them.
 * `candidates` are the trees of the cells along the segment and their
 * neighbours (an index lookup): the work is O(those trees).
 */
/**
 * Reach of a swipe around a tree's foot, in cells: under half the closest
 * spacing of a grove's trees (0.2), so a tap that slips a few pixels over a
 * dense grove takes the tree it meant, not its neighbours (Tristan, 29 October:
 * a starter grove gave three trees to one touch at 0.35). The instance under
 * the pointer stays the main designation; the foot reach catches low stumps.
 */
export const WOOD_FOOT_REACH = 0.15;

export function treesAlongSegment(
  from: { cellX: number; cellY: number },
  to: { cellX: number; cellY: number },
  candidates: Iterable<GestureTree>,
  world: { widthCells: number; heightCells: number },
  reach = WOOD_FOOT_REACH,
): GestureTree[] {
  const dx = wrap(to.cellX - from.cellX, world.widthCells),
    dy = wrap(to.cellY - from.cellY, world.heightCells),
    length2 = dx * dx + dy * dy;
  const met: Array<{ tree: GestureTree; t: number; d: number }> = [];
  for (const tree of candidates) {
    const px = wrap(tree.x - from.cellX, world.widthCells),
      py = wrap(tree.y - from.cellY, world.heightCells);
    const t = length2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0;
    const d = Math.hypot(px - dx * t, py - dy * t);
    if (d <= reach) met.push({ tree, t, d });
  }
  // In the order met; at one point (a still pointer), the nearest foot first.
  return met.sort((a, b) => a.t - b.t || a.d - b.d).map((m) => m.tree);
}
