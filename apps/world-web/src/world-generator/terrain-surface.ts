import { periodicClimateNoise, wrapClimate } from '@arbestra/contracts';
const smooth = (v: number) => {
  v = Math.max(0, Math.min(1, v));
  return v * v * (3 - 2 * v);
};
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v * (1 - t) + b[i]! * t);
/** Visual materials only. Saved geography, water levels and bedrock remain authoritative. */
export function terrainSurfaceColor(
  world: { width: number; height: number; seed: number; circulation?: unknown },
  v: { x: number; y: number; z: number; surface: number; rock: number; slope: number; incision?: number },
): number[] {
  const x = wrapClimate(v.x, world.width) / world.width,
    y = wrapClimate(v.y, world.height) / world.height;
  const province = periodicClimateNoise(x, y, Math.max(4, Math.round(world.height / 12)), world.seed + 9187);
  const clearance = v.z - v.surface;
  // Approximate a narrow lateral wet fringe from slope, rather than paint every
  // low plain as a beach merely because it is close to sea level.
  const wetHeight = world.circulation
    ? Math.max(0.003, Math.min(0.016, v.slope * 0.13))
    : Math.max(0.006, Math.min(0.06, v.slope * 0.35));
  const grass = [0.31, 0.43, 0.19],
    damp = [0.28, 0.32, 0.2],
    bed = [0.27, 0.29, 0.23];
  const soil =
    clearance < 0 ? mix(damp, bed, smooth(-clearance / 0.15)) : mix(damp, grass, smooth(clearance / wetHeight));
  const rock = mix([0.35, 0.38, 0.36], [0.46, 0.475, 0.445], smooth((clearance + 0.015) / 0.1));
  // Coherent strata and actual incisions give the formation a readable hierarchy.
  const strata = periodicClimateNoise(x, y, Math.max(8, Math.round(world.height / 6)), world.seed + 17191);
  const exposure = smooth((v.rock - 0.12) / 0.72);
  const rockShade = 0.87 + 0.2 * strata - 0.12 * smooth(((v.incision ?? 0) - 0.1) / 0.22);
  const shade = (0.97 + 0.06 * province) * (1 - exposure + exposure * rockShade);
  return [...mix(soil, rock, exposure).map((c) => c * shade), 1];
}

/** Opaque water coloured by the actual local depth; no extra transparency pass. */
export function terrainWaterColor(depth: number): number[] {
  const shallow = mix([0.23, 0.33, 0.28], [0.1, 0.36, 0.43], smooth(depth / 0.09));
  return [...mix(shallow, [0.065, 0.29, 0.43], smooth((depth - 0.06) / 0.55)), 1];
}
