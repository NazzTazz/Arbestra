import { Type, type Static } from '@sinclair/typebox';
import { createSpawnSurfaceIndex, spawnDelta, spawnSurfacesOverlap, SpawnTerrainResultSchema, type SpawnPoint, type SpawnSurface } from './spawn-map.js';

/** Internal preflight; neither permission, reservation nor installation. Details
 * of other villages' occupations, stocks and routes stay on the server. */
export const SpawnResourcePreflightSchema = Type.Object({
  terrain: SpawnTerrainResultSchema, readiness: Type.Literal('terrain-only'), accessRevision: Type.Integer(),
  planningStatus: Type.Union([Type.Literal('planned'), Type.Literal('incomplete'), Type.Literal('terrain-blocked')]),
  naturalProjection: Type.Union([Type.Literal('pending'),Type.Literal('planned'),Type.Literal('ready')]), woodAssumption: Type.Union([Type.Literal('required-until-projected'),Type.Literal('evaluated')]),
  poorInResources:Type.Optional(Type.Boolean()),
  visited: Type.Integer(), plannedStone: Type.Integer(), plannedWood: Type.Integer(),
  cleaning: Type.Optional(Type.Object({ referenceHeight:Type.Number(), treesToRemove:Type.Integer({minimum:0}), woodCredit:Type.Literal(0) })),
});
export type SpawnResourcePreflight = Static<typeof SpawnResourcePreflightSchema>;

/** These paths must come from the server's pedestrian access solver. This module
 * measures and protects them; it does not certify terrain or invent a slope rule. */
export interface SpawnResourceAccess { path: readonly SpawnPoint[] }
export interface SpawnResourceCandidate { surface: SpawnSurface; access: SpawnResourceAccess; kinds?: readonly ('stone' | 'wood')[] }
export interface SpawnNaturalResource {
  kind: 'stone' | 'wood'; state: 'available' | 'reserved' | 'depleted';
  remainingAmount: number; reservedAmount: number; cleared?: boolean;
  access: SpawnResourceAccess | null;
  /** Canonical positions of the trees represented by the economic aggregate.
   * No individual persistent tree entities are required. */
  trees?: readonly SpawnPoint[];
}
export interface SpawnResourceSupplement extends SpawnResourceCandidate {
  kind: 'stone-mini' | 'stone-large' | 'wood'; amount: 150 | 2000 | 1500;
  treeCount: 0 | 3; pathLength: number;
}
export type SpawnResourcePlan = {
  poorInResources: boolean; needsWood: boolean; visited: number;
} & ({ status: 'planned'; supplements: SpawnResourceSupplement[] }
  | { status: 'no-space' | 'incomplete'; supplements: [] });
export interface SpawnResourcePlanningInput {
  width: number; height: number; townHall: SpawnPoint;
  /** Full translated kit, including unposed elements in manual mode. */
  referenceSurfaces: readonly SpawnSurface[];
  /** Only elements being posed; used for the natural wood removal test. */
  posedSurfaces: readonly SpawnSurface[];
  /** Occupations, equipment and swept mission/used-route surfaces. */
  protectedSurfaces: readonly SpawnSurface[];
  naturalResources: readonly SpawnNaturalResource[];
  /** Exhaustive, dry, safe candidates with validated exploitation access.
   * A partial enumeration must set candidatesComplete=false. */
  candidates: readonly SpawnResourceCandidate[]; candidatesComplete: boolean;
  maxVisited?: number;
}
const EPSILON = 1e-8;
export function spawnSurfaceGap(a: SpawnSurface, b: SpawnSurface, width: number, height: number): number {
  const dx = Math.max(0, Math.abs(spawnDelta(a.x, b.x, width)) - a.halfWidth - b.halfWidth);
  const dy = Math.max(0, Math.abs(spawnDelta(a.y, b.y, height)) - a.halfHeight - b.halfHeight);
  return Math.hypot(dx, dy);
}
export function spawnPathLength(path: readonly SpawnPoint[], width: number, height: number): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const dx = Math.abs(spawnDelta(b.x, a.x, width)), dy = Math.abs(spawnDelta(b.y, a.y, height));
    // The existing travel protocol has cardinal legs, including fine-grid legs.
    if (dx > EPSILON && dy > EPSILON) throw Error('Spawn access requires cardinal legs');
    length += dx + dy;
  }
  return length;
}
/** Swept 1/8-cell pedestrian passage, rather than unprotected path vertices. */
export function spawnPathSurfaces(path: readonly SpawnPoint[], width: number, height: number): SpawnSurface[] {
  // Historical missions may contain diagonal legs. Their enclosing swept
  // rectangle is conservative; new spawn accesses remain cardinal via length().
  return path.flatMap((a, i) => {
    const b = path[i + 1];
    if (!b) return [{ ...a, halfWidth: 1 / 16, halfHeight: 1 / 16 }];
    const dx = spawnDelta(b.x, a.x, width), dy = spawnDelta(b.y, a.y, height);
    return [{ x: a.x + dx / 2, y: a.y + dy / 2, halfWidth: Math.abs(dx) / 2 + 1 / 16, halfHeight: Math.abs(dy) / 2 + 1 / 16 }];
  });
}

/** Read-only, deterministic packing of the exact RC1 supplements. A bounded
 * search that runs out of work is never reported as a proof of impossibility.
 * Applying this plan remains the responsibility of the atomic town-hall command. */
