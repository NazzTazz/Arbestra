import { describe, expect, it } from 'vitest';
import { planSpawnResources, spawnPathLength, spawnPathSurfaces, spawnSurfaceGap,
  type SpawnResourceCandidate, type SpawnResourcePlanningInput, type SpawnNaturalResource } from './spawn-resources.js';

const origin = { x: 0, y: 0 };
const surface = (x: number, y: number) => ({ x, y, halfWidth: .5, halfHeight: .5 });
function candidate(x: number, y: number, path: Array<{ x: number; y: number }>, kind: 'wood' | 'stone' = 'stone'): SpawnResourceCandidate {
  return { surface: surface(x, y), access: { path: [origin, ...path] }, kinds: [kind] };
}
const sites = [
  candidate(11, 0, [{ x: 10.4375, y: 0 }]),
  candidate(0, 16, [{ x: 2.28125, y: 0 },{ x: 2.28125, y: 15.4375 },{ x: 0, y: 15.4375 }]),
  candidate(-21.5625, 0, [{ x: -21, y: 0 }]),
  candidate(0, -40.5625, [{ x: 0, y: -40 }]),
  candidate(4, 4, [{ x: 0, y: 4 }, { x: 3.4375, y: 4 }], 'wood'),
  candidate(-4, -4, [{ x: 0, y: -4 }, { x: -3.4375, y: -4 }], 'wood'),
];
function input(overrides: Partial<SpawnResourcePlanningInput> = {}): SpawnResourcePlanningInput {
  return { width: 512, height: 256, townHall: origin, referenceSurfaces: [surface(0, 0)], posedSurfaces: [surface(0, 0)],
    protectedSurfaces: [], naturalResources: [], candidates: sites, candidatesComplete: true, ...overrides };
}
const wood = (distance: number): SpawnNaturalResource => ({ kind: 'wood', state: 'available', remainingAmount: 500, reservedAmount: 0,
  access: { path: [origin, { x: distance, y: 0 }] }, trees: [{ x: 5, y: 5 }] });
const stone = (distance: number): SpawnNaturalResource => ({ kind: 'stone', state: 'available', remainingAmount: 1, reservedAmount: 0,
  access: { path: [origin, { x: 0, y: distance }] } });
