import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { NaturalFeature, TerrainChunk, TravelCell, TravelRoute } from '@arbestra/contracts';
import { pavedProfiles } from './road-profile';
import { buildTerrainUnit, RENDER_UNIT_CELLS as UNIT } from './terrain-unit';
import { type ChunkDemand, WorldSpace, normalize, delta } from './world-space';
import type { TerrainStore } from './terrain-store';
import { TERRAIN_STREAMING } from './terrain-settings';

interface Unit { signature: string; meshes: Mesh[]; ground: boolean }
interface Resident { chunk: Pick<TerrainChunk, 'originCellX' | 'originCellY'>; root: TransformNode; units: Map<string, Unit> }
interface Job { chunkKey: string; key: string; signature: string; ground: boolean; priority: number; distance: number; build: () => Mesh[] }
export class TerrainRenderer {
  readonly residents = new Map<string, Resident>();
  #jobs = new Map<string, Job>();
  #visible = new Set<string>();
  #masks = new Map<string, Set<string>>();
  #ordered: Array<[string, Job]> = [];
  #orderDirty = true;
  #shown = true;
  #roads = new Map<string, number>();
  #roadSignature = '';
  setRoads(routes: readonly TravelRoute[]): void {
    const next = pavedProfiles(routes, this.space.width, this.space.height);
    const signature = JSON.stringify([...next].sort(([a], [b]) => a.localeCompare(b)));
    if (signature === this.#roadSignature) return;
    this.#roadSignature = signature; this.#roads = next;
    for (const key of this.#visible) {
      const chunk = this.store.chunk(key);
      if (chunk) this.#queue(key, chunk);
    }
  }
  #cost = new Map<string, number>();
  version = 0;
  peakGraphicChunks = 0;
  slowestUnit: { kind: string; ms: number } = { kind: '', ms: 0 };
  readonly integrationMs: number[] = [];
  readonly activeIntegrationMs: number[] = [];
  constructor(private readonly scene: Scene, private readonly store: TerrainStore, private readonly space: WorldSpace,
    private readonly groundMaterial: StandardMaterial, private readonly waterMaterial: StandardMaterial,
    private readonly feature: (f: NaturalFeature) => Mesh[], private readonly decor: (c: TerrainChunk, x: number, y: number) => Mesh[],
    private readonly woodland: (features: NaturalFeature[]) => Mesh[], private readonly focus: () => TravelCell = () => space.origin,
    private readonly now: () => number = () => performance.now()) {}
  get queued(): number { return this.#jobs.size; }
  get missingVisible(): boolean { return [...this.#masks].some(([key, mask]) => [...mask].some(unit => !this.residents.get(key)?.units.has(`ground:${unit}`))); }
  meshes(): Mesh[] { return [...this.residents.values()].flatMap((r) => [...r.units.values()].flatMap((u) => u.meshes)); }
  setVisible(shown: boolean): void {
    if (shown === this.#shown) return;
    this.#shown = shown;
    for (const [key, resident] of this.residents) resident.root.setEnabled(shown && this.#visible.has(key));
  }
  #remove(key: string): void {
    const r = this.residents.get(key); if (!r) return;
    for (const u of r.units.values()) for (const m of u.meshes) m.dispose(false, false);
    r.root.dispose();
    this.residents.delete(key); for (const [id, job] of this.#jobs) if (job.chunkKey === key) this.#jobs.delete(id);
    this.version++;
  }
  demand(demand: readonly ChunkDemand[], intersectsUnit: (x: number, y: number, size: number) => boolean = () => true): void {
    const previousVisible = this.#visible;
    const visible = new Set(demand.filter(d => d.visible).map(d => d.key));
    if ([...visible].join('|') !== [...this.#visible].join('|')) { this.#orderDirty = true; this.version++; }
    this.#visible = new Set(demand.filter((d) => d.visible).map((d) => d.key));
    const wanted = new Set(demand.map((d) => d.key));
    const previousMasks = this.#masks;
    this.#masks = new Map();
    for (const d of demand) if (d.visible) {
      const mask = new Set<string>(), size = this.store.world.chunkSize;
      for (let y = 0; y < size; y += UNIT) for (let x = 0; x < size; x += UNIT)
        if (intersectsUnit(d.chunkX * size + x, d.chunkY * size + y, Math.min(UNIT, size - x, size - y))) mask.add(`${x}:${y}`);
      this.#masks.set(d.key, mask);
      if ([...mask].join('|') !== [...(previousMasks.get(d.key) ?? [])].join('|')) this.version++;
    }
    // Outside the demand, old terrain survives a network failure within the hard cap.
    for (const [id, job] of this.#jobs) if (!this.#visible.has(job.chunkKey)) this.#jobs.delete(id);
    while (this.residents.size + demand.filter((d) => d.visible && !this.residents.has(d.key)).length > TERRAIN_STREAMING.graphicChunks - 1) {
      const victim = [...this.residents].filter(([key]) => !visible.has(key)).sort((a, b) => {
        const pa = this.space.project({ cellX: a[1].chunk.originCellX, cellY: a[1].chunk.originCellY });
        const pb = this.space.project({ cellX: b[1].chunk.originCellX, cellY: b[1].chunk.originCellY });
        return Math.hypot(pb.x, pb.z) - Math.hypot(pa.x, pa.z);
      })[0];
      if (!victim) break; this.#remove(victim[0]);
    }
    for (const [key, r] of this.residents) {
      r.root.setEnabled(this.#shown && this.#visible.has(key));
      if (wanted.has(key)) { const p = this.space.project({ cellX: r.chunk.originCellX, cellY: r.chunk.originCellY }); r.root.position.set(p.x, 0, p.z); }
    }
    for (const d of demand) if (d.visible && (this.store.changed.has(d.key) || !this.residents.has(d.key) || !previousVisible.has(d.key)
      || [...this.#masks.get(d.key)!].join('|') !== [...(previousMasks.get(d.key) ?? [])].join('|'))) {
      const chunk = this.store.chunk(d.key); if (!chunk) continue;
      this.#queue(d.key, chunk); this.store.changed.delete(d.key);
    }
  }
  #queue(chunkKey: string, chunk: TerrainChunk): void {
    this.#orderDirty = true;
    let resident = this.residents.get(chunkKey);
    if (!resident) {
      const root = new TransformNode(`terrain-chunk-${chunkKey}`, this.scene);
      const p = this.space.project({ cellX: chunk.originCellX, cellY: chunk.originCellY }); root.position.set(p.x, 0, p.z);
      resident = { chunk: { originCellX: chunk.originCellX, originCellY: chunk.originCellY }, root, units: new Map() }; this.residents.set(chunkKey, resident);
    }
    const keys = new Set<string>();
    const add = (key: string, signature: string, ground: boolean, priority: number, x: number, y: number, build: () => Mesh[]) => {
      keys.add(key); const id = `${chunkKey}/${key}`;
      if (resident.units.get(key)?.signature === signature) { this.#jobs.delete(id); return; }
      const distance = Math.max(Math.abs(delta(x, focus.cellX, this.space.width)), Math.abs(delta(y, focus.cellY, this.space.height)));
      this.#jobs.set(id, { chunkKey, key, signature, ground, priority, distance, build });
    };
    const size = this.store.world.chunkSize;
    const focus = this.focus();
    const mask = this.#masks.get(chunkKey)!;
    const wantedFeature = (f: NaturalFeature) => mask.has(`${Math.floor((f.cellX - chunk.originCellX) / UNIT) * UNIT}:${Math.floor((f.cellY - chunk.originCellY) / UNIT) * UNIT}`);
    for (let y = 0; y < size; y += UNIT) for (let x = 0; x < size; x += UNIT) {
      if (!mask.has(`${x}:${y}`)) continue;
      const inside = (c: { cellX: number; cellY: number }) => c.cellX >= chunk.originCellX + x && c.cellX < chunk.originCellX + x + UNIT
        && c.cellY >= chunk.originCellY + y && c.cellY < chunk.originCellY + y + UNIT;
      const signature = JSON.stringify([chunk.occupiedCells.filter(inside), chunk.features.filter(inside).map((f) => [f.id, f.deposit?.state])]);
      const cx = chunk.originCellX + x + (UNIT - 1) / 2, cy = chunk.originCellY + y + (UNIT - 1) / 2;
      const roads = new Map([...this.#roads].filter(([key]) => {
        const [cellX, cellY] = key.split(':').map(Number);
        return inside({cellX:cellX!, cellY:cellY!});
      }));
      add(`ground:${x}:${y}`, JSON.stringify([...roads].sort(([a], [b]) => a.localeCompare(b))), true, inside(focus) ? -2 : 0, cx, cy,
        () => buildTerrainUnit(this.scene, chunk, x, y, this.space, this.groundMaterial, this.waterMaterial, roads));
      add(`decor:${x}:${y}`, signature, false, 2, cx, cy, () => this.decor(chunk, x, y));
    }
    const featureCenter = (f: NaturalFeature) => ({
      x: chunk.originCellX + Math.floor((f.cellX - chunk.originCellX) / UNIT) * UNIT + (UNIT - 1) / 2,
      y: chunk.originCellY + Math.floor((f.cellY - chunk.originCellY) / UNIT) * UNIT + (UNIT - 1) / 2,
    });
    for (const f of chunk.features.filter(f => f.type !== 'woodland' && wantedFeature(f))) {
      const { x, y } = featureCenter(f);
      add(`feature:${f.id}`, JSON.stringify(f), false, 1, x, y, () => this.feature(f));
    }
    const woods = chunk.features.filter(f => f.type === 'woodland' && wantedFeature(f)).sort((a, b) => a.cellY - b.cellY || a.cellX - b.cellX || a.id.localeCompare(b.id));
    for (let i = 0; i < woods.length; i++) {
      const batch = woods.slice(i, i + 1);
      const { x, y } = featureCenter(batch[0]!);
      add(`woodland:${batch[0]!.id}`, JSON.stringify(batch), false, 1, x, y, () => this.woodland(batch));
    }
    const featureKeys = new Set(chunk.features.map(f => `${f.type === 'woodland' ? 'woodland' : 'feature'}:${f.id}`));
    // Camera masks control new work, not the lifetime of already built tiles.
    // Whole residents are still evicted under the same hard chunk cap.
    for (const [key, u] of resident.units) if ((key.startsWith('feature:') || key.startsWith('woodland:')) && !featureKeys.has(key)) {
      for (const m of u.meshes) m.dispose(false, false); resident.units.delete(key); this.version++;
    }
    for (const [id, j] of this.#jobs) if (j.chunkKey === chunkKey && !keys.has(j.key)) this.#jobs.delete(id);
  }
  tick(): void {
    const started = this.now();
    // One bounded unit at a time. Admission reserves one allocation beyond residents.
    const demandOrder = new Map(this.store.demand.map((d, i) => [d.key, i]));
    if (this.#orderDirty) this.#ordered = [...this.#jobs].sort((a, b) => {
      const va = this.#visible.has(a[1].chunkKey), vb = this.#visible.has(b[1].chunkKey);
      return Number(vb) - Number(va) || Number(b[1].priority < 0) - Number(a[1].priority < 0)
        || Math.floor(a[1].distance / UNIT) - Math.floor(b[1].distance / UNIT) || a[1].priority - b[1].priority
        || (demandOrder.get(a[1].chunkKey) ?? 999) - (demandOrder.get(b[1].chunkKey) ?? 999);
    });
    this.#orderDirty = false;
    const hadJobs = this.#jobs.size > 0;
    let published = 0;
    while (this.#ordered.length) {
      if (this.now() - started >= TERRAIN_STREAMING.admissionMs) break;
      const [id, job] = this.#ordered[0]!;
      if (this.#jobs.get(id) !== job) { this.#ordered.shift(); continue; }
      const kind = job.key.split(':')[0]!;
      if (published && this.now() - started + (this.#cost.get(kind) ?? 1) > TERRAIN_STREAMING.admissionMs) break;
      this.#ordered.shift();
      const resident = this.residents.get(job.chunkKey); this.#jobs.delete(id); if (!resident) continue;
      this.peakGraphicChunks = Math.max(this.peakGraphicChunks, this.residents.size + 1);
      const buildStarted = this.now(), meshes = job.build();
      for (const mesh of meshes) {
        mesh.unfreezeWorldMatrix(); mesh.parent = resident.root;
        mesh.position.x -= resident.root.position.x; mesh.position.z -= resident.root.position.z;
      }
      for (const m of resident.units.get(job.key)?.meshes ?? []) m.dispose(false, false);
      resident.units.set(job.key, { signature: job.signature, meshes, ground: job.ground });
      const cost = this.now() - buildStarted;
      this.#cost.set(kind, cost); published++;
      if (cost > this.slowestUnit.ms) this.slowestUnit = { kind, ms: cost };
      if (job.ground) this.version++;
    }
    const elapsed = this.now() - started;
    this.integrationMs.push(elapsed); if (this.integrationMs.length > 3600) this.integrationMs.shift();
    if (hadJobs) { this.activeIntegrationMs.push(elapsed); if (this.activeIntegrationMs.length > 3600) this.activeIntegrationMs.shift(); }
  }
  rendered(x: number, y: number): boolean {
    const { widthCells: w, heightCells: h, chunkSize: s } = this.store.world;
    x = normalize(Math.round(x), w); y = normalize(Math.round(y), h);
    const resident = this.residents.get(this.store.key(x, y));
    const unit = `${Math.floor(x % s / UNIT) * UNIT}:${Math.floor(y % s / UNIT) * UNIT}`;
    return Boolean(resident?.root.isEnabled() && this.#masks.get(this.store.key(x, y))?.has(unit) && resident.units.has(`ground:${unit}`));
  }
  shift(x: number, z: number): void {
    for (const r of this.residents.values()) { r.root.position.x -= x; r.root.position.z -= z; }
    this.version++;
  }
  dispose(): void { for (const key of [...this.residents.keys()]) this.#remove(key); this.#jobs.clear(); this.#ordered.length = 0; }
}
