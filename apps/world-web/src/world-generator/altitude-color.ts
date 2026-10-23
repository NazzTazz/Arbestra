// Fixed physical legend shared by the mesh and the operator panel.
const stops: Array<[number, readonly [number, number, number]]> = [
  [-16, [0.04, 0.06, 0.2]],
  [-8, [0.12, 0.16, 0.48]],
  [-4, [0.1, 0.48, 0.72]],
  [0, [0.65, 0.82, 0.88]],
  [1, [0.28, 0.55, 0.32]],
  [4, [0.8, 0.68, 0.32]],
  [8, [0.72, 0.22, 0.16]],
  [16, [0.95, 0.9, 0.84]],
];
export function altitudeColor(height: number): [number, number, number] {
  const z = Math.max(-16, Math.min(16, height));
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i]!,
      [a, ca] = stops[i - 1]!;
    if (z <= b) {
      const t = (z - a) / (b - a);
      return [0, 1, 2].map((k) => ca[k]! + (cb[k]! - ca[k]!) * t) as [number, number, number];
    }
  }
  return [...stops[stops.length - 1]![1]];
}
export const ALTITUDE_LEGEND = [-16, -8, -4, 0, 1, 4, 8, 16].map((height) => ({
  height,
  color:
    'rgb(' +
    altitudeColor(height)
      .map((c) => Math.round(c * 255))
      .join(',') +
    ')',
}));
