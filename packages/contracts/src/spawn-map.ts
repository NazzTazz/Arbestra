import type { SpawnTerrace } from './spawn-installation.js';
import { Type, type Static } from '@sinclair/typebox';
import { illumination, TAU } from './cosmology.js';
import { wrapClimate } from './world-climate.js';
import { sampleWorldGeography } from './world-geography.js';
import type { GeneratedLandscape } from './world-generator.js';
import { insideTerritory, SpawnTerritorySchema, type SpawnTerritory, type SpawnCleaningPlan } from './spawn-atlas.js';

/** RC1 substrate only. This revision does not grant permission to create a village. */
export const SPAWN_TERRAIN_REVISION = 3;
export const SPAWN_DIAGNOSTIC_RADIUS = 8;
export const SPAWN_TERRACE_TOLERANCE = .5; // Two RC1 levels; walking slope is unchanged.
export const SpawnPointSchema = Type.Object({ x: Type.Integer({ minimum: 0, maximum: 511 }), y: Type.Integer({ minimum: 0, maximum: 255 }) }, { additionalProperties: false });
export const SpawnInspectionRequestSchema = Type.Object({
  point: SpawnPointSchema, quarterTurns: Type.Integer({ minimum: 0, maximum: 3 }),
  artifactChecksum: Type.String({ pattern: '^[a-f0-9]{64}$' }),
}, { additionalProperties: false });
export type SpawnInspectionRequest = Static<typeof SpawnInspectionRequestSchema>;
export interface SpawnPoint { x: number; y: number }
/** Exact surfaces, expressed in canonical cells relative to the town hall. */
export interface SpawnSurface { x: number; y: number; halfWidth: number; halfHeight: number }
export interface SpawnVillage extends SpawnPoint { id: string; playerName: string; population: number }
export interface SpawnMap {
  worldId: string; worldSlug: string; worldName: string; artifactChecksum: string;
  terrainRevision: number; landscape: GeneratedLandscape; surfaces: SpawnSurface[]; villages: SpawnVillage[];
  readiness: 'terrain-only';
  territories?: SpawnTerritory[];
  terraces?: SpawnTerrace[]; removedTreeIndices?: number[];
}
export interface SpawnTerrainResult {
  point: SpawnPoint; quarterTurns: number; referenceHeight: number; terrainCompatible: boolean;
  reasons: Array<'water' | 'rock' | 'relief' | 'neighbor' | 'occupation' | 'territory'>;
  incompatible: Array<SpawnPoint & { reason: 'water' | 'rock' | 'relief' | 'occupation' }>;
  readiness: 'terrain-only';
}
const surfaceSchema = Type.Object({ x: Type.Number(), y: Type.Number(), halfWidth: Type.Number(), halfHeight: Type.Number() });
const terrainReasonSchema = Type.Union([Type.Literal('water'), Type.Literal('rock'), Type.Literal('relief'), Type.Literal('occupation')]);
export const SpawnTerrainResultSchema = Type.Object({ point: SpawnPointSchema, quarterTurns: Type.Integer(), referenceHeight: Type.Number(),
  terrainCompatible: Type.Boolean(), reasons: Type.Array(Type.Union([terrainReasonSchema, Type.Literal('neighbor'), Type.Literal('territory')])),
  incompatible: Type.Array(Type.Object({ x: Type.Integer(), y: Type.Integer(), reason: terrainReasonSchema })), readiness: Type.Literal('terrain-only') });
export const SpawnMapSchema = Type.Object({ terraces:Type.Optional(Type.Array(Type.Object({cellX:Type.Integer(),cellY:Type.Integer(),height:Type.Number()}))), removedTreeIndices:Type.Optional(Type.Array(Type.Integer({minimum:0}))), worldId: Type.String(), worldSlug: Type.String(), worldName: Type.String(), artifactChecksum: Type.String(),
  terrainRevision: Type.Integer(), landscape: Type.Unsafe<GeneratedLandscape>(Type.Any()), surfaces: Type.Array(surfaceSchema), territories: Type.Optional(Type.Array(SpawnTerritorySchema)),
  villages: Type.Array(Type.Object({ id: Type.String(), x: Type.Integer(), y: Type.Integer(), playerName: Type.String(), population: Type.Integer() })), readiness: Type.Literal('terrain-only') });
