import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  MAX_TERRAFORM_CELLS,
  type TerrainEditGesture,
  type TerrainVertex,
  type TerraformRequest,
  type VillageState,
  type TravelCell,
} from '@arbestra/contracts';
import type { TerrainHandle } from '../scene/VillageScene';
import type { InfrastructureGesture } from '../scene/infrastructure-renderer';
import type { TerraformVisual } from '../scene/terraform-preview';
import { BrushCursor, brushCells, type BrushTone } from '../scene/terraform-brush';
import { cellsAlongSegment, cellKey } from '../scene/construction-selection';
import { localStroke, terrainBrushHeight, terraformSelectionVisual } from './terraform-draft';
import { cellRefused, oraclePages, terraformObstacles, type OraclePage } from './terraform-refusals';
import './terraform.css';

type Draft = { anchor: TravelCell; cells: TravelCell[]; height: number };
/** One step of the height setting: a quarter of a cell; Shift moves a whole one. */
export const TERRAFORM_STEP = 0.25;
/** The setting after one step: no bound beyond the server's (none upwards;
 * the water refuses a height at or under the surface), on the quarter grid. */
export const steppedHeight = (height: number, steps: number) => Math.round((height + steps * TERRAFORM_STEP) * 4) / 4;

/**
 * Height brush (docs/SPEC-TERRAFORMATION-OUTIL.md): instant and free. The
 * hovered cell shows the 3 × 3 cells a stroke changes, at their future
 * heights. A released stroke is sent at once without its cells the client
 * sees refused, and predicted on the ground (§7); the Oracle tells each
 * refusal. The setting: − / + (Shift: a whole cell), the pipette (P) samples
 * a cell's height; Échap forgets it.
 */
