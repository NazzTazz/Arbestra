import { describe, expect, it } from 'vitest';
import { isBuildingFootprintFlat, levelingWork } from './leveling.js';

describe('building leveling', () => {
  it('balances cut and fill and divides one-minute labour between inhabitants', () => {
    expect(levelingWork([[1], [1.5]], 1)).toEqual({ height: 1.25, workMs: 120_000 });
    expect(levelingWork([[1], [1.5]], 3)).toEqual({ height: 1.25, workMs: 40_000 });
    expect(levelingWork([[1, 1.5], [1, 1.5]], 2)).toEqual({ height: 1.25, workMs: 60_000 });
  });
  it('checks the complete footprint, tolerates one snapshot unit and rejects unknown heights', () => {
    expect(isBuildingFootprintFlat([25, 26, 25])).toBe(true);
    expect(isBuildingFootprintFlat([25, 26, 27])).toBe(false);
    expect(isBuildingFootprintFlat([25, NaN])).toBe(false);
    expect(isBuildingFootprintFlat([])).toBe(false);
  });
  it('detects relief inside a cell and rounds labour only once', () => {
    expect(levelingWork([[0, .25]], 1).workMs).toBe(30_000);
    expect(levelingWork([[1], [1.001]], 1).workMs).toBeLessThan(241);
    expect(() => levelingWork([[NaN]], 1)).toThrow();
    expect(() => levelingWork([[1]], 4)).toThrow();
  });
});
