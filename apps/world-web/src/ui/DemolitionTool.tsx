import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { DemolitionRequest, VillageState } from '@arbestra/contracts';
import type { TerrainHandle } from '../scene/VillageScene';
import type { InfrastructureGesture } from '../scene/infrastructure-renderer';
import { DemolitionSelection, demolitionIndex, subPointCell, sweptCells } from './demolition-selection';

type Cell = { cellX: number; cellY: number };
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * Destroy tool: a swipe designates buildings, garden cells, road cells and braziers
 * (never the town hall), each pulsing red. **Démolir** hands the designation to the
 * App's waiting order (usePendingDemolition): it leaves after a cancellable delay,
 * even if the player changes mode meanwhile (docs/SPEC-DEMOLITION.md §9).
 */
export function DemolitionTool({
  state,
  scene,
  active,
  ready,
  pending,
  onSchedule,
}: {
  state: VillageState;
  scene: RefObject<TerrainHandle | null>;
  active: boolean;
  /** False while the V2 village session is not ready. */
  ready: boolean;
  /** An order waits for its delay: its targets stay red, the tool is frozen. */
  pending: boolean;
  onSchedule: (request: DemolitionRequest) => void;
}) {
  const index = useMemo(
    () => demolitionIndex(state),
    // The index follows the cells, road cells and anchors, not every economic refresh.
    [state.world, state.cells, state.roadCells, state.roadAnchors],
  );
  const selection = useRef(new DemolitionSelection()),
    last = useRef<Cell | null>(null),
    latestIndex = useRef(index);
  latestIndex.current = index;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [counts, setCounts] = useState({ buildings: 0, gardens: 0, roads: 0, braziers: 0 });
  const publish = () =>
    setCounts({
      buildings: selection.current.buildings.size,
      gardens: selection.current.gardenCells.size,
      roads: selection.current.roadCells.size,
      braziers: selection.current.braziers.size,
    });
  /** Drops the designation; the red marks of a waiting order belong to it. */
  const clear = () => {
    selection.current.clear();
    last.current = null;
    if (!pendingRef.current) scene.current?.demolitionClear();
    publish();
  };
  const start = () => {
    if (!ready || !selection.current.size || pendingRef.current) return;
    onSchedule(selection.current.request(crypto.randomUUID()));
    // The marks stay red until the order is sent or cancelled.
    selection.current.clear();
    last.current = null;
    publish();
  };
  const sweep = (to: Cell) => {
    const added = selection.current.mark(
      latestIndex.current,
      sweptCells(last.current, to, latestIndex.current.world),
      (kind, id) => scene.current?.demolitionMark(kind, id),
    );
    last.current = to;
    if (added) publish();
  };
  const handler = useRef<(e: InfrastructureGesture) => void>(() => {});
  handler.current = (e) => {
    // Frozen while an order waits: one designation at a time.
    if (pendingRef.current) return;
    if (e.kind === 'cancel') {
      last.current = null;
      return;
    }
    if (e.kind === 'right') {
      clear();
      return;
    }
    if (!e.point) return;
    const cell = subPointCell(e.point, latestIndex.current.world);
    if (e.kind === 'down') {
      last.current = null;
      sweep(cell);
    } else if (e.kind === 'hover' && last.current) sweep(cell);
    else if (e.kind === 'up') {
      if (last.current) sweep(cell);
      last.current = null;
    }
  };
  useEffect(() => {
    if (!active) {
      scene.current?.infrastructureTool(null);
      return;
    }
    let frame = 0,
      stopped = false;
    const register = () => {
      if (stopped) return;
      if (scene.current?.ready()) scene.current.infrastructureTool((e) => handler.current(e));
      else frame = requestAnimationFrame(register);
    };
    register();
    const context = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('.village-canvas')) e.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target instanceof Element && e.target.closest('input,select,textarea'))) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      scene.current?.cancelGesture();
      clear();
    };
    window.addEventListener('contextmenu', context);
    window.addEventListener('keydown', key, true);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      scene.current?.infrastructureTool(null);
      // Unmounted with its domain: an unsent designation does not outlive the tool;
      // a waiting order does, with its marks.
      selection.current.clear();
      if (!pendingRef.current) scene.current?.demolitionClear();
      window.removeEventListener('contextmenu', context);
      window.removeEventListener('keydown', key, true);
    };
  }, [active, scene]);
  // Leaving the tool or the village drops the unsent designation.
  useEffect(() => {
    if (!active) clear();
  }, [active, state.world.id, state.village.id]);
  const total = counts.buildings + counts.gardens + counts.roads + counts.braziers;
  if (!active) return null;
  return (
    <aside className="construction-feedback demolition-feedback" aria-label="Démolition">
      <strong>Détruire</strong>
      <span role="status">
        {pending
          ? 'Démolition en attente'
          : total
            ? [
                counts.buildings && plural(counts.buildings, 'bâtiment', 'bâtiments'),
                counts.gardens && plural(counts.gardens, 'case de jardin', 'cases de jardin'),
                counts.roads && plural(counts.roads, 'case de route', 'cases de route'),
                counts.braziers && plural(counts.braziers, 'brasero', 'braseros'),
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Balayez ce qu’il faut détruire · l’hôtel de ville est épargné'}
      </span>
      <small>Sans remboursement · clic droit ou Échap : tout désélectionner</small>
      {counts.buildings + counts.gardens > 0 && (
        <small className="demolition-warning">
          Les ressources stockées dans ces bâtiments (récoltes, lots d’atelier) seront perdues.
        </small>
      )}
      <div className="intent-buttons">
        <button
          type="button"
          disabled={!total || !ready || pending}
          title={ready ? undefined : 'Synchronisation du village en cours.'}
          onClick={start}
        >
          Démolir
        </button>
        <button type="button" disabled={!total} onClick={clear}>
          Annuler
        </button>
      </div>
    </aside>
  );
}
