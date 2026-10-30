import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { DemolitionRequest, DemolitionResult, VillageState } from '@arbestra/contracts';
import type { TerrainHandle } from '../scene/VillageScene';
import type { InfrastructureGesture } from '../scene/infrastructure-renderer';
import { DemolitionSelection, demolitionIndex, subPointCell, sweptCells } from './demolition-selection';

type Cell = { cellX: number; cellY: number };
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
/** Safety net against a mistaken click (Tristan, 31 October): the command
 * leaves only after this delay, cancellable until then. */
export const DEMOLITION_DELAY_MS = 15000;

/**
 * Destroy tool: a swipe designates buildings, garden cells, road cells and braziers
 * (never the town hall), each pulsing red. **Démolir** starts a cancellable delay,
 * then sends one immediate V2 command (docs/SPEC-DEMOLITION.md §9).
 */
export function DemolitionTool({
  state,
  scene,
  active,
  demolish,
  onNotice,
}: {
  state: VillageState;
  scene: RefObject<TerrainHandle | null>;
  active: boolean;
  /** The V2 command; null while the V2 village session is not ready. */
  demolish: ((request: DemolitionRequest) => Promise<DemolitionResult>) | null;
  onNotice: (message: string, tone?: 'default' | 'warning') => void;
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
  const [counts, setCounts] = useState({ buildings: 0, gardens: 0, roads: 0, braziers: 0 });
  /** Waiting command: sent at `deadline` unless cancelled; `sending` once it left. */
  const [pending, setPending] = useState<{ deadline: number; sending: boolean } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef(0);
  const publish = () =>
    setCounts({
      buildings: selection.current.buildings.size,
      gardens: selection.current.gardenCells.size,
      roads: selection.current.roadCells.size,
      braziers: selection.current.braziers.size,
    });
  const stopTimer = () => {
    window.clearInterval(timer.current);
    timer.current = 0;
  };
  const clear = () => {
    stopTimer();
    setPending(null);
    selection.current.clear();
    last.current = null;
    scene.current?.demolitionClear();
    publish();
  };
  const send = async () => {
    stopTimer();
    if (!demolish || !selection.current.size) {
      setPending(null);
      return;
    }
    setPending((p) => p && { ...p, sending: true });
    try {
      const result = await demolish(selection.current.request(crypto.randomUUID()));
      const gone = result.buildings + result.gardenCells + result.roadCells + result.braziers;
      onNotice(gone ? 'Démolition effectuée.' : 'Rien à démolir : ces cibles avaient déjà disparu.');
      clear();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Démolition refusée.', 'warning');
      setPending(null);
    }
  };
  const latestSend = useRef(send);
  latestSend.current = send;
  const start = () => {
    if (!demolish || !selection.current.size || pendingRef.current) return;
    const deadline = Date.now() + DEMOLITION_DELAY_MS;
    setPending({ deadline, sending: false });
    setNow(Date.now());
    // A few ticks per second for the countdown; the command leaves at the deadline.
    timer.current = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) void latestSend.current();
    }, 250);
  };
  const cancelPending = () => {
    stopTimer();
    setPending(null);
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
    // The designation is frozen while its command waits or leaves.
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
      // A command already sent cannot be called back.
      if (pendingRef.current?.sending) return;
      clear();
    };
    window.addEventListener('contextmenu', context);
    window.addEventListener('keydown', key, true);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      scene.current?.infrastructureTool(null);
      // Unmounted with its domain: no designation, waiting or not, outlives the tool.
      window.clearInterval(timer.current);
      timer.current = 0;
      selection.current.clear();
      scene.current?.demolitionClear();
      window.removeEventListener('contextmenu', context);
      window.removeEventListener('keydown', key, true);
    };
  }, [active, scene]);
  // Leaving the tool or the village drops the designation and its waiting command: nothing was sent.
  useEffect(() => {
    if (!active && !pendingRef.current?.sending) clear();
  }, [active, state.world.id, state.village.id]);
  const total = counts.buildings + counts.gardens + counts.roads + counts.braziers;
  if (!active) return null;
  const seconds = pending ? Math.max(0, Math.ceil((pending.deadline - now) / 1000)) : 0;
  return (
    <aside className="construction-feedback demolition-feedback" aria-label="Démolition">
      <strong>Détruire</strong>
      <span role="status">
        {total
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
      {pending ? (
        <small role="alert">
          {pending.sending ? 'Démolition en cours…' : `Démolition dans ${seconds} s · Annuler pour tout garder`}
        </small>
      ) : (
        <small>Sans remboursement · clic droit ou Échap : tout désélectionner</small>
      )}
      {counts.buildings + counts.gardens > 0 && (
        <small className="demolition-warning">
          Les ressources stockées dans ces bâtiments (récoltes, lots d’atelier) seront perdues.
        </small>
      )}
      <div className="intent-buttons">
        <button
          type="button"
          disabled={!total || !demolish || Boolean(pending)}
          title={demolish ? undefined : 'Synchronisation du village en cours.'}
          onClick={start}
        >
          Démolir
        </button>
        <button
          type="button"
          disabled={(!total && !pending) || Boolean(pending?.sending)}
          onClick={pending ? cancelPending : clear}
        >
          Annuler
        </button>
      </div>
    </aside>
  );
}
