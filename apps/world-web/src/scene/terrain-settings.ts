export const TERRAIN_STREAMING = {
  detailRadiusCells: 48, fadeCells: 8, graphicChunks: 17, cachedChunks: 64,
  batchChunks: 16, concurrentBatches: 2, coalesceMs: 100, freshnessMs: 5000,
  requestTimeoutMs: 10000, admissionMs: 1, renderUnitCells: 4,
} as const;
export function coverage(width: number, height: number, size: number): { radius: number; ring: number } {
  // This bounds detailed chunk residency, not the visible geographic horizon.
  let radius = Math.max(1, Math.min(TERRAIN_STREAMING.detailRadiusCells, Math.floor(Math.min(width, height) / 4) - 1)), ring = 1;
  const demandLimit = Math.min(64, TERRAIN_STREAMING.cachedChunks);
  while ((Math.ceil(2 * radius / size) + 3) ** 2 > demandLimit && ring > 0) ring--;
  while ((Math.ceil(2 * radius / size) + 1 + 2 * ring) ** 2 > demandLimit && radius > 1) radius--;
  while ((Math.ceil(2 * radius / size) + 1) ** 2 > TERRAIN_STREAMING.graphicChunks - 1 && radius > 1) radius--;
  return { radius, ring };
}
