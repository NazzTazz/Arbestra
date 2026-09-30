/** Width of the shore band measured inland from the square water boundary.
 * Segment endpoints use a fixed width so neighboring cell corners meet. */
export function shoreInset(cellX: number, cellY: number, edge: number, point: number): number {
  if (point === 0 || point === 4) return 0.38;
  let value = Math.imul(cellX + 17, 374761393) ^ Math.imul(cellY + 29, 668265263);
  value ^= Math.imul(edge + 11, 1442695041) ^ Math.imul(point + 7, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  const fraction = ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
  return 0.32 + fraction * 0.36;
}

/** Babylon treats this vertex order as the water-facing side of the wall. */
export function shoreFaceCorners(a: readonly [number, number], b: readonly [number, number], top: number, bottom: number): number[] {
  return [b[0], top, b[1], a[0], top, a[1], a[0], bottom, a[1], b[0], bottom, b[1]];
}

/** A diagonal water tile leaves an uncovered grass corner between two shore-bearing neighbors. */
export function needsDiagonalShorePatch(sideA: number | null, sideB: number | null, diagonal: number | null): boolean {
  return sideA !== null && sideB !== null && sideA !== 2 && sideB !== 2 && diagonal === 2;
}
