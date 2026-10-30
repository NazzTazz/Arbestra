import {
  ROAD_ANCHORS_PER_COMMAND,
  roadAnchorAccessories,
  roadAnchorCells,
  wrapCoordinate,
  type RoadAnchor,
  type RoadAnchorPosition,
  type RoadAnchorSkip,
  type RoadAnchorSkipCode,
  type RoadAnchorsPreview,
  type RoadAnchorsPreviewRequest,
  type RoadAnchorsRequest,
  type RoadAnchorsResult,
} from '@arbestra/contracts';
import { MAX_SWEEP_STEP, PREVIEW_DELAY_MS, sweptCells4 } from './road-cell-gesture';

type World = { widthCells: number; heightCells: number };
type Cell = { cellX: number; cellY: number };
export type Vertex = RoadAnchorPosition;
export type RoadAnchorMode = 'place' | 'remove';
export type RoadAnchorTone = 'place' | 'remove' | 'invalid';

/** Half-width, in vertices, of the window of highlighted anchors around the pointer. */
export const HIGHLIGHT_RADIUS = 10;
/** Most anchors highlighted at once (the closest to the pointer). */
export const MAX_HIGHLIGHTS = 256;
const key = (x: number, y: number) => x + ':' + y;
export const vertexKey = (v: Vertex) => key(v.vertexX, v.vertexY);

/** Magnetic radius of the anchors, in cells (Tristan, 30 October): the pointer
 * snaps to the nearest anchor closer than this. Below 0.5, at most one vertex
 * is within reach, so the nearest vertex computed from the coordinates is the
 * only candidate (no list walk). */
export const ANCHOR_SNAP_RADIUS = 0.4;

/** Nearest vertex of a pointer in eighths of a cell: vertex `(x, y)` lies at `(8x-4, 8y-4)`. */
export function subPointVertex(point: { x: number; y: number }, world: World): Vertex {
  return {
    vertexX: wrapCoordinate(Math.round((point.x + 4) / 8), world.widthCells),
    vertexY: wrapCoordinate(Math.round((point.y + 4) / 8), world.heightCells),
  };
}

/**
 * The village's anchors and the accessories it shows, indexed once per state
 * change (linear in its road cells): a pointer sample then only does set
 * lookups. An anchor is a vertex touched by one of the village's road cells
 * (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §5.1).
 */
/** The vertex the pointer snaps to, or null beyond `radius` cells (O(1), torus aware). */
export function snapAnchor(point: { x: number; y: number }, world: World, radius = ANCHOR_SNAP_RADIUS): Vertex | null {
  const vertex = subPointVertex(point, world);
  const offset = (d: number, size: number) => ((((d + size / 2) % size) + size) % size) - size / 2;
  const dx = offset(point.x - (vertex.vertexX * 8 - 4), world.widthCells * 8) / 8,
    dy = offset(point.y - (vertex.vertexY * 8 - 4), world.heightCells * 8) / 8;
  return dx * dx + dy * dy <= radius * radius ? vertex : null;
}

