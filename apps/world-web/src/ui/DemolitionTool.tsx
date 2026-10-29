import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { VillageState } from '@arbestra/contracts';
import type { TerrainHandle } from '../scene/VillageScene';
import type { InfrastructureGesture } from '../scene/infrastructure-renderer';
import { DemolitionSelection, demolitionIndex, subPointCell, sweptCells } from './demolition-selection';

type Cell = { cellX: number; cellY: number };
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * Destroy tool, client gesture only: a swipe designates buildings, gardens, roads and
 * braziers (never the town hall), each pulsing red. The command and its worksite are
 * specified in docs/SPEC-DEMOLITION.md and not wired yet.
 */
export function DemolitionTool({
  state,
  scene,
  active,
}: {
  state: VillageState;
  scene: RefObject<TerrainHandle | null>;
  active: boolean;
}) {
  const index = useMemo(
    () => demolitionIndex(state),
    // The index follows the cells and the plan, not every economic refresh.
    [state.world, state.cells, state.infrastructure],
  );
  const selection = useRef(new DemolitionSelection()),
    last = useRef<Cell | null>(null),
    latestIndex = useRef(index);
  latestIndex.current = index;
  const [counts, setCounts] = useState({ buildings: 0, roads: 0, equipment: 0 });
  const publish = () =>
    setCounts({
      buildings: selection.current.buildings.size,
      roads: selection.current.roadCells.size,
      equipment: selection.current.equipment.size,
    });
  const clear = () => {
    selection.current.clear();
    last.current = null;
    scene.current?.demolitionClear();
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
      // Unmounted with its domain: no designation may outlive the tool.
      selection.current.clear();
      scene.current?.demolitionClear();
      window.removeEventListener('contextmenu', context);
      window.removeEventListener('keydown', key, true);
    };
  }, [active, scene]);
  // Leaving the tool or the village drops the designation: nothing was sent.
  useEffect(() => {
    if (!active) clear();
  }, [active, state.world.id, state.village.id]);
  const total = counts.buildings + counts.roads + counts.equipment;
  if (!active) return null;
  return (
    <aside className="construction-feedback demolition-feedback" aria-label="Démolition">
      <strong>Détruire</strong>
      <span role="status">
        {total
          ? [
              counts.buildings && plural(counts.buildings, 'bâtiment', 'bâtiments'),
              counts.roads && plural(counts.roads, 'case de route', 'cases de route'),
              counts.equipment && plural(counts.equipment, 'brasero', 'braseros'),
            ]
              .filter(Boolean)
              .join(' · ')
          : 'Balayez ce qu’il faut détruire · l’hôtel de ville est épargné'}
      </span>
      <small>Sans remboursement · clic droit ou Échap : tout désélectionner</small>
      <div className="intent-buttons">
        <button type="button" disabled title="La commande de démolition n’existe pas encore côté serveur.">
          Démolir
        </button>
        <button type="button" disabled={!total} onClick={clear}>
          Annuler
        </button>
      </div>
    </aside>
  );
}
