/** Canonical coordinate helpers for the rectangular toroidal world. */
export function normalizeCell(value: number, size: number): number {
  return ((value % size) + size) % size;
}

export function wrappedDelta(value: number, origin: number, size: number): number {
  const direct = value - origin;
  if (direct > size / 2) return direct - size;
  if (direct < -size / 2) return direct + size;
  return direct;
}

export function toroidalManhattan(
  aX: number, aY: number, bX: number, bY: number, width: number, height: number,
): number {
  return Math.abs(wrappedDelta(aX, bX, width)) + Math.abs(wrappedDelta(aY, bY, height));
}

export function toroidalChebyshev(
  aX: number, aY: number, bX: number, bY: number, width: number, height: number,
): number {
  return Math.max(Math.abs(wrappedDelta(aX, bX, width)), Math.abs(wrappedDelta(aY, bY, height)));
}

export function worldCellKey(cellX: number, cellY: number): string {
  return `${cellX}:${cellY}`;
}