export class RoadAnchorIndex {
  readonly #roads = new Set<string>();
  /** Vertex key → shown accessory (manual or automatic). */
  readonly shown = new Map<string, { automatic: boolean }>();
  /** Vertices whose automatic brazier the village removed: placing restores it, free. */
  readonly suppressed = new Set<string>();
  constructor(
    cells: readonly Cell[] | undefined,
    stored: ReadonlyArray<Pick<RoadAnchor, 'vertexX' | 'vertexY' | 'accessory'>> | undefined,
    readonly world: World,
  ) {
    for (const c of cells ?? []) this.#roads.add(key(c.cellX, c.cellY));
    const views = roadAnchorAccessories(cells ?? [], stored ?? [], world);
    for (const view of views) this.shown.set(key(view.vertexX, view.vertexY), { automatic: view.automatic });
    for (const row of stored ?? []) if (row.accessory === 'none') this.suppressed.add(key(row.vertexX, row.vertexY));
  }
  isAnchor(v: Vertex): boolean {
    for (const c of roadAnchorCells(v, this.world)) if (this.#roads.has(key(c.cellX, c.cellY))) return true;
    return false;
  }
  /** Place: an anchor without a shown accessory (a removed automatic brazier
   * included, restored for free); remove: an anchor showing one. */
  designable(v: Vertex, mode: RoadAnchorMode): boolean {
    const shown = this.shown.has(vertexKey(v));
    return (mode === 'place' ? !shown : shown) && this.isAnchor(v);
  }
}

/** Designable anchors near the pointer, closest first: at most
 * (2·HIGHLIGHT_RADIUS+1)² lookups and MAX_HIGHLIGHTS results per call,
 * whatever the size of the village. */
export function highlightedAnchors(
  index: RoadAnchorIndex,
  centre: Vertex,
  mode: RoadAnchorMode,
  radius = HIGHLIGHT_RADIUS,
  max = MAX_HIGHLIGHTS,
): Vertex[] {
  const found: Array<Vertex & { d: number }> = [];
  const { widthCells, heightCells } = index.world;
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const v = {
        vertexX: wrapCoordinate(centre.vertexX + dx, widthCells),
        vertexY: wrapCoordinate(centre.vertexY + dy, heightCells),
      };
      if (index.designable(v, mode)) found.push({ ...v, d: dx * dx + dy * dy });
    }
  if (found.length > max) found.sort((a, b) => a.d - b.d).length = max;
  return found.map(({ vertexX, vertexY }) => ({ vertexX, vertexY }));
}

export interface RoadAnchorGestureDeps {
  world: World;
  preview: (body: RoadAnchorsPreviewRequest) => Promise<RoadAnchorsPreview>;
  command: (request: RoadAnchorsRequest) => Promise<RoadAnchorsResult>;
  uuid: () => string;
  /** Whether the vertex may join the designation in the current mode (highlighted anchors). */
  designable: (vertex: Vertex, mode: RoadAnchorMode) => boolean;
  /** Newly designated anchors of the current gesture, once each. */
  added?: (vertices: readonly Vertex[]) => void;
  /** Designated anchors the current quote skips (shown red), once each. */
  refused?: (vertices: readonly Vertex[]) => void;
  /** The designation is dropped (cancel, refusal, acceptance). */
  cleared?: () => void;
  tone?: (tone: RoadAnchorTone) => void;
  changed?: () => void;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Quote {
  version: number;
  valid: boolean;
  message: string | null;
  stone: number;
  wood: number;
  skipped: RoadAnchorSkip[];
}

/**
 * Lighting tool, client gesture (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md
 * §5): press, drag, release designate highlighted anchors; the release sends
 * one V2 command (with the quote shown when placing). Same rules as the road
 * cell gesture (S2b/S2d): bounded sweep per pointer sample, coalesced quotes,
 * skipped anchors in red, one command at a time, idempotent retry.
 */
export class RoadAnchorGesture {
  readonly vertices = new Map<string, Vertex>();
  mode: RoadAnchorMode = 'place';
  drawing = false;
  busy = false;
  limited = false;
  error: string | null = null;
  notice: string | null = null;
  quote: Quote | null = null;
  uncertain: RoadAnchorsRequest | null = null;
  #last: Vertex | null = null;
  readonly #refused = new Set<string>();
  #version = 0;
  #timer: unknown = null;
  #inFlight = false;
  #sendWhenQuoted = false;
  #queued = false;
  #disposed = false;
  constructor(private readonly deps: RoadAnchorGestureDeps) {}

