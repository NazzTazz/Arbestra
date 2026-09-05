import { describe, expect, it } from 'vitest';

import { worldCellKey } from './coordinates.js';
import { planClearingFeatures } from './clearing-features.js';

describe('clearing feature plans', () => {
  it('keeps the 5x5 core empty and places a small deterministic invitation', () => {
    const first = planClearingFeatures(42, 2048, 1024, [
      { centerCellX: 100, centerCellY: 100 },
    ], new Set());
    const second = planClearingFeatures(42, 2048, 1024, [
      { centerCellX: 100, centerCellY: 100 },
    ], new Set());

    expect(first).toEqual(second);
    expect(first.map((feature) => feature.featureTypeCode)).toEqual([
      'woodland',
      'woodland',
      'stone_outcrop',
      'woodland',
    ]);
    expect(first.every((feature) =>
      Math.max(Math.abs(feature.cellX - 100), Math.abs(feature.cellY - 100)) > 2,
    )).toBe(true);
  });

  it('never plans over an existing occupation', () => {
    const baseline = planClearingFeatures(7, 2048, 1024, [
      { centerCellX: 500, centerCellY: 300 },
    ], new Set());
    const blocked = new Set(baseline.map((feature) => worldCellKey(feature.cellX, feature.cellY)));
    const replacement = planClearingFeatures(7, 2048, 1024, [
      { centerCellX: 500, centerCellY: 300 },
    ], blocked);

    expect(replacement).toHaveLength(4);
    expect(replacement.every((feature) => !blocked.has(worldCellKey(feature.cellX, feature.cellY)))).toBe(true);
  });
});
