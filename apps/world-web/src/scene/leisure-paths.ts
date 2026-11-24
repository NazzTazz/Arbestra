import type { TravelCell, TravelRoute, VillageState } from '@arbestra/contracts';

/** Most cells the search visits. A village's desire lines and road cells are a few thousand
 * cells; a graph beyond this is cut off, deterministically, and the homes it did not reach get no
 * walk. The search runs once per change of its inputs, never per frame. */
export const LEISURE_MAX_NODES = 12_288;

type LeisureState = Pick<VillageState, 'world' | 'cells' | 'travelRoutes' | 'roadCells'>;

export interface LeisureSearch {
  /** The walk from the town hall to each home it reaches, by the home's cell (`x:y`). A route here is
   * the `building` route `VillageWorkers` walks: from the hall's cell to the home's. */
  routes: Map<string, TravelRoute>;
  /** Cells the search reached; never above the bound. */
  visited: number;
  /** The bound cut the search short: some homes may lack a walk the graph would have given. */
  truncated: boolean;
}

/** What the walks depend on besides the routes and the road cells: where the hall, its footprint,
 * the homes and every other building stand, and which homes are finished. A stock or a clock does
 * not move it, so a publication that only changes those leaves the walks alone. */
export function leisureLayout(state: Pick<VillageState, 'cells'>): string {
  let layout = '';
  for (const c of state.cells)
    if (c.footprint || c.building)
      layout += `${c.cellX}:${c.cellY}:${c.footprint?.buildingId ?? ''}:${c.building ? `${c.building.id}:${c.building.type}:${c.building.status}` : ''};`;
  return layout;
}

/** The eight steps, cardinal first (east, south, west, north), then south-east, south-west,
 * north-west, north-east: the order that fixes which of several equal paths is taken. Bit `i` of a
 * cell's links is step `i`; the opposite of step `i` is step `i ^ 2` (cardinal) or `4 + ((i + 2) & 3)`. */
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];
const opposite = (step: number) => (step < 4 ? (step + 2) % 4 : 4 + ((step - 4 + 2) % 4));