describe('RC1 read-only resource packing', () => {
  it('plans exactly 4300 stone and conditional 3000 wood without mutating the input', () => {
    const data = input(), before = structuredClone(data), result = planSpawnResources(data);
    expect(result.status).toBe('planned'); expect(result.poorInResources).toBe(true);
    expect(result.supplements.map(s => [s.kind, s.amount, s.treeCount])).toEqual([
      ['stone-mini', 150, 0], ['stone-mini', 150, 0], ['stone-large', 2000, 0], ['stone-large', 2000, 0], ['wood', 1500, 3], ['wood', 1500, 3]]);
    expect(data).toEqual(before);
  });
  it('includes mini gap=10 and path=20, large path=40; excludes large path=20 and wood path=15', () => {
    const accepted = planSpawnResources(input()); expect(accepted.status).toBe('planned');
    expect(spawnSurfaceGap(sites[0]!.surface, surface(0, 0), 512, 256)).toBe(10);
    for (const replacement of [candidate(10.99, 0, [{ x: 10.4275, y: 0 }]), candidate(-20.5625, 0, [{ x: -20, y: 0 }]),
      candidate(0, -40.5725, [{ x: 0, y: -40.01 }]), candidate(4, 4, [{ x: 0, y: 7.78125 }, { x: 3.4375, y: 7.78125 }, { x: 3.4375, y: 4 }], 'wood')]) {
      const index = replacement.surface.x > 10 ? 0 : replacement.surface.x < -20 ? 2 : replacement.surface.y < -40 ? 3 : 4;
      const candidates = [...sites]; candidates[index] = replacement;
      expect(planSpawnResources(input({ candidates })).status).toBe('no-space');
    }
  });
  it('uses strict natural wood <15, natural stone <=40 and positive unreserved stock', () => {
    const rich = planSpawnResources(input({ naturalResources: [wood(14.999), stone(40)] }));
    expect(rich).toMatchObject({ status: 'planned', poorInResources: false, needsWood: false }); expect(rich.supplements).toHaveLength(4);
    for (const unavailable of [wood(15), { ...wood(1), state: 'depleted' as const }, { ...wood(1), state: 'reserved' as const },
      { ...wood(1), remainingAmount: 500, reservedAmount: 500 }, { ...wood(1), cleared: true }, { ...wood(1), access: null }]) {
      expect(planSpawnResources(input({ naturalResources: [unavailable, stone(40)] })).needsWood).toBe(true);
    }
    expect(planSpawnResources(input({ naturalResources: [wood(1), stone(40.01)] })).poorInResources).toBe(true);
  });
  it('counts only trees surviving actual posed surfaces, not the unposed kit reference', () => {
    const natural = { ...wood(1), trees: [{ x: 0, y: 0 }] };
    expect(planSpawnResources(input({ naturalResources: [natural] })).needsWood).toBe(true);
    const moved = { ...wood(1), trees: [{ x: 5, y: 5 }] };
    expect(planSpawnResources(input({ naturalResources: [moved], referenceSurfaces: [surface(0, 0), surface(5, 5)] })).needsWood).toBe(false);
  });
  it('measures swept passages and toroidal edge-to-edge gaps across both seams', () => {
    expect(spawnPathLength([{ x: 511, y: 255 }, { x: 1, y: 255 }, { x: 1, y: 1 }], 512, 256)).toBe(4);
    expect(spawnSurfaceGap(surface(511, 255), surface(10, 255), 512, 256)).toBe(10);
    expect(spawnPathSurfaces([{ x: 511, y: 0 }, { x: 1, y: 0 }], 512, 256)[0]).toEqual({ x: 512, y: 0, halfWidth: 1.0625, halfHeight: .0625 });
    expect(() => spawnPathLength([{ x: 0, y: 0 }, { x: 1, y: 1 }], 512, 256)).toThrow('cardinal');
  });
  it('protects occupations and entire swept routes; never leaves a partial supplement plan', () => {
    expect(planSpawnResources(input({ protectedSurfaces: [surface(11, 0)] }))).toMatchObject({ status: 'no-space', supplements: [] });
    const crossing = [...sites]; crossing[4] = candidate(10.5, .5, [{ x: 0, y: .5 }, { x: 9.9375, y: .5 }], 'wood');
    expect(planSpawnResources(input({ candidates: crossing }))).toMatchObject({ status: 'no-space', supplements: [] });
  });
  it('finds a complete alternative to a locally valid mini that would obstruct required wood access', () => {
    const trap = candidate(11.05, 1.2, [{ x: 0, y: 1.2 }, { x: 10.4875, y: 1.2 }]);
    expect(spawnSurfaceGap(trap.surface, surface(0, 0), 512, 256)).toBeGreaterThanOrEqual(10);
    // The first mini is shorter than the safe second mini, but blocks this wood route.
    const routedWood = candidate(4, 4, [{ x: 0, y: 1.2 }, { x: 11, y: 1.2 }, { x: 11, y: 4 }, { x: 4.5625, y: 4 }]);
    // Its route is >15, so use a nearby wood access crossing the trap instead.
    const shortWood = candidate(11, 3, [{ x: 0, y: 1.2 }, { x: 11, y: 1.2 }, { x: 11, y: 2.4375 }], 'wood');
    expect(spawnPathLength(routedWood.access.path, 512, 256)).toBeGreaterThan(15);
    const safeMini = candidate(0, 15, [{ x: 0, y: 14.4375 }]);
    const result = planSpawnResources(input({ candidates: [trap, sites[0]!, safeMini, sites[2]!, sites[3]!, shortWood, sites[5]!], maxVisited: 100 }));
    expect(result.status).toBe('planned'); expect(result.supplements.some(c => c.surface.x === trap.surface.x)).toBe(false);
  });
  it('never calls an exhausted budget or partial candidate enumeration impossible', () => {
    expect(planSpawnResources(input({ maxVisited: 0 }))).toMatchObject({ status: 'incomplete', supplements: [] });
    expect(planSpawnResources(input({ candidates: [], candidatesComplete: false }))).toMatchObject({ status: 'incomplete', supplements: [] });
    expect(planSpawnResources(input({ candidates: [] }))).toMatchObject({ status: 'no-space', supplements: [] });
    expect(() => planSpawnResources(input({ candidates: [candidate(2, 2, [{ x: 1, y: 1 }])] }))).toThrow('cardinal');
  });
  it('retains all unposed manual-kit surfaces when measuring mini-deposit margins', () => {
    const plan = planSpawnResources(input({ referenceSurfaces: [surface(0, 0), surface(5, 0)] }));
    expect(plan).toMatchObject({ status: 'no-space', supplements: [] });
    // The second kit element has not been posed; the natural wood test still
    // only removes trees under posedSurfaces. It never reserves the reference.
    expect(planSpawnResources(input({ naturalResources: [{ ...wood(1), trees: [{ x: 5, y: 0 }] }],
      referenceSurfaces: [surface(0, 0), surface(5, 0)] })).needsWood).toBe(false);
  });
});
