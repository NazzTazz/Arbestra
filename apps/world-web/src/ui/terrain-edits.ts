import { useCallback, useEffect, useRef } from 'react';
import {
  orderedTerrainEditGestures,
  TERRAIN_EDIT_CELLS_PER_COMMAND,
  TERRAIN_EDIT_GESTURES_PER_COMMAND,
  type LiveTerrainEditGesture,
  type TerrainEditStep,
  type TerrainEditRefusal,
  type TerrainEditsRequest,
  type TerrainEditsResult,
  type TerrainVertex,
} from '@arbestra/contracts';
import { randomUUID } from '../random-uuid';
import { SyncV2HttpError } from '../api/sync-v2-session';
import { oraclePages, serverRefusal, type OraclePage, type TerraformObstacles } from './terraform-refusals';

/**
 * Live terrain edits (Tristan, 2 November: « l'effet du pinceau immédiat »,
 * then « c'est pendant le geste », docs/SPEC-TERRAFORMATION-OUTIL.md §7).
 *
 * The painted cells of a stroke arrive frame by frame (ui/terraform-live.ts),
 * already predicted on the displayed ground (the scene's TerrainStore.predict,
 * which holds the chunks it patched). They are sent while the stroke goes on,
 * in small ordered batches: one command at a time, at most one every
 * SEND_INTERVAL_MS, carrying everything painted meanwhile as gestures the
 * server applies in painting order. When an answer comes (applied, partly
 * refused, refused or failed), the chunks of its frames are released: the
 * server's terrain replaces the prediction, a refused cell comes back to its
 * height. The Oracle's pages wait for the end of the stroke.
 */
export const SEND_INTERVAL_MS = 150;
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
/** Where a gesture is: its anchor, or the first restored cell. */
const gestureAnchor = (gesture: LiveTerrainEditGesture): Cell =>
  gesture.buildingType === 'terrain'
    ? gesture.anchor
    : { cellX: gesture.cells[0]!.cellX, cellY: gesture.cells[0]!.cellY };
