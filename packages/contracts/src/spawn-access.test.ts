import { describe, expect, it } from 'vitest';
import { buildSpawnAccessNetwork, canWalkSpawnSegment, type SpawnAccessField } from './spawn-access.js';
import { spawnPathLength } from './spawn-resources.js';
const flat = (): SpawnAccessField => ({ width: 512, height: 256, sample: () => ({ elevation: .75, dry: true, blocked: false }) });
describe('RC1 pedestrian paths, independently from terraforming', () => {
  it('accepts exactly .25 per cell and rejects an additional .00001', () => {
    for (const slope of [.25, -.25, .25001, -.25001]) {
      const field = { ...flat(), sample: (x: number) => ({ elevation: 1 + slope * x, dry: true, blocked: false }) };
      expect(canWalkSpawnSegment(field, { x: 10, y: 10 }, { x: 11, y: 10 })).toBe(Math.abs(slope) <= .25);
    }
  });
  it('rejects a local cliff even if the endpoint difference is inside the terrace band', () => {
    const field = { ...flat(), sample: (x: number) => ({ elevation: x < 10.5 ? .75 : .95, dry: true, blocked: false }) };
    expect(canWalkSpawnSegment(field, { x: 10, y: 10 }, { x: 11, y: 10 })).toBe(false);
  });
  it('checks water and blocked surfaces inside the swept passage, not only endpoints', () => {
    for (const obstacle of ['water', 'occupation']) {
      const field = { ...flat(), sample: (x: number, y: number) => ({ elevation: .75,
        dry: !(obstacle === 'water' && x === 10.5 && y > 10), blocked: obstacle === 'occupation' && x === 10.5 }) };
      expect(canWalkSpawnSegment(field, { x: 10, y: 10 }, { x: 11, y: 10 })).toBe(false);
    }
  });
  it('takes a real detour around an obstacle and stores physical path lengths', () => {
    const field = { ...flat(), sample: (x: number, y: number) => ({ elevation: .75, dry: true, blocked: Math.abs(x - 1) < .4 && (y < .4 || y > 255.6) }) };
    const network = buildSpawnAccessNetwork(field, [[{ x: 0, y: 0 }]], 4);
    const route = network.routes.find(r => r.point.x === 2 && r.point.y === 0)!;
    expect(route.length).toBe(4); expect(spawnPathLength(route.path, 512, 256)).toBe(4);
    expect(network.complete).toBe(true);
  });
  it('wraps both seams and reaches the corner in two steps', () => {
    const result = buildSpawnAccessNetwork(flat(), [[{ x: 511, y: 255 }]], 2);
    expect(result.routes.find(r => r.point.x === 0 && r.point.y === 0)?.length).toBe(2);
    expect(result.routes.every(r => r.length <= 2)).toBe(true);
  });
  it('connects the actual subcell exit and retains its hall-to-door length', () => {
    const result = buildSpawnAccessNetwork(flat(), [[{ x: 10, y: 10 }, { x: 10, y: 10.5 }, { x: 10.625, y: 10.5 }]], 2);
    expect(result.routes.find(r => r.point.x === 11 && r.point.y === 11)?.length).toBe(2);
  });
  it('keeps an interrupted search distinct from a completed lattice search', () => {
    expect(buildSpawnAccessNetwork(flat(), [[{ x: 0, y: 0 }]], 40, 1)).toMatchObject({ visited: 1, complete: false });
    expect(() => canWalkSpawnSegment(flat(), { x: 0, y: 0 }, { x: 1, y: 1 })).toThrow('cardinal');
  });
  it('stops on a successful route witness without claiming exhaustive exploration', () => {
    const network = buildSpawnAccessNetwork(flat(), [[{ x: 0, y: 0 }]], 40, 4000, routes => routes.some(r => r.point.x === 2 && r.point.y === 0));
    expect(network.complete).toBe(false); expect(network.visited).toBeLessThan(20);
    expect(network.routes.find(r => r.point.x === 2 && r.point.y === 0)?.length).toBe(2);
  });
});
