import {
  roadAnchorAccessories,
  roadCellAnchors,
  wrapCoordinate,
  wrappedDistance,
  type SubPoint,
  type VillageState,
} from '@arbestra/contracts';

type Cell = { cellX: number; cellY: number };
type World = { widthCells: number; heightCells: number };

/** What a swipe may designate, one lookup per swept cell (docs/SPEC-DEMOLITION.md §9.4). */
export interface DemolitionIndex {
  world: World;
  /** Building on a cell, gardens and the town hall excepted. */
  building: (key: string) => string | null;
  /** True when the cell is a garden plot of the village: gardens leave cell by cell. */
  garden: (key: string) => boolean;
  /** True when the cell carries a road cell of the village. */
  road: (key: string) => boolean;
  /** Braziers shown at the cell's four corners, manual or automatic, as `x:y` vertex keys. */
  braziers: (key: string) => readonly string[];
}

export type DemolitionTarget = 'building' | 'garden' | 'road' | 'brazier';
const cellKey = (c: Cell) => `${c.cellX}:${c.cellY}`;
/** Same cell rounding as subCellKey: a sub-point belongs to the cell whose centre it is closest to. */
export const subPointCell = (p: SubPoint, world: World): Cell => ({
  cellX: wrapCoordinate(Math.floor((p.x + 4) / 8), world.widthCells),
  cellY: wrapCoordinate(Math.floor((p.y + 4) / 8), world.heightCells),
});
export const parseKey = (key: string) => {
  const [x, y] = key.split(':').map(Number);
  return { x: x!, y: y! };
};

/** Built once per village state, never per pointer sample. */
export function demolitionIndex(
  state: Pick<VillageState, 'world' | 'cells' | 'roadCells' | 'roadAnchors'>,
): DemolitionIndex {
  const world = { widthCells: state.world.widthCells, heightCells: state.world.heightCells };
  const buildings = new Map<string, string>(),
    gardens = new Set<string>();
  for (const cell of state.cells) {
    const id = cell.footprint?.buildingId ?? cell.building?.id,
      type = cell.footprint?.buildingType ?? cell.building?.type;
    if (!id || type === 'town-hall') continue;
    if (type === 'garden') gardens.add(cellKey(cell));
    else buildings.set(cellKey(cell), id);
  }
  const roads = new Set((state.roadCells ?? []).map(cellKey));
  const shown = new Set(
    roadAnchorAccessories(state.roadCells ?? [], state.roadAnchors ?? [], world)
      .filter((v) => v.kind === 'brazier')
      .map((v) => `${v.vertexX}:${v.vertexY}`),
  );
  return {
    world,
    building: (key) => buildings.get(key) ?? null,
    garden: (key) => gardens.has(key),
    road: (key) => roads.has(key),
    braziers: (key) => {
      if (!shown.size) return [];
      const { x, y } = parseKey(key);
      return roadCellAnchors({ cellX: x, cellY: y }, world)
        .map((v) => `${v.vertexX}:${v.vertexY}`)
        .filter((v) => shown.has(v));
    },
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
  readonly gardenCells = new Set<string>();
  readonly roadCells = new Set<string>();
  readonly braziers = new Set<string>();
  get size() {
    return this.buildings.size + this.gardenCells.size + this.roadCells.size + this.braziers.size;
  }
  clear() {
    this.buildings.clear();
    this.gardenCells.clear();
    this.roadCells.clear();
    this.braziers.clear();
  }
  /** Adds the targets of the swept cells and reports each new one; returns how many were added. */
  mark(
    index: DemolitionIndex,
    cells: readonly Cell[],
    added: (kind: DemolitionTarget, id: string) => void = () => {},
  ): number {
    let count = 0;
    const add = (set: Set<string>, kind: DemolitionTarget, id: string) => {
      if (set.has(id)) return;
      set.add(id);
      added(kind, id);
      count++;
    };
    for (const cell of cells) {
      const key = cellKey(cell),
        building = index.building(key);
      if (building) add(this.buildings, 'building', building);
      if (index.garden(key)) add(this.gardenCells, 'garden', key);
      if (index.road(key)) add(this.roadCells, 'road', key);
      for (const vertex of index.braziers(key)) add(this.braziers, 'brazier', vertex);
    }
    return count;
  }
  /** The demolition command's targets (docs/SPEC-DEMOLITION.md §9.1). */
  request(commandId: string) {
    const cells = (set: Set<string>) =>
      [...set].map((key) => {
        const { x, y } = parseKey(key);
        return { cellX: x, cellY: y };
      });
    return {
      commandId,
      buildings: [...this.buildings].map((id) => ({ id })),
      gardenCells: cells(this.gardenCells),
      roadCells: cells(this.roadCells),
      braziers: [...this.braziers].map((key) => {
        const { x, y } = parseKey(key);
        return { vertexX: x, vertexY: y };
      }),
    };
  }
}
