import type { VillageState } from './villages.js';

export interface TravelCell { cellX: number; cellY: number }
export interface TravelRoute {
  id: string;
  kind: 'building' | 'garden' | 'stone';
  destination: TravelCell;
  cells: TravelCell[];
}

const key = ({ cellX, cellY }: TravelCell): string => `${cellX}:${cellY}`;
const wrap = (value: number, size: number): number => ((value % size) + size) % size;
const delta = (value: number, origin: number, size: number): number => {
  const direct = value - origin;
  return direct > size / 2 ? direct - size : direct < -size / 2 ? direct + size : direct;
};

interface Step { cell: TravelCell; cost: number; score: number; direction: number; steps: number; previous?: Step }

class StepQueue {
  readonly #items: Step[] = [];
  get length(): number { return this.#items.length; }
  push(step: Step): void {
    const items = this.#items;
    let i = items.length;
    items.push(step);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.score <= step.score) break;
      items[i] = items[parent]!;
      i = parent;
    }
    items[i] = step;
  }
  pop(): Step {
    const items = this.#items;
    const result = items[0]!;
    const last = items.pop()!;
    if (items.length) {
      let i = 0;
      while (i * 2 + 1 < items.length) {
        let child = i * 2 + 1;
        if (child + 1 < items.length && items[child + 1]!.score < items[child]!.score) child++;
        if (last.score <= items[child]!.score) break;
        items[i] = items[child]!;
        i = child;
      }
      items[i] = last;
    }
    return result;
  }
}

/** Deterministic cardinal route, with a bounded preference for shared tracks. */
export function buildTravelNetwork(state: Pick<VillageState, 'world' | 'village' | 'region' | 'cells'>): TravelRoute[] {
  const { world, village, region } = state;
  const start = { cellX: village.anchorCellX, cellY: village.anchorCellY };
  const blocked = new Set(state.cells.filter((cell) => cell.footprint).map(key));
  for (const feature of region.features) {
    if (feature.type !== 'stone_outcrop' || feature.deposit?.state !== 'depleted') blocked.add(key(feature));
  }
  const goals: Array<Pick<TravelRoute, 'id' | 'kind' | 'destination'>> = [];
  for (const cell of state.cells) {
    if (cell.building && cell.building.type !== 'town-hall') goals.push({
      id: cell.building.id, kind: 'building', destination: cell,
    });
    for (const plot of cell.building?.garden?.plots ?? []) goals.push({
      id: `${cell.building!.id}:${key(plot)}`, kind: 'garden', destination: plot,
    });
  }
  for (const feature of region.features) if (feature.type === 'stone_outcrop' && feature.deposit?.state === 'available') {
    goals.push({ id: feature.id, kind: 'stone', destination: feature });
  }
  goals.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const shared = new Set<string>();
  const routes: TravelRoute[] = [];
  const inside = (cell: TravelCell): boolean => {
    const x = wrap(cell.cellX - region.originCellX, world.widthCells);
    const y = wrap(cell.cellY - region.originCellY, world.heightCells);
    return x < region.width && y < region.height && region.terrainCodes[y * region.width + x] === 1;
  };
  const distance = (a: TravelCell, b: TravelCell): number =>
    Math.abs(delta(a.cellX, b.cellX, world.widthCells)) + Math.abs(delta(a.cellY, b.cellY, world.heightCells));
  for (const goal of goals) {
    if (!inside(goal.destination) && goal.kind !== 'stone') continue;
    const maxSteps = distance(start, goal.destination) + 8;
    const pending = new StepQueue();
    pending.push({ cell: start, cost: 0, score: distance(start, goal.destination) * 0.7, direction: -1, steps: 0 });
    const best = new Map<string, number>();
    let found: Step | undefined;
    while (pending.length) {
      const current = pending.pop();
      const currentKey = `${key(current.cell)}:${current.direction}`;
      if (current.cost > (best.get(currentKey) ?? Infinity)) continue;
      if (key(current.cell) === key(goal.destination)) { found = current; break; }
      if (current.steps >= maxSteps) continue;
      const neighbours = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      for (const [direction, [dx, dy]] of neighbours.entries()) {
        const cell = { cellX: wrap(current.cell.cellX + dx!, world.widthCells),
          cellY: wrap(current.cell.cellY + dy!, world.heightCells) };
        if ((!inside(cell) && key(cell) !== key(goal.destination)) || blocked.has(key(cell)) && key(cell) !== key(goal.destination)) continue;
        const edge = [key(current.cell), key(cell)].sort().join('|');
        const cost = current.cost + (shared.has(edge) ? 0.7 : 1) + (current.direction >= 0 && current.direction !== direction ? 0.05 : 0);
        const stateKey = `${key(cell)}:${direction}`;
        if (cost >= (best.get(stateKey) ?? Infinity)) continue;
        best.set(stateKey, cost);
        pending.push({ cell, cost, score: cost + distance(cell, goal.destination) * 0.7, direction, steps: current.steps + 1, previous: current });
      }
    }
    if (!found) continue;
    const cells: TravelCell[] = [];
    for (let cursor: Step | undefined = found; cursor; cursor = cursor.previous) cells.push(cursor.cell);
    cells.reverse();
    for (let i = 1; i < cells.length; i++) shared.add([key(cells[i - 1]!), key(cells[i]!)].sort().join('|'));
    routes.push({ ...goal, cells });
  }
  return routes;
}
