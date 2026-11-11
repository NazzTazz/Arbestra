import { triangleHeight, terrainFeatureKey } from '@arbestra/contracts';
import { clientTime } from '../dev/statistics';
import { rc1Height } from './rc1-terrain';
import type {
  NaturalFeature,
  StoneDeposit,
  TerrainChunk,
  TerrainResponse,
  TerrainUpdatesChunk,
  TerrainUpdatesResponse,
  VillageState,
} from '@arbestra/contracts';
import { normalize, type ChunkDemand } from './world-space';
import { TERRAIN_STREAMING as SETTINGS } from './terrain-settings';

interface Entry {
  incarnation: number;
  sequence: number;
  invalidation: number;
  inFlight: boolean;
  chunk?: TerrainChunk;
  groundRevision?: number;
  /** Revision of the last publication that was not a prediction: the whole chunk may differ. */
  baseGroundRevision?: number;
  /** Cells (local index y * chunkSize + x) a prediction changed since, with that revision. */
  cellRevisions?: Map<number, number>;
  freshAt: number;
  retryAt: number;
  failures: number;
  touched: number;
  /** null: the chunk was patched by a prediction, its signature is computed when an answer is compared. */
  mutableSignature: string | null;
  /** Changes whenever what chunk() returns for this entry may have changed (featureVersion). */
  featureVersion: number;
}
export type TerrainFetch = (
  chunks: Array<{ chunkX: number; chunkY: number }>,
  signal: AbortSignal,
  updatesOnly: boolean,
) => Promise<TerrainResponse | TerrainUpdatesResponse>;
function hasGround(chunk: TerrainUpdatesChunk): chunk is TerrainChunk {
  return (
    'terrainCodes' in chunk &&
    Array.isArray(chunk.terrainCodes) &&
    'elevations' in chunk &&
    Array.isArray(chunk.elevations)
  );
}
const sameNumbers = (a: readonly number[], b: readonly number[]) =>
  a === b || (a.length === b.length && a.every((value, index) => value === b[index]));
function sameChunkGround(a: TerrainChunk | undefined, b: TerrainChunk): boolean {
  if (
    !a ||
    a.originCellX !== b.originCellX ||
    a.originCellY !== b.originCellY ||
    !sameNumbers(a.terrainCodes, b.terrainCodes) ||
    !sameNumbers(a.elevations, b.elevations)
  )
    return false;
  if (a.rc1 === b.rc1) return true;
  if (!a.rc1 || !b.rc1) return false;
  const before = a.rc1,
    after = b.rc1;
  return (
    before.model === after.model &&
    before.stride === after.stride &&
    sameNumbers(before.heights, after.heights) &&
    sameNumbers(before.water, after.water) &&
    before.terraces.length === after.terraces.length &&
    before.terraces.every((terrace, index) => {
      const next = after.terraces[index]!;
      return terrace.cellX === next.cellX && terrace.cellY === next.cellY && terrace.height === next.height;
    })
  );
}
/** What a refreshed chunk may change besides its immutable ground: a
 * difference marks the chunk changed for the renderer. */
/** Longest hold of a chunk by a terraforming prediction without an answer. */
export const PREDICTION_HOLD_MS = 30_000;
const mutableSignature = (chunk: TerrainUpdatesChunk) =>
  JSON.stringify([
    chunk.features,
    chunk.occupiedCells,
    chunk.rc1?.model === 'vertices' ? chunk.rc1 : (chunk.rc1Edits?.terraces ?? chunk.rc1?.terraces),
  ]);