export function TerraformPanel({
  state,
  scene,
  onGesture,
  onDraft,
  onRefusals,
}: {
  state: VillageState;
  scene: RefObject<TerrainHandle | null>;
  /** Sends a stroke at once and predicts its vertex heights on the ground. */
  onGesture: (gesture: TerrainEditGesture, vertices: readonly TerrainVertex[]) => boolean;
  /** The stroke being painted, shown over the ground. */
  onDraft: (visual: TerraformVisual | null) => void;
  /** The refused cells of a stroke, told by the Oracle one error per page. */
  onRefusals: (pages: OraclePage[]) => void;
}) {
  const [target, setTarget] = useState<number | null>(null),
    [pipette, setPipette] = useState(false),
    [hint, setHint] = useState<string | null>(null);
  const draft = useRef<Draft | null>(null),
    stroke = useRef<{ last: TravelCell } | null>(null),
    cursor = useRef(new BrushCursor()),
    hovered = useRef<TravelCell | null>(null),
    revision = useRef(0);
  const latest = useRef({ state, target, pipette, onGesture, onDraft, onRefusals });
  latest.current = { state, target, pipette, onGesture, onDraft, onRefusals };
  /** Height of a vertex as shown: the predictions of strokes sent are already on the ground. */
  const heightAt = (x: number, y: number) => scene.current?.terrainVertexHeight(x, y) ?? NaN;
  const request = (d: Draft): TerraformRequest => ({
    buildingType: 'terrain',
    anchor: d.anchor,
    quarterTurns: 0,
    cells: d.cells,
    height: d.height,
    workerCount: 1,
  });
  const show = (d: Draft | null) => {
    draft.current = d;
    latest.current.onDraft(d ? terraformSelectionVisual(request(d), latest.current.state.world, heightAt) : null);
  };
  /** The brush on `cell`: redrawn only when the cell, the setting or the data change. */
  const brush = (cell: TravelCell | null) => {
    hovered.current = cell;
    if (!cell) {
      cursor.current.reset();
      scene.current?.terraformBrush(null);
      return;
    }
    const { state: s, target: t, pipette: sampling } = latest.current,
      height = sampling ? null : t;
    const drawn = cursor.current.update(cell, height, revision.current, s.world, heightAt);
    if (drawn === 'same') return;
    if (drawn === 'missing') {
      scene.current?.terraformBrush(null);
      return;
    }
    const obstacles = terraformObstacles(s);
    const tone: BrushTone = sampling
      ? 'pipette'
      : (height !== null && height <= 0) || brushCells(cell, s.world).some((c) => cellRefused(obstacles, c))
        ? 'refused'
        : 'paint';
    scene.current?.terraformBrush({ cell, heights: cursor.current.heights, tone });
  };
  // New data or setting: the brush under the pointer is drawn again.
  useEffect(() => {
    revision.current++;
    if (hovered.current) brush(hovered.current);
  }, [state, target, pipette]);
  const release = () => {
    const d = draft.current;
    stroke.current = null;
    show(null);
    if (!d) return;
    let checked: ReturnType<typeof localStroke>;
    try {
      checked = localStroke(latest.current.state, d, heightAt);
    } catch {
      setHint('Les raccords dépassent le terrain visible. Réduisez la sélection.');
      return;
    }
    setHint(checked.hint);
    // The refused cells are withdrawn and told; the rest leaves now.
    if (checked.refusals.length) latest.current.onRefusals(oraclePages(checked.refusals, d.anchor));
    if (!checked.gesture) return;
    latest.current.onGesture(checked.gesture, checked.vertices);
    // The ground under the pointer has just changed: the brush follows it.
    revision.current++;
    if (hovered.current) brush(hovered.current);
  };
  const gesture = useRef<(g: InfrastructureGesture) => void>(() => {});
  gesture.current = (g) => {
    if (g.kind === 'right') return;
    if (g.kind === 'cancel') {
      stroke.current = null;
      show(null);
      return;
    }
    const point = g.point
      ? { cellX: g.point.x / 8, cellY: g.point.y / 8 }
      : g.kind === 'up'
        ? stroke.current?.last
        : null;
    const s = latest.current.state;
    if (!point) {
      if (g.kind === 'hover') brush(null);
      return;
    }
    const cell = {
      cellX: Math.round(point.cellX) % s.world.widthCells,
      cellY: Math.round(point.cellY) % s.world.heightCells,
    };
    if (g.kind === 'hover' || g.kind === 'down') brush(cell);
    if (g.kind === 'hover' && !stroke.current) return;
    if (g.kind === 'down') {
      // The cell's own height: the pipette's sample, or the first stroke's.
      const sampled = terrainBrushHeight(s, cell.cellX, cell.cellY, heightAt);
      if (latest.current.pipette) {
        if (!Number.isFinite(sampled)) setHint('Sélectionnez une case de terrain visible.');
        else {
          setTarget(sampled);
          setHint(null);
        }
        setPipette(false);
        return;
      }
      const height = latest.current.target ?? sampled;
      if (!Number.isFinite(height)) {
        setHint('Sélectionnez une case de terrain visible.');
        return;
      }
      setTarget(height);
      stroke.current = { last: point };
      show({ anchor: cell, cells: [cell], height });
    }
    const current = draft.current;
    if (!current || !stroke.current) return;
    const cells = new Map(current.cells.map((c) => [cellKey(c), c]));
    for (const c of [cell, ...cellsAlongSegment(stroke.current.last, point, s.world)]) cells.set(cellKey(c), c);
    if (cells.size > MAX_TERRAFORM_CELLS) {
      setHint(`Limite de ${MAX_TERRAFORM_CELLS} cases par trait.`);
      if (g.kind === 'up') release();
      return;
    }
    stroke.current.last = point;
    if (cells.size !== current.cells.length) show({ ...current, cells: [...cells.values()] });
    if (g.kind === 'up') release();
  };
  const adjust = (steps: number) => setTarget((t) => (t === null ? t : steppedHeight(t, steps)));
  const actions = useRef({ adjust });
  actions.current = { adjust };
  useEffect(() => {
    let frame = 0,
      stopped = false;
    const register = () => {
      if (stopped) return;
      if (scene.current?.ready()) scene.current.infrastructureTool((g) => gesture.current(g));
      else frame = requestAnimationFrame(register);
    };
    frame = requestAnimationFrame(register);
    const key = (e: KeyboardEvent) => {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable="true"]'))
      )
        return;
      if (['ArrowUp', 'ArrowDown', '+', '-', '=', '_', 'Escape', 'p', 'P'].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape') {
          stroke.current = null;
          show(null);
          setTarget(null);
          setPipette(false);
          setHint(null);
        } else if (e.key === 'p' || e.key === 'P') setPipette((p) => !p);
        else actions.current.adjust((['ArrowUp', '+', '='].includes(e.key) ? 1 : -1) * (e.shiftKey ? 4 : 1));
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      scene.current?.infrastructureTool(null);
      scene.current?.terraformBrush(null);
      latest.current.onDraft(null);
      window.removeEventListener('keydown', key, true);
    };
  }, [scene]);
  const step = (direction: 1 | -1) => (e: { shiftKey: boolean }) => adjust(direction * (e.shiftKey ? 4 : 1));
  return (
    <>
      <div className="terraform-toolbar" role="toolbar" aria-label="Pinceau de hauteur">
        <div className="terraform-title">
          <strong>Terraformation</strong>
          <small>
            {pipette
              ? 'Cliquez une case pour prélever son altitude'
              : target === null
                ? 'Glissez sur le sol pour prélever sa hauteur, ou utilisez la pipette'
                : 'Peignez à cette hauteur · gratuit et immédiat · Échap : oublier la hauteur'}
          </small>
        </div>
        <div className="terraform-altitude" role="group" aria-label="Altitude visée">
          <button
            type="button"
            aria-label="Baisser la hauteur cible"
            aria-keyshortcuts="ArrowDown Shift+ArrowDown"
            title="Baisser d’un quart de case (Maj : d’une case)"
            disabled={target === null}
            onClick={step(-1)}
          >
            −
          </button>
          <output aria-label="Hauteur cible" aria-live="polite">
            <span>Altitude</span>
            {target === null ? '—' : target.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
          </output>
          <button
            type="button"
            aria-label="Monter la hauteur cible"
            aria-keyshortcuts="ArrowUp Shift+ArrowUp"
            title="Monter d’un quart de case (Maj : d’une case)"
            disabled={target === null}
            onClick={step(1)}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="terraform-pipette"
          aria-pressed={pipette}
          aria-keyshortcuts="P"
          title="Pipette : prélever l’altitude d’une case (P)"
          onClick={() => setPipette((p) => !p)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
            <path
              d="M14.5 3.5l6 6-2.2 2.2-1.4-1.4-7.6 7.6-3.4.8-1.6 1.6-1.4-1.4 1.6-1.6.8-3.4 7.6-7.6-1.4-1.4z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          <span>Pipette</span>
        </button>
        <small className="terraform-keys">¼ de case · Maj : 1 case · ↑ ↓ · P</small>
      </div>
      {hint && (
        <p className="terraform-hint" role="status">
          {hint}
        </p>
      )}
    </>
  );
}
