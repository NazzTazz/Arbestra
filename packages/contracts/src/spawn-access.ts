import { spawnDelta, type SpawnPoint } from './spawn-map.js';
import { spawnPathLength } from './spawn-resources.js';
import { wrapClimate } from './world-climate.js';

export const SPAWN_ACCESS_REVISION = 1;
export const SPAWN_MAX_PEDESTRIAN_SLOPE = .25;
export interface SpawnAccessSample { elevation: number; dry: boolean; blocked: boolean }
export interface SpawnAccessField { width: number; height: number; sample: (x: number, y: number) => SpawnAccessSample }

/** Validate the swept passage, not just the endpoints. The approved RC1 rule
 * is |dz| <= .25 * horizontal length, on each sampled interval. Width 1/8,
 * sampling at most 1/8 along the path. No effect on building terrace admission. */
export function canWalkSpawnSegment(field: SpawnAccessField, a: SpawnPoint, b: SpawnPoint): boolean {
  const dx = spawnDelta(b.x, a.x, field.width), dy = spawnDelta(b.y, a.y, field.height);
  if (Math.abs(dx) > 1e-8 && Math.abs(dy) > 1e-8) throw Error('Spawn walk requires a cardinal segment');
  const length = Math.abs(dx) + Math.abs(dy), count = Math.max(1, Math.ceil(length * 8));
  const horizontal = length / count;
  for (const offset of [-1 / 16, 0, 1 / 16]) {
    let previous: SpawnAccessSample | undefined;
    for (let i = 0; i <= count; i++) {
      const x = a.x + dx * i / count + (dy ? offset : 0), y = a.y + dy * i / count + (dx ? offset : 0);
      const sample = field.sample(wrapClimate(x, field.width), wrapClimate(y, field.height));
      if (!sample.dry || sample.blocked || !Number.isFinite(sample.elevation)) return false;
      if (previous && Math.abs(sample.elevation - previous.elevation) > SPAWN_MAX_PEDESTRIAN_SLOPE * horizontal + 1e-6) return false;
      previous = sample;
    }
  }
  return true;
}
export interface SpawnAccessRoute { point: SpawnPoint; path: SpawnPoint[]; length: number }
export interface SpawnAccessNetwork { routes: SpawnAccessRoute[]; complete: boolean; visited: number }
/** Cardinal cell lattice with subcell-checked edges. A successful route is a
 * witness; failure on this lattice is not proof that all finer routes fail.
 * Exit paths include the hall origin and its actual doorway/outside connector.
 * The caller certifies their internal building portion; exterior connectors are
 * checked here. Limits are physical path lengths, never A* or road costs. */
export function buildSpawnAccessNetwork(field: SpawnAccessField, exits: readonly (readonly SpawnPoint[])[], maxLength = 40, maxVisited = 4000,
  stop?: (routes: readonly SpawnAccessRoute[]) => boolean): SpawnAccessNetwork {
  if (!Number.isFinite(maxLength) || maxLength < 0 || !Number.isSafeInteger(maxVisited) || maxVisited < 0) throw Error('Invalid spawn access bounds');
  const key = (p: SpawnPoint) => p.y * field.width + p.x;
  type Entry = SpawnAccessRoute & { key: number };
  const queue: Entry[] = [], best = new Map<number, Entry>(), finalized = new Set<number>();
  const push = (entry: Entry) => {
    if (entry.length > maxLength + 1e-8 || (best.get(entry.key)?.length ?? Infinity) <= entry.length + 1e-8) return;
    best.set(entry.key, entry);
    let i = queue.length; queue.push(entry);
    while (i) { const parent = (i - 1) >> 1; if (queue[parent]!.length <= entry.length) break; queue[i] = queue[parent]!; i = parent; } queue[i] = entry;
  };
  const pop = () => {
    const result = queue[0]!, tail = queue.pop()!;
    if (queue.length) { let i = 0; while (2 * i + 1 < queue.length) {
      let child = 2 * i + 1; if (child + 1 < queue.length && queue[child + 1]!.length < queue[child]!.length) child++;
      if (tail.length <= queue[child]!.length) break; queue[i] = queue[child]!; i = child;
    } queue[i] = tail; } return result;
  };
  for (const path of exits) {
    const last = path.at(-1); if (!last) continue;
    const prefixLength = spawnPathLength(path, field.width, field.height);
    for (const x of new Set([Math.floor(last.x), Math.ceil(last.x)])) for (const y of new Set([Math.floor(last.y), Math.ceil(last.y)])) {
      const target = { x: wrapClimate(x, field.width), y: wrapClimate(y, field.height) };
      for (const bend of [{ x: target.x, y: last.y }, { x: last.x, y: target.y }]) {
        if (!canWalkSpawnSegment(field, last, bend) || !canWalkSpawnSegment(field, bend, target)) continue;
        const connector = [last, bend, target], length = prefixLength + spawnPathLength(connector, field.width, field.height);
        push({ key: key(target), point: target, path: [...path.map(p => ({ ...p })), bend, target], length });
      }
    }
  }
  const edges = new Map<string, boolean>();
  const routes: SpawnAccessRoute[] = [];
  while (queue.length && routes.length < maxVisited) {
    const entry = pop(); if (best.get(entry.key) !== entry || finalized.has(entry.key)) continue;
    finalized.add(entry.key); routes.push({ point: entry.point, path: entry.path, length: entry.length });
    if (stop?.(routes)) return { routes, complete: false, visited: routes.length };
    if (entry.length + 1 > maxLength + 1e-8) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const point = { x: wrapClimate(entry.point.x + dx!, field.width), y: wrapClimate(entry.point.y + dy!, field.height) }, next = key(point);
      if (finalized.has(next)) continue;
      const edge = `${Math.min(entry.key, next)}:${Math.max(entry.key, next)}`;
      let allowed = edges.get(edge);
      if (allowed === undefined) { allowed = canWalkSpawnSegment(field, entry.point, point); edges.set(edge, allowed); }
      if (allowed) push({ key: next, point, path: [...entry.path, point], length: entry.length + 1 });
    }
  }
  return { routes, complete: queue.length === 0, visited: routes.length };
}
