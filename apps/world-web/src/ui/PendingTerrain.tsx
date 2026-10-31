import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TERRAIN_EDIT_CELLS_PER_COMMAND,
  TERRAIN_EDIT_GESTURES_PER_COMMAND,
  type TerrainEditGesture,
  type TerrainEditsRequest,
  type TerrainEditsResult,
} from '@arbestra/contracts';
import type { TerraformVisual } from '../scene/terraform-preview';
import { randomUUID } from '../random-uuid';

/** Each gesture restarts this delay (Tristan, 31 October): the batch leaves
 * 10 s after the last one, unless cancelled. */
export const TERRAIN_DELAY_MS = 10000;

export interface PendingTerrainBatch {
  gestures: TerrainEditGesture[];
  /** Preview of each gesture, in batch order (the later one wins a shared vertex). */
  visuals: TerraformVisual[];
  deadline: number;
  sending: boolean;
}
const gestureCells = (g: TerrainEditGesture) => (g.buildingType === 'terrain' ? g.cells.length : 9);

/**
 * The terrain gestures waiting for their delay, held by the App so that they
 * survive a change of HUD mode or tool (docs/SPEC-TERRAFORMATION-INSTANTANEE.md).
 * A new village drops them unsent. A full batch leaves at once.
 */
export function usePendingTerrain({
  edit,
  villageKey,
  onNotice,
}: {
  edit: ((request: TerrainEditsRequest) => Promise<TerrainEditsResult>) | null;
  villageKey: string;
  onNotice: (message: string, tone?: 'default' | 'warning') => void;
}) {
  const [batch, setBatch] = useState<PendingTerrainBatch | null>(null);
  const current = useRef<PendingTerrainBatch | null>(null),
    timer = useRef(0);
  const latest = useRef({ edit, onNotice });
  latest.current = { edit, onNotice };
  const publish = (next: PendingTerrainBatch | null) => {
    current.current = next;
    setBatch(next);
  };
  const drop = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (current.current && !current.current.sending) publish(null);
  }, []);
  const send = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    const pending = current.current,
      { edit: command, onNotice: notice } = latest.current;
    if (!pending || pending.sending) return;
    if (!command) {
      notice('Terraformation non envoyée : synchronisation du village en cours.', 'warning');
      publish(null);
      return;
    }
    publish({ ...pending, sending: true });
    try {
      const result = await command({ commandId: randomUUID(), gestures: pending.gestures });
      notice(result.gestures ? 'Terrain modifié.' : 'Le terrain était déjà à cette hauteur.');
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Terraformation refusée.', 'warning');
    }
    // The applied heights now come from the ground stream; the preview leaves.
    if (current.current?.sending) publish(null);
  }, []);
  /** Appends a gesture and restarts the delay; a full batch is sent now. */
  const add = useCallback(
    (gesture: TerrainEditGesture, visual: TerraformVisual) => {
      const pending = current.current;
      if (pending?.sending) {
        latest.current.onNotice('Envoi de la terraformation en cours, réessayez dans un instant.', 'warning');
        return false;
      }
      const gestures = [...(pending?.gestures ?? []), gesture];
      if (
        gestures.length > TERRAIN_EDIT_GESTURES_PER_COMMAND ||
        gestures.reduce((n, g) => n + gestureCells(g), 0) > TERRAIN_EDIT_CELLS_PER_COMMAND
      ) {
        latest.current.onNotice('Lot de terraformation plein : il part maintenant, reprenez ensuite.', 'warning');
        void send();
        return false;
      }
      window.clearTimeout(timer.current);
      publish({
        gestures,
        visuals: [...(pending?.visuals ?? []), visual],
        deadline: Date.now() + TERRAIN_DELAY_MS,
        sending: false,
      });
      timer.current = window.setTimeout(() => void send(), TERRAIN_DELAY_MS);
      return true;
    },
    [send],
  );
  // Another village (or world): the waiting batch is dropped, never sent there.
  useEffect(() => drop, [villageKey, drop]);
  return { batch, add, cancel: drop };
}
