import { DEPOSIT_EXPLOITATION_RANGE, type TravelCell } from '@arbestra/contracts';
import { normalizeCell } from '../worlds/coordinates.js';

/** Smallest circular interval containing the village, padded for local exploitation. */
function axis(values: number[], period: number) {
  const points = [...new Set(values.map(v => normalizeCell(v, period)))].sort((a, b) => a - b);
  let gap = -1, start = points[0]!;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length]!;
    const distance = i + 1 === points.length ? next + period - points[i]! : next - points[i]!;
    if (distance > gap) { gap = distance; start = next; }
  }
  const span = period - gap + 1;
  const size = Math.min(period, span + DEPOSIT_EXPLOITATION_RANGE * 2);
  return { origin: normalizeCell(start - DEPOSIT_EXPLOITATION_RANGE, period), size };
}

export function villageTerrainRegion(village: { anchorCellX: number; anchorCellY: number; widthCells: number; heightCells: number }, cells: readonly TravelCell[]) {
  // Preserve the initial 64-cell neighbourhood; it is a minimum, never a boundary.
  const x = axis([village.anchorCellX - 16, village.anchorCellX, village.anchorCellX + 15, ...cells.map(c => c.cellX)], village.widthCells);
  const y = axis([village.anchorCellY - 16, village.anchorCellY, village.anchorCellY + 15, ...cells.map(c => c.cellY)], village.heightCells);
  return { originCellX: x.origin, originCellY: y.origin, width: x.size, height: y.size };
}