export const SpawnAtlasSchema = Type.Omit(SpawnMapSchema, ['landscape']);
export function spawnDelta(a: number, b: number, size: number): number {
  return wrapClimate(a - b + size / 2, size) - size / 2;
}
export function spawnDistance(a: SpawnPoint, b: SpawnPoint, width: number, height: number): number {
  return Math.hypot(spawnDelta(a.x, b.x, width), spawnDelta(a.y, b.y, height));
}
export function rotateSpawnPoint(p: SpawnPoint, turns: number): SpawnPoint {
  switch (wrapClimate(turns, 4)) { case 1: return { x: p.y, y: -p.x }; case 2: return { x: -p.x, y: -p.y }; case 3: return { x: -p.y, y: p.x }; default: return p; }
}
export function spawnSurfacesAt(surfaces: readonly SpawnSurface[], point: SpawnPoint, turns: number): SpawnSurface[] {
  return surfaces.map(s => ({ ...rotateSpawnPoint(s, turns), x: rotateSpawnPoint(s, turns).x + point.x,
    y: rotateSpawnPoint(s, turns).y + point.y, halfWidth: turns % 2 ? s.halfHeight : s.halfWidth, halfHeight: turns % 2 ? s.halfWidth : s.halfHeight }));
}
/** Sharing a border is not an overlap of two area footprints. Point queries
 * retain closed boundaries for walking collisions and terrace membership. */
export function spawnSurfacesOverlap(a: SpawnSurface, b: SpawnSurface, width: number, height: number): boolean {
  const axis = (distance: number, halfA: number, halfB: number) => halfA === 0 || halfB === 0
    ? Math.abs(distance) <= halfA + halfB + 1e-6 : Math.abs(distance) < halfA + halfB - 1e-8;
  return axis(spawnDelta(a.x, b.x, width), a.halfWidth, b.halfWidth)
    && axis(spawnDelta(a.y, b.y, height), a.halfHeight, b.halfHeight);
}

