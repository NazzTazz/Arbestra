import { footprintVertices, fixedBuildingFootprint, isBuildingFootprintFlat } from '@arbestra/contracts';
import type { VillageState } from '@arbestra/contracts';

export interface Cell {
  cellX: number;
  cellY: number;
}
export interface CellRange {
  first: Cell;
  last: Cell;
}
export interface AreaPreview {
  cells: Cell[];
  count: number;
  error: string | null;
  needsLeveling?: boolean;
  newCells?: Cell[];
  existingCells?: Cell[];
  obstacleCells?: Cell[];
}
export const MAX_SELECTION_CELLS = 100;
export const cellKey = (cell: Cell): string => `${cell.cellX}:${cell.cellY}`;
function fixedRange(type: 'university' | 'stonemason', anchor: Cell, turns: number): CellRange {
  const cells = fixedBuildingFootprint(type, anchor, turns),
    xs = cells.map((c) => c.cellX),
    ys = cells.map((c) => c.cellY);
  return {
    first: { cellX: Math.min(...xs), cellY: Math.min(...ys) },
    last: { cellX: Math.max(...xs), cellY: Math.max(...ys) },
  };
}
export const campusRange = (anchor: Cell, turns: number) => fixedRange('university', anchor, turns);
export const stonemasonRange = (anchor: Cell, turns: number) => fixedRange('stonemason', anchor, turns);
const normalize = (value: number, size: number): number => ((value % size) + size) % size;
const delta = (value: number, origin: number, size: number): number =>
  normalize(value - origin + size / 2, size) - size / 2;

export function touchesCell(
  a: Cell,
  b: Cell,
  world: Pick<VillageState['world'], 'widthCells' | 'heightCells'>,
): boolean {
  return (
    Math.abs(delta(a.cellX, b.cellX, world.widthCells)) + Math.abs(delta(a.cellY, b.cellY, world.heightCells)) === 1
  );
}

export function cellsAlongSegment(
  from: Cell,
  to: Cell,
  world: Pick<VillageState['world'], 'widthCells' | 'heightCells'>,
): Cell[] {
  const dx = delta(to.cellX, from.cellX, world.widthCells),
    dy = delta(to.cellY, from.cellY, world.heightCells);
  const width = Math.abs(dx),
    height = Math.abs(dy);
  const stepX = Math.sign(dx),
    stepY = Math.sign(dy);
  let x = Math.round(from.cellX),
    y = Math.round(from.cellY);
  const endX = Math.round(from.cellX + dx),
    endY = Math.round(from.cellY + dy);
  let distanceX = stepX * (x + stepX * 0.5 - from.cellX);
  let distanceY = stepY * (y + stepY * 0.5 - from.cellY);
  const cells: Cell[] = [];
  while (x !== endX || y !== endY) {
    // Compare the next grid intersections using their actual starting point. A
    // corner contact alone does not traverse either of the two side cells.
    const nextX = distanceX * height,
      nextY = distanceY * width;
    if (x !== endX && (y === endY || nextX < nextY - 1e-12)) {
      x += stepX;
      distanceX++;
    } else if (y !== endY && (x === endX || nextY < nextX - 1e-12)) {
      y += stepY;
      distanceY++;
    } else {
      x += stepX;
      y += stepY;
      distanceX++;
      distanceY++;
    }
    cells.push({ cellX: normalize(x, world.widthCells), cellY: normalize(y, world.heightCells) });
  }
  return cells;
}

export function rectangleCells(
  range: CellRange,
  world: Pick<VillageState['world'], 'widthCells' | 'heightCells'>,
  spatial: boolean,
): AreaPreview {
  if (!spatial) return { cells: [range.last], count: 1, error: null };
  const dx = delta(range.last.cellX, range.first.cellX, world.widthCells);
  const dy = delta(range.last.cellY, range.first.cellY, world.heightCells);
  const count = (Math.abs(dx) + 1) * (Math.abs(dy) + 1);
  if (count > MAX_SELECTION_CELLS)
    return { cells: [], count, error: `Sélection trop grande : ${MAX_SELECTION_CELLS} cases maximum par commande.` };
  const cells: Cell[] = [];
  for (let y = Math.min(0, dy); y <= Math.max(0, dy); y += 1)
    for (let x = Math.min(0, dx); x <= Math.max(0, dx); x += 1)
      cells.push({
        cellX: normalize(range.first.cellX + x, world.widthCells),
        cellY: normalize(range.first.cellY + y, world.heightCells),
      });
  return { cells, count, error: null };
}