export class TerrainStore {
  readonly entries = new Map<string, Entry>();
  readonly revisions = new Map<string, StoneDeposit>();
  readonly changed = new Set<string>();
  /** Vertices a terraforming prediction changed, by chunk (index in its
   * shared-vertex patch): ground only, consumed by the renderer each frame. */
  readonly groundEdits = new Map<string, Set<number>>();
  readonly world: TerrainResponse['world'];
  #snapshot: VillageState;
  #groundRevision = 0;
  #snapshotGroundRevision = 0;
  /** Revision of values returned by ground(), published before terrain-mesh admission. */
  get groundRevision(): number {
    return this.#groundRevision;
  }
  /** Chunks a terraforming prediction holds, with the number of predictions on each. */
  readonly #held = new Map<string, number>();
  readonly #heldSince = new Map<string, number>();
  /**
   * A terraforming prediction (docs/SPEC-TERRAFORMATION-OUTIL.md §7): shows
   * these vertex heights at once, before the server answers, on the path of a
   * server edit. The cached shared-vertex chunks holding them (both for a
   * vertex on their border) are copied, patched and published as a ground
   * change: the renderer rebuilds only the units whose vertices changed. The
   * chunks are held until `release`: an answer already on its way is dropped
   * (it predates the prediction) and none is fetched meanwhile, so the
   * prediction never flickers back. O(vertices) plus one copy of the heights
   * of each touched chunk; a live stroke calls it at most once per frame
   * (ui/terraform-live.ts).
   * Returns the held chunk keys.
   */
  predict(vertices: readonly { vertexX: number; vertexY: number; height: number }[]): string[] {
    const { widthCells: w, heightCells: h, chunkSize: s } = this.world;
    const copies = new Map<string, TerrainChunk>(),
      edited = new Map<string, number[]>();
    for (const v of vertices) {
      const x = normalize(v.vertexX, w),
        y = normalize(v.vertexY, h);
      for (const cy of y % s === 0 ? [y, normalize(y - 1, h)] : [y])
        for (const cx of x % s === 0 ? [x, normalize(x - 1, w)] : [x]) {
          const key = this.key(cx, cy),
            chunk = copies.get(key) ?? this.entries.get(key)?.chunk,
            patch = chunk?.rc1;
          if (!chunk || !patch || patch.model !== 'vertices') continue;
          const dx = normalize(x - chunk.originCellX, w),
            dy = normalize(y - chunk.originCellY, h);
          if (dx >= patch.stride || dy >= patch.stride) continue;
          let copy = copies.get(key);
          if (!copy) {
            copy = { ...chunk, rc1: { ...patch, heights: [...patch.heights] } };
            copies.set(key, copy);
          }
          copy.rc1!.heights[dy * patch.stride + dx] = v.height;
          let indexes = edited.get(key);
          if (!indexes) edited.set(key, (indexes = []));
          indexes.push(dy * patch.stride + dx);
        }
    }
    for (const [key, chunk] of copies) {
      const entry = this.entries.get(key)!,
        stride = chunk.rc1!.stride,
        cells = new Set<number>();
      // A vertex is a corner of the four cells around it (the chunk's own only).
      for (const index of edited.get(key)!) {
        const vx = index % stride,
          vy = Math.floor(index / stride);
        for (const cy of [vy - 1, vy])
          for (const cx of [vx - 1, vx]) if (cx >= 0 && cy >= 0 && cx < s && cy < s) cells.add(cy * s + cx);
      }
      entry.invalidation++;
      this.#publishGround(entry, chunk, cells);
      entry.mutableSignature = null;
      // Only the ground units reading these vertices are rebuilt
      // (TerrainRenderer.queueGroundEdits), never the whole chunk.
      let units = this.groundEdits.get(key);
      if (!units) this.groundEdits.set(key, (units = new Set()));
      for (const index of edited.get(key)!) units.add(index);
      this.#held.set(key, (this.#held.get(key) ?? 0) + 1);
      this.#heldSince.set(key, this.now());
    }
    return [...copies.keys()];
  }
  /** The server answered a prediction (or failed): once no prediction holds a
   * chunk, it is read again and the server's terrain replaces the predicted
   * one; the units are rebuilt only where they differ (a refused cell). */
  release(keys: readonly string[]): void {
    for (const key of keys) {
      const count = (this.#held.get(key) ?? 0) - 1;
      if (count > 0) {
        this.#held.set(key, count);
        continue;
      }
      this.#held.delete(key);
      this.#heldSince.delete(key);
      this.invalidate(key);
      this.#nextDemandAt = Math.min(this.#nextDemandAt, this.now());
    }
  }
  /** Whether a prediction holds this chunk (test probe). */
  held(key: string): boolean {
    return this.#held.has(key);
  }
  /** A hold never outlives PREDICTION_HOLD_MS: an answer lost by the page
   * must not freeze a chunk on its prediction. */
  #isHeld(key: string, now: number): boolean {
    if (!this.#held.has(key)) return false;
    if (now - (this.#heldSince.get(key) ?? now) < PREDICTION_HOLD_MS) return true;
    this.#held.delete(key);
    this.#heldSince.delete(key);
    this.invalidate(key);
    return false;
  }
  /** `predicted`: the only cells a terraforming prediction changed (groundCellRevision).
   * `featuresChanged`: false for a periodic refresh returning the same features,
   * occupied cells and terraces, which must not wake featureVersion readers. */
  #publishGround(entry: Entry, chunk: TerrainChunk, predicted?: ReadonlySet<number>, featuresChanged = true) {
    if (!sameChunkGround(entry.chunk, chunk)) {
      const revision = (entry.groundRevision = ++this.#groundRevision);
      if (predicted && entry.chunk) {
        entry.cellRevisions ??= new Map();
        for (const cell of predicted) entry.cellRevisions.set(cell, revision);
      } else {
        entry.baseGroundRevision = revision;
        delete entry.cellRevisions;
      }
    }
    entry.chunk = chunk;
    if (featuresChanged) entry.featureVersion = ++this.#featureVersions;
  }
  #featureVersions = 0;
  /**
   * A value that changes whenever the features or deposits chunk(key) returns
   * may have changed (a publication, an invalidation, a newer deposit), never
   * repeated: a cache keyed on it rereads a chunk only after a change (O(1) check).
   */
  featureVersion(key: string): number {
    return this.entries.get(key)?.featureVersion ?? -1;
  }
  /** Local dependency for continuous probes: a whole substrate chunk, or snapshot fallback. */
  groundRevisionAt(x: number, y: number): number {
    const entry = this.entries.get(
      this.key(normalize(Math.round(x), this.world.widthCells), normalize(Math.round(y), this.world.heightCells)),
    );
    return entry?.chunk ? entry.groundRevision! : this.#snapshotGroundRevision;
  }
  /**
   * groundRevisionAt, except where ground() can return nothing at all (no
   * chunk, outside the village snapshot): a constant -1 there, so that a new
   * snapshot (each applied command of a stroke) does not invalidate the whole
   * region for a caller that caches by revision (RegionalOverview.fitGround). O(1).
   */
  groundSourceRevision(x: number, y: number): number {
    const { widthCells: w, heightCells: h } = this.world;
    x = normalize(Math.round(x), w);
    y = normalize(Math.round(y), h);
    if (this.entries.get(this.key(x, y))?.chunk) return this.groundRevisionAt(x, y);
    const r = this.#snapshot.region;
    return normalize(x - r.originCellX, w) < r.width && normalize(y - r.originCellY, h) < r.height
      ? this.#snapshotGroundRevision
      : -1;
  }
  /**
   * The same dependency for one cell: what ground() returns anywhere in the
   * cell (its four corners) changes only when this changes. A terraforming
   * prediction moves it for the cells around its vertices only, not for the
   * rest of the chunk: a road or a path the stroke does not touch keeps its
   * identity (docs/SPEC-TERRAFORMATION-OUTIL.md §7.14). Any other publication
   * of the chunk moves every cell of it. O(1).
   */
  groundCellRevision(x: number, y: number): number {
    const { widthCells: w, heightCells: h, chunkSize: s } = this.world;
    x = normalize(Math.round(x), w);
    y = normalize(Math.round(y), h);
    const entry = this.entries.get(this.key(x, y)),
      chunk = entry?.chunk;
    if (!chunk) return this.#snapshotGroundRevision;
    const local = normalize(y - chunk.originCellY, h) * s + normalize(x - chunk.originCellX, w);
    return entry.cellRevisions?.get(local) ?? entry.baseGroundRevision ?? entry.groundRevision!;
  }
  #own = new Set<string>();
  #features = new Map<string, NaturalFeature>();
  #missions = new Map<string, string>();
  #demand: ChunkDemand[] = [];
  #controllers = new Set<AbortController>();
  #cancelled = new WeakSet<AbortController>();
  #paused = false;
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #incarnation = 0;
  #disposed = false;
  #nextDemandAt = 0;
  constructor(
    state: VillageState,
    private readonly fetchChunks: TerrainFetch,
    private readonly now = () => Date.now(),
  ) {
    this.world = state.world;
    this.#snapshot = state;
    this.observe(state);
  }
  key(x: number, y: number): string {
    return `${Math.floor(x / this.world.chunkSize)}:${Math.floor(y / this.world.chunkSize)}`;
  }
  get demand(): readonly ChunkDemand[] {
    return this.#demand;
  }
  get pending(): number {
    return this.#controllers.size;
  }
  get paused(): boolean {
    return this.#paused;
  }
  setPaused(paused: boolean): void {
    if (this.#paused === paused) return;
    this.#paused = paused;
    if (paused)
      for (const controller of this.#controllers) {
        this.#cancelled.add(controller);
        controller.abort();
      }
    else this.#nextDemandAt = this.now();
  }
  get degraded(): boolean {
    return this.#demand.some((d) => d.visible && (this.entries.get(d.key)?.failures ?? 0) > 0);
  }
  #entry(key: string): Entry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        incarnation: ++this.#incarnation,
        sequence: 0,
        invalidation: 0,
        inFlight: false,
        freshAt: -Infinity,
        retryAt: 0,
        failures: 0,
        touched: this.now(),
        mutableSignature: '',
        featureVersion: ++this.#featureVersions,
      };
      this.entries.set(key, entry);
    }
    return entry;
  }
  invalidate(key: string): void {
    const e = this.entries.get(key);
    if (e) {
      e.featureVersion = ++this.#featureVersions;
      e.invalidation++;
      e.freshAt = -Infinity;
      e.retryAt = 0;
      this.changed.add(key);
    }
  }
  geographyChanged(): void {
    // Ground normally remains cached. A newly returned map changes that ground
    // authorization, so an updates-only refresh is insufficient.
    for (const controller of this.#controllers) {
      this.#cancelled.add(controller);
      controller.abort();
    }
    for (const key of this.entries.keys()) this.changed.add(key);
    this.groundEdits.clear();
    if (this.entries.size) this.#groundRevision++;
    this.entries.clear();
    this.#nextDemandAt = this.now();
  }
  deposit(deposit: StoneDeposit): void {
    const previous = this.revisions.get(deposit.featureId);
    if (previous && previous.revision >= deposit.revision) return;
    this.revisions.set(deposit.featureId, deposit);
    this.invalidate(this.key(deposit.cellX, deposit.cellY));
  }
  observe(state: VillageState): void {
    const before = this.#snapshot.region,
      after = state.region;
    if (
      before.originCellX !== after.originCellX ||
      before.originCellY !== after.originCellY ||
      before.width !== after.width ||
      before.height !== after.height ||
      !sameNumbers(before.terrainCodes, after.terrainCodes) ||
      !sameNumbers(before.elevations, after.elevations) ||
      !sameNumbers(before.vertexHeights ?? [], after.vertexHeights ?? [])
    )
      this.#snapshotGroundRevision = ++this.#groundRevision;
    if (!sameNumbers(before.elevations, after.elevations)) {
      for (const cell of state.cells) this.invalidate(this.key(cell.cellX, cell.cellY));
    } else if (!sameNumbers(before.vertexHeights ?? [], after.vertexHeights ?? [])) {
      // Only the chunks whose vertices moved (an applied terrain edit): a live
      // stroke confirmed command after command must not requeue the whole
      // village each time (docs/SPEC-TERRAFORMATION-OUTIL.md §7.9). A chunk a
      // prediction holds is read again at its release anyway.
      const now = this.now();
      for (const key of this.#movedChunks(before, state)) if (!this.#isHeld(key, now)) this.invalidate(key);
    }
    this.#snapshot = state;
    const own = new Set(state.cells.filter((c) => c.footprint || c.building).map((c) => `${c.cellX}:${c.cellY}`));
    for (const key of new Set([...own, ...this.#own]))
      if (own.has(key) !== this.#own.has(key)) {
        const [x, y] = key.split(':').map(Number);
        this.invalidate(this.key(x!, y!));
      }
    this.#own = own;
    const siteKeys = new Set(state.region.features.filter((f) => f.type === 'leveling-site').map(terrainFeatureKey));
    for (const [id, f] of this.#features)
      if (f.type === 'leveling-site' && !siteKeys.has(id)) {
        this.#features.delete(id);
        this.invalidate(this.key(f.cellX, f.cellY));
      }
    for (const f of state.region.features) {
      if (f.type === 'leveling-site' && !this.#features.has(terrainFeatureKey(f)))
        this.invalidate(this.key(f.cellX, f.cellY));
      this.#features.set(terrainFeatureKey(f), f);
      if (f.deposit) this.deposit(f.deposit);
    }
    // A server-confirmed disappearance ends the mission, never a local timer.
    const missions = new Map<string, string>();
    for (const e of state.village.extractions) missions.set(e.id, this.key(e.cellX, e.cellY));
    for (const c of state.cells)
      for (const p of c.building?.garden?.plots ?? [])
        if (p.harvest) missions.set(p.harvest.id, this.key(p.cellX, p.cellY));
    for (const [id, key] of new Map([...this.#missions, ...missions]))
      if (missions.has(id) !== this.#missions.has(id)) this.invalidate(key);
    this.#missions = missions;
  }
  /** The chunks holding a vertex whose height differs between two snapshots
   * of the same region (both chunks for a vertex on their border); every
   * chunk of the village's cells when the region itself changed. */
  #movedChunks(before: VillageState['region'], state: VillageState): Set<string> {
    const after = state.region;
    const keys = new Set<string>(),
      a = before.vertexHeights,
      b = after.vertexHeights;
    if (
      !a ||
      !b ||
      a.length !== b.length ||
      before.originCellX !== after.originCellX ||
      before.originCellY !== after.originCellY ||
      before.width !== after.width ||
      before.height !== after.height
    ) {
      for (const cell of state.cells) keys.add(this.key(cell.cellX, cell.cellY));
      return keys;
    }
    const { widthCells: w, heightCells: h, chunkSize: s } = this.world,
      stride = after.width + 1;
    for (let i = 0; i < b.length; i++) {
      if (a[i] === b[i]) continue;
      const x = normalize(after.originCellX + (i % stride), w),
        y = normalize(after.originCellY + Math.floor(i / stride), h);
      for (const cy of y % s === 0 ? [y, normalize(y - 1, h)] : [y])
        for (const cx of x % s === 0 ? [x, normalize(x - 1, w)] : [x]) keys.add(this.key(cx, cy));
    }
    return keys;
  }
  demandChunks(demand: ChunkDemand[], immediate = false): void {
    if (demand.map((d) => d.key + d.visible).join('|') !== this.#demand.map((d) => d.key + d.visible).join('|'))
      this.#nextDemandAt = this.now() + (immediate ? 0 : SETTINGS.coalesceMs);
    const previous = new Set(this.#demand.map((d) => d.key));
    for (const d of demand)
      if (!previous.has(d.key) && this.now() - this.#entry(d.key).freshAt >= SETTINGS.freshnessMs)
        this.invalidate(d.key);
    this.#demand = demand;
    for (const d of demand) this.#entry(d.key).touched = this.now();
    const needed = new Set(demand.map((d) => d.key));
    while (this.entries.size > SETTINGS.cachedChunks) {
      const victim = [...this.entries].filter(([k]) => !needed.has(k)).sort((a, b) => a[1].touched - b[1].touched)[0];
      if (!victim) break;
      if (victim[1].chunk) this.#groundRevision++;
      this.entries.delete(victim[0]);
      this.changed.delete(victim[0]);
      this.groundEdits.delete(victim[0]);
    }
    const missionChunks = new Set(this.#missions.values());
    for (const [id, deposit] of this.revisions)
      if (
        !this.entries.has(this.key(deposit.cellX, deposit.cellY)) &&
        !this.#features.has(id) &&
        !missionChunks.has(this.key(deposit.cellX, deposit.cellY))
      )
        this.revisions.delete(id);
  }
  revalidate(): void {
    for (const d of this.#demand) if (d.visible) this.invalidate(d.key);
  }
  tick(maxConcurrent: number = SETTINGS.concurrentBatches, initial = false): void {
    const now = this.now();
    if (this.#disposed || this.#paused || now < this.#nextDemandAt) return;
    while (this.#controllers.size < Math.max(1, Math.min(SETTINGS.concurrentBatches, maxConcurrent))) {
      const eligible = this.#demand.filter((d) => {
        const e = this.#entry(d.key);
        if ((initial && !d.visible) || this.#isHeld(d.key, now)) return false;
        return (
          !e.inFlight &&
          now >= e.retryAt &&
          (!e.chunk ||
            (d.visible && (e.freshAt === -Infinity || (!initial && now - e.freshAt >= SETTINGS.freshnessMs))) ||
            (!d.visible && e.freshAt === -Infinity))
        );
      });
      const first =
        eligible.find((d) => d.visible && !this.#entry(d.key).chunk) ?? eligible.find((d) => d.visible) ?? eligible[0];
      if (!first) break;
      const updatesOnly = Boolean(this.#entry(first.key).chunk);
      const wanted = eligible
        .filter((d) => Boolean(this.#entry(d.key).chunk) === updatesOnly)
        .slice(0, SETTINGS.batchChunks);
      const tickets = wanted.map((d) => {
        const e = this.#entry(d.key);
        e.inFlight = true;
        return { key: d.key, incarnation: e.incarnation, sequence: ++e.sequence, invalidation: e.invalidation };
      });
      const controller = new AbortController();
      this.#controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), SETTINGS.requestTimeoutMs);
      this.#timers.add(timeout);
      // Abort must release admission even if a transport/body parser never settles.
      // The raced transport may still finish later; it has no publishing callback.
      let onAbort: () => void;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('Terrain request aborted'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      let fetched: Promise<TerrainResponse | TerrainUpdatesResponse>;
      try {
        fetched = this.fetchChunks(wanted, controller.signal, updatesOnly);
      } catch (error) {
        fetched = Promise.reject(error);
      }
      void Promise.race([fetched, aborted])
        .then((response) => {
          return clientTime('terrain', () => {
            if (this.#cancelled.has(controller)) return;
            if (
              this.#disposed ||
              response.world.id !== this.world.id ||
              response.world.generationVersion !== this.world.generationVersion ||
              response.world.chunkSize !== this.world.chunkSize ||
              response.world.widthCells !== this.world.widthCells ||
              response.world.heightCells !== this.world.heightCells
            )
              throw new Error('Terrain scope mismatch');
            for (const ticket of tickets) {
              const e = this.entries.get(ticket.key),
                chunk = response.chunks.find((c) => `${c.chunkX}:${c.chunkY}` === ticket.key);
              if (!e || e.incarnation !== ticket.incarnation || e.sequence !== ticket.sequence) continue;
              const fullChunk = chunk && hasGround(chunk) ? chunk : undefined;
              if (
                !chunk ||
                (updatesOnly
                  ? !e.chunk
                  : !fullChunk ||
                    fullChunk.terrainCodes.length !== (this.world.chunkSize + 2) ** 2 ||
                    fullChunk.elevations.length !== fullChunk.terrainCodes.length)
              )
                throw new Error('Incomplete terrain');
              const stale =
                ticket.invalidation !== e.invalidation ||
                chunk.features.some((f) => f.deposit && (this.revisions.get(f.id)?.revision ?? 0) > f.deposit.revision);
              if (stale) {
                if (!e.chunk && fullChunk) {
                  this.#publishGround(e, { ...fullChunk, features: [], occupiedCells: [] });
                  this.changed.add(ticket.key);
                }
                e.freshAt = -Infinity;
                continue;
              }
              for (const f of chunk.features) if (f.deposit) this.revisions.set(f.id, f.deposit);
              const signature = mutableSignature(chunk),
                mutated = !e.chunk || signature !== (e.mutableSignature ?? mutableSignature(e.chunk));
              if (mutated) this.changed.add(ticket.key);
              if (e.chunk) {
                if (chunk.rc1Edits && !e.chunk.rc1) throw new Error('RC1 edits without substrate');
                const rc1 =
                  chunk.rc1Edits && e.chunk.rc1 ? { ...e.chunk.rc1, terraces: chunk.rc1Edits.terraces } : chunk.rc1;
                this.#publishGround(
                  e,
                  {
                    ...chunk,
                    ...(rc1 ? { rc1 } : {}),
                    terrainCodes: e.chunk.terrainCodes,
                    elevations: e.chunk.elevations,
                  },
                  undefined,
                  mutated,
                );
              } else if (fullChunk) this.#publishGround(e, fullChunk);
              e.mutableSignature = signature;
              e.freshAt = this.now();
              e.failures = 0;
              e.retryAt = 0;
            }
          });
        })
        .catch(() => {
          if (this.#disposed || this.#cancelled.has(controller)) return;
          for (const t of tickets) {
            const e = this.entries.get(t.key);
            if (e?.incarnation !== t.incarnation) continue;
            e.retryAt = this.now() + [2000, 5000, 10000][Math.min(e.failures++, 2)]!;
          }
        })
        .finally(() => {
          controller.signal.removeEventListener('abort', onAbort!);
          clearTimeout(timeout);
          this.#timers.delete(timeout);
          this.#controllers.delete(controller);
          for (const t of tickets) {
            const e = this.entries.get(t.key);
            if (e?.incarnation === t.incarnation && e.sequence === t.sequence) e.inFlight = false;
          }
        });
    }
  }
  chunk(key: string): TerrainChunk | undefined {
    const entry = this.entries.get(key),
      chunk = entry?.chunk;
    if (!chunk) return;
    const features = new Map(chunk.features.map((f) => [terrainFeatureKey(f), f]));
    // A stale chunk shows the snapshot's features, which carry no RC1 tree
    // geometry: keep the chunk's, or the grove jumps to a generic layout.
    if (entry!.freshAt === -Infinity)
      for (const f of this.#features.values())
        if (this.key(f.cellX, f.cellY) === key) {
          const rc1 = f.rc1 ?? features.get(terrainFeatureKey(f))?.rc1;
          features.set(terrainFeatureKey(f), rc1 ? { ...f, rc1 } : f);
        }
    const occupied = new Map(chunk.occupiedCells.map((c) => [`${c.cellX}:${c.cellY}`, c]));
    for (const k of this.#own) {
      const [cellX, cellY] = k.split(':').map(Number);
      if (this.key(cellX!, cellY!) === key) occupied.set(k, { cellX: cellX!, cellY: cellY! });
    }
    return {
      ...chunk,
      features: [...features.values()].map((f) => ({ ...f, deposit: this.revisions.get(f.id) ?? f.deposit })),
      occupiedCells: [...occupied.values()],
    };
  }
  naturalFeatures(): NaturalFeature[] {
    const features = new Map(this.#snapshot.region.features.map((f) => [terrainFeatureKey(f), f]));
    // Navigation uses all known cached chunks, not only the current viewport.
    for (const key of this.entries.keys())
      for (const f of this.chunk(key)?.features ?? []) features.set(terrainFeatureKey(f), f);
    return [...features.values()].map((f) => ({ ...f, deposit: this.revisions.get(f.id) ?? f.deposit }));
  }
  /** Exact rendered corner in terrain units, including retained chunk borders. No I/O. */
  vertexHeight(x: number, y: number): number | null {
    const { widthCells: w, heightCells: h, chunkSize: s } = this.world;
    x = normalize(x, w);
    y = normalize(y, h);
    for (const cy of y % s === 0 ? [y, normalize(y - 1, h)] : [y])
      for (const cx of x % s === 0 ? [x, normalize(x - 1, w)] : [x]) {
        const chunk = this.entries.get(this.key(cx, cy))?.chunk;
        if (!chunk?.rc1) continue;
        const dx = normalize(x - chunk.originCellX, w),
          dy = normalize(y - chunk.originCellY, h);
        if (dx > s || dy > s) continue;
        const value = rc1Height(chunk, chunk.originCellX + dx - 0.5, chunk.originCellY + dy - 0.5);
        if (value !== null && Number.isFinite(value)) return value / 2.5;
      }
    const r = this.#snapshot.region,
      dx = normalize(x - r.originCellX, w),
      dy = normalize(y - r.originCellY, h);
    const value = dx <= r.width && dy <= r.height ? r.vertexHeights?.[dy * (r.width + 1) + dx] : undefined;
    return value !== undefined && Number.isFinite(value) ? value : null;
  }
  ground(x: number, y: number): { code: number; height: number } | null {
    const { widthCells: w, heightCells: h, chunkSize: s } = this.world;
    const continuousX = x,
      continuousY = y;
    x = normalize(Math.round(x), w);
    y = normalize(Math.round(y), h);
    const chunk = this.entries.get(this.key(x, y))?.chunk;
    let code: number | undefined, elevation: number | undefined;
    if (chunk?.rc1) {
      const height = rc1Height(
        chunk,
        x + (continuousX - Math.round(continuousX)),
        y + (continuousY - Math.round(continuousY)),
      )!;
      const i = (y - chunk.originCellY + 1) * (s + 2) + x - chunk.originCellX + 1;
      return { height, code: chunk.terrainCodes[i] ?? 1 };
    }
    if (chunk) {
      const index = (y - chunk.originCellY + 1) * (s + 2) + x - chunk.originCellX + 1;
      code = chunk.terrainCodes[index];
      elevation = chunk.elevations[index];
    } else {
      const r = this.#snapshot.region,
        lx = normalize(x - r.originCellX, w),
        ly = normalize(y - r.originCellY, h);
      if (r.vertexHeights && lx < r.width && ly < r.height) {
        const u = continuousX - Math.round(continuousX) + 0.5,
          v = continuousY - Math.round(continuousY) + 0.5,
          stride = r.width + 1;
        const at = (dx: number, dy: number) => r.vertexHeights![(ly + dy) * stride + lx + dx]!;
        return {
          code: r.terrainCodes[ly * r.width + lx] ?? 1,
          height: triangleHeight(at(0, 0), at(1, 0), at(1, 1), at(0, 1), u, v) * 2.5,
        };
      }
      if (lx < r.width && ly < r.height) {
        code = r.terrainCodes[ly * r.width + lx];
        elevation = r.elevations[ly * r.width + lx];
      }
    }
    return code === undefined || elevation === undefined
      ? null
      : { code, height: code === 2 ? -0.75 : elevation * 0.025 };
  }
  dispose(): void {
    this.#disposed = true;
    for (const c of this.#controllers) c.abort();
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    this.#controllers.clear();
    this.entries.clear();
    this.revisions.clear();
    this.changed.clear();
    this.groundEdits.clear();
  }
}
