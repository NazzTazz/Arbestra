import {
  infrastructurePlanSurface,
  wrapCoordinate,
  wrappedDistance,
  type SubPoint,
  type VillageState,
} from '@arbestra/contracts';

type Cell = { cellX: number; cellY: number };
type World = { widthCells: number; heightCells: number };

/** What a swipe may designate, one lookup per swept cell. */
export interface DemolitionIndex {
  world: World;
  /** Building or garden on a cell; the town hall is never a target. */
  building: (key: string) => string | null;
  /** True when the cell carries a manual road of the plan. */
  road: (key: string) => boolean;
  /** Manual braziers standing on the cell. */
  equipment: (key: string) => readonly string[];
}

export type DemolitionTarget = 'building' | 'road' | 'equipment';
const cellKey = (c: Cell) => `${c.cellX}:${c.cellY}`;
/** Same cell rounding as subCellKey: a sub-point belongs to the cell whose centre it is closest to. */
export const subPointCell = (p: SubPoint, world: World): Cell => ({
  cellX: wrapCoordinate(Math.floor((p.x + 4) / 8), world.widthCells),
  cellY: wrapCoordinate(Math.floor((p.y + 4) / 8), world.heightCells),
});

/** Built once per village state, never per pointer sample. */
export function demolitionIndex(
  state: Pick<VillageState, 'world' | 'cells' | 'infrastructure'>,
  surface = state.infrastructure ? infrastructurePlanSurface(state.infrastructure, state.world) : null,
): DemolitionIndex {
  const world = { widthCells: state.world.widthCells, heightCells: state.world.heightCells };
  const buildings = new Map<string, string>();
  for (const cell of state.cells) {
    const id = cell.footprint?.buildingId ?? cell.building?.id,
      type = cell.footprint?.buildingType ?? cell.building?.type;
    if (id && type !== 'town-hall') buildings.set(cellKey(cell), id);
  }
  const roads = new Set<string>();
  for (const p of surface?.values() ?? [])
    if (p.manual && p.material !== 'none')
      roads.add(`${Math.floor((p.x + 8) / 16) % world.widthCells}:${Math.floor((p.y + 8) / 16) % world.heightCells}`);
  const equipment = new Map<string, string[]>();
  for (const e of state.infrastructure?.equipment ?? []) {
    const key = cellKey(subPointCell(e, world)),
      list = equipment.get(key) ?? [];
    list.push(e.id);
    equipment.set(key, list);
  }
  return {
    world,
    building: (key) => buildings.get(key) ?? null,
    road: (key) => roads.has(key),
    equipment: (key) => equipment.get(key) ?? [],
  };
}

/** A pointer sample covers every cell between it and the previous one, bounded on a fast swipe. */
export const MAX_SWEEP_CELLS = 64;
export function sweptCells(from: Cell | null, to: Cell, world: World, limit = MAX_SWEEP_CELLS): Cell[] {
  if (!from) return [to];
  const dx = wrappedDistance(to.cellX, from.cellX, world.widthCells),
    dy = wrappedDistance(to.cellY, from.cellY, world.heightCells),
    steps = Math.min(limit - 1, Math.max(Math.abs(dx), Math.abs(dy)));
  const cells: Cell[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / Math.max(Math.abs(dx), Math.abs(dy));
    cells.push({
      cellX: wrapCoordinate(from.cellX + Math.round(dx * t), world.widthCells),
      cellY: wrapCoordinate(from.cellY + Math.round(dy * t), world.heightCells),
    });
  }
  if (!cells.length || cellKey(cells.at(-1)!) !== cellKey(to)) cells.push(to);
  return cells;
}

/** Swiped targets, kept as sets: marking a cell costs a constant number of lookups. */
export class DemolitionSelection {
  readonly buildings = new Set<string>();
  readonly roadCells = new Set<string>();
  readonly equipment = new Set<string>();
  get size() {
    return this.buildings.size + this.roadCells.size + this.equipment.size;
  }
  clear() {
    this.buildings.clear();
    this.roadCells.clear();
    this.equipment.clear();
  }
  /** Adds the targets of the swept cells and reports each new one; returns how many were added. */
  mark(
    index: DemolitionIndex,
    cells: readonly Cell[],
    added: (kind: DemolitionTarget, id: string) => void = () => {},
  ): number {
    let count = 0;
    for (const cell of cells) {
      const key = cellKey(cell),
        building = index.building(key);
      if (building && !this.buildings.has(building)) {
        this.buildings.add(building);
        added('building', building);
        count++;
      }
      if (index.road(key) && !this.roadCells.has(key)) {
        this.roadCells.add(key);
        added('road', key);
        count++;
      }
      for (const id of index.equipment(key))
        if (!this.equipment.has(id)) {
          this.equipment.add(id);
          added('equipment', id);
          count++;
        }
    }
    return count;
  }
}
