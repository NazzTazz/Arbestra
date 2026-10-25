import { describe, expect, it } from 'vitest';
import { PEBBLE_DENSITY, roadTone, rubblePebbles } from './road-surface-detail';

const strip = (width: number, length: number) =>
  Array.from({ length: width * length }, (_, i) => ({ x: 100 + (i % length), y: 200 + Math.floor(i / length) }));

describe('road surface detail', () => {
  it('shades a corner identically whichever sector asks, within the amplitude', () => {
    expect(roadTone(12, 34, 0.06)).toBe(roadTone(12, 34, 0.06));
    for (const [x, y] of [
      [0, 0],
      [5, 9],
      [4095, 17],
    ]) {
      const t = roadTone(x!, y!, 0.06);
      expect(t).toBeGreaterThanOrEqual(0.94);
      expect(t).toBeLessThanOrEqual(1.06);
    }
  });
  it('places pebbles deterministically inside their own pixel, at the bounded density', () => {
    const pixels = strip(24, 160); // a ten-cell cart road roadway
    const a = rubblePebbles(pixels),
      b = rubblePebbles([...pixels].reverse());
    expect(new Set(a.map((p) => `${p.x}:${p.y}`))).toEqual(new Set(b.map((p) => `${p.x}:${p.y}`)));
    for (const p of a) {
      expect(p.x % 1).toBeGreaterThan(0.19);
      expect(p.x % 1).toBeLessThan(0.81);
      expect(p.size).toBeGreaterThanOrEqual(0.03);
      expect(p.size).toBeLessThanOrEqual(0.065);
    }
    expect(a.length / pixels.length).toBeGreaterThan(PEBBLE_DENSITY * 0.75);
    expect(a.length / pixels.length).toBeLessThan(PEBBLE_DENSITY * 1.25);
  });
});
