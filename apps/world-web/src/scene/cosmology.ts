/** Presentation only. No economic clock, credit or individual simulation. */
export type Point3 = readonly [number, number, number];
export const TAU = 2 * Math.PI;
export const COSMOLOGY = {
  majorRadius: 2.4, tubeRadius: 1, periodMs: 8 * 60 * 60 * 1000,
  epochMs: Date.UTC(2026, 0, 1), horizonThreshold: 0.01,
  surfaceEpsilon: 1e-5, minimumDayFraction: 0.01,
  torusTurns: 3, solarTurns: 2,
} as const;
export interface SolarOrbit { readonly a: number; readonly b: number; readonly phase: number }
export const SOLAR_ORBIT: SolarOrbit = Object.freeze({ a: 5.5, b: 3, phase: 0 });
export function combinedPeriod(rotationPeriodMs: number = COSMOLOGY.periodMs): number {
  return rotationPeriodMs * COSMOLOGY.torusTurns;
}
/** Common epoch, independent motions: three torus turns and two solar eights. */
export function cyclePhases(phase: number) {
  return { torus: phase * COSMOLOGY.torusTurns, sun: phase * COSMOLOGY.solarTurns };
}
export function cyclePhase(serverMs: number, periodMs: number = combinedPeriod()): number {
  return ((serverMs - COSMOLOGY.epochMs) % periodMs + periodMs) % periodMs / periodMs * TAU;
}
export function sunPosition(phase: number, orbit: SolarOrbit = SOLAR_ORBIT): Point3 {
  return solarCurvePoint(solarPhase(phase, orbit), orbit);
}
export function solarCurvePoint(q: number, orbit: SolarOrbit = SOLAR_ORBIT): Point3 {
  // The XY plane contains the revolution axis (Y). In profile each lobe
  // encloses one torus section, alternately passing above and below it.
  return [orbit.a * Math.cos(q), orbit.b * Math.sin(2 * q), 0];
}
const ARC_SEGMENTS = 4096;
const arcTables = new WeakMap<SolarOrbit, Float64Array>();
function arcTable(orbit: SolarOrbit): Float64Array {
  const cached = arcTables.get(orbit);
  if (cached) return cached;
  const table = new Float64Array(ARC_SEGMENTS + 1);
  let previous = solarCurvePoint(0, orbit);
  for (let i = 1; i <= ARC_SEGMENTS; i++) {
    const p = solarCurvePoint(i / ARC_SEGMENTS * TAU, orbit);
    table[i] = table[i - 1]! + Math.hypot(p[0] - previous[0], p[1] - previous[1]);
    previous = p;
  }
  arcTables.set(orbit, table);
  return table;
}
/** Invert cumulative arc length: equal time means equal distance on the eight. */
export function solarPhase(phase: number, orbit: SolarOrbit = SOLAR_ORBIT): number {
  const fraction = (((phase + orbit.phase) % TAU) + TAU) % TAU / TAU;
  const table = arcTable(orbit), length = table[ARC_SEGMENTS]!;
  if (length === 0) return fraction * TAU;
  const distance = fraction * length;
  let low = 0, high = ARC_SEGMENTS;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (table[middle]! <= distance) low = middle; else high = middle;
  }
  const part = (distance - table[low]!) / (table[high]! - table[low]!);
  return (low + part) / ARC_SEGMENTS * TAU;
}
export function torusFrame(u: number, v: number, phase = 0): { point: Point3; normal: Point3; east: Point3; north: Point3 } {
  const a = u + phase, c = Math.cos(a), s = Math.sin(a), cv = Math.cos(v), sv = Math.sin(v);
  const radius = COSMOLOGY.majorRadius + COSMOLOGY.tubeRadius * cv;
  return { point: [radius * c, COSMOLOGY.tubeRadius * sv, radius * s],
    normal: [cv * c, sv, cv * s], east: [-s, 0, c], north: [-sv * c, cv, -sv * s] };
}
export function torusImplicit([x, y, z]: Point3): number {
  const R = COSMOLOGY.majorRadius, r = COSMOLOGY.tubeRadius;
  return (x * x + y * y + z * z + R * R - r * r) ** 2 - 4 * R * R * (x * x + z * z);
}
const dot = (a: Point3, b: Point3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function polynomial(coefficients: number[], x: number): number {
  return coefficients.reduceRight((sum, coefficient) => sum * x + coefficient, 0);
}
/** Isolate roots between derivative extrema; no ray sampling can skip a thin obstruction. */
function roots(coefficients: number[], low: number, high: number): number[] {
  const scale = Math.max(...coefficients.map(Math.abs));
  if (!scale) return [];
  const c = coefficients.map(v => v / scale);
  while (c.length > 1 && Math.abs(c.at(-1)!) < 1e-14) c.pop();
  if (c.length === 1) return [];
  if (c.length === 2) { const r = -c[0]! / c[1]!; return r > low && r < high ? [r] : []; }
  const derivative = c.slice(1).map((v, i) => v * (i + 1));
  const boundaries = [low, ...roots(derivative, low, high), high], result: number[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    let a = boundaries[i]!, b = boundaries[i + 1]!, fa = polynomial(c, a), fb = polynomial(c, b);
    if (Math.abs(fa) < 1e-12 && a > low) result.push(a);
    if (fa * fb >= 0) continue;
    for (let step = 0; step < 42; step++) {
      const middle = (a + b) / 2, value = polynomial(c, middle);
      if (fa * value <= 0) { b = middle; fb = value; } else { a = middle; fa = value; }
    }
    result.push((a + b) / 2);
  }
  return result;
}
export function torusBlocksSegment(start: Point3, end: Point3): boolean {
  const d: Point3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const R2 = COSMOLOGY.majorRadius ** 2;
  const a = dot(d, d), b = 2 * dot(start, d), c = dot(start, start) + R2 - COSMOLOGY.tubeRadius ** 2;
  const f = [c * c - 4 * R2 * (start[0] ** 2 + start[2] ** 2),
    2 * b * c - 8 * R2 * (start[0] * d[0] + start[2] * d[2]),
    b * b + 2 * a * c - 4 * R2 * (d[0] ** 2 + d[2] ** 2), 2 * a * b, a * a];
  const extrema = roots(f.slice(1).map((v, i) => v * (i + 1)), 0, 1);
  return [0, 1, ...extrema].some(t => polynomial(f, t) < -1e-8);
}
export function illumination(u: number, v: number, phase: number, orbit: SolarOrbit = SOLAR_ORBIT) {
  const phases = cyclePhases(phase);
  const frame = torusFrame(u, v, phases.torus), sun = sunPosition(phases.sun, orbit);
  const delta: Point3 = [sun[0] - frame.point[0], sun[1] - frame.point[1], sun[2] - frame.point[2]];
  const distance = Math.hypot(...delta);
  const direction: Point3 = delta.map(value => value / distance) as unknown as Point3;
  const incidence = dot(frame.normal, direction);
  const origin: Point3 = frame.point.map((value, i) => value + frame.normal[i]! * COSMOLOGY.surfaceEpsilon) as unknown as Point3;
  const occluded = incidence > 0 && torusBlocksSegment(origin, sun);
  const direct = occluded ? 0 : Math.max(0, incidence);
  const localDirection: Point3 = [dot(direction, frame.east), incidence, dot(direction, frame.north)];
  return { direct, incidence, occluded, localDirection, lit: direct > COSMOLOGY.horizonThreshold };
}
export interface DayRegime { days: number; dayFraction: number; permanent: 'day' | 'night' | null; intervals: Array<[number, number]> }
export function measureRegime(u: number, v: number, orbit: SolarOrbit = SOLAR_ORBIT, samples = 1024): DayRegime {
  const flags = Array.from({ length: samples }, (_, i) => illumination(u, v, i / samples * TAU, orbit).lit);
  const fraction = flags.filter(Boolean).length / samples;
  if (fraction === 0 || fraction === 1) return { days: 0, dayFraction: fraction, permanent: fraction ? 'day' : 'night', intervals: [] };
  const intervals: Array<[number, number]> = [];
  const boundary = (low: number, high: number, entering: boolean) => {
    for (let step = 0; step < 20; step++) {
      const middle = (low + high) / 2;
      if (illumination(u, v, middle * TAU, orbit).lit === entering) high = middle;
      else low = middle;
    }
    return (low + high) / 2;
  };
  for (let i = 0; i < samples; i++) if (flags[i] && !flags[(i + samples - 1) % samples]) {
    let length = 1;
    while (length < samples && flags[(i + length) % samples]) length++;
    let start = boundary((i - 1) / samples, i / samples, true);
    let end = boundary((i + length - 1) / samples, (i + length) / samples, false);
    if (start < 0) { start++; end++; }
    intervals.push([start, end]);
  }
  // Keep the minimum at 1% of one torus rotation, not of the longer cycle.
  return { days: intervals.filter(([a, b]) => b - a >= COSMOLOGY.minimumDayFraction / COSMOLOGY.torusTurns).length,
    dayFraction: fraction, permanent: null, intervals };
}
