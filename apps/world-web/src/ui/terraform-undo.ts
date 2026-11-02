import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cellVertices,
  vertexKey,
  type TerrainEditRestore,
  type TerrainEditStep,
  type TerrainVertex,
} from '@arbestra/contracts';
import { LiveStroke } from './terraform-live';
import { oraclePages, type OraclePage, type TerraformObstacles } from './terraform-refusals';
import type { TerrainEditOwner } from './terrain-edits';

/**
 * Undo of a terraforming stroke by the inverse gesture (Tristan, 2 November:
 * « Ctrl+Z en geste inverse avec un bouton "Annuler" en haut à droite, qui
 * disparaît au bout de 10 secondes. Le geste Ctrl+Z reste possible passé ce
 * délai. », docs/SPEC-TERRAFORMATION-OUTIL.md §7.10).
 *
 * Each released stroke leaves a record: the cells it painted and, for every
 * vertex its prediction wrote, the height the client showed just before (the
 * first time the stroke touched it). A cell the server refused leaves the
 * record (it changed nothing). Undoing pops the last record and sends a new
 * gesture, live like a stroke: each recorded cell back to those corner
 * heights (`terrain-restore`), predicted, sent and refused exactly as painted
 * cells are. The stack only holds touched vertices, never a chunk.
 */
export const TERRAFORM_UNDO_LIMIT = 20;
/** The « Annuler » button stays this long after a released stroke. */
export const TERRAFORM_UNDO_BUTTON_MS = 10_000;
type Cell = { cellX: number; cellY: number };
type World = { widthCells: number; heightCells: number };
const key = (c: Cell) => `${c.cellX}:${c.cellY}`;

/** One released stroke: its cells in painting order, and the heights before it. */
export class TerraformUndoRecord implements TerrainEditOwner {
  readonly cells = new Map<string, Cell>();
  readonly before = new Map<string, number>();
  /** Painted cells and their predicted vertices; `heightAt` is read before the prediction lands. */
  record(
    steps: readonly TerrainEditStep[],
    vertices: readonly TerrainVertex[],
    heightAt: (x: number, y: number) => number,
  ) {
    for (const v of vertices) {
      const k = vertexKey(v);
      if (!this.before.has(k)) this.before.set(k, heightAt(v.vertexX, v.vertexY));
    }
    for (const { cell } of steps) {
      const k = key(cell);
      // Painted again later: the cell keeps its first place.
      if (!this.cells.has(k)) this.cells.set(k, { cellX: cell.cellX, cellY: cell.cellY });
    }
  }
  /** The server refused this cell: it changed nothing, there is nothing to undo there. */
  refused(cell: Cell) {
    this.cells.delete(key(cell));
  }
  /** The inverse gesture: each cell whose corners differ from the heights
   * before the stroke, back to them; a corner the stroke did not write keeps
   * its current height. Empty when nothing is left to undo. */
  restoration(world: World, heightAt: (x: number, y: number) => number): TerrainEditRestore[] {
    const steps: TerrainEditRestore[] = [];
    for (const cell of this.cells.values()) {
      const corners = cellVertices(cell, world).map((v) => {
        const now = heightAt(v.vertexX, v.vertexY);
        return { now, then: this.before.get(vertexKey(v)) ?? now };
      });
      if (corners.some((c) => !Number.isFinite(c.now) || !Number.isFinite(c.then))) continue;
      if (corners.every((c) => Math.abs(c.now - c.then) < 1e-9)) continue;
      steps.push({ cell, corners: corners.map((c) => c.then) });
    }
    return steps;
  }
}

