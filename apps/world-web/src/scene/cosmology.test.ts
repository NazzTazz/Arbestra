import { describe, expect, it } from 'vitest';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { COSMOLOGY, SOLAR_ORBIT, TAU, combinedPeriod, cyclePhase, cyclePhases, illumination, measureRegime, solarCurvePoint, solarPhase, sunPosition, torusBlocksSegment, torusFrame, torusImplicit } from './cosmology';

describe('deterministic toric daylight', () => {
  it('lights every sampled exterior longitude at least once over the complete combined cycle', () => {
    for (let i = 0; i < 128; i++) {
      const regime = measureRegime(i / 128 * TAU, 0, SOLAR_ORBIT, 2048);
      expect(regime.permanent, `exterior longitude ${i}`).not.toBe('night');
      expect(regime.days, `exterior longitude ${i}`).toBeGreaterThanOrEqual(1);
    }
  });
  it('uses the epoch and returns the same phase after suspension and whole rotations', () => {
    const period = combinedPeriod();
    expect(cyclePhase(COSMOLOGY.epochMs)).toBe(0);
    expect(cyclePhase(COSMOLOGY.epochMs - period / 4)).toBeCloseTo(TAU * .75);
    for (const elapsed of [31, 250, 39000, 91000]) expect(cyclePhase(COSMOLOGY.epochMs + elapsed + 100 * period)).toBeCloseTo(cyclePhase(COSMOLOGY.epochMs + elapsed));
  });
  it('separates the two periods and repeats only after three torus rotations and two solar eights', () => {
    expect(combinedPeriod()).toBe(24 * 3600_000);
    const rotation = cyclePhases(cyclePhase(COSMOLOGY.epochMs + 8 * 3600_000));
    expect(rotation.torus).toBeCloseTo(TAU);
    expect(rotation.sun).toBeCloseTo(TAU * 2 / 3);
    const solar = cyclePhases(cyclePhase(COSMOLOGY.epochMs + 12 * 3600_000));
    expect(solar.sun).toBeCloseTo(TAU);
    expect(solar.torus).toBeCloseTo(3 * Math.PI);
    expect(cyclePhase(COSMOLOGY.epochMs + 24 * 3600_000)).toBe(0);
  });
  it('covers every exterior direction with four quarter-turn witnesses and a positive horizon margin', () => {
    const radius = COSMOLOGY.majorRadius + COSMOLOGY.tubeRadius;
    const worstIncidence = (SOLAR_ORBIT.a * Math.cos(Math.PI / 4) - radius)
      / Math.sqrt(SOLAR_ORBIT.a ** 2 + radius ** 2 - 2 * SOLAR_ORBIT.a * radius * Math.cos(Math.PI / 4));
    // Nearest of four evenly spaced directions is at most π/4 away. Its
    // outward ray stays outside R+r, so the torus cannot occult this witness.
    expect(worstIncidence).toBeGreaterThan(.12);
    for (let i = 0; i < 2048; i++) {
      const u = i / 2048 * TAU;
      const witnesses = [0, .25, .5, .75].map(t => illumination(u, 0, t * TAU));
      expect(Math.max(...witnesses.map(light => light.direct))).toBeGreaterThanOrEqual(worstIncidence - 1e-10);
    }
  });
  it('detects obstruction including narrow grazing intersections without treating tangent or hole rays as blocked', () => {
    expect(torusBlocksSegment([0, 0, 0], [0, 5, 0])).toBe(false);
    expect(torusBlocksSegment([-5, 0, 0], [5, 0, 0])).toBe(true);
    expect(torusBlocksSegment([-5, 1, 0], [5, 1, 0])).toBe(false);
    expect(torusBlocksSegment([-5, .9999, 0], [5, .9999, 0])).toBe(true);
    expect(torusBlocksSegment([3.40001, 0, 0], [8, 0, 0])).toBe(false);
  });
  it('agrees with Babylon rotation and keeps tangent directions orthogonal across both seams', () => {
    for (const u of [0, TAU - 1e-8, .7]) for (const v of [0, TAU - 1e-8, Math.PI]) {
      const p = torusFrame(u, v), rotated = torusFrame(u, v, .9);
      const native = Vector3.TransformCoordinates(Vector3.FromArray([...p.point]), Matrix.RotationY(-.9));
      // Babylon matrices use Float32 storage by default.
      expect(Vector3.Distance(native, Vector3.FromArray([...rotated.point]))).toBeLessThan(1e-6);
      expect(torusImplicit(rotated.point)).toBeCloseTo(0, 8);
      expect(Vector3.Dot(Vector3.FromArray([...p.east]), Vector3.FromArray([...p.normal]))).toBeCloseTo(0);
    }
    expect(illumination(0, 0, 1).direct).toBeCloseTo(illumination(TAU, TAU, 1).direct, 12);
  });
  it('keeps the sun out of the torus and traverses its closed curve without reversing', () => {
    for (let i = 0; i < 4096; i++) expect(torusImplicit(sunPosition(i / 4096 * TAU))).toBeGreaterThan(0);
    for (let axis = 0; axis < 3; axis++) expect(sunPosition(0)[axis]).toBeCloseTo(sunPosition(TAU)[axis]!, 12);
    // The visible sphere (radius .13) also clears the torus, not only its centre.
    for (let i = 0; i < 4096; i++) {
      const [x, y, z] = solarCurvePoint(i / 4096 * TAU);
      expect(Math.hypot(Math.hypot(x, z) - COSMOLOGY.majorRadius, y) - COSMOLOGY.tubeRadius).toBeGreaterThan(.13);
      expect(z).toBe(0);
    }
  });
  it('passes through the central hole at both crossings of the eight', () => {
    // Invert the monotone time mapping rather than assuming constant solar speed.
    for (const crossing of [Math.PI / 2, 3 * Math.PI / 2]) {
      let low = 0, high = TAU - 1e-12;
      for (let step = 0; step < 50; step++) {
        const t = (low + high) / 2;
        const q = solarPhase(t);
        if (q < crossing) low = t; else high = t;
      }
      expect(Math.hypot(...sunPosition((low + high) / 2))).toBeLessThan(1e-8);
    }
  });
  it('distinguishes permanent light from zero significant days and reports periodic intervals', () => {
    expect(measureRegime(0, Math.PI / 2).days).toBeGreaterThan(0);
    const central = { ...SOLAR_ORBIT, a: 0, b: 0 };
    expect(measureRegime(0, Math.PI, central).permanent).toBe('day');
    expect(measureRegime(0, 0, central).permanent).toBe('night');
    const r = measureRegime(.2, Math.PI);
    expect(r.intervals.length).toBeGreaterThanOrEqual(r.days);
    expect(r.dayFraction).toBeGreaterThan(0);
  });
  it('encloses both complete torus sections in the two loops of its vertical profile', () => {
    for (const side of [-1, 1]) for (let i = 0; i < 1024; i++) {
      const angle = i / 1024 * TAU;
      const x = side * COSMOLOGY.majorRadius + COSMOLOGY.tubeRadius * Math.cos(angle);
      const y = COSMOLOGY.tubeRadius * Math.sin(angle);
      // Interior of the Gerono eight: y² < 4 B² (x/A)² (1 - (x/A)²).
      const c2 = (x / SOLAR_ORBIT.a) ** 2;
      expect(c2).toBeLessThan(1);
      expect(y * y).toBeLessThan(4 * SOLAR_ORBIT.b ** 2 * c2 * (1 - c2));
    }
    expect(solarCurvePoint(Math.PI / 4)[1]).toBeGreaterThan(0);
    expect(solarCurvePoint(3 * Math.PI / 4)[1]).toBeLessThan(0);
    expect(solarCurvePoint(5 * Math.PI / 4)[1]).toBeGreaterThan(0);
    expect(solarCurvePoint(7 * Math.PI / 4)[1]).toBeLessThan(0);
  });
  it('moves at constant linear speed through lobes, turns and both crossings', () => {
    const distances = Array.from({ length: 1024 }, (_, i) => {
      const t = i / 1024 * TAU, a = sunPosition(t), b = sunPosition(t + TAU / 100_000);
      return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    });
    const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    expect(Math.max(...distances) / mean).toBeLessThan(1.002);
    expect(Math.min(...distances) / mean).toBeGreaterThan(.998);
    expect(solarPhase(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10);
    expect(solarPhase(3 * Math.PI / 2)).toBeCloseTo(3 * Math.PI / 2, 10);
  });
});
