import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TerrainEditStep, TerrainVertex, VillageState, TravelCell } from '@arbestra/contracts';
import type { TerrainHandle } from '../scene/VillageScene';
import type { InfrastructureGesture } from '../scene/infrastructure-renderer';
import { BrushCursor, brushCells, type BrushTone } from '../scene/terraform-brush';
import { cellsAlongSegment } from '../scene/construction-selection';
import { terrainBrushHeight } from './terraform-draft';
import { LiveStroke, type LiveStrokeResult } from './terraform-live';
import { cellRefused, oraclePages, terraformObstacles, type OraclePage } from './terraform-refusals';
import './terraform.css';

/** One step of the height setting: a quarter of a cell; Shift moves a whole one. */
export const TERRAFORM_STEP = 0.25;
/** The setting after one step: no bound beyond the server's (none upwards;
 * the water refuses a height at or under the surface), on the quarter grid. */
export const steppedHeight = (height: number, steps: number) => Math.round((height + steps * TERRAFORM_STEP) * 4) / 4;

/**
 * Height brush (docs/SPEC-TERRAFORMATION-OUTIL.md): instant and free. The
 * hovered cell shows the 3 × 3 cells a stroke changes, at their future
 * heights. While the stroke is drawn, every painted cell changes the ground
 * at once and leaves for the server in small ordered batches (§7.9,
 * ui/terraform-live.ts); a change of the setting mid-stroke repaints the cell
 * under the pointer. The Oracle tells the refusals once the stroke ends. The
 * setting: − / + (Shift: a whole cell), the pipette (P) samples a cell's
 * height; Échap forgets it.
 */
export function TerraformPanel({
  state,
  scene,
  onPaint,
  onStroke,
  onRefusals,
}: {
  state: VillageState;
  scene: RefObject<TerrainHandle | null>;
  /** Painted cells of one frame, with their predicted vertex heights: predicted on the ground and sent. */
  onPaint: (paints: TerrainEditStep[], vertices: readonly TerrainVertex[]) => void;
  /** A stroke starts or ends (the server's refusals wait for its end). */
  onStroke: (active: boolean) => void;
  /** The refused cells of a stroke, told by the Oracle one error per page. */
  onRefusals: (pages: OraclePage[]) => void;
}) {
  const [target, setTarget] = useState<number | null>(null),
    [pipette, setPipette] = useState(false),
    [hint, setHint] = useState<string | null>(null);
  const stroke = useRef<{
      last: TravelCell;
      cell: TravelCell;
      anchor: TravelCell;
      height: number;
      live: LiveStroke;
    } | null>(null),
    cursor = useRef(new BrushCursor()),
    hovered = useRef<TravelCell | null>(null),
    revision = useRef(0);
  const latest = useRef({ state, target, pipette, onPaint, onStroke, onRefusals });
  latest.current = { state, target, pipette, onPaint, onStroke, onRefusals };
  /** Height of a vertex as shown: the predictions of painted cells are already on the ground. */
  const heightAt = (x: number, y: number) => scene.current?.terrainVertexHeight(x, y) ?? NaN;
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
  // New data or setting: the brush under the pointer is drawn again; mid-stroke,
  // a new height repaints the cell under the pointer.
  useEffect(() => {
    revision.current++;
    if (hovered.current) brush(hovered.current);
    if (stroke.current && target !== null && target !== stroke.current.height) {
      stroke.current.height = target;
      stroke.current.live.paint([stroke.current.cell], target);
    }
  }, [state, target, pipette]);
  /** The stroke ends: what is still waiting is applied, then the Oracle speaks. */
  const finish = () => {
    const current = stroke.current;
    stroke.current = null;
    if (!current) return;
    current.live.end((result: LiveStrokeResult) => {
      if (result.unknown) setHint('Les raccords dépassent le terrain visible. Réduisez la sélection.');
      else if (result.sent && !result.changed && !result.refusals.length)
        setHint('Le terrain est déjà à cette hauteur.');
      else setHint(null);
      // Local refusals first, then the server's that waited for the end of the stroke.
      if (result.refusals.length) latest.current.onRefusals(oraclePages(result.refusals, current.anchor));
      latest.current.onStroke(false);
    });
  };
  const start = (point: TravelCell, cell: TravelCell, height: number) => {
    finish();
    const live = new LiveStroke({
      world: latest.current.state.world,
      obstacles: () => terraformObstacles(latest.current.state),
      heightAt,
      apply: (paints, vertices) => {
        latest.current.onPaint(paints, vertices);
        // The ground under the pointer has just changed: the brush follows it.
        revision.current++;
        if (hovered.current) brush(hovered.current);
      },
      frame: (callback) => requestAnimationFrame(callback),
    });
    stroke.current = { last: point, cell, anchor: cell, height, live };
    latest.current.onStroke(true);
    live.paint([cell], height);
  };
  const gesture = useRef<(g: InfrastructureGesture) => void>(() => {});
  gesture.current = (g) => {
    if (g.kind === 'right') return;
    if (g.kind === 'cancel') {
      // What is painted stays painted; Ctrl+Z undoes the stroke once released (§7.10).
      finish();
      return;
    }
    const s = latest.current.state;
    const point = g.point ? { cellX: g.point.x / 8, cellY: g.point.y / 8 } : null;
    if (!point) {
      if (g.kind === 'hover') brush(null);
      if (g.kind === 'up') finish();
      return;
    }
    const cell = {
      cellX: Math.round(point.cellX) % s.world.widthCells,
      cellY: Math.round(point.cellY) % s.world.heightCells,
    };
    if (g.kind === 'hover' || g.kind === 'down') brush(cell);
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
      start(point, cell, height);
      return;
    }
    const current = stroke.current;
    if (!current) return;
    // Every cell crossed since the last frame, in order: each one is painted now.
    current.live.paint(cellsAlongSegment(current.last, point, s.world), current.height);
    current.last = point;
    current.cell = cell;
    if (g.kind === 'up') finish();
  };
  const adjust = (steps: number) => setTarget((t) => (t === null ? t : steppedHeight(t, steps)));
  const actions = useRef({ adjust, finish });
  actions.current = { adjust, finish };
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
          actions.current.finish();
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
      // Leaving the tool mid-stroke: what is painted stays, nothing more is applied.
      if (stroke.current) {
        stroke.current.live.stop();
        stroke.current = null;
        latest.current.onStroke(false);
      }
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
