import { describe, expect, it } from 'vitest';
import { FALL_S, PILE_LOGS, WOOD_SECTIONS, pileSlot, woodFallAt, woodSite } from './worksite-site';

describe('wood worksite material', () => {
  it('fells at W0 + min(10 s, 12 %), later for a late feller, never after 30 %', () => {
    expect(woodFallAt(60, 0)).toBeCloseTo(7.2);
    expect(woodFallAt(200, 0)).toBe(10);
    expect(woodFallAt(200, 12)).toBeCloseTo(16.8);
    expect(woodFallAt(60, 40)).toBeCloseTo(18);
    expect(woodFallAt(60, null)).toBeCloseTo(18);
  });

  it('tilts in t², bounces, then lies, with no tilt before the fall', () => {
    const at = 10;
    expect(woodSite(60, 9.9, at, 0).tilt).toBe(0);
    expect(woodSite(60, at + FALL_S / 2, at, 0).tilt).toBeCloseTo(Math.PI / 8);
    const bounce = woodSite(60, at + FALL_S + 0.2, at, 0).tilt;
    expect(bounce).toBeLessThan(Math.PI / 2);
    expect(bounce).toBeGreaterThan(Math.PI / 2 - 0.08);
    expect(woodSite(60, at + 5, at, 0).tilt).toBe(Math.PI / 2);
  });

  it('never replays a fall that was due before the site was shown (F5)', () => {
    expect(woodSite(60, 10.3, 10, 10.2).tilt).toBe(Math.PI / 2);
    expect(woodSite(60, 10.3, 10, 10.2).sections).toBe(WOOD_SECTIONS);
  });

  it('cuts the sections at even steps between landing and W1, consuming the trunk at W1', () => {
    expect(woodSite(60, 5, 10, 0).sections).toBe(WOOD_SECTIONS);
    expect(woodSite(60, 12, 10, 0).sections).toBe(WOOD_SECTIONS);
    expect(woodSite(60, 30, 10, 0).sections).toBe(4);
    expect(woodSite(60, 59.9, 10, 0).sections).toBe(1);
    expect(woodSite(60, 60, 10, 0).sections).toBe(0);
  });

  it('grows the pile with progress and fills it at W1', () => {
    expect(woodSite(60, 0, 10, 0).logs).toBe(0);
    expect(woodSite(60, 30, 10, 0).logs).toBe(4);
    expect(woodSite(60, 60, 10, 0).logs).toBe(PILE_LOGS);
    expect(woodSite(60, 90, 10, 0).logs).toBe(PILE_LOGS);
  });

  it('gives the same state whatever the evaluation path', () => {
    const direct = woodSite(73, 41.3, woodFallAt(73, 2), 0);
    for (let t = 0; t <= 41.3; t += 0.7) woodSite(73, t, woodFallAt(73, 2), 0);
    expect(woodSite(73, 41.3, woodFallAt(73, 2), 0)).toEqual(direct);
  });

  it('stacks the pile in three centred levels of 4, 3 and 2', () => {
    const slots = Array.from({ length: PILE_LOGS }, (_, i) => pileSlot(i));
    expect(slots.map((s) => s.level)).toEqual([0, 0, 0, 0, 1, 1, 1, 2, 2]);
    expect(slots.filter((s) => s.level === 1).map((s) => s.along)).toEqual([-1, 0, 1]);
    expect(slots.filter((s) => s.level === 2).map((s) => s.along)).toEqual([-0.5, 0.5]);
  });
});
