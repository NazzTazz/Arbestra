import { HttpError } from '../../errors.js';
import { normalizeCell, wrappedDelta, worldCellKey } from '../worlds/coordinates.js';

export interface SpatialCell { cellX: number; cellY: number }
export interface SpatialSelection { anchor: SpatialCell; cells: SpatialCell[] }

const MAX_SPATIAL_CELLS = 100;

/** Normalize a small, filled rectangle on the torus. The explicit anchor makes
 * seam-crossing selections unambiguous and keeps the client a convenience only. */
export function normalizeSpatialSelection(
  anchor: SpatialCell,
  rawCells: SpatialCell[],
  width: number,
  height: number,
): SpatialSelection {
  if (rawCells.length === 0 || rawCells.length > MAX_SPATIAL_CELLS)
    throw new HttpError(400, 'INVALID_SPATIAL_SELECTION', `Une sélection doit contenir entre 1 et ${MAX_SPATIAL_CELLS} cases.`);
  const normalizedAnchor = {
    cellX: normalizeCell(anchor.cellX, width),
    cellY: normalizeCell(anchor.cellY, height),
  };
  const cells = rawCells.map((cell) => ({
    cellX: normalizeCell(cell.cellX, width),
    cellY: normalizeCell(cell.cellY, height),
  }));
  const unique = new Map(cells.map((cell) => [worldCellKey(cell.cellX, cell.cellY), cell]));
  if (unique.size !== cells.length)
    throw new HttpError(400, 'INVALID_SPATIAL_SELECTION', 'Une sélection ne peut pas contenir deux fois la même case.');
  if (!unique.has(worldCellKey(normalizedAnchor.cellX, normalizedAnchor.cellY)))
    throw new HttpError(400, 'ANCHOR_NOT_IN_SELECTION', 'La case d’ancrage doit appartenir à la sélection.');

  const unwrapped = cells.map((cell) => ({
    ...cell,
    x: wrappedDelta(cell.cellX, normalizedAnchor.cellX, width),
    y: wrappedDelta(cell.cellY, normalizedAnchor.cellY, height),
  }));
  const minX = Math.min(...unwrapped.map((cell) => cell.x));
  const maxX = Math.max(...unwrapped.map((cell) => cell.x));
  const minY = Math.min(...unwrapped.map((cell) => cell.y));
  const maxY = Math.max(...unwrapped.map((cell) => cell.y));
  const expected = (maxX - minX + 1) * (maxY - minY + 1);
  if (expected !== cells.length)
    throw new HttpError(400, 'SPATIAL_SELECTION_NOT_RECTANGULAR', 'Un jardin doit être une zone rectangulaire sans trou.');
  return { anchor: normalizedAnchor, cells };
}

export function scaledCosts<T extends { resourceCode: string; amount: string | number }>(costs: T[], factor: number): T[] {
  return costs.map((cost) => ({ ...cost, amount: Number(cost.amount) * factor }));
}
