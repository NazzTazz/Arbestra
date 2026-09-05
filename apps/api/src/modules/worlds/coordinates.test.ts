import { describe, expect, it } from 'vitest';

import { normalizeCell, toroidalChebyshev, toroidalManhattan, wrappedDelta } from './coordinates.js';

describe('toroidal world coordinates', () => {
  it('normalizes coordinates on both sides of the canonical interval', () => {
    expect(normalizeCell(-1, 2048)).toBe(2047);
    expect(normalizeCell(2048, 2048)).toBe(0);
  });

  it('uses the shortest delta across a seam', () => {
    expect(wrappedDelta(0, 2047, 2048)).toBe(1);
    expect(wrappedDelta(2047, 0, 2048)).toBe(-1);
  });

  it('computes Manhattan and Chebyshev distance across both seams', () => {
    expect(toroidalManhattan(0, 0, 2047, 1023, 2048, 1024)).toBe(2);
    expect(toroidalChebyshev(0, 0, 2047, 1023, 2048, 1024)).toBe(1);
  });
});