export function previewArea(
  state: VillageState,
  range: CellRange,
  spatial: boolean,
  extensionBuildingId?: string,
  buildingType?: string,
  /** Current vertex heights (the scene's ground, kept up to date by the ground
   * stream); `state.region` is a snapshot that an instant terrain edit does not refresh. */
  vertexHeight?: (x: number, y: number) => number,
): AreaPreview {
  const preview = rectangleCells(range, state.world, spatial);
  if (preview.error) return preview;
  const free = new Set(state.cells.filter((cell) => cell.canBuild).map(cellKey));
  if (extensionBuildingId) {
    const target = state.cells.filter(
      (cell) => cell.footprint?.buildingId === extensionBuildingId && cell.footprint.state === 'active',
    );
    const activeGardens = state.cells.filter(
      (cell) => cell.footprint?.buildingType === 'garden' && cell.footprint.state === 'active',
    );
    const existingKeys = new Set(activeGardens.map(cellKey));
    const existingCells = preview.cells.filter((cell) => existingKeys.has(cellKey(cell)));
    const newCells = preview.cells.filter((cell) => free.has(cellKey(cell)));
    const obstacleCells = preview.cells.filter((cell) => !existingKeys.has(cellKey(cell)) && !free.has(cellKey(cell)));
    const result = { ...preview, count: newCells.length, newCells, existingCells, obstacleCells };
    if (obstacleCells.length)
      return { ...result, error: 'Une case est occupée, hors de portée ou encore en chantier.' };
    if (
      !preview.cells.some((cell) =>
        target.some((other) => cellKey(cell) === cellKey(other) || touchesCell(cell, other, state.world)),
      )
    )
      return { ...result, error: 'La zone doit partager un côté avec le Jardin actif.' };
    return result;
  }
  const result = previewCells(preview.cells, (cell) => free.has(cellKey(cell)));
  const offersLeveling = buildingType === 'university' || buildingType === 'stonemason';
  if (!result.error && (offersLeveling || (buildingType && buildingType !== 'garden' && state.region.vertexHeights))) {
    const heights = state.region.vertexHeights
      ? footprintVertices(result.cells, state.world).map((v) => {
          const live = vertexHeight?.(v.vertexX, v.vertexY);
          if (live !== undefined && Number.isFinite(live)) return live * 100;
          const x = normalize(v.vertexX - state.region.originCellX, state.world.widthCells),
            y = normalize(v.vertexY - state.region.originCellY, state.world.heightCells);
          return x <= state.region.width && y <= state.region.height
            ? state.region.vertexHeights![y * (state.region.width + 1) + x]! * 100
            : NaN;
        })
      : result.cells.map((c) => {
          const x = normalize(c.cellX - state.region.originCellX, state.world.widthCells);
          const y = normalize(c.cellY - state.region.originCellY, state.world.heightCells);
          return x < state.region.width && y < state.region.height
            ? state.region.elevations[y * state.region.width + x]!
            : NaN;
        });
    if (heights.some((h) => !Number.isFinite(h))) return { ...result, error: 'Terrain en cours de chargement.' };
    if (!isBuildingFootprintFlat(heights))
      return offersLeveling
        ? { ...result, needsLeveling: true, error: 'Cette emprise doit être nivelée avant de construire.' }
        : {
            ...result,
            error: 'Construction impossible sur une pente. Préparez une surface plane avec la terraformation.',
          };
  }
  return result;
}

/** Shared preview for rectangular buildings and compound starter footprints. */
export function previewCells(cells: Cell[], canBuild: (cell: Cell) => boolean, pendingReason?: string): AreaPreview {
  const obstacleCells = cells.filter((cell) => !canBuild(cell));
  return {
    cells,
    count: cells.length,
    obstacleCells,
    error:
      pendingReason ?? (obstacleCells.length ? 'Une case est occupée, hors de portée ou non constructible.' : null),
  };
}
