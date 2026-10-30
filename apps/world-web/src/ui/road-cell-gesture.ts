import {
  ROAD_CELLS_PER_COMMAND,
  wrapCoordinate,
  wrappedDistance,
  type RoadCellSkip,
  type RoadCellSkipCode,
  type RoadCellStyle,
  type RoadCellsPreview,
  type RoadCellsPreviewRequest,
  type RoadCellsRequest,
  type RoadCellsResult,
} from '@arbestra/contracts';

export type Cell = { cellX: number; cellY: number };
type World = { widthCells: number; heightCells: number };
export type RoadCellMode =
  | { action: 'place'; style: Pick<RoadCellStyle, 'surface' | 'sidewalks'> }
  | { action: 'remove' };
export type RoadCellTone = 'place' | 'remove' | 'invalid';

/** Most cells one pointer sample may add: a fast swipe catches up on the next samples. */
export const MAX_SWEEP_STEP = 64;
/** Quiet time before quoting the designated cells (one read-only request at a time). */
export const PREVIEW_DELAY_MS = 120;
const key = (c: Cell) => c.cellX + ':' + c.cellY;

/**
 * Cells crossed from `from` (excluded) towards `to`, on the torus, in
 * 4-connexity: two consecutive cells always share a side, so a diagonal
 * swipe leaves no hole between road cells. At most `limit` cells; the last
 * one is `to` only when it is reached within the limit.
 */
export function sweptCells4(from: Cell | null, to: Cell, world: World, limit = MAX_SWEEP_STEP): Cell[] {
  if (!from) return [to];
  const dx = wrappedDistance(to.cellX, from.cellX, world.widthCells),
    dy = wrappedDistance(to.cellY, from.cellY, world.heightCells),
    nx = Math.abs(dx),
    ny = Math.abs(dy),
    sx = Math.sign(dx),
    sy = Math.sign(dy),
    steps = Math.min(limit, nx + ny);
  const cells: Cell[] = [];
  let ix = 0,
    iy = 0;
  for (let i = 0; i < steps; i++) {
    // Step along the axis whose next cell centre stays closest to the segment.
    if (iy >= ny || (ix < nx && (1 + 2 * ix) * ny < (1 + 2 * iy) * nx)) ix++;
    else iy++;
    cells.push({
      cellX: wrapCoordinate(from.cellX + ix * sx, world.widthCells),
      cellY: wrapCoordinate(from.cellY + iy * sy, world.heightCells),
    });
  }
  return cells;
}

export interface RoadCellGestureDeps {
  world: World;
  preview: (body: RoadCellsPreviewRequest) => Promise<RoadCellsPreview>;
  command: (request: RoadCellsRequest) => Promise<RoadCellsResult>;
  uuid: () => string;
  /** Newly designated cells of the current gesture, once each. */
  added?: (cells: readonly Cell[]) => void;
  /** Designated cells the current quote skips (shown red), once each. */
  refused?: (cells: readonly Cell[]) => void;
  /** The designation is dropped (cancel, refusal, acceptance). */
  cleared?: () => void;
  tone?: (tone: RoadCellTone) => void;
  /** Status changed (cells, quote, busy, error): re-render the feedback. */
  changed?: () => void;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Quote {
  version: number;
  valid: boolean;
  message: string | null;
  stone: number;
  /** Cells the placement will skip (bâtiment, gisement, terrain…). */
  skipped: RoadCellSkip[];
}

/**
 * Road cell tool, client gesture (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md
 * §4.2): press, drag, release designate cells; the release sends one V2
 * command with the quote shown. Each pointer sample costs at most
 * MAX_SWEEP_STEP set insertions; quotes are coalesced (one in flight, a
 * quiet delay, the latest cells only).
 */
export class RoadCellGesture {
  readonly cells = new Map<string, Cell>();
  mode: RoadCellMode = { action: 'place', style: { surface: 'earth', sidewalks: false } };
  drawing = false;
  busy = false;
  limited = false;
  error: string | null = null;
  notice: string | null = null;
  quote: Quote | null = null;
  uncertain: RoadCellsRequest | null = null;
  #last: Cell | null = null;
  readonly #refused = new Set<string>();
  #version = 0;
  #timer: unknown = null;
  #inFlight = false;
  #sendWhenQuoted = false;
  #queued = false;
  #disposed = false;
  constructor(private readonly deps: RoadCellGestureDeps) {}

