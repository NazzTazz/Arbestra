import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Scene } from '@babylonjs/core/scene';
import { HALO_MARKER, haloFlash, haloHalfSize, HaloMarkerPlugin, ondeWaves, satellites } from './halo-marker';

const ms = (p: number) => p * HALO_MARKER.flashMs;

it('rests as a soft ring a little inside the reference ring, with no wave', () => {
  const rest = haloFlash(null);
  expect(rest).toMatchObject({ active: false, light: 0, base: 0.92, keep: 1, done: false });
  expect(HALO_MARKER.ring - HALO_MARKER.onde.inset).toBeCloseTo(76 / 128, 6);
  expect(ondeWaves(rest.p)).toEqual([]);
  // The quad is sized from the reference ring, as on the board (R = 84 of 128 px).
  expect(haloHalfSize(0.84)).toBeCloseTo(1.28, 6);
});

it('sends two white waves outwards, at 0 and 22 %, each over 60 % of the 1.8 s validation', () => {
  expect(HALO_MARKER.flashMs).toBe(1800);
  const early = haloFlash(ms(0.1));
  expect(early.active).toBe(true);
  expect(ondeWaves(early.p)).toHaveLength(1);
  const mid = haloFlash(ms(0.5));
  // Lit: the ring whitens and brightens.
  expect(mid.light).toBeCloseTo(1, 6);
  expect(mid.base).toBeCloseTo(1, 6);
  const [first, second] = ondeWaves(mid.p);
  const q1 = 0.5 / 0.6,
    q2 = (0.5 - 0.22) / 0.6;
  expect(first!.radius).toBeCloseTo((76 + q1 * 40) / 128, 6);
  expect(first!.alpha).toBeCloseTo(1 - q1, 6);
  expect(first!.width).toBeCloseTo((10 * (1 - q1) + 2) / 128, 6);
  expect(second!.radius).toBeCloseTo((76 + q2 * 40) / 128, 6);
  // The older wave is wider, thinner and fainter.
  expect(first!.radius).toBeGreaterThan(second!.radius);
  expect(first!.width).toBeLessThan(second!.width);
  expect(first!.alpha).toBeLessThan(second!.alpha);
  // Each wave grows by about 48 % of the reference radius.
  expect(HALO_MARKER.onde.growth / HALO_MARKER.ring).toBeCloseTo(0.476, 3);
  // Both waves are over before the end; the light fades out.
  expect(ondeWaves(0.83)).toEqual([]);
  const late = haloFlash(ms(0.95));
  expect(late.light).toBeLessThan(0.05);
  expect(late.keep).toBeLessThan(0.05);
});

it('ends a validation with nothing drawn: a queued item has no halo', () => {
  const end = haloFlash(HALO_MARKER.flashMs);
  expect(end).toMatchObject({ active: false, done: true, keep: 0 });
  expect(satellites(end, 12).dots).toEqual([]);
});

it('keeps every wave and satellite inside the quad, so nothing is clipped', () => {
  const { onde, satellites: s, ring } = HALO_MARKER;
  expect(ring - onde.inset + onde.growth + onde.startWidth / 2).toBeLessThan(1);
  expect(ring + s.dot + s.dotGlow).toBeLessThan(1);
  expect(s.burstStart + s.burstGrowth).toBeLessThan(1);
});

it('orbits three points at rest, dives them to the centre in a spiral, then bursts', () => {
  const rest = haloFlash(null);
  const a = satellites(rest, 0),
    b = satellites(rest, 1);
  expect(a.dots).toHaveLength(3);
  for (const dot of a.dots) expect(Math.hypot(dot.x, dot.y)).toBeCloseTo(HALO_MARKER.ring, 6);
  // A second later every point has turned by the orbit speed.
  expect(Math.atan2(b.dots[0]!.y, b.dots[0]!.x)).toBeCloseTo(HALO_MARKER.satellites.orbit, 6);
  expect(a.burst).toBeNull();
  const diving = satellites(haloFlash(ms(0.25)), 0);
  expect(diving.dive).toBeGreaterThan(0.5);
  expect(Math.hypot(diving.dots[0]!.x, diving.dots[0]!.y)).toBeLessThan(HALO_MARKER.ring / 2);
  const centre = satellites(haloFlash(ms(1 / 1.8)), 0);
  expect(centre.dive).toBeCloseTo(1, 6);
  expect(Math.hypot(centre.dots[0]!.x, centre.dots[0]!.y)).toBeCloseTo(0, 6);
  expect(centre.burst).toMatchObject({ radius: expect.closeTo((20 + ((1 / 1.8 - 0.5) / 0.4) * 70) / 128, 6) });
  const burst = satellites(haloFlash(ms(0.7)), 0).burst!;
  expect(burst.radius).toBeCloseTo((20 + 0.5 * 70) / 128, 6);
  expect(burst.alpha).toBeCloseTo(0.45, 6);
  expect(satellites(haloFlash(ms(0.92)), 0).burst!.alpha).toBe(0);
});

it('declares its per-instance attributes only on instanced markers', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const source = { clock: () => 3, opacity: () => 0.5, scale: 2 };
    const instanced = new HaloMarkerPlugin(new StandardMaterial('a', scene), source, true),
      single = new HaloMarkerPlugin(new StandardMaterial('b', scene), source, false);
    const attributes: string[] = [];
    instanced.getAttributes(attributes);
    expect(attributes).toEqual(['haloState', 'haloTint']);
    attributes.length = 0;
    single.getAttributes(attributes);
    expect(attributes).toEqual([]);
    expect(single.uniforms()).toMatchObject({ clock: [3, 0.5], scale: 2, state: [0, 0, 0] });
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