/** Who painted a frame (an undo record, ui/terraform-undo.ts): told of its cells the server refused. */
export interface TerrainEditOwner {
  refused(cell: Cell): void;
}
/** One frame of a stroke: its painted (or restored) cells and the chunks its prediction holds. */
interface Queued {
  paints: TerrainEditStep[];
  keys: string[];
  owner?: TerrainEditOwner | undefined;
}
export class TerrainEditQueue {
  #queue: Queued[] = [];
  #sending = false;
  #lastSent = -Infinity;
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** Strokes being drawn or finishing (a new one may start before the last one is applied). */
  #strokes = 0;
  #deferred: OraclePage[] = [];
  constructor(
    private readonly deps: () => TerrainEditsDeps,
    private readonly options: { intervalMs?: number; now?: () => number } = {},
  ) {}
  /** Commands in flight (0 or 1) and frames waiting for it. */
  get pending(): { sending: boolean; queued: number } {
    return { sending: this.#sending, queued: this.#queue.length };
  }
  /** Painted cells checked locally: predicted now, sent with the next command. */
  add(paints: TerrainEditStep[], vertices: readonly TerrainVertex[], owner?: TerrainEditOwner): void {
    const keys = this.deps().predict(vertices);
    this.#queue.push({ paints, keys, owner });
    void this.#flush();
  }
  /** A stroke is being drawn: the server's refusals wait for its end, with the local ones. */
  stroke(active: boolean): void {
    this.#strokes = Math.max(0, this.#strokes + (active ? 1 : -1));
    if (this.#strokes || !this.#deferred.length) return;
    const pages = this.#deferred;
    this.#deferred = [];
    this.deps().onRefusals(pages);
  }
  /** Another village: the cells not sent yet are forgotten, their prediction released. */
  drop(): void {
    const dropped = this.#queue;
    this.#queue = [];
    this.#deferred = [];
    this.#strokes = 0;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    for (const item of dropped) this.deps().release(item.keys);
  }
  #now() {
    return (this.options.now ?? (() => performance.now()))();
  }
  async #flush(): Promise<void> {
    if (this.#sending || this.#timer || !this.#queue.length) return;
    // A bounded cadence: at most one command per interval, whatever the pointer's speed.
    const wait = this.#lastSent + (this.options.intervalMs ?? SEND_INTERVAL_MS) - this.#now();
    if (wait > 0) {
      this.#timer = setTimeout(() => {
        this.#timer = null;
        void this.#flush();
      }, wait);
      return;
    }
    const { edit, onNotice } = this.deps();
    // The batch: whole frames in painting order, within the command's limits.
    const batch: Queued[] = [];
    let gestures: LiveTerrainEditGesture[] = [];
    while (this.#queue.length) {
      const next = orderedTerrainEditGestures(this.#queue[0]!.paints, structuredClone(gestures));
      if (
        batch.length &&
        (next.length > TERRAIN_EDIT_GESTURES_PER_COMMAND ||
          next.reduce((n, g) => n + g.cells.length, 0) > TERRAIN_EDIT_CELLS_PER_COMMAND)
      )
        break;
      gestures = next;
      batch.push(this.#queue.shift()!);
    }
    let refused: readonly TerrainEditRefusal[] = [];
    if (!edit) {
      onNotice('Terraformation non envoyée : synchronisation du village en cours.', 'warning');
      for (const item of batch) this.deps().release(item.keys);
      return this.#flush();
    }
    this.#sending = true;
    this.#lastSent = this.#now();
    try {
      refused = (await edit({ commandId: randomUUID(), gestures })).refused ?? [];
    } catch (error) {
      if (error instanceof SyncV2HttpError && error.refused.length) refused = error.refused;
      else if (error instanceof SyncV2HttpError && error.status === 409 && error.code !== 'COMMAND_REUSED') {
        // A refusal without the list (an older server): the named gesture, at its anchor.
        const index = error.gesture ?? 0,
          anchor = gestureAnchor(gestures[index] ?? gestures[0]!);
        refused = [{ gesture: index, cell: anchor, code: error.code as TerrainEditRefusal['code'], at: anchor }];
      } else onNotice(error instanceof Error ? error.message : 'Terraformation refusée.', 'warning');
    } finally {
      this.#sending = false;
      // The server's terrain replaces the prediction: refused cells come back.
      for (const item of batch) this.deps().release(item.keys);
    }
    if (refused.length) {
      // The undo records forget the refused cells: a refused unit has nothing to undo.
      const owners = new Map<string, Set<TerrainEditOwner>>();
      for (const item of batch)
        if (item.owner)
          for (const { cell } of item.paints) {
            const k = `${cell.cellX}:${cell.cellY}`;
            owners.set(k, (owners.get(k) ?? new Set()).add(item.owner));
          }
      for (const r of refused)
        for (const owner of owners.get(`${r.cell.cellX}:${r.cell.cellY}`) ?? []) owner.refused(r.cell);
      const pages = terrainEditPages(refused, gestures, this.deps().obstacles());
      if (this.#strokes) this.#deferred.push(...pages);
      else this.deps().onRefusals(pages);
    }
    return this.#flush();
  }
}

/** The Oracle's pages for the refused units of a batch: one per error (reason
 * and obstacle cell), a unit without known obstacle falling back on its cell. */
export function terrainEditPages(
  refused: readonly TerrainEditRefusal[],
  gestures: readonly LiveTerrainEditGesture[],
  obstacles: TerraformObstacles | null,
): OraclePage[] {
  return oraclePages(
    refused.map((r) => {
      const gesture = gestures[r.gesture];
      return serverRefusal(r.code, r.at ?? r.cell ?? (gesture ? gestureAnchor(gesture) : null), obstacles);
    }),
  );
}

/** The App's queue of live terrain edits; a new village drops what is not sent. */
export function useTerrainEdits(deps: TerrainEditsDeps & { villageKey: string }) {
  const latest = useRef(deps);
  latest.current = deps;
  const queue = useRef<TerrainEditQueue | null>(null);
  queue.current ??= new TerrainEditQueue(() => latest.current);
  useEffect(() => () => queue.current?.drop(), [deps.villageKey]);
  const add = useCallback(
    (paints: TerrainEditStep[], vertices: readonly TerrainVertex[], owner?: TerrainEditOwner) =>
      queue.current!.add(paints, vertices, owner),
    [],
  );
  const stroke = useCallback((active: boolean) => queue.current!.stroke(active), []);
  return { add, stroke };
}
