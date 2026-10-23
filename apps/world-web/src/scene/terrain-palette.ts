/** Stable atlas variation shared by stepped and continuous ground. */
export function hash(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return value - Math.floor(value);
}
export function grassVariant(x: number, y: number): number {
  return Math.floor(((hash(x, y) * 0.65 + hash(Math.floor(x / 5), Math.floor(y / 5)) * 0.35) % 1) * 8);
}
export function atlasUv(tile: number, x: number, y: number): [number, number] {
  const column = tile % 8,
    row = Math.floor(tile / 8),
    u0 = column / 8 + 0.5 / 1024,
    u1 = (column + 1) / 8 - 0.5 / 1024,
    v0 = row / 4 + 0.5 / 512,
    v1 = (row + 1) / 4 - 0.5 / 512;
  return [u0 + (u1 - u0) * x, v1 + (v0 - v1) * y];
}