/** Reusable immutable-field cache; never use it for occupancy or resource authority. */
export function createSpawnTerrainField(data: GeneratedLandscape) {
  if (!data.geography || data.altitudeCellRatio !== .25) throw Error('RC1 geography required');
  const g = { ...data.geography, ...(data.geography.study ? { study: { ...data.geography.study, waterLevel: 0 } } : {}) };
  const samples = new Map<string, ReturnType<typeof sampleWorldGeography>>();
  const sample = (x: number, y: number) => {
    x = wrapClimate(x, data.width); y = wrapClimate(y, data.height);
    const key = `${x}:${y}`;
    let result = samples.get(key);
    if (!result) { result = sampleWorldGeography(g, x, y); if (samples.size >= 100_000) samples.clear(); samples.set(key, result); }
    return result;
  };
  // Immutable geometry: reuse the same envelope and trigonometry at every
  // terrain/path sample, without changing the separating-axis test.
  const rocks = (data.stoneSites ?? []).flatMap(s => s.rocks).map(r => {
    const scaleX = (2.4 + Math.cos(r.y / data.height * Math.PI * 2 + Math.PI)) * data.height / data.width;
    const c = Math.cos(r.rotation), n = -Math.sin(r.rotation), hw = r.width * .75 * 1.28, hh = r.depth * .75 * 1.28;
    return { ...r, scaleX, c, n, hw, hh };
  });
  const rockSurfaces = rocks.map(r => ({ x: r.x, y: r.y,
    halfWidth: (Math.abs(r.c) * r.hw + Math.abs(r.n) * r.hh) / r.scaleX,
    halfHeight: Math.abs(r.n) * r.hw + Math.abs(r.c) * r.hh, rock: r }));
  const intersectsRock = createSpawnSurfaceIndex(rockSurfaces, data.width, data.height, (s, other) => {
    const r = (other as typeof rockSurfaces[number]).rock;
    // world-outcrops uses a .75 radius, anisotropic torus metric and a bent
    // profile with support bounded by 1.12 + .16. Raw width/2 is too small.
    const { scaleX, c, n, hw, hh } = r;
    const dy = spawnDelta(r.y, s.y, data.height);
    if (!(Math.abs(dy) <= s.halfHeight + Math.abs(n) * hw + Math.abs(c) * hh)) return false;
    const dx = spawnDelta(r.x, s.x, data.width) * scaleX;
    const sw = s.halfWidth * scaleX;
    // Conservative separating-axis envelope; refine the visible profile before spawn authority.
    return Math.abs(dx) <= sw + Math.abs(c) * hw + Math.abs(n) * hh
      && Math.abs(dx * c + dy * n) <= hw + Math.abs(c) * sw + Math.abs(n) * s.halfHeight
      && Math.abs(-dx * n + dy * c) <= hh + Math.abs(n) * sw + Math.abs(c) * s.halfHeight;
  });
  const intersectsTree = createSpawnSurfaceIndex((data.forest?.trees ?? []).map(t => ({ x: t.x, y: t.y, halfWidth: 0, halfHeight: 0 })), data.width, data.height,
    (s, t) => Math.abs(spawnDelta(t.x, s.x, data.width)) <= s.halfWidth && Math.abs(spawnDelta(t.y, s.y, data.height)) <= s.halfHeight);
  // Cache immutable classifications, never the decision relative to a hall.
  const summaries = new Map<string, { obstacle: 'water' | 'rock' | null; min: number; max: number }>();
  const summarize = (s: SpawnSurface, resolution: number) => {
    const key = `${wrapClimate(s.x, data.width)}:${wrapClimate(s.y, data.height)}:${s.halfWidth}:${s.halfHeight}:${resolution}`;
    const cached = summaries.get(key); if (cached) return cached;
    const result = { obstacle: intersectsRock(s) ? 'rock' as const : null as 'water' | 'rock' | null, min: Infinity, max: -Infinity };
    const nx = Math.max(1, Math.ceil(s.halfWidth * 2 / resolution)), ny = Math.max(1, Math.ceil(s.halfHeight * 2 / resolution));
    for (let iy = 0; !result.obstacle && iy <= ny; iy++) for (let ix = 0; ix <= nx; ix++) {
      const v = sample(s.x - s.halfWidth + ix * s.halfWidth * 2 / nx, s.y - s.halfHeight + iy * s.halfHeight * 2 / ny);
      if (v.elevation <= Math.max(0, v.surface) + 1e-6) { result.obstacle = 'water'; break; }
      result.min = Math.min(result.min, v.elevation); result.max = Math.max(result.max, v.elevation);
    }
    if (summaries.size >= 32_768) summaries.delete(summaries.keys().next().value!);
    summaries.set(key, result); return result;
  };
  const surfaceReason = (s: SpawnSurface, reference: number | null, resolution: number): 'water' | 'rock' | 'relief' | null => {
    const result = summarize(s, resolution);
    if (result.obstacle) return result.obstacle;
    return reference !== null && (Math.abs(result.min - reference) > SPAWN_TERRACE_TOLERANCE + 1e-6 || Math.abs(result.max - reference) > SPAWN_TERRACE_TOLERANCE + 1e-6) ? 'relief' : null;
  };
  return { sample, surfaceReason, intersectsRock, intersectsTree };
}
/** A per-snapshot index. Never cache dynamic protections with the base field. */
export function createSpawnSurfaceIndex(surfaces: readonly SpawnSurface[], width: number, height: number,
  intersects = (a: SpawnSurface, b: SpawnSurface) => spawnSurfacesOverlap(a, b, width, height)) {
  const cells = new Map<number, SpawnSurface[]>();
  // Floor bins include the collision epsilon. No per-query Set, nor nine
  // duplicated neighboring buckets for every walking sample.
  const bounds = (s: SpawnSurface) => ({ x: Math.floor(s.x - s.halfWidth - 1e-6), y: Math.floor(s.y - s.halfHeight - 1e-6),
    right: Math.floor(s.x + s.halfWidth + 1e-6), top: Math.floor(s.y + s.halfHeight + 1e-6) });
  for (const s of surfaces) {
    const b = bounds(s);
    for (let y = b.y; y <= Math.min(b.top, b.y + height - 1); y++) for (let x = b.x; x <= Math.min(b.right, b.x + width - 1); x++) {
      const key = wrapClimate(y, height) * width + wrapClimate(x, width);
      let bucket = cells.get(key); if (!bucket) { bucket = []; cells.set(key, bucket); } bucket.push(s);
    }
  }
  return (s: SpawnSurface) => {
    const b = bounds(s);
    for (let y = b.y; y <= Math.min(b.top, b.y + height - 1); y++) for (let x = b.x; x <= Math.min(b.right, b.x + width - 1); x++) {
      const bucket = cells.get(wrapClimate(y, height) * width + wrapClimate(x, width));
      if (bucket) for (const other of bucket) if (intersects(s, other)) return true;
    }
    return false;
  };
}
export function createSpawnTerrainInspector(data: GeneratedLandscape, field = createSpawnTerrainField(data)) {
  const { sample, surfaceReason } = field;
  return (point: SpawnPoint, surfaces: readonly SpawnSurface[], quarterTurns: number, villages: readonly SpawnVillage[], disk = true, protectedSurfaces: readonly SpawnSurface[] = [], territories: readonly SpawnTerritory[] = []): SpawnTerrainResult => {
    const canonical = { x: wrapClimate(point.x, data.width), y: wrapClimate(point.y, data.height) };
    const referenceHeight = sample(canonical.x, canonical.y).elevation;
    const reasons = new Set<SpawnTerrainResult['reasons'][number]>();
    const occupied = createSpawnSurfaceIndex(protectedSurfaces, data.width, data.height);
    for (const s of spawnSurfacesAt(surfaces, canonical, quarterTurns)) {
      const reason = occupied(s) ? 'occupation' : surfaceReason(s, referenceHeight, .125); if (reason) reasons.add(reason);
    }
    if (villages.some(v => spawnDistance(v, canonical, data.width, data.height) <= 50)) reasons.add('neighbor');
    if (territories.some(t => insideTerritory(canonical, t.points, data.width, data.height))) reasons.add('territory');
    const incompatible: SpawnTerrainResult['incompatible'] = [];
    if (disk) for (let dy = -SPAWN_DIAGNOSTIC_RADIUS; dy <= SPAWN_DIAGNOSTIC_RADIUS; dy++) for (let dx = -SPAWN_DIAGNOSTIC_RADIUS; dx <= SPAWN_DIAGNOSTIC_RADIUS; dx++) {
      if (dx * dx + dy * dy > SPAWN_DIAGNOSTIC_RADIUS ** 2) continue;
      const x = wrapClimate(canonical.x + dx, data.width), y = wrapClimate(canonical.y + dy, data.height);
      const s = { x, y, halfWidth: .5, halfHeight: .5 };
      const reason = occupied(s) ? 'occupation' : surfaceReason(s, referenceHeight, .5);
      if (reason) incompatible.push({ x, y, reason });
    }
    return { point: canonical, quarterTurns, referenceHeight, terrainCompatible: reasons.size === 0,
      reasons: [...reasons], incompatible, readiness: 'terrain-only' };
  };
}

