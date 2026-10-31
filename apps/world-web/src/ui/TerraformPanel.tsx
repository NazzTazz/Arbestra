import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  MAX_TERRAFORM_CELLS,
  type TerrainEditGesture,
  type TerraformRequest,
  type VillageState,
  type TravelCell,
} from '@arbestra/contracts';
import type { TerrainHandle } from '../scene/VillageScene';
import type { InfrastructureGesture } from '../scene/infrastructure-renderer';
import type { TerraformVisual } from '../scene/terraform-preview';
import { cellsAlongSegment, cellKey } from '../scene/construction-selection';
import { localTerraform, terrainBrushHeight, terraformSelectionVisual } from './terraform-draft';
import './terraform.css';

type Draft = { anchor: TravelCell; cells: TravelCell[]; height: number };
/**
 * Height brush (docs/SPEC-TERRAFORMATION-INSTANTANEE.md): instant and free, no
 * workers, no quote, no confirmation. A released stroke, valid locally, joins
 * the App's waiting batch; the first stroke samples the ground's height, the
 * next ones keep it (↑ ↓ to change it, Échap to sample again).
 */
export function TerraformPanel({
  state,
  scene,
  onGesture,
  onDraft,
}: {
  state: VillageState;
  scene: RefObject<TerrainHandle | null>;
  /** Appends a gesture to the waiting batch; false when it could not join. */
  onGesture: (gesture: TerrainEditGesture, visual: TerraformVisual) => boolean;
  /** The stroke being painted, shown with the waiting batch. */
  onDraft: (visual: TerraformVisual | null) => void;
}) {
  const [target, setTarget] = useState<number | null>(null),
    [error, setError] = useState<string | null>(null);
  const draft = useRef<Draft | null>(null),
    stroke = useRef<{ last: TravelCell } | null>(null);
  const latest = useRef({ state, target, onGesture, onDraft });
  latest.current = { state, target, onGesture, onDraft };
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
  const release = () => {
    const d = draft.current;
    stroke.current = null;
    show(null);
    if (!d) return;
    let checked: ReturnType<typeof localTerraform>;
    try {
      checked = localTerraform(latest.current.state, request(d), heightAt);
    } catch {
      setError('Les raccords dépassent le terrain visible. Réduisez la sélection.');
      return;
    }
    if (checked.error) {
      setError(checked.error);
      return;
    }
    setError(null);
    latest.current.onGesture(
      { buildingType: 'terrain', anchor: d.anchor, cells: d.cells, height: d.height },
      checked.visual,
    );
  };
  const gesture = useRef<(g: InfrastructureGesture) => void>(() => {});
  gesture.current = (g) => {
    if (g.kind === 'right') return;
    if (g.kind === 'cancel') {
      stroke.current = null;
      show(null);
      return;
    }
    if (g.kind === 'hover' && !stroke.current) return;
    const point = g.point
      ? { cellX: g.point.x / 8, cellY: g.point.y / 8 }
      : g.kind === 'up'
        ? stroke.current?.last
        : null;
    if (!point) return;
    const s = latest.current.state;
    const cell = {
      cellX: Math.round(point.cellX) % s.world.widthCells,
      cellY: Math.round(point.cellY) % s.world.heightCells,
    };
    if (g.kind === 'down') {
      const height = latest.current.target ?? terrainBrushHeight(s, point.cellX, point.cellY, heightAt);
      if (!Number.isFinite(height)) {
        setError('Sélectionnez une case de terrain visible.');
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
      setError(`Limite de ${MAX_TERRAFORM_CELLS} cases par trait.`);
      if (g.kind === 'up') release();
      return;
    }
    stroke.current.last = point;
    if (cells.size !== current.cells.length) show({ ...current, cells: [...cells.values()] });
    if (g.kind === 'up') release();
  };
  const adjust = (delta: number) => setTarget((t) => (t === null ? t : t + delta));
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
      if (['ArrowUp', 'ArrowDown', '+', '-', '=', '_', 'Escape'].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape') {
          stroke.current = null;
          show(null);
          setTarget(null);
          setError(null);
        } else actions.current.adjust(['ArrowUp', '+', '='].includes(e.key) ? 0.25 : -0.25);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      scene.current?.infrastructureTool(null);
      latest.current.onDraft(null);
      window.removeEventListener('keydown', key, true);
    };
  }, [scene]);
  return (
    <>
      <div className="terraform-toolbar" aria-label="Pinceau de hauteur">
        <div>
          <strong>Terraformation</strong>
          <small>
            {target === null
              ? 'Glissez sur le sol pour prélever sa hauteur'
              : 'Peignez à cette hauteur · gratuit et immédiat · Échap : prélever à nouveau'}
          </small>
        </div>
        <button
          aria-label="Baisser la hauteur cible"
          aria-keyshortcuts="ArrowDown"
          disabled={target === null}
          onClick={() => adjust(-0.25)}
        >
          −
        </button>
        <output aria-label="Hauteur cible">
          {target === null ? '—' : target.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
        </output>
        <button
          aria-label="Monter la hauteur cible"
          aria-keyshortcuts="ArrowUp"
          disabled={target === null}
          onClick={() => adjust(0.25)}
        >
          +
        </button>
        <small>¼ de case · ↑ ↓</small>
      </div>
      {error && (
        <p className="terraform-hint" role="status">
          {error}
        </p>
      )}
    </>
  );
}
