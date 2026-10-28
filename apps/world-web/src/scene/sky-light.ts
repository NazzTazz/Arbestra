export type Rgb = readonly [number, number, number];

export interface SkyLight {
  /** Sun (directional light) intensity. */
  sun: number;
  sunColor: Rgb;
  /** Hemispheric light intensity, before the presentation dimming. */
  ambient: number;
  ambientColor: Rgb;
  groundColor: Rgb;
  /** Sky clear colour, also used by the fog. */
  sky: Rgb;
}

const DAY_SUN: Rgb = [1, 0.82, 0.58],
  DUSK_SUN: Rgb = [1, 0.42, 0.18];
const DAY_AMBIENT: Rgb = [0.92, 0.94, 0.79],
  NIGHT_AMBIENT: Rgb = [0.42, 0.54, 0.92],
  DUSK_AMBIENT: Rgb = [0.96, 0.62, 0.56];
const DAY_GROUND: Rgb = [0.18, 0.22, 0.14],
  NIGHT_GROUND: Rgb = [0.08, 0.1, 0.2];
const DAY_SKY: Rgb = [0x8e / 255, 0xa0 / 255, 0xa0 / 255],
  NIGHT_SKY: Rgb = [0x1e / 255, 0x31 / 255, 0x50 / 255],
  DUSK_SKY: Rgb = [0.82, 0.54, 0.42];
/** Night stays readable: a stronger, blue moonlight instead of the dim day ambient. */
const NIGHT_AMBIENT_INTENSITY = 0.7;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Village lighting from the sun's signed incidence (see `illumination`), with a
 * continuous dusk and dawn. Full day matches the former lighting exactly; night
 * is blue and readable; around the horizon the sun, ambient and sky turn warm.
 */
export function skyLight(incidence: number, cloud: number): SkyLight {
  // A narrow band around the horizon: low-sun villages (peak incidence ≈ 0.2)
  // still get a full day, and dusk lasts about a quarter of an hour.
  const day = smoothstep(-0.1, 0.06, incidence),
    // Peaks halfway through the transition, zero in full day and full night.
    dusk = 4 * day * (1 - day);
  const dayAmbient = 0.34 + Math.max(0, incidence) * 0.24 * (1 - cloud * 0.4);
  return {
    sun: 0.85 * smoothstep(-0.01, 0.05, incidence),
    sunColor: mix(DAY_SUN, DUSK_SUN, dusk),
    ambient: NIGHT_AMBIENT_INTENSITY + (dayAmbient - NIGHT_AMBIENT_INTENSITY) * day,
    ambientColor: mix(mix(NIGHT_AMBIENT, DAY_AMBIENT, day), DUSK_AMBIENT, dusk * 0.7),
    groundColor: mix(NIGHT_GROUND, DAY_GROUND, day),
    sky: mix(mix(NIGHT_SKY, DAY_SKY, day), DUSK_SKY, dusk * 0.7),
  };
}

/**
 * Eases the incidence the lighting follows: the torus hiding the sun would
 * otherwise switch day to night in one step.
 */
export function easeIncidence(current: number, target: number, elapsedMs: number, timeMs = 4000): number {
  return target + (current - target) * Math.exp(-Math.max(0, elapsedMs) / timeMs);
}
