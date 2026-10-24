import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  MAX_TERRAFORM_CELLS,
  type LevelingPreview,
  type TerraformCommand,
  type TerraformRequest,
  type VillageState,
  type TravelCell,
} from '@arbestra/contracts';
import type { TerrainHandle } from '../scene/VillageScene';
import type { InfrastructureGesture } from '../scene/infrastructure-renderer';
import { cellsAlongSegment, cellKey } from '../scene/construction-selection';
import { ApiError, commandTerraform, type TimedVillageState } from '../api/client';
import { SyncV2HttpError } from '../api/sync-v2-transport';
import { randomUUID } from '../random-uuid';
import { localTerraform, terrainBrushHeight, terraformSelectionVisual } from './terraform-draft';
import './terraform.css';

const duration = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60 ? `${seconds % 60} s` : ''}`;
};
type Draft = { request: TerraformRequest; open: boolean; side: 'left' | 'right' };
export function TerraformPanel({
  state,
  scene,
  onSnapshot,
  onStarted,
  submit: send,
}: {
  /** V2 when the village is synchronized by it: no snapshot comes back. */
  submit?: (
    command: TerraformCommand,
  ) => Promise<{ status: 'changed'; preview: LevelingPreview } | { status: 'started'; snapshot?: TimedVillageState }>;
  state: VillageState;
  scene: RefObject<TerrainHandle | null>;
  onSnapshot: (s: TimedVillageState) => void;
  onStarted: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null),
    draftRef = useRef(draft);
  draftRef.current = draft;
  const [workers, setWorkers] = useState(() => Math.max(1, Math.min(5, state.village.population.available)));
  const [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [retry, setRetry] = useState<TerraformCommand | null>(null);
  const [certified, setCertified] = useState<LevelingPreview | null>(null);
  const storageKey = `terraform-command:${state.world.id}:${state.village.id}`;
  const stroke = useRef<{ before: Draft | null; last: TravelCell } | null>(null);
  const latest = useRef({ state, workers, pending, retry });
  latest.current = { state, workers, pending, retry };
  const heightAt = (x: number, y: number) => scene.current?.terrainVertexHeight(x, y) ?? NaN;
  const set = (value: Draft | null) => {
    draftRef.current = value;
    setDraft(value);
    setCertified(null);
    setError(null);
    scene.current?.terraformPreview(
      value ? terraformSelectionVisual(value.request, latest.current.state.world, heightAt) : null,
    );
  };
  const clear = () => {
    if (latest.current.pending || latest.current.retry) return;
    stroke.current = null;
    set(null);
  };
  const adjust = (delta: number) => {
    if (latest.current.pending || latest.current.retry || !draftRef.current) return;
    set({
      ...draftRef.current,
      request: { ...draftRef.current.request, height: draftRef.current.request.height + delta },
    });
  };
  const gesture = useRef<(g: InfrastructureGesture) => void>(() => {});
  gesture.current = (g) => {
    if (latest.current.pending || latest.current.retry) return;
    if (g.kind === 'right') return;
    if (g.kind === 'cancel') {
      if (stroke.current) {
        const before = stroke.current.before;
        stroke.current = null;
        set(before);
      }
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
      stroke.current = { before: draftRef.current, last: point };
      if (!draftRef.current) {
        const height = terrainBrushHeight(s, point.cellX, point.cellY, heightAt);
        if (!Number.isFinite(height)) {
          stroke.current = null;
          setError('Sélectionnez une case de terrain visible.');
          return;
        }
        const screen = scene.current?.projectCell(cell);
        set({
          request: {
            buildingType: 'terrain',
            anchor: cell,
            quarterTurns: 0,
            cells: [cell],
            height,
            workerCount: latest.current.workers,
          },
          open: false,
          side: screen && screen.x < window.innerWidth / 2 ? 'right' : 'left',
        });
      }
    }
    const current = draftRef.current;
    if (!current || !stroke.current) return;
    const cells = new Map(current.request.cells.map((c) => [cellKey(c), c]));
    for (const c of [cell, ...cellsAlongSegment(stroke.current.last, point, s.world)]) cells.set(cellKey(c), c);
    if (cells.size > MAX_TERRAFORM_CELLS) {
      setError(`Limite de ${MAX_TERRAFORM_CELLS} cases par chantier.`);
      if (g.kind === 'up') {
        stroke.current = null;
        setDraft((d) => d && { ...d, open: true });
      }
      return;
    }
    stroke.current.last = point;
    if (cells.size !== current.request.cells.length || g.kind === 'up')
      set({
        ...current,
        request: { ...current.request, cells: [...cells.values()] },
        open: current.open || g.kind === 'up',
      });
    if (g.kind === 'up') stroke.current = null;
  };
  const actions = useRef({ clear, adjust });
  actions.current = { clear, adjust };
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
        if (e.key === 'Escape') actions.current.clear();
        else actions.current.adjust(['ArrowUp', '+', '='].includes(e.key) ? 0.25 : -0.25);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      scene.current?.infrastructureTool(null);
      scene.current?.terraformPreview(null);
      window.removeEventListener('keydown', key, true);
    };
  }, [scene]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const command = JSON.parse(raw) as TerraformCommand;
      if (command.buildingType !== 'terrain' || !command.commandId || !Array.isArray(command.cells)) return;
      setRetry(command);
      setWorkers(command.workerCount);
      set({ request: command, open: true, side: 'right' });
      setError('Vérifiez le résultat du chantier précédent.');
    } catch {
      /* Storage unavailable: the in-memory receipt remains usable. */
    }
  }, [storageKey]);
  const [local, setLocal] = useState<{
    visual: ReturnType<typeof localTerraform>['visual'] | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!draft) {
      setLocal(null);
      return;
    }
    // Pointer-down feedback already exists in Babylon. Only quote after release;
    // neither a snapshot nor a request is needed to initiate/extend the stroke.
    if (stroke.current) return;
    let value: NonNullable<typeof local>;
    try {
      value = localTerraform(state, draft.request, (x, y) => scene.current?.terrainVertexHeight(x, y) ?? NaN);
    } catch {
      value = { visual: null, error: 'Les raccords dépassent le terrain visible. Réduisez la sélection.' };
    }
    setLocal(value);
    if (value.visual) scene.current?.terraformPreview(value.visual);
  }, [draft, state, scene]);
  const quote = certified?.quote ?? local?.visual?.quote;
  async function submit() {
    if (pending || !draft || (!retry && (!quote || local?.error || certified?.valid === false))) return;
    const command = retry ?? { ...draft.request, commandId: randomUUID(), expected: quote! };
    setRetry(command);
    setPending(true);
    setError(null);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(command));
    } catch {
      /* Retry still retains the exact command in memory. */
    }
    const forget = () => {
      setRetry(null);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Optional persistence. */
      }
    };
    try {
      const result = await (send ?? ((c: TerraformCommand) => commandTerraform(state.world.slug, state.village.id, c)))(
        command,
      );
      forget();
      if (result.status === 'changed') {
        setCertified(result.preview);
        setError(result.preview.message ?? 'Le serveur a ajusté le devis et le trajet. Confirmez ces valeurs.');
      } else {
        if (result.snapshot) onSnapshot(result.snapshot);
        stroke.current = null;
        set(null);
        onStarted();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Résultat inconnu. Vérifiez le même chantier.');
      if (
        (reason instanceof ApiError || reason instanceof SyncV2HttpError) &&
        reason.status >= 400 &&
        reason.status < 500 &&
        ![401, 403, 408, 429].includes(reason.status)
      ) {
        forget();
        setCertified(null);
      }
    } finally {
      setPending(false);
    }
  }
  const locked = pending || !!retry;
  return (
    <>
      <div className="terraform-toolbar" aria-label="Pinceau de hauteur">
        <div>
          <strong>Terraformation</strong>
          <small>{draft ? 'Peignez pour agrandir la zone' : 'Glissez sur le sol pour prélever sa hauteur'}</small>
        </div>
        <button
          aria-label="Baisser la hauteur cible"
          aria-keyshortcuts="ArrowDown"
          disabled={!draft || locked}
          onClick={() => adjust(-0.25)}
        >
          −
        </button>
        <output aria-label="Hauteur cible">
          {draft ? draft.request.height.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '—'}
        </output>
        <button
          aria-label="Monter la hauteur cible"
          aria-keyshortcuts="ArrowUp"
          disabled={!draft || locked}
          onClick={() => adjust(0.25)}
        >
          +
        </button>
        <small>¼ de case · ↑ ↓</small>
      </div>
      {!draft && error && (
        <p className="terraform-hint" role="status">
          {error}
        </p>
      )}
      {draft?.open && (
        <section
          className={`terraform-panel is-${draft.side}`}
          role="dialog"
          aria-modal="false"
          aria-labelledby="terraform-title"
        >
          <header>
            <small>DEVIS DE NIVELLEMENT</small>
            <h2 id="terraform-title">Préparer le terrain</h2>
            <p>
              {draft.request.cells.length} case{draft.request.cells.length > 1 ? 's' : ''} · hauteur{' '}
              {draft.request.height.toLocaleString('fr-FR')}
            </p>
          </header>
          <div className="terraform-workers" role="group" aria-label="Habitants du chantier">
            {[
              ...new Set([
                ...(state.village.population.available < 5 ? [Math.max(1, state.village.population.available)] : []),
                5,
                20,
                50,
              ]),
            ].map((n) => (
              <button
                key={n}
                disabled={locked || n > state.village.population.available}
                aria-pressed={workers === n}
                onClick={() => {
                  setWorkers(n);
                  set({ ...draft, request: { ...draft.request, workerCount: n } });
                }}
              >
                <span aria-hidden="true">♟</span>
                <strong>{n}</strong>
                <small>habitants</small>
              </button>
            ))}
          </div>
          <dl>
            <div>
              <dt>Durée {certified ? 'confirmée' : 'estimée'}</dt>
              <dd>{quote ? duration(quote.durationMs) : '—'}</dd>
            </div>
            <div>
              <dt>Pierres brutes</dt>
              <dd>{quote ? (quote.stoneDebit ? `−${quote.stoneDebit}` : 'Aucun coût') : '—'}</dd>
            </div>
            <div>
              <dt>Avec les raccords</dt>
              <dd>{quote?.affectedCells?.length ?? '—'} cases</dd>
            </div>
          </dl>
          <p className="terraform-status" role="status">
            {pending
              ? 'Validation du chantier…'
              : (error ?? local?.error ?? 'Continuez à peindre. Les raccords font partie du chantier.')}
          </p>
          <footer>
            <button disabled={locked} onClick={clear}>
              Annuler
            </button>
            <button
              className="terraform-confirm"
              disabled={
                pending ||
                (!retry &&
                  (!quote ||
                    !!local?.error ||
                    certified?.valid === false ||
                    workers > state.village.population.available))
              }
              onClick={() => void submit()}
            >
              {pending ? 'Validation…' : retry ? 'Vérifier le chantier' : certified ? 'Confirmer le devis' : 'Valider'}
            </button>
          </footer>
        </section>
      )}
    </>
  );
}
