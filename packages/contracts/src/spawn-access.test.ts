import { describe, expect, it } from 'vitest';
import { buildSpawnAccessNetwork, canWalkSpawnSegment, type SpawnAccessField } from './spawn-access.js';
import { spawnPathLength } from './spawn-resources.js';
const flat = (): SpawnAccessField => ({
  width: 512,
  height: 256,
  sample: () => ({ elevation: 0.75, dry: true, blocked: false }),
});
describe('RC1 pedestrian paths, independently from terraforming', () => {
  it('accepts exactly .25 per cell and rejects an additional .00001', () => {
    for (const slope of [0.25, -0.25, 0.25001, -0.25001]) {
      const field = { ...flat(), sample: (x: number) => ({ elevation: 1 + slope * x, dry: true, blocked: false }) };
      expect(canWalkSpawnSegment(field, { x: 10, y: 10 }, { x: 11, y: 10 })).toBe(Math.abs(slope) <= 0.25);
    }
  });
  it('rejects a local cliff even if the endpoint difference is inside the terrace band', () => {
    const field = {
      ...flat(),
      sample: (x: number) => ({ elevation: x < 10.5 ? 0.75 : 0.95, dry: true, blocked: false }),
    };
    expect(canWalkSpawnSegment(field, { x: 10, y: 10 }, { x: 11, y: 10 })).toBe(false);
  });
  it('checks water and blocked surfaces inside the swept passage, not only endpoints', () => {
    for (const obstacle of ['water', 'occupation']) {
      const field = {
        ...flat(),
        sample: (x: number, y: number) => ({
          elevation: 0.75,
          dry: !(obstacle === 'water' && x === 10.5 && y > 10),
          blocked: obstacle === 'occupation' && x === 10.5,
        }),
      };
      expect(canWalkSpawnSegment(field, { x: 10, y: 10 }, { x: 11, y: 10 })).toBe(false);
    }
  });
  it('takes a real detour around an obstacle and stores physical path lengths', () => {
    const field = {
      ...flat(),
      sample: (x: number, y: number) => ({
        elevation: 0.75,
        dry: true,
        blocked: Math.abs(x - 1) < 0.4 && (y < 0.4 || y > 255.6),
      }),
    };
    const network = buildSpawnAccessNetwork(field, [[{ x: 0, y: 0 }]], 4);
    const route = network.routes.find((r) => r.point.x === 2 && r.point.y === 0)!;
    expect(route.length).toBe(4);
    expect(spawnPathLength(route.path, 512, 256)).toBe(4);
    expect(network.complete).toBe(true);
  });
  it('wraps both seams and reaches the corner in two steps', () => {
    const result = buildSpawnAccessNetwork(flat(), [[{ x: 511, y: 255 }]], 2);
    expect(result.routes.find((r) => r.point.x === 0 && r.point.y === 0)?.length).toBe(2);
    expect(result.routes.every((r) => r.length <= 2)).toBe(true);
  });
  it('connects the actual subcell exit and retains its hall-to-door length', () => {
    const result = buildSpawnAccessNetwork(
      flat(),
      [
        [
          { x: 10, y: 10 },
          { x: 10, y: 10.5 },
          { x: 10.625, y: 10.5 },
        ],
      ],
      2,
    );
    expect(result.routes.find((r) => r.point.x === 11 && r.point.y === 11)?.length).toBe(2);
  });
  it('keeps an interrupted search distinct from a completed lattice search', () => {
    expect(buildSpawnAccessNetwork(flat(), [[{ x: 0, y: 0 }]], 40, 1)).toMatchObject({ visited: 1, complete: false });
  });
  it('sweeps an oblique segment along its normal, with Euclidean intervals (decision 23)', () => {
    expect(canWalkSpawnSegment(flat(), { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(true);
    // A diagonal of one cell rises 0.25 per unit of its own length, not per axis.
    for (const slope of [0.25, 0.25001]) {
      const field = {
        ...flat(),
        sample: (x: number, y: number) => ({
          elevation: 1 + (slope * (x + y)) / Math.SQRT2,
          dry: true,
          blocked: false,
        }),
      };
      expect(canWalkSpawnSegment(field, { x: 10, y: 10 }, { x: 11, y: 11 })).toBe(slope <= 0.25);
    }
    // A thin obstacle on one side line, 1/16 off the diagonal: swept, then missed when farther.
    const side = (distance: number) => ({
      ...flat(),
      sample: (x: number, y: number) => ({
        elevation: 0.75,
        dry: true,
        blocked: Math.abs((x - 10 - (y - 10)) / Math.SQRT2 - distance) < 1e-6,
      }),
    });
    expect(canWalkSpawnSegment(side(1 / 16), { x: 10, y: 10 }, { x: 11, y: 11 })).toBe(false);
    expect(canWalkSpawnSegment(side(1 / 8), { x: 10, y: 10 }, { x: 11, y: 11 })).toBe(true);
    // Across both seams of the torus.
    expect(canWalkSpawnSegment(flat(), { x: 511.5, y: 255.5 }, { x: 0.5, y: 0.5 })).toBe(true);
  });
  it('samples the same points in both directions of a unit edge (symmetric test)', () => {
    const seen = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const points = new Set<string>();
      canWalkSpawnSegment(
        {
          ...flat(),
          sample: (x, y) => {
            points.add(`${x.toFixed(9)}:${y.toFixed(9)}`);
            return { elevation: 0.75, dry: true, blocked: false };
          },
        },
        a,
        b,
      );
      return [...points].sort();
    };
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
    ] as const)
      expect(seen({ x: 20 + dx, y: 20 + dy }, { x: 20, y: 20 })).toEqual(
        seen({ x: 20, y: 20 }, { x: 20 + dx, y: 20 + dy }),
      );
  });
  it('stops on a successful route witness without claiming exhaustive exploration', () => {
    const network = buildSpawnAccessNetwork(flat(), [[{ x: 0, y: 0 }]], 40, 4000, (routes) =>
      routes.some((r) => r.point.x === 2 && r.point.y === 0),
    );
    expect(network.complete).toBe(false);
    expect(network.visited).toBeLessThan(20);
    expect(network.routes.find((r) => r.point.x === 2 && r.point.y === 0)?.length).toBe(2);
  });
});
