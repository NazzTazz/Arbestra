import { writeFileSync, mkdirSync } from 'node:fs';
import { COSMOLOGY, SOLAR_ORBIT, TAU, combinedPeriod, measureRegime, solarCurvePoint, torusImplicit } from '../apps/world-web/src/scene/cosmology.js';

const samples = Number(process.argv[2] ?? 1024);
if (!Number.isInteger(samples) || samples < 128 || samples > 8192) throw new Error('samples: integer 128..8192');
const bands = [0, 0.05, -0.05, Math.PI / 4, Math.PI / 2, Math.PI - 0.05, Math.PI, Math.PI + 0.05, -Math.PI / 2];
const started = performance.now();
const rows = bands.map(v => ({ v, longitudes: Array.from({ length: 64 }, (_, index) => {
  const u = index / 64 * TAU;
  return { u, ...measureRegime(u, v, SOLAR_ORBIT, samples) };
}) }));
const report = { config: COSMOLOGY, orbit: SOLAR_ORBIT, samples, longitudeSamples: 64,
  combinedPeriodMs: combinedPeriod(), solarPeriodMs: combinedPeriod() / COSMOLOGY.solarTurns,
  rayMethod: 'quartic extrema on segment', elapsedMs: performance.now() - started,
  sunInMatter: Array.from({ length: 8192 }, (_, i) => torusImplicit(solarCurvePoint(i / 8192 * TAU))).some(f => f < 0),
  rows };
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/cosmology-calibration.json', JSON.stringify(report, null, 2));
for (const row of rows) {
  const counts: Record<string, number> = {};
  for (const r of row.longitudes) { const key = r.permanent ?? String(r.days); counts[key] = (counts[key] ?? 0) + 1; }
  console.log(`v/π=${(row.v / Math.PI).toFixed(3)} ${JSON.stringify(counts)}`);
}
console.log(`sunInMatter=${report.sunInMatter} elapsed=${Math.round(report.elapsedMs)}ms`);
