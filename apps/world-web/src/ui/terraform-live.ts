import { terrainEditUnit, vertexKey, type TerrainEditPaint, type TerrainVertex } from '@arbestra/contracts';
import { unitRefusal, type TerraformObstacles, type TerraformRefusal } from './terraform-refusals';

/**
 * A terraforming stroke drawn live (Tristan, 2 November: « c'est même pas au
 * relâchement du geste, c'est pendant le geste. Tu dessines ton terrain
 * vraiment en temps réel. », docs/SPEC-TERRAFORMATION-OUTIL.md §7.9).
 *
 * Every cell the pointer paints (and the cell under it when the setting
 * changes) is one unit, applied in painting order: refused when the client
 * sees an obstacle in its 3 × 3 (told by the Oracle once the stroke ends, the
 * gesture is never interrupted), otherwise predicted on the displayed ground
 * with the server's own calculation (`terrainEditUnit`) and handed to the send
 * queue, which keeps that order on the server (`orderedTerrainEditGestures`).
 *
 * Hot path, bounded per frame: the units painted during one frame are
 * coalesced, at most LIVE_CELLS_PER_FRAME of them are applied, with one single
 * prediction (one copy of each touched chunk); the rest waits for the next
 * frame, in order. The renderer then rebuilds the touched ground units under
 * its own per-frame budget (TerrainRenderer.queueGroundEdits).
 */
export const LIVE_CELLS_PER_FRAME = 16;
type Cell = { cellX: number; cellY: number };
export interface LiveStrokeDeps {
  world: { widthCells: number; heightCells: number };
  /** What the client sees, indexed once per village state. */
  obstacles: () => TerraformObstacles;
  /** Displayed vertex height, predictions included. */
  heightAt: (x: number, y: number) => number;
  /** The units of one frame and their predicted vertices: predicted and queued for the server. */
  apply: (paints: TerrainEditPaint[], vertices: TerrainVertex[]) => void;
  /** Next display frame (requestAnimationFrame). */
  frame: (callback: () => void) => void;
}
export interface LiveStrokeResult {
  /** Cells refused locally, one per painted cell, with the obstacle in cause. */
  refusals: TerraformRefusal[];
  /** Units sent, units that changed the displayed ground. */
  sent: number;
  changed: number;
  /** A painted cell whose ground is not loaded: not sent. */
  unknown: boolean;
}
export class LiveStroke {
  #pending: TerrainEditPaint[] = [];
  /** Cells painted since the height last changed: painting them again changes nothing. */
  #run = new Set<string>();
  #runHeight = NaN;
  #spent = false;
  #ending: ((result: LiveStrokeResult) => void) | null = null;
  #stopped = false;
  #water = false;
  readonly result: LiveStrokeResult = { refusals: [], sent: 0, changed: 0, unknown: false };
  constructor(private readonly deps: LiveStrokeDeps) {}
  /** Units waiting for a frame. */
  get pending(): number {
    return this.#pending.length;
  }
  /** The cells painted during one frame, in order, at this height: applied
   * this frame if the frame's budget allows, the next frames otherwise. */
  paint(cells: readonly Cell[], height: number): void {
    if (this.#stopped || this.#ending) return;
    const { widthCells: w, heightCells: h } = this.deps.world;
    if (height !== this.#runHeight) {
      this.#run.clear();
      this.#runHeight = height;
    }
    for (const cell of cells) {
      const c = { cellX: ((cell.cellX % w) + w) % w, cellY: ((cell.cellY % h) + h) % h },
        key = `${c.cellX}:${c.cellY}`;
      if (this.#run.has(key)) continue;
      this.#run.add(key);
      this.#pending.push({ cell: c, height });
    }
    if (this.#pending.length) this.#pump();
  }
  /** The pointer is released: the waiting units are applied over the next frames, then `done`. */
  end(done: (result: LiveStrokeResult) => void): void {
    if (this.#stopped) return;
    this.#ending = done;
    if (!this.#pending.length && !this.#spent) this.#finish();
  }
  /** The panel closes: nothing more is applied. */
  stop(): void {
    this.#stopped = true;
    this.#pending = [];
  }
  #pump(): void {
    if (this.#stopped) return;
    if (this.#spent) return;
    this.#spent = true;
    this.deps.frame(() => {
      this.#spent = false;
      if (this.#pending.length) this.#pump();
      else if (this.#ending) this.#finish();
    });
    this.#applyFrame();
  }
  #finish(): void {
    const done = this.#ending;
    this.#ending = null;
    this.#stopped = true;
    done?.(this.result);
  }
  /** One frame's work: at most LIVE_CELLS_PER_FRAME units, one prediction. */
  #applyFrame(): void {
    const batch = this.#pending.splice(0, LIVE_CELLS_PER_FRAME);
    if (!batch.length) return;
    const { world, heightAt } = this.deps,
      obstacles = this.deps.obstacles(),
      written = new Map<string, TerrainVertex>(),
      at = (x: number, y: number) => written.get(`${x}:${y}`)?.height ?? heightAt(x, y),
      accepted: TerrainEditPaint[] = [];
    for (const paint of batch) {
      // At or under the water line: one error for the stroke, as the server's LEVELING_WATER.
      if (paint.height <= 0) {
        if (!this.#water) this.result.refusals.push({ reason: 'water', cell: paint.cell });
        this.#water = true;
        continue;
      }
      const refusal = unitRefusal(obstacles, paint.cell, world);
      if (refusal) {
        this.result.refusals.push(refusal);
        continue;
      }
      let plan: ReturnType<typeof terrainEditUnit>;
      try {
        plan = terrainEditUnit(paint.cell, world, at, paint.height);
      } catch {
        this.result.unknown = true;
        continue;
      }
      accepted.push(paint);
      if (plan.volume < 1e-9) continue;
      this.result.changed++;
      for (const v of plan.vertices) written.set(vertexKey(v), v);
    }
    if (!accepted.length) return;
    this.result.sent += accepted.length;
    this.deps.apply(accepted, [...written.values()]);
  }
}
