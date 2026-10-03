import { describe, expect, it } from 'vitest';
import { WorldSpace, terrainDemand } from './world-space';

describe('local toroidal frame', () => {
  it('round trips fractional picking at zero, both seams and the antipodal cut', () => {
    const space = new WorldSpace(2048, 1024, { cellX: 2017, cellY: 995 });
    for (const cell of [{ cellX: 0.25, cellY: 0.75 }, { cellX: 993.25, cellY: 483.75 }, { cellX: 2047.75, cellY: 1023.75 }]) {
      const p = space.project(cell), recovered = space.inverse(p.x, p.z);
      expect(recovered.cellX).toBeCloseTo(cell.cellX); expect(recovered.cellY).toBeCloseTo(cell.cellY);
      const shift = space.rebase(cell, 32)!;
      expect(space.inverse(p.x - shift.x, p.z - shift.z)).toEqual(recovered);
    }
  });
  it('unwraps a path through the antipodal cut by cardinal deltas', () => {
    const space = new WorldSpace(128, 128, { cellX: 95, cellY: 95 });
    const path = space.path([{ cellX: 30, cellY: 30 }, { cellX: 31, cellY: 30 }, { cellX: 32, cellY: 30 }]);
    expect(path[1]!.x - path[0]!.x).toBe(2.5); expect(path[2]!.x - path[1]!.x).toBe(2.5);
    const seam = space.path([{ cellX: 127, cellY: 127 }, { cellX: 0, cellY: 127 }, { cellX: 0, cellY: 0 }]);
    expect(seam[1]!.x - seam[0]!.x).toBe(2.5); expect(seam[2]!.z - seam[1]!.z).toBe(2.5);
    const anchor = { cellX: 30, cellY: 30 }, next = { cellX: 32, cellY: 32 };
    const a = space.project(anchor), b = space.projectFrom(next, anchor);
    expect(b.x - a.x).toBe(5); expect(b.z - a.z).toBe(5);
  });
  it('bounds demand at corners, every storage alignment, and smaller chunks', () => {
    for (const size of [8, 16, 32, 64]) for (const x of [0, 1, 31, 32, 2047]) {
      const demand = terrainDemand({ cellX: x, cellY: 1023 }, 2048, 1024, size);
      expect(demand.length).toBeLessThanOrEqual(64);
      expect(demand.filter(d => d.visible).length).toBeLessThanOrEqual(16);
      if (size === 32) expect(demand.length).toBeLessThanOrEqual(36);
      expect(new Set(demand.map(d => d.key)).size).toBe(demand.length);
      expect(demand.every(d => d.chunkX >= 0 && d.chunkY >= 0)).toBe(true);
    }
  });
});
