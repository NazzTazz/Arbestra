import type { VillageState } from '@arbestra/contracts';

export interface Cell { cellX: number; cellY: number }
export interface CellRange { first: Cell; last: Cell }
export interface AreaPreview { cells: Cell[]; count: number; error: string | null }
export const MAX_SELECTION_CELLS = 100;
export const cellKey = (cell: Cell): string => `${cell.cellX}:${cell.cellY}`;
const normalize = (value: number, size: number): number => ((value % size) + size) % size;
const delta = (value: number, origin: number, size: number): number => normalize(value - origin + size / 2, size) - size / 2;

export function touchesCell(a: Cell, b: Cell, world: VillageState['world']): boolean {
  return Math.abs(delta(a.cellX, b.cellX, world.widthCells))
    + Math.abs(delta(a.cellY, b.cellY, world.heightCells)) === 1;
}

// Small rectangles follow the shortest wrapped direction. Bound their size
// before allocating cells, especially when selecting across a world seam.
export function rectangleCells(range: CellRange, world: VillageState['world'], spatial: boolean): AreaPreview {
  if (!spatial) return { cells: [range.last], count: 1, error: null };
  const dx = delta(range.last.cellX, range.first.cellX, world.widthCells);
  const dy = delta(range.last.cellY, range.first.cellY, world.heightCells);
  const count = (Math.abs(dx) + 1) * (Math.abs(dy) + 1);
  if (count > MAX_SELECTION_CELLS) return { cells: [], count, error: `Sélection trop grande : ${MAX_SELECTION_CELLS} cases maximum par commande.` };
  const cells: Cell[] = [];
  for (let y = Math.min(0, dy); y <= Math.max(0, dy); y += 1)
    for (let x = Math.min(0, dx); x <= Math.max(0, dx); x += 1)
      cells.push({ cellX: normalize(range.first.cellX + x, world.widthCells), cellY: normalize(range.first.cellY + y, world.heightCells) });
  return { cells, count, error: null };
}

export function previewArea(state: VillageState, range: CellRange, spatial: boolean, extensionBuildingId?: string): AreaPreview {
  const preview = rectangleCells(range, state.world, spatial);
  if (preview.error) return preview;
  const free = new Set(state.cells.filter((cell) => cell.canBuild).map(cellKey));
  if (preview.cells.some((cell) => !free.has(cellKey(cell))))
    return { ...preview, error: 'Une case est occupée, hors de portée ou non constructible.' };
  if (extensionBuildingId) {
    const active = state.cells.filter((cell) => cell.footprint?.buildingId === extensionBuildingId && cell.footprint.state === 'active');
    if (!preview.cells.some((cell) => active.some((other) => touchesCell(cell, other, state.world))))
      return { ...preview, error: 'La zone doit partager un côté avec le Jardin actif.' };
  }
  return preview;
}
