/**
 * Deterministic surface detail for earth and rubble roads. Values depend only on
 * canonical pixel coordinates, so neighbouring render sectors and toric seams agree.
 */
function hash(x: number, y: number, salt: number): number {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Vertex shade multiplier for a road corner, around 1: a beaten-earth tone without a pattern. */
export function roadTone(x: number, y: number, amplitude: number): number {
  return 1 + (hash(x, y, 7) * 2 - 1) * amplitude;
}

export interface Pebble {
  /** Centre in pixels (sixteenths of a cell). */
  x: number;
  y: number;
  /** Footprint in metres. */
  size: number;
}

/** About one pebble for every eight rubble pixels: bounded geometry for long roads. */
export const PEBBLE_DENSITY = 0.12;

export function rubblePebbles(pixels: Iterable<{ x: number; y: number }>): Pebble[] {
  const pebbles: Pebble[] = [];
  for (const p of pixels) {
    if (hash(p.x, p.y, 1) >= PEBBLE_DENSITY) continue;
    pebbles.push({
      x: p.x + 0.2 + hash(p.x, p.y, 2) * 0.6,
      y: p.y + 0.2 + hash(p.x, p.y, 3) * 0.6,
      size: 0.03 + hash(p.x, p.y, 4) * 0.035,
    });
  }
  return pebbles;
}