export function planSpawnCleaning(data: GeneratedLandscape, point: SpawnPoint, surfaces: readonly SpawnSurface[], turns: number,
  field = createSpawnTerrainField(data)): SpawnCleaningPlan {
  const placed = spawnSurfacesAt(surfaces, point, turns);
  const underPose = createSpawnSurfaceIndex(placed, data.width, data.height);
  return { referenceHeight: field.sample(point.x, point.y).elevation, surfaces: placed,
    removedTreeIndices: (data.forest?.trees ?? []).flatMap((t, i) => underPose({ ...t, halfWidth: 0, halfHeight: 0 }) ? [i] : []), woodCredit: 0 };
}

/** Fixed 24 h cycle, inclusive endpoint; common 0..1 scale at every location. */
export function spawnLuminosity(point: SpawnPoint, width: number, height: number): number[] {
  const u = wrapClimate(point.x, width) / width * TAU, v = wrapClimate(point.y, height) / height * TAU + Math.PI;
  return Array.from({ length: 289 }, (_, i) => illumination(u, v, i / 288 * TAU).direct);
}
/** First local extremum; merge a plateau across the periodic seam and use its middle. */
export function firstLuminosityExtremum(values: readonly number[], maximum: boolean): number | null {
  const n = values.length - 1, epsilon = 1e-8;
  if (n < 3 || Math.max(...values) - Math.min(...values) < epsilon) return null;
  const groups: Array<{ start: number; end: number; value: number }> = [];
  let start = 0;
  while (start < n) { let end = start; while (end + 1 < n && Math.abs(values[end + 1]! - values[start]!) < epsilon) end++;
    groups.push({ start, end, value: values[start]! }); start = end + 1; }
  if (groups.length > 1 && Math.abs(groups[0]!.value - groups.at(-1)!.value) < epsilon) {
    const last = groups.pop()!; groups[0] = { ...groups[0]!, start: last.start - n };
  }
  const candidates = groups.flatMap((group, i) => {
    const before = groups[wrapClimate(i - 1, groups.length)]!.value, after = groups[(i + 1) % groups.length]!.value;
    const isExtreme = maximum ? group.value > before && group.value > after : group.value < before && group.value < after;
    return isExtreme ? [wrapClimate((group.start + group.end) / 2, n)] : [];
  });
  return candidates.length ? Math.min(...candidates) : null;
}