/** Binary min-heap of (cost, order, cell); duplicates allowed, stale entries skipped by the reader. */
class Frontier {
  readonly #items: Array<[number, number, number]> = [];
  get size() {
    return this.#items.length;
  }
  #less(i: number, j: number) {
    const a = this.#items[i]!,
      b = this.#items[j]!;
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }
  #swap(i: number, j: number) {
    const t = this.#items[i]!;
    this.#items[i] = this.#items[j]!;
    this.#items[j] = t;
  }
  push(item: [number, number, number]) {
    this.#items.push(item);
    for (let i = this.#items.length - 1; i > 0; ) {
      const up = (i - 1) >> 1;
      if (!this.#less(i, up)) break;
      this.#swap(i, up);
      i = up;
    }
  }
  pop(): [number, number, number] {
    const top = this.#items[0]!,
      last = this.#items.pop()!;
    if (this.#items.length) {
      this.#items[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < this.#items.length && this.#less(l, m)) m = l;
        if (r < this.#items.length && this.#less(r, m)) m = r;
        if (m === i) break;
        this.#swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/**
 * The leisure walks of a village whose paths are desire lines (decision 9, §4.3 and §8 of
 * docs/SPEC-REFONTE-TRAJETS-2026-11-10.md): inhabitants stroll along the visible paths and the
 * player's road cells, from the town hall to the homes they lead to, and nowhere else. A building
 * raised after the paths were laid has no walk until a path reaches it.
 *
 * The graph, in eight directions (docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md §3.4): a desire edge
 * (a two-cell segment of `travelRoutes`, cardinal or diagonal) joins its two cells, and two road
 * cells side by side or corner to corner are joined, as in the mission search (a chain of road cells
 * laid corner to corner is a diagonal road). A diagonal step never passes between two corners of
 * buildings: both cells beside it must be free, as in the mission search. The hall's footprint
 * cells are the sources; a cell of the hall touches the path cells that border it, as a door opens on
 * the path in front of it. One shortest-path search from all the sources (a diagonal step √2), at
 * most `maxNodes` cells, fixes a path to every cell reached; a home is reached when its own cell, or
 * one of the four cells around it, is. Steps are met in the order of `STEPS` and the sources by cell
 * index, so the same inputs give the same walks. Pure; n log n in the cells it reaches.
 */
export function desireLeisureRoutes(state: LeisureState, maxNodes = LEISURE_MAX_NODES): LeisureSearch {
  const { widthCells: width, heightCells: height } = state.world;
  const id = (x: number, y: number) => (((y % height) + height) % height) * width + (((x % width) + width) % width);
  const cellOf = (index: number): TravelCell => ({ cellX: index % width, cellY: Math.floor(index / width) });
  const none: LeisureSearch = { routes: new Map(), visited: 0, truncated: false };

  const hall = state.cells.find((c) => c.building?.type === 'town-hall' && c.building.status === 'completed');
  if (!hall?.building) return none;
  const homes = state.cells.filter((c) => c.building?.status === 'completed' && c.building.type === 'dwelling');
  if (!homes.length) return none;

  // Desire edges as step bits per cell, from the two-cell segments.
  const links = new Map<number, number>();
  for (const route of state.travelRoutes)
    for (let i = 1; i < route.cells.length; i++) {
      const a = route.cells[i - 1]!,
        b = route.cells[i]!;
      if (![a.cellX, a.cellY, b.cellX, b.cellY].every(Number.isInteger)) continue;
      const from = id(a.cellX, a.cellY),
        to = id(b.cellX, b.cellY);
      for (const [step, [dx, dy]] of STEPS.entries())
        if (id(a.cellX + dx, a.cellY + dy) === to) {
          links.set(from, (links.get(from) ?? 0) | (1 << step));
          links.set(to, (links.get(to) ?? 0) | (1 << opposite(step)));
          break;
        }
    }
  const roads = new Set<number>((state.roadCells ?? []).map((c) => id(c.cellX, c.cellY)));
  // A cell with a path or a road: the cells a door opens on.
  const path = (cell: number) => links.has(cell) || roads.has(cell);

  const hallId = hall.building.id,
    sources = [
      ...new Set([
        id(hall.cellX, hall.cellY),
        ...state.cells.filter((c) => c.footprint?.buildingId === hallId).map((c) => id(c.cellX, c.cellY)),
      ]),
    ].sort((a, b) => a - b);
  const sourceSet = new Set(sources);
  // A walker goes round a building, never through it: another building's cells end a walk, they
  // do not carry it on. The hall's own cells are the sources.
  const solid = new Set(
    state.cells
      .filter((c) => (c.footprint || c.building) && !sourceSet.has(id(c.cellX, c.cellY)))
      .map((c) => id(c.cellX, c.cellY)),
  );
  const buildings = new Set(state.cells.filter((c) => c.footprint || c.building).map((c) => id(c.cellX, c.cellY)));

  // Shortest paths from every source at once; the bound counts the cells reached.
  const parent = new Map<number, number>();
  const depth = new Map<number, number>();
  const frontier = new Frontier();
  let truncated = false,
    order = 0;
  const reach = (cell: number, from: number, d: number) => {
    const known = depth.get(cell);
    if (known !== undefined && known <= d + 1e-9) return;
    if (known === undefined && parent.size >= maxNodes) {
      truncated = true;
      return;
    }
    parent.set(cell, from);
    depth.set(cell, d);
    frontier.push([d, order++, cell]);
  };
  for (const source of sources) reach(source, -1, 0);
  const done = new Set<number>();
  while (frontier.size) {
    const [d, , cell] = frontier.pop();
    if (done.has(cell) || d > depth.get(cell)! + 1e-9) continue;
    done.add(cell);
    if (solid.has(cell)) continue;
    const here = links.get(cell) ?? 0,
      x = cell % width,
      y = Math.floor(cell / width);
    for (const [step, [dx, dy]] of STEPS.entries()) {
      const next = id(x + dx, y + dy);
      if (step >= 4) {
        // Never between two corners of buildings.
        const sideA = id(x + dx, y),
          sideB = id(x, y + dy);
        if (buildings.has(sideA) || buildings.has(sideB)) continue;
        if (here & (1 << step) || (roads.has(cell) && roads.has(next))) reach(next, cell, d + Math.SQRT2);
        continue;
      }
      if (
        here & (1 << step) ||
        (roads.has(cell) && roads.has(next)) ||
        (sourceSet.has(cell) && !sourceSet.has(next) && path(next))
      )
        reach(next, cell, d + 1);
    }
  }

  const routes = new Map<string, TravelRoute>();
  for (const home of homes) {
    const own = id(home.cellX, home.cellY);
    let best = -1,
      cost = Infinity;
    // The home's own cell when a desire edge ends in it, else a free cell around it: the one that
    // makes the walk shortest, the home's own cell first, then east, south, west, north.
    for (const candidate of [own, ...STEPS.slice(0, 4).map(([dx, dy]) => id(home.cellX + dx, home.cellY + dy))]) {
      if (!depth.has(candidate) || (candidate !== own && solid.has(candidate))) continue;
      const length = depth.get(candidate)! + (candidate === own ? 0 : 1);
      if (length < cost) {
        best = candidate;
        cost = length;
      }
    }
    if (best < 0) continue;
    const cells: number[] = [];
    for (let cell = best; cell >= 0; cell = parent.get(cell)!) cells.push(cell);
    cells.reverse();
    if (best !== own) cells.push(own);
    // The hall's own cell opens the walk, as the network's routes do.
    if (cells[0] !== id(hall.cellX, hall.cellY)) cells.unshift(id(hall.cellX, hall.cellY));
    routes.set(`${home.cellX}:${home.cellY}`, {
      id: `leisure:${home.building!.id}`,
      kind: 'building',
      destination: cellOf(own),
      cells: cells.map(cellOf),
    });
  }
  return { routes, visited: parent.size, truncated };
}
