import { describe, expect, it } from 'vitest';
import { axisZones, boxZones, cellZones, vertexCells, wrappedSpan, zoneOf } from './spatial-locks.js';

const rc1 = { worldId: 'w', widthCells: 512, heightCells: 256, chunkSize: 32 };

describe('spatial zones', () => {
  it('maps cells to chunk zones on the torus', () => {
    expect(zoneOf(rc1, 0, 0)).toBe(0);
    expect(zoneOf(rc1, 31, 31)).toBe(0);
    expect(zoneOf(rc1, 32, 0)).toBe(1);
    expect(zoneOf(rc1, 0, 32)).toBe(16);
    expect(zoneOf(rc1, -1, -1)).toBe(7 * 16 + 15);
    expect(zoneOf(rc1, 512, 256)).toBe(0);
  });
  it('covers a wrapped interval, through the seam, or the whole axis', () => {
    expect(axisZones(30, 4, 512, 32)).toEqual([0, 1]);
    expect(axisZones(-2, 4, 512, 32)).toEqual([0, 15]);
    expect(axisZones(0, 32, 512, 32)).toEqual([0]);
    expect(axisZones(0, 33, 512, 32)).toEqual([0, 1]);
    expect(axisZones(5, 512, 512, 32)).toHaveLength(16);
  });
  it('adds a halo across zone borders and the seam', () => {
    expect([...cellZones(rc1, [{ cellX: 40, cellY: 40 }], 2)]).toEqual([17]);
    expect([...cellZones(rc1, [{ cellX: 31, cellY: 40 }], 2)].sort((a, b) => a - b)).toEqual([16, 17]);
    // A cell at the corner of the torus touches the four corner zones.
    expect([...cellZones(rc1, [{ cellX: 0, cellY: 0 }], 1)].sort((a, b) => a - b)).toEqual([0, 15, 112, 127]);
  });
  it('two writers whose rules meet always share a zone', () => {
    // Cells one apart (a shared vertex) on both sides of a zone border.
    for (const [a, b] of [
      [31, 32],
      [511, 0],
      [63, 64],
    ] as const) {
      const left = cellZones(rc1, [{ cellX: a, cellY: 100 }], 2),
        right = cellZones(rc1, [{ cellX: b, cellY: 100 }], 2);
      expect([...left].some((z) => right.has(z))).toBe(true);
    }
    // A vertex write locks its four cells.
    expect(vertexCells({ vertexX: 32, vertexY: 32 })).toContainEqual({ cellX: 31, cellY: 31 });
  });
  it('widens a box by its margin, wrapping', () => {
    const zones = boxZones(rc1, { originCellX: 500, originCellY: 10, width: 20, height: 4 }, 16);
    // x from 484 to 535 (wraps to 23): zones 15 and 0; y from -6 to 29: zones 7 and 0.
    expect([...zones].sort((a, b) => a - b)).toEqual([0, 15, 112, 127]);
  });
  it('finds the smallest wrapped span', () => {
    expect(wrappedSpan([10, 20, 15], 512)).toEqual({ origin: 10, size: 11 });
    expect(wrappedSpan([510, 2], 512)).toEqual({ origin: 510, size: 5 });
  });
});
