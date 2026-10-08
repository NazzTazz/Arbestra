import { climateAt } from '@arbestra/contracts';
import { COSMOLOGY, TAU, cyclePhase, illumination } from './cosmology';

const wrap = (x: number, size: number) => ((x % size) + size) % size;
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
export const WEATHER_DRIFT_SECONDS = 1200;
export function weatherSeed(worldId: string): number {
  let seed = 2166136261;
  for (const char of worldId) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}
function noise(u: number, v: number, frequency: number, seed: number): number {
  const x = wrap(u, 1) * frequency, y = wrap(v, 1) * frequency;
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const corner = (a: number, b: number) => {
    let h = Math.imul(wrap(a, frequency) + 1, 374761393) ^ Math.imul(wrap(b, frequency) + 1, 668265263) ^ seed;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967295;
  };
  return (corner(ix, iy) * (1 - fx) + corner(ix + 1, iy) * fx) * (1 - fy)
    + (corner(ix, iy + 1) * (1 - fx) + corner(ix + 1, iy + 1) * fx) * fy;
}
/** Canonical normalized coordinates; epoch time, never time since the view opened. */
export function weatherAt(u: number, v: number, serverMs: number, seed: number, sharedClimate = false) {
  const time = (serverMs - COSMOLOGY.epochMs) / 1000;
  const x = u - time / WEATHER_DRIFT_SECONDS, y = v - time / (WEATHER_DRIFT_SECONDS * 2);
  const transient = .62 * noise(x, y, 8, seed) + .26 * noise(x, y, 16, seed + 1) + .12 * noise(x, y, 32, seed + 2);
  const field = sharedClimate ? .7 * transient + .3 * climateAt(u, v, seed).humidity : transient;
  const cloud = smooth((field - .28) / .42);
  return { cloud, rain: smooth((cloud - .68) / .3) };
}
/** Bounded visual rain memory, recomputed identically after reload. No persisted/economic state. */
export function groundWetness(u: number, v: number, serverMs: number, seed: number): number {
  let wet = 0;
  for (let i = 20; i >= 0; i--) {
    const time = serverMs - i * 60_000, weather = weatherAt(u, v, time, seed);
    const sunlight = illumination(u * TAU, v * TAU + Math.PI, cyclePhase(time)).direct;
    wet = Math.max(0, Math.min(1, wet + weather.rain * .3 - .025 - sunlight * (1 - weather.cloud) * .13));
  }
  return wet;
}