  get version() {
    return this.#version;
  }
  /** Whether the quote shown matches the designated cells and style. */
  get quoteCurrent() {
    return this.quote?.version === this.#version;
  }
  setMode(mode: RoadCellMode) {
    this.cancel();
    this.mode = mode;
    this.error = null;
    this.notice = null;
    this.deps.changed?.();
  }
  /** A gesture may start while the previous command is in flight; its release then waits for it. */
  down(cell: Cell) {
    if (this.#disposed) return;
    this.#reset();
    this.error = null;
    this.notice = null;
    this.drawing = true;
    this.deps.tone?.(this.mode.action === 'remove' ? 'remove' : 'place');
    this.#extend(cell);
  }
  move(cell: Cell) {
    if (this.drawing) this.#extend(cell);
  }
  up(cell: Cell | null) {
    if (!this.drawing) return;
    // Bounded catch-up to the release cell, MAX_SWEEP_STEP cells per pass.
    if (cell)
      for (let pass = 0; pass < ROAD_CELLS_PER_COMMAND / MAX_SWEEP_STEP + 1; pass++) if (!this.#extend(cell)) break;
    this.drawing = false;
    if (!this.cells.size) return;
    if (this.mode.action === 'remove') void this.#send();
    else {
      this.#sendWhenQuoted = true;
      if (this.quoteCurrent) this.#release();
      else this.#flushPreview();
    }
    this.deps.changed?.();
  }
  /** Right click, Escape or a lost pointer: the gesture in progress is dropped, nothing is sent. */
  cancel() {
    this.#queued = false;
    this.#reset();
    this.deps.changed?.();
  }
  /** Same request, same identifier: an uncertain outcome is resolved idempotently. */
  retry() {
    if (this.uncertain && !this.busy) void this.#send(this.uncertain);
  }
  /** A disposed gesture ignores late answers and pointer events until resumed. */
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
    if (this.cells.size) {
      this.cells.clear();
      this.deps.cleared?.();
    }
    this.#version++;
  }
  /** Adds the cells crossed towards `cell`; false once `cell` is reached or the gesture is full. */
  #extend(cell: Cell): boolean {
    const swept = sweptCells4(this.#last, cell, this.deps.world),
      fresh: Cell[] = [];
    for (const c of swept) {
      const k = key(c);
      if (this.cells.has(k)) continue;
      if (this.cells.size >= ROAD_CELLS_PER_COMMAND) {
        this.limited = true;
        break;
      }
      this.cells.set(k, c);
      fresh.push(c);
    }
    if (swept.length) this.#last = swept.at(-1)!;
    if (fresh.length) {
      this.#version++;
      this.deps.added?.(fresh);
      this.#schedulePreview();
      this.deps.changed?.();
    }
    return !this.limited && Boolean(this.#last) && key(this.#last!) !== key(cell);
  }
  #body(): RoadCellsPreviewRequest {
    const cells = [...this.cells.values()];
    return this.mode.action === 'remove'
      ? { action: 'remove', cells }
      : { action: 'place', cells, style: { ...this.mode.style } };
  }
  #schedulePreview() {
    if (this.#timer !== null || this.#disposed) return;
    this.#timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.#timer = null;
      this.#flushPreview();
    }, PREVIEW_DELAY_MS);
  }
  #flushPreview() {
    if (this.#disposed || !this.cells.size) return;
    if (this.#timer !== null) {
      (this.deps.clearTimer ?? clearTimeout)(this.#timer as ReturnType<typeof setTimeout>);
      this.#timer = null;
    }
    // One read-only quote at a time; its answer reschedules if the cells moved on.
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
          skipped: result.result?.skipped ?? [],
        }),
        (reason: unknown): Quote => ({
          version,
          valid: false,
          message: reason instanceof Error ? reason.message : 'Devis indisponible.',
          stone: 0,
          skipped: [],
        }),
      )
      .then((quote) => {
        this.#inFlight = false;
        if (this.#disposed) return;
        if (quote.version === this.#version) {
          this.quote = quote;
          this.deps.tone?.(!quote.valid ? 'invalid' : this.mode.action === 'remove' ? 'remove' : 'place');
          this.#markRefused(quote.skipped);
          if (this.#sendWhenQuoted && !this.drawing) this.#release();
          this.deps.changed?.();
        } else if (this.cells.size) {
          if (this.#sendWhenQuoted && !this.drawing) this.#flushPreview();
          else this.#schedulePreview();
        }
      });
  }
  /** Newly skipped cells of the designation, reported once (bounded by the gesture). */
  #markRefused(skipped: readonly RoadCellSkip[]) {
    const fresh: Cell[] = [];
    for (const { cellX, cellY } of skipped) {
      const k = key({ cellX, cellY });
      if (this.#refused.has(k) || !this.cells.has(k)) continue;
      this.#refused.add(k);
      fresh.push({ cellX, cellY });
    }
    if (fresh.length) this.deps.refused?.(fresh);
  }
  /** The release of a placement: a quote without any valid cell aborts the
   * gesture; otherwise the command is sent and the server skips the refused
   * cells itself (Tristan, 30 October), even one refused since the quote. */
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
  async #send(request?: RoadCellsRequest) {
    if (this.busy) {
      // One command at a time: the latest released gesture follows the current one.
      if (!request) this.#queued = true;
      return;
    }
    const sentVersion = this.#version;
    const body = this.#body(),
      sent: RoadCellsRequest =
        request ??
        (body.action === 'remove'
          ? { commandId: this.deps.uuid(), action: 'remove', cells: body.cells }
          : {
              commandId: this.deps.uuid(),
              action: 'place',
              cells: body.cells,
              style: body.style,
              expectedQuote: { stone: this.quote!.stone },
            });
    this.busy = true;
    this.error = null;
    this.deps.changed?.();
    try {
      const result = await this.deps.command(sent);
      if (this.#disposed) return;
      this.uncertain = null;
      this.notice = summary(result);
    } catch (reason) {
      if (this.#disposed) return;
      const status = (reason as { status?: unknown })?.status;
      this.error = reason instanceof Error ? reason.message : 'Commande impossible.';
      // A business refusal rolled back without writing; anything else may have committed.
      this.uncertain = typeof status === 'number' && status < 500 ? null : sent;
    } finally {
      this.busy = false;
    }
    // The V2 effects of the confirmation now carry the cells: drop the designation,
    // unless a newer gesture has started meanwhile.
    if (sentVersion === this.#version) this.#reset();
    if (this.#queued && !this.drawing && this.cells.size) {
      this.#queued = false;
      if (this.mode.action === 'remove') void this.#send();
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
const SKIP_REASONS: Record<RoadCellSkipCode, string> = {
  CELL_OCCUPIED: 'bâtiment ou gisement',
  INCOMPATIBLE_TERRAIN: 'terrain impraticable',
  OUTSIDE_INFRASTRUCTURE_REACH: 'hors du périmètre',
  FOREIGN_INFRASTRUCTURE: 'route d’un autre village',
};
/** « M sautées (motif principal) »: the most frequent motive, the first seen on a tie. */
export function skippedLabel(skipped: readonly RoadCellSkip[] | undefined): string | null {
  if (!skipped?.length) return null;
  const counts = new Map<RoadCellSkipCode, number>();
  for (const { code } of skipped) counts.set(code, (counts.get(code) ?? 0) + 1);
  let main = skipped[0]!.code;
  for (const [code, n] of counts) if (n > counts.get(main)!) main = code;
  return `${plural(skipped.length, 'sautée', 'sautées')} (${SKIP_REASONS[main] ?? main})`;
}
export function summary(result: RoadCellsResult): string {
  const parts = [
    result.placed && plural(result.placed, 'case posée', 'cases posées'),
    result.restyled && plural(result.restyled, 'case modifiée', 'cases modifiées'),
    result.removed && plural(result.removed, 'case retirée', 'cases retirées'),
  ].filter(Boolean);
  const skipped = skippedLabel(result.skipped);
  return (
    (parts.length ? parts.join(' · ') : 'Rien à changer') +
    (skipped ? ` · ${skipped}` : '') +
    (result.stone ? ` · −${result.stone} ◆` : '')
  );
}