/** The village's undo stack, in memory, at most TERRAFORM_UNDO_LIMIT strokes. */
export class TerraformUndoStack {
  #strokes: TerraformUndoRecord[] = [];
  #current: TerraformUndoRecord | null = null;
  constructor(private readonly limit = TERRAFORM_UNDO_LIMIT) {}
  get size() {
    return this.#strokes.length;
  }
  /** The stroke being drawn, null between strokes. */
  get current() {
    return this.#current;
  }
  begin(): TerraformUndoRecord {
    return (this.#current = new TerraformUndoRecord());
  }
  /** The stroke is released: kept when it painted something; true then. */
  end(): boolean {
    const record = this.#current;
    this.#current = null;
    if (!record?.cells.size) return false;
    this.#strokes.push(record);
    if (this.#strokes.length > this.limit) this.#strokes.shift();
    return true;
  }
  /** The last released stroke, taken off the stack. */
  pop(): TerraformUndoRecord | null {
    return this.#strokes.pop() ?? null;
  }
  clear() {
    this.#strokes = [];
    this.#current = null;
  }
}

/** Ctrl+Z (Cmd+Z), outside text fields and dialogs. */
export function isUndoKey(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target'>,
) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z')
    return false;
  if (typeof Element === 'undefined') return true;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="alertdialog"],dialog')
  )
    return false;
  const focused = document.activeElement;
  return !(focused instanceof Element && focused.closest('[role="dialog"],[role="alertdialog"],dialog'));
}

export interface TerraformUndoDeps {
  /** Village shown: Ctrl+Z listens. */
  enabled: boolean;
  villageKey: string;
  world: World | null;
  heightAt: (x: number, y: number) => number;
  obstacles: () => TerraformObstacles | null;
  /** The live queue (useTerrainEdits). */
  add: (steps: TerrainEditStep[], vertices: readonly TerrainVertex[], owner?: TerrainEditOwner) => void;
  stroke: (active: boolean) => void;
  onRefusals: (pages: OraclePage[]) => void;
  onNotice: (message: string, tone?: 'default' | 'warning') => void;
}

/**
 * The App's undo: wraps the panel's strokes to record them, listens to
 * Ctrl+Z, and gives the deadline of the « Annuler » button (restarted by
 * each released stroke, gone after TERRAFORM_UNDO_BUTTON_MS or once used).
 */
export function useTerraformUndo(deps: TerraformUndoDeps) {
  const latest = useRef(deps);
  latest.current = deps;
  const stack = useRef(new TerraformUndoStack());
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    stack.current.clear();
    setDeadline(null);
  }, [deps.villageKey]);
  useEffect(() => {
    if (deadline === null) return;
    const timer = window.setTimeout(() => setDeadline(null), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [deadline]);
  /** The panel's frames: recorded, then predicted and queued. */
  const add = useCallback((steps: TerrainEditStep[], vertices: readonly TerrainVertex[]) => {
    const record = stack.current.current;
    record?.record(steps, vertices, latest.current.heightAt);
    latest.current.add(steps, vertices, record ?? undefined);
  }, []);
  /** The panel's strokes: a released stroke that painted something can be undone. */
  const stroke = useCallback((active: boolean) => {
    if (active) stack.current.begin();
    else if (stack.current.end()) setDeadline(Date.now() + TERRAFORM_UNDO_BUTTON_MS);
    latest.current.stroke(active);
  }, []);
  /** The inverse gesture of the last released stroke, live. */
  const undo = useCallback(() => {
    const d = latest.current,
      known = d.obstacles();
    setDeadline(null);
    if (!d.world || !known || stack.current.current) return;
    const record = stack.current.pop();
    if (!record) {
      d.onNotice('Aucun trait de terraformation à annuler.');
      return;
    }
    const steps = record.restoration(d.world, d.heightAt);
    if (!steps.length) {
      d.onNotice('Ce trait n’a plus rien à annuler.');
      return;
    }
    const live = new LiveStroke({
      world: d.world,
      obstacles: () => latest.current.obstacles() ?? known,
      heightAt: (x, y) => latest.current.heightAt(x, y),
      apply: (applied, vertices) => latest.current.add(applied, vertices),
      frame: (callback) => requestAnimationFrame(callback),
    });
    d.stroke(true);
    live.restore(steps);
    live.end((result) => {
      if (result.unknown) latest.current.onNotice('Une partie du trait est hors du terrain visible.', 'warning');
      if (result.refusals.length) latest.current.onRefusals(oraclePages(result.refusals, steps[0]!.cell));
      latest.current.stroke(false);
    });
  }, []);
  useEffect(() => {
    if (!deps.enabled) return;
    const key = (event: KeyboardEvent) => {
      if (!isUndoKey(event)) return;
      event.preventDefault();
      // Not while a stroke is drawn: the undo is of a released stroke.
      if (stack.current.current) return;
      undo();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [deps.enabled, undo]);
  return { add, stroke, undo, deadline };
}
