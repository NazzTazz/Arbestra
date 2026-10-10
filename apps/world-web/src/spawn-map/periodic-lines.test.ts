import { describe, expect, it } from 'vitest';
import { periodicMapLines } from './periodic-lines.js';
describe('arrival-map marker and red edges at torus seams', () => {
  it('clips a short horizontal marker into both visible sides instead of losing it', () => {
    expect(periodicMapLines([{ x: -1, y: 10 }, { x: 1, y: 10 }], 512, 256)).toEqual([
      [{ x: 511, y: 10 }, { x: 512, y: 10 }], [{ x: 0, y: 10 }, { x: 1, y: 10 }]]);
  });
  it('clips across both seams at the corner without a diagonal across the map', () => {
    expect(periodicMapLines([{ x: -1, y: -1 }, { x: 1, y: 1 }], 512, 256)).toEqual([
      [{ x: 511, y: 255 }, { x: 512, y: 256 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }]]);
  });
  it('duplicates a boundary-aligned edge and keeps ordinary contiguous polylines whole', () => {
    expect(periodicMapLines([{ x: 0, y: 10 }, { x: 0, y: 11 }], 512, 256)).toEqual([
      [{ x: 0, y: 10 }, { x: 0, y: 11 }], [{ x: 512, y: 10 }, { x: 512, y: 11 }]]);
    expect(periodicMapLines([{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 11 }], 512, 256)).toEqual([
      [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 11 }]]);
  });
});