  get quoteCurrent() {
    return this.quote?.version === this.#version;
  }
  setMode(mode: RoadAnchorMode) {
    this.cancel();
    this.mode = mode;
    this.error = null;
    this.notice = null;
    this.deps.changed?.();
  }
  /** A press away from any anchor (null) starts the gesture without designating. */
  down(vertex: Vertex | null) {
    if (this.#disposed) return;
    this.#reset();
    this.error = null;
    this.notice = null;
    this.drawing = true;
    this.deps.tone?.(this.mode);
    if (vertex) this.#extend(vertex);
  }
  /** Samples between anchors (null) are skipped: the next snapped anchor sweeps from the last one. */
  move(vertex: Vertex | null) {
    if (this.drawing && vertex) this.#extend(vertex);
  }
  up(vertex: Vertex | null) {
    if (!this.drawing) return;
    if (vertex)
      for (let pass = 0; pass < ROAD_ANCHORS_PER_COMMAND / MAX_SWEEP_STEP + 1; pass++) if (!this.#extend(vertex)) break;
    this.drawing = false;
    if (!this.vertices.size) {
      this.notice = this.mode === 'place' ? 'Aucun ancrage libre ici' : 'Aucun brasero ici';
      this.#reset();
      this.deps.changed?.();
      return;
    }
    if (this.mode === 'remove') void this.#send();
    else {
      this.#sendWhenQuoted = true;
      if (this.quoteCurrent) this.#release();
      else this.#flushPreview();
    }
    this.deps.changed?.();
  }
  cancel() {
    this.#queued = false;
    this.#reset();
    this.deps.changed?.();
  }
  retry() {
    if (this.uncertain && !this.busy) void this.#send(this.uncertain);
  }
  resume() {
    this.#disposed = false;
  }
  dispose() {
    this.cancel();
    this.#disposed = true;
    if (this.#timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.#timer as ReturnType<typeof setTimeout>);
    this.#timer = null;
  }
  #reset() {
    this.drawing = false;
    this.limited = false;
    this.#last = null;
    this.#sendWhenQuoted = false;
    this.quote = null;
    this.#refused.clear();
    if (this.vertices.size) {
      this.vertices.clear();
      this.deps.cleared?.();
    }
    this.#version++;
  }
  /** Adds the designable vertices crossed towards `vertex`; false once it is reached or the gesture is full. */
  #extend(vertex: Vertex): boolean {
    // The vertex grid is a copy of the cell grid: the 4-connected sweep applies as is.
    const swept = sweptCells4(
        this.#last && { cellX: this.#last.vertexX, cellY: this.#last.vertexY },
        { cellX: vertex.vertexX, cellY: vertex.vertexY },
        this.deps.world,
      ),
      fresh: Vertex[] = [];
    for (const c of swept) {
      const v = { vertexX: c.cellX, vertexY: c.cellY },
        k = vertexKey(v);
      if (this.vertices.has(k) || !this.deps.designable(v, this.mode)) continue;
      if (this.vertices.size >= ROAD_ANCHORS_PER_COMMAND) {
        this.limited = true;
        break;
      }
      this.vertices.set(k, v);
      fresh.push(v);
    }
    const last = swept.at(-1);
    if (last) this.#last = { vertexX: last.cellX, vertexY: last.cellY };
    if (fresh.length) {
      this.#version++;
      this.deps.added?.(fresh);
      if (this.mode === 'place') this.#schedulePreview();
      this.deps.changed?.();
    }
    return !this.limited && Boolean(this.#last) && vertexKey(this.#last!) !== vertexKey(vertex);
  }
  #body(): RoadAnchorsPreviewRequest {
    const anchors = [...this.vertices.values()];
    return this.mode === 'remove' ? { action: 'remove', anchors } : { action: 'place', accessory: 'brazier', anchors };
  }
  #schedulePreview() {
    if (this.#timer !== null || this.#disposed) return;
    this.#timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.#timer = null;
      this.#flushPreview();
    }, PREVIEW_DELAY_MS);
  }
  #flushPreview() {
    if (this.#disposed || !this.vertices.size) return;
    if (this.#timer !== null) {
      (this.deps.clearTimer ?? clearTimeout)(this.#timer as ReturnType<typeof setTimeout>);
      this.#timer = null;
    }
    if (this.#inFlight) return;
    this.#inFlight = true;
    const version = this.#version;
    void this.deps
      .preview(this.#body())
      .then(
        (result): Quote => ({
          version,
          valid: result.valid,
          message: result.message,
          stone: result.quote.stone,
          wood: result.quote.wood,
          skipped: result.result?.skipped ?? [],
        }),
        (reason: unknown): Quote => ({
          version,
          valid: false,
          message: reason instanceof Error ? reason.message : 'Devis indisponible.',
          stone: 0,
          wood: 0,
          skipped: [],
        }),
      )
      .then((quote) => {
        this.#inFlight = false;
        if (this.#disposed) return;
        if (quote.version === this.#version) {
          this.quote = quote;
          this.deps.tone?.(quote.valid ? this.mode : 'invalid');
          this.#markRefused(quote.skipped);
          if (this.#sendWhenQuoted && !this.drawing) this.#release();
          this.deps.changed?.();
        } else if (this.vertices.size) {
          if (this.#sendWhenQuoted && !this.drawing) this.#flushPreview();
          else this.#schedulePreview();
        }
      });
  }
  #markRefused(skipped: readonly RoadAnchorSkip[]) {
    const fresh: Vertex[] = [];
    for (const { vertexX, vertexY } of skipped) {
      const k = key(vertexX, vertexY);
      if (this.#refused.has(k) || !this.vertices.has(k)) continue;
      this.#refused.add(k);
      fresh.push({ vertexX, vertexY });
    }
    if (fresh.length) this.deps.refused?.(fresh);
  }
  /** A quote without any valid anchor aborts; otherwise the server skips the refused anchors itself. */
  #release() {
    this.#sendWhenQuoted = false;
    const quote = this.quote!;
    if (!quote.valid) {
      this.error = quote.message ?? 'Pose impossible.';
      this.#reset();
      return;
    }
    void this.#send();
  }
  async #send(request?: RoadAnchorsRequest) {
    if (this.busy) {
      if (!request) this.#queued = true;
      return;
    }
    const sentVersion = this.#version;
    const anchors = [...this.vertices.values()],
      sent: RoadAnchorsRequest =
        request ??
        (this.mode === 'remove'
          ? { commandId: this.deps.uuid(), action: 'remove', anchors }
          : {
              commandId: this.deps.uuid(),
              action: 'place',
              accessory: 'brazier',
              anchors,
              expectedQuote: { stone: this.quote!.stone, wood: this.quote!.wood },
            });
    this.busy = true;
    this.error = null;
    this.deps.changed?.();
    try {
      const result = await this.deps.command(sent);
      if (this.#disposed) return;
      this.uncertain = null;
      this.notice = anchorSummary(result);
    } catch (reason) {
      if (this.#disposed) return;
      const status = (reason as { status?: unknown })?.status;
      this.error = reason instanceof Error ? reason.message : 'Commande impossible.';
      this.uncertain = typeof status === 'number' && status < 500 ? null : sent;
    } finally {
      this.busy = false;
    }
    // The V2 effects of the confirmation now carry the anchors.
    if (sentVersion === this.#version) this.#reset();
    if (this.#queued && !this.drawing && this.vertices.size) {
      this.#queued = false;
      if (this.mode === 'remove') void this.#send();
      else if (this.quoteCurrent) this.#release();
      else {
        this.#sendWhenQuoted = true;
        this.#flushPreview();
      }
    }
    this.deps.changed?.();
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const SKIP_REASONS: Record<RoadAnchorSkipCode, string> = {
  ANCHOR_MISSING: 'plus de route',
  FOREIGN_INFRASTRUCTURE: 'autre village',
  ANCHOR_OCCUPIED: 'déjà occupé',
  ENGAGED_PASSAGE: 'trajet en cours',
};
/** « M sautés (motif principal) »: the most frequent motive, the first seen on a tie. */
export function skippedAnchorsLabel(skipped: readonly RoadAnchorSkip[] | undefined): string | null {
  if (!skipped?.length) return null;
  const counts = new Map<RoadAnchorSkipCode, number>();
  for (const { code } of skipped) counts.set(code, (counts.get(code) ?? 0) + 1);
  let main = skipped[0]!.code;
  for (const [code, n] of counts) if (n > counts.get(main)!) main = code;
  return `${plural(skipped.length, 'sauté', 'sautés')} (${SKIP_REASONS[main] ?? main})`;
}
export function anchorSummary(result: RoadAnchorsResult): string {
  const parts = [
    result.placed && plural(result.placed, 'brasero posé', 'braseros posés'),
    result.restored && plural(result.restored, 'brasero rétabli', 'braseros rétablis'),
    result.removed && plural(result.removed, 'brasero retiré', 'braseros retirés'),
  ].filter(Boolean);
  const skipped = skippedAnchorsLabel(result.skipped);
  return (
    (parts.length ? parts.join(' · ') : 'Rien à changer') +
    (skipped ? ` · ${skipped}` : '') +
    (result.stone ? ` · −${result.stone} ◆` : '') +
    (result.wood ? ` · −${result.wood} ▰` : '')
  );
}