export function planSpawnResources(input: SpawnResourcePlanningInput): SpawnResourcePlan {
  const { width, height, townHall, referenceSurfaces, posedSurfaces, protectedSurfaces } = input;
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('Invalid spawn world size');
  const overlap = (a: SpawnSurface, b: SpawnSurface) => spawnSurfacesOverlap(a, b, width, height);
  const length = (access: SpawnResourceAccess) => {
    const first = access.path[0];
    if (!first || Math.abs(spawnDelta(first.x, townHall.x, width)) > EPSILON || Math.abs(spawnDelta(first.y, townHall.y, height)) > EPSILON)
      throw Error('Spawn access must include its town-hall origin');
    return spawnPathLength(access.path, width, height);
  };
  let naturalWood = false, naturalStone = false;
  for (const resource of input.naturalResources) {
    if (resource.state !== 'available' || resource.cleared || !Number.isFinite(resource.remainingAmount)
      || !Number.isFinite(resource.reservedAmount) || resource.remainingAmount <= resource.reservedAmount || !resource.access) continue;
    const distance = length(resource.access);
    if (resource.kind === 'stone' && distance <= 40) naturalStone = true;
    if (resource.kind === 'wood' && distance < 15 && resource.trees?.some(tree => !posedSurfaces.some(s =>
      Math.abs(spawnDelta(tree.x, s.x, width)) <= s.halfWidth + EPSILON && Math.abs(spawnDelta(tree.y, s.y, height)) <= s.halfHeight + EPSILON))) naturalWood = true;
  }
  const base = { poorInResources: !naturalWood || !naturalStone, needsWood: !naturalWood };
  const excluded = createSpawnSurfaceIndex([...referenceSurfaces, ...posedSurfaces, ...protectedSurfaces], width, height);
  const candidates = input.candidates.map(c => ({ ...c, distance: length(c.access), passages: spawnPathSurfaces(c.access.path, width, height) }))
    .filter(c => !excluded(c.surface))
    .sort((a, b) => a.distance - b.distance || a.surface.x - b.surface.x || a.surface.y - b.surface.y
      || a.surface.halfWidth - b.surface.halfWidth || a.surface.halfHeight - b.surface.halfHeight);
  const slots: Array<Pick<SpawnResourceSupplement, 'kind' | 'amount' | 'treeCount'>> = [
    { kind: 'stone-mini', amount: 150, treeCount: 0 }, { kind: 'stone-mini', amount: 150, treeCount: 0 },
    { kind: 'stone-large', amount: 2000, treeCount: 0 }, { kind: 'stone-large', amount: 2000, treeCount: 0 },
    ...(naturalWood ? [] : [{ kind: 'wood' as const, amount: 1500 as const, treeCount: 3 as const }, { kind: 'wood' as const, amount: 1500 as const, treeCount: 3 as const }]),
  ];
  const eligible = slots.map(slot => candidates.filter(c => (!c.kinds || c.kinds.includes(slot.kind === 'wood' ? 'wood' : 'stone')) && (slot.kind === 'wood' ? c.distance < 15
    : slot.kind === 'stone-large' ? c.distance > 20 && c.distance <= 40
      : c.distance <= 20 && referenceSurfaces.every(s => spawnSurfaceGap(c.surface, s, width, height) + EPSILON >= 10))));
  const maxVisited = input.maxVisited ?? 10_000;
  if (!Number.isSafeInteger(maxVisited) || maxVisited < 0) throw Error('Invalid spawn search budget');
  let visited = 0, interrupted = false;
  // Constrained kinds first: at the growing search frontier the far stone
  // accesses are scarcer than nearby wood sites. Do not permute identical slots.
  const order = slots.map((_, i) => i).sort((a, b) => eligible[a]!.length - eligible[b]!.length || a - b);
  const chosen: Array<{ candidate: (typeof candidates)[number]; slot: number; index: number }> = [];
  const search = (depth: number): boolean => {
    if (depth === slots.length) return true;
    const slot = order[depth]!;
    for (const [index, candidate] of eligible[slot]!.entries()) {
      const sameKind = chosen.find(c => slots[c.slot]!.kind === slots[slot]!.kind);
      if (sameKind && index <= sameKind.index) continue;
      if (visited >= maxVisited) { interrupted = true; return false; } visited++;
      // A new deposit must not cut an earlier access; its own access must also
      // avoid all previously selected deposits. Sharing pedestrian paths is fine.
      if (chosen.some(({ candidate: c }) => overlap(c.surface, candidate.surface)
        || c.passages.some(p => overlap(p, candidate.surface)) || candidate.passages.some(p => overlap(p, c.surface)))) continue;
      chosen.push({ candidate, slot, index });
      if (search(depth + 1)) return true;
      chosen.pop();
      if (interrupted) return false;
    }
    return false;
  };
  if (!search(0)) return { ...base, visited, status: interrupted || !input.candidatesComplete ? 'incomplete' : 'no-space', supplements: [] };
  return { ...base, visited, status: 'planned', supplements: chosen.sort((a, b) => a.slot - b.slot).map(({ candidate: c, slot }) => ({ ...slots[slot]!,
    surface: { ...c.surface }, access: { path: c.access.path.map(p => ({ ...p })) }, pathLength: c.distance })) };
}
