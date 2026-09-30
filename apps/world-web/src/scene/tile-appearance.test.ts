import { describe, expect, it } from 'vitest';
import { gardenTileStage } from './tile-appearance';
import { needsDiagonalShorePatch, shoreFaceCorners, shoreInset } from './shore-profile';

describe('terrain tile selection', () => {
  it('keeps square water boundaries and varies the shore band inland', () => {
    for (let edge = 0; edge < 4; edge++) {
      expect(shoreInset(1024, 512, edge, 0)).toBe(0.38);
      expect(shoreInset(1024, 512, edge, 4)).toBe(0.38);
      for (const point of [1, 2, 3]) {
        const inset = shoreInset(1024, 512, edge, point);
        expect(inset).toBe(shoreInset(1024, 512, edge, point));
        expect(inset).toBeGreaterThanOrEqual(0.32);
        expect(inset).toBeLessThanOrEqual(0.68);
      }
    }
  });

  it('orients each cliff face toward its water neighbor', () => {
    const edges = [
      { a: [-1, -1], b: [1, -1], outward: [0, -1] },
      { a: [1, -1], b: [1, 1], outward: [1, 0] },
      { a: [1, 1], b: [-1, 1], outward: [0, 1] },
      { a: [-1, 1], b: [-1, -1], outward: [-1, 0] },
    ] as const;
    for (const edge of edges) {
      const corners = shoreFaceCorners(edge.a, edge.b, 0, -0.75);
      const ux = corners[3]! - corners[0]!, uy = corners[4]! - corners[1]!, uz = corners[5]! - corners[2]!;
      const vx = corners[6]! - corners[0]!, vy = corners[7]! - corners[1]!, vz = corners[8]! - corners[2]!;
      const normalX = uy * vz - uz * vy, normalZ = ux * vy - uy * vx;
      expect(normalX * edge.outward[0] + normalZ * edge.outward[1]).toBeLessThan(0);
    }
  });

  it('fills the grass corner between two shore-bearing land neighbors', () => {
    expect(needsDiagonalShorePatch(1, 1, 2)).toBe(true);
    expect(needsDiagonalShorePatch(1, 3, 2)).toBe(true);
    expect(needsDiagonalShorePatch(2, 1, 2)).toBe(false);
    expect(needsDiagonalShorePatch(1, 1, 1)).toBe(false);
    expect(needsDiagonalShorePatch(null, 1, 2)).toBe(false);
  });

  it('uses the eight garden stages from construction through full', () => {
    const plot = (storedCarrots: number, full = false): NonNullable<Parameters<typeof gardenTileStage>[0]> => ({
      storedCarrots, capacity: 600, full,
    } as NonNullable<Parameters<typeof gardenTileStage>[0]>);
    expect([0, 1, 119, 120, 240, 360, 480, 600].map((stock) => gardenTileStage(plot(stock))))
      .toEqual([1, 2, 2, 3, 4, 5, 6, 7]);
    expect(gardenTileStage(plot(450, true))).toBe(7);
  });
});
