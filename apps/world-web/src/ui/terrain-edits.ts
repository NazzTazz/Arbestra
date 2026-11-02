import { useCallback, useEffect, useRef } from 'react';
import {
  TERRAIN_EDIT_CELLS_PER_COMMAND,
  TERRAIN_EDIT_GESTURES_PER_COMMAND,
  type TerrainEditGesture,
  type TerrainEditRefusal,
  type TerrainEditsRequest,
  type TerrainEditsResult,
  type TerrainVertex,
} from '@arbestra/contracts';
import { randomUUID } from '../random-uuid';
import { SyncV2HttpError } from '../api/sync-v2-session';
import { oraclePages, serverRefusal, type OraclePage, type TerraformObstacles } from './terraform-refusals';

/**
 * Immediate terrain edits (Tristan, 2 November: « l'effet du pinceau
 * immédiat … préshot côté client la réponse du serveur »; the 10 s delay and
 * its Annuler / Confirmer are gone, docs/SPEC-TERRAFORMATION-OUTIL.md §7).
 *
 * A released stroke is predicted on the displayed ground at once (the scene's
 * TerrainStore.predict, which holds the chunks it patched) and sent. One
 * command at a time, so that the server applies the strokes in the order they
 * were painted: strokes released while one is in flight leave together in the
 * next command (up to the batch limits). When the answer comes (applied,
 * partly refused, refused or failed), the chunks are released: the server's
 * terrain replaces the prediction, a refused cell comes back to its height,
 * and the Oracle tells each refusal.
 */
export interface TerrainEditsDeps {
  /** The V2 command; null while the village session is not ready. */
  edit: ((request: TerrainEditsRequest) => Promise<TerrainEditsResult>) | null;
  predict: (vertices: readonly TerrainVertex[]) => string[];
  release: (keys: readonly string[]) => void;
  /** What the client sees, to name a server refusal (road or fixture). */
  obstacles: () => TerraformObstacles | null;
  onRefusals: (pages: OraclePage[]) => void;
  onNotice: (message: string, tone?: 'default' | 'warning') => void;
}
type Cell = { cellX: number; cellY: number };
interface Queued {
  gesture: TerrainEditGesture;
  keys: string[];
}
const gestureCells = (g: TerrainEditGesture) => (g.buildingType === 'terrain' ? g.cells.length : 9);

export class TerrainEditQueue {
  #queue: Queued[] = [];
  #sending = false;
  constructor(private readonly deps: () => TerrainEditsDeps) {}
  /** Commands in flight (0 or 1) and strokes waiting for it. */
  get pending(): { sending: boolean; queued: number } {
    return { sending: this.#sending, queued: this.#queue.length };
  }
  /** A stroke checked locally: predicted now, sent now or right after the command in flight. */
  add(gesture: TerrainEditGesture, vertices: readonly TerrainVertex[]): void {
    const keys = this.deps().predict(vertices);
    this.#queue.push({ gesture, keys });
    void this.#flush();
  }
  /** Another village: the strokes not sent yet are forgotten, their prediction released. */
  drop(): void {
    const dropped = this.#queue;
    this.#queue = [];
    for (const item of dropped) this.deps().release(item.keys);
  }
  async #flush(): Promise<void> {
    if (this.#sending || !this.#queue.length) return;
    const { edit, onNotice } = this.deps();
    // The batch: strokes in painting order, within the command's limits.
    const batch: Queued[] = [];
    let cells = 0;
    while (
      this.#queue.length &&
      batch.length < TERRAIN_EDIT_GESTURES_PER_COMMAND &&
      (!batch.length || cells + gestureCells(this.#queue[0]!.gesture) <= TERRAIN_EDIT_CELLS_PER_COMMAND)
    ) {
      cells += gestureCells(this.#queue[0]!.gesture);
      batch.push(this.#queue.shift()!);
    }
    const gestures = batch.map((b) => b.gesture);
    let refused: readonly TerrainEditRefusal[] = [];
    if (!edit) {
      onNotice('Terraformation non envoyée : synchronisation du village en cours.', 'warning');
      for (const item of batch) this.deps().release(item.keys);
      return this.#flush();
    }
    this.#sending = true;
    try {
      refused = (await edit({ commandId: randomUUID(), gestures })).refused ?? [];
    } catch (error) {
      if (error instanceof SyncV2HttpError && error.refused.length) refused = error.refused;
      else if (error instanceof SyncV2HttpError && error.status === 409 && error.code !== 'COMMAND_REUSED') {
        // A refusal without the list (an older server): the named gesture, at its anchor.
        const index = error.gesture ?? 0,
          anchor = gestures[index]?.anchor ?? gestures[0]!.anchor;
        refused = [{ gesture: index, cell: anchor, code: error.code as TerrainEditRefusal['code'], at: anchor }];
      } else onNotice(error instanceof Error ? error.message : 'Terraformation refusée.', 'warning');
    } finally {
      this.#sending = false;
      // The server's terrain replaces the prediction: refused cells come back.
      for (const item of batch) this.deps().release(item.keys);
    }
    if (refused.length) this.deps().onRefusals(terrainEditPages(refused, gestures, this.deps().obstacles()));
    return this.#flush();
  }
}

/** The Oracle's pages for the refused units of a batch: one per error (reason
 * and obstacle cell), a unit without known obstacle falling back on its cell. */
export function terrainEditPages(
  refused: readonly TerrainEditRefusal[],
  gestures: readonly { anchor: Cell }[],
  obstacles: TerraformObstacles | null,
): OraclePage[] {
  return oraclePages(
    refused.map((r) => serverRefusal(r.code, r.at ?? r.cell ?? gestures[r.gesture]?.anchor ?? null, obstacles)),
  );
}

/** The App's queue of immediate terrain edits; a new village drops what is not sent. */
export function useTerrainEdits(deps: TerrainEditsDeps & { villageKey: string }) {
  const latest = useRef(deps);
  latest.current = deps;
  const queue = useRef<TerrainEditQueue | null>(null);
  queue.current ??= new TerrainEditQueue(() => latest.current);
  useEffect(() => () => queue.current?.drop(), [deps.villageKey]);
  const add = useCallback((gesture: TerrainEditGesture, vertices: readonly TerrainVertex[]) => {
    queue.current!.add(gesture, vertices);
    return true;
  }, []);
  return { add };
}
