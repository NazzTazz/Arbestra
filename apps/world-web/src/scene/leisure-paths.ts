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

const EAST = 1,
  SOUTH = 2,
  WEST = 4,
  NORTH = 8;
const OPPOSITE: Readonly<Record<number, number>> = { [EAST]: WEST, [SOUTH]: NORTH, [WEST]: EAST, [NORTH]: SOUTH };
/** E, S, W, N: the order that fixes which of several equal paths is taken. */
const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, EAST],
  [0, 1, SOUTH],
  [-1, 0, WEST],
  [0, -1, NORTH],
];

/**
 * The leisure walks of a village whose paths are desire lines (decision 9, §4.3 and §8 of
 * docs/SPEC-REFONTE-TRAJETS-2026-11-10.md): inhabitants stroll along the visible paths and the
 * player's road cells, from the town hall to the homes they lead to, and nowhere else. A building
 * raised after the paths were laid has no walk until a path reaches it.
 *
 * The graph: a desire edge (a two-cell segment of `travelRoutes`) joins its two cells, and two
 * adjacent road cells are joined. The hall's footprint cells are the sources; a cell of the hall
 * touches the path cells that border it, as a door opens on the path in front of it. One breadth-first
 * search from all the sources, at most `maxNodes` cells, fixes a shortest path to every cell
 * reached; a home is reached when its own cell, or one of the four cells around it, is. Neighbours
 * are met east, south, west, north and the sources by cell index, so the same inputs give the same
 * walks. Pure; linear in the cells it visits.
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

  // Desire edges as direction bits per cell, from the two-cell segments.
  const links = new Map<number, number>();
  const link = (a: number, b: number, bit: number, opposite: number) => {
    links.set(a, (links.get(a) ?? 0) | bit);
    links.set(b, (links.get(b) ?? 0) | opposite);
  };
  for (const route of state.travelRoutes)
    for (let i = 1; i < route.cells.length; i++) {
      const a = route.cells[i - 1]!,
        b = route.cells[i]!;
      if (![a.cellX, a.cellY, b.cellX, b.cellY].every(Number.isInteger)) continue;
      for (const [dx, dy, bit] of STEPS)
        if (id(a.cellX + dx, a.cellY + dy) === id(b.cellX, b.cellY))
          link(id(a.cellX, a.cellY), id(b.cellX, b.cellY), bit, OPPOSITE[bit]!);
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

  // Breadth-first from every source at once; the bound counts the cells reached.
  const parent = new Map<number, number>();
  const depth = new Map<number, number>();
  const queue: number[] = [];
  let truncated = false;
  const reach = (cell: number, from: number, d: number) => {
    if (parent.has(cell)) return;
    if (parent.size >= maxNodes) {
      truncated = true;
      return;
    }
    parent.set(cell, from);
    depth.set(cell, d);
    queue.push(cell);
  };
  for (const source of sources) reach(source, -1, 0);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (solid.has(cell)) continue;
    const here = links.get(cell) ?? 0,
      x = cell % width,
      y = Math.floor(cell / width),
      d = depth.get(cell)! + 1;
    for (const [dx, dy, bit] of STEPS) {
      const next = id(x + dx, y + dy);
      if (
        here & bit ||
        (roads.has(cell) && roads.has(next)) ||
        (sourceSet.has(cell) && !sourceSet.has(next) && path(next))
      )
        reach(next, cell, d);
    }
  }

  const routes = new Map<string, TravelRoute>();
  for (const home of homes) {
    const own = id(home.cellX, home.cellY);
    let best = -1,
      cost = Infinity;
    // The home's own cell when a desire edge ends in it, else a free cell around it: the one that
    // makes the walk shortest, the home's own cell first, then east, south, west, north.
    for (const candidate of [own, ...STEPS.map(([dx, dy]) => id(home.cellX + dx, home.cellY + dy))]) {
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
