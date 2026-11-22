import { describe, expect, it } from 'vitest';
import { desireRoutes, type DesireCell, type VillageState } from '@arbestra/contracts';
import { desireLeisureRoutes, leisureLayout, LEISURE_MAX_NODES } from './leisure-paths';

const world = { widthCells: 64, heightCells: 64 };
type Cell = VillageState['cells'][number];
const hall = (cellX: number, cellY: number): Cell =>
  ({
    cellX,
    cellY,
    footprint: { buildingId: 'hall' },
    building: { id: 'hall', type: 'town-hall', status: 'completed' },
  }) as unknown as Cell;
const house = (name: string, cellX: number, cellY: number, status = 'completed'): Cell =>
  ({
    cellX,
    cellY,
    footprint: { buildingId: name },
    building: { id: name, type: 'dwelling', status },
  }) as unknown as Cell;
const garden = (cellX: number, cellY: number): Cell =>
  ({ cellX, cellY, footprint: { buildingId: 'garden' }, building: null }) as unknown as Cell;
/** `n` edges east from (x, y), then the cells' own routes. */
const east = (x: number, y: number, n: number): DesireCell[] =>
  Array.from({ length: n }, (_, i) => ({ cellX: (x + i) % 64, cellY: y, east: true, south: false }));
const south = (x: number, y: number, n: number): DesireCell[] =>
  Array.from({ length: n }, (_, i) => ({ cellX: x, cellY: (y + i) % 64, east: false, south: true }));
const state = (cells: Cell[], paths: DesireCell[], roadCells: Array<[number, number]> = [], size = world) =>
  ({
    world: size,
    cells,
    travelRoutes: desireRoutes(paths, size),
    roadCells: roadCells.map(([cellX, cellY]) => ({ id: `${cellX},${cellY}`, cellX, cellY })),
  }) as unknown as Pick<VillageState, 'world' | 'cells' | 'travelRoutes' | 'roadCells'>;
const walk = (search: ReturnType<typeof desireLeisureRoutes>, cellX: number, cellY: number) =>
  search.routes.get(`${cellX}:${cellY}`)?.cells.map((c) => `${c.cellX}:${c.cellY}`);

describe('leisure walks over desire paths', () => {
  it('walks from the hall to the homes a path leads to, by the path and nowhere else', () => {
    const search = desireLeisureRoutes(
      state(
        [hall(10, 10), house('a', 14, 10), house('b', 12, 12), house('far', 30, 30), house('beside', 16, 11)],
        // East along row 10 into house a; a branch south from 12 to the cell above house b.
        [...east(10, 10, 4), ...south(12, 10, 2)],
      ),
    );
    // A path that ends in the home's own cell.
    expect(walk(search, 14, 10)).toEqual(['10:10', '11:10', '12:10', '13:10', '14:10']);
    // A path that ends beside it: the walk steps into the home from the path's last cell.
    expect(walk(search, 12, 12)).toEqual(['10:10', '11:10', '12:10', '12:11', '12:12']);
    // Built after the paths were laid: nothing leads to it, so no walk (decision 9).
    expect(search.routes.has('30:30')).toBe(false);
    expect(search.routes.has('16:11')).toBe(false);
    for (const route of search.routes.values()) {
      expect(route.kind).toBe('building');
      expect(route.destination).toEqual(route.cells.at(-1));
    }
    expect(search.truncated).toBe(false);
  });

  it('walks no diagonal desire path before they are drawn (R2a), and walks the cardinal ones the same', () => {
    const homes = [hall(10, 10), house('a', 14, 10), house('diag', 13, 13), house('seam', 63, 63)];
    // Diagonals only: from the hall's cell south-east to the home diag, and across the seam.
    const diagonals: DesireCell[] = [
      { cellX: 10, cellY: 10, east: false, south: false, southEast: true },
      { cellX: 11, cellY: 11, east: false, south: false, southEast: true },
      { cellX: 12, cellY: 12, east: false, south: false, southEast: true },
      { cellX: 0, cellY: 62, east: false, south: false, southWest: true },
    ];
    expect(desireLeisureRoutes(state(homes, diagonals)).routes.size).toBe(0);
    // Beside the cardinal path to house a, they change nothing.
    const cardinal = east(10, 10, 4),
      merged = cardinal.map((c) => (c.cellX === 10 ? { ...c, southEast: true } : c));
    const plain = desireLeisureRoutes(state(homes, cardinal)),
      both = desireLeisureRoutes(state(homes, [...merged, ...diagonals.slice(1)]));
    expect([...both.routes]).toEqual([...plain.routes]);
    expect(both.visited).toBe(plain.visited);
    expect(walk(both, 14, 10)).toEqual(['10:10', '11:10', '12:10', '13:10', '14:10']);
    expect(both.routes.has('13:13')).toBe(false);
  });

  it('follows the road cells of the player as well, and joins them to the hall', () => {
    // A road of cells from the hall's south side to a home, with no desire path at all.
    const search = desireLeisureRoutes(
      state(
        [hall(10, 10), house('d', 10, 14)],
        [],
        [
          [10, 11],
          [10, 12],
          [10, 13],
        ],
      ),
    );
    expect(walk(search, 10, 14)).toEqual(['10:10', '10:11', '10:12', '10:13', '10:14']);
    // A road cell on its own, far from the hall, leads nowhere.
    expect(desireLeisureRoutes(state([hall(10, 10), house('e', 40, 41)], [], [[40, 40]])).routes.size).toBe(0);
    // Paths and road cells meet only along an edge of a path: two cells side by side are not a link.
    expect(
      desireLeisureRoutes(state([hall(10, 10), house('f', 13, 11)], east(10, 10, 2), [[12, 10]])).routes.has('13:11'),
    ).toBe(false);
  });

  it('crosses the seam of the torus', () => {
    const search = desireLeisureRoutes(state([hall(62, 5), house('seam', 2, 5)], [...east(62, 5, 4)]));
    expect(walk(search, 2, 5)).toEqual(['62:5', '63:5', '0:5', '1:5', '2:5']);
    const vertical = desireLeisureRoutes(state([hall(7, 62), house('v', 7, 1)], south(7, 62, 3)));
    expect(walk(vertical, 7, 1)).toEqual(['7:62', '7:63', '7:0', '7:1']);
  });

  it('goes round a building, never through it, and ignores a home that is not finished', () => {
    const through = desireLeisureRoutes(
      state([hall(10, 10), garden(12, 10), house('behind', 14, 10), house('before', 11, 10)], east(10, 10, 4)),
    );
    expect(walk(through, 11, 10)).toEqual(['10:10', '11:10']);
    // The path runs on through the garden's cell: the walk stops there, the home behind it has none.
    expect(through.routes.has('14:10')).toBe(false);
    const unfinished = desireLeisureRoutes(
      state([hall(10, 10), house('g', 12, 10, 'under-construction')], east(10, 10, 2)),
    );
    expect(unfinished.routes.size).toBe(0);
    // No hall, no walk.
    expect(desireLeisureRoutes(state([house('h', 12, 10)], east(10, 10, 2))).routes.size).toBe(0);
  });

  it('is deterministic: the order of the paths and of the cells changes nothing, equal paths take the same way', () => {
    // A square of paths: two equal ways round to the home at the opposite corner.
    const paths = [...east(10, 10, 3), ...east(10, 13, 3), ...south(10, 10, 3), ...south(13, 10, 3)];
    const cells = [hall(10, 10), house('corner', 13, 13)];
    const first = desireLeisureRoutes(state(cells, paths));
    const route = walk(first, 13, 13)!;
    expect(route).toHaveLength(7);
    expect(route[0]).toBe('10:10');
    expect(route.at(-1)).toBe('13:13');
    // East first, then south: the order the neighbours are met in.
    expect(route.slice(0, 4)).toEqual(['10:10', '11:10', '12:10', '13:10']);
    expect(walk(desireLeisureRoutes(state([...cells].reverse(), [...paths].reverse())), 13, 13)).toEqual(route);
    expect(desireLeisureRoutes(state(cells, paths))).toEqual(first);
    // Every step of a walk is to a neighbouring cell.
    const steps = first.routes.get('13:13')!.cells;
    for (let i = 1; i < steps.length; i++)
      expect(Math.abs(steps[i]!.cellX - steps[i - 1]!.cellX) + Math.abs(steps[i]!.cellY - steps[i - 1]!.cellY)).toBe(1);
  });

  it('visits at most the published bound of cells, and says when it stopped there', () => {
    // A lattice of paths, larger than the bound: every cell is a node, every cell has both edges.
    const side = 120,
      lattice: DesireCell[] = [];
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) lattice.push({ cellX: x, cellY: y, east: x < side - 1, south: y < side - 1 });
    expect(side * side).toBeGreaterThan(LEISURE_MAX_NODES);
    const cells = [hall(0, 0), house('near', 3, 3), house('far', 119, 119)];
    const wide = state(cells, lattice, [], { widthCells: 256, heightCells: 256 }),
      big = desireLeisureRoutes(wide);
    expect(big.visited).toBeLessThanOrEqual(LEISURE_MAX_NODES);
    expect(big.truncated).toBe(true);
    // The breadth-first order reaches the nearby home first, and never the one beyond the bound.
    expect(big.routes.has('3:3')).toBe(true);
    expect(big.routes.has('119:119')).toBe(false);
    // The bound is a parameter of the search: a small one bites at once, identically each time.
    const small = desireLeisureRoutes(wide, 40);
    expect(small.visited).toBe(40);
    expect(small.truncated).toBe(true);
    expect(desireLeisureRoutes(wide, 40)).toEqual(small);
    // Under the bound the search reaches everything it can, and says so.
    const sparse = desireLeisureRoutes(state(cells, [...east(0, 0, 3), ...south(3, 0, 3)]));
    expect(sparse.truncated).toBe(false);
    expect(sparse.visited).toBeLessThan(40);
    expect(sparse.routes.has('3:3')).toBe(true);
  });

  it('reads the layout of the buildings, not their stocks', () => {
    const a = [hall(1, 1), house('a', 2, 2)];
    expect(leisureLayout({ cells: a })).toBe(leisureLayout({ cells: [...a] }));
    expect(leisureLayout({ cells: a })).not.toBe(leisureLayout({ cells: [hall(1, 1), house('a', 2, 3)] }));
    expect(leisureLayout({ cells: a })).not.toBe(
      leisureLayout({ cells: [hall(1, 1), house('a', 2, 2, 'under-construction')] }),
    );
    expect(
      leisureLayout({ cells: [...a, { cellX: 5, cellY: 5, footprint: null, building: null } as unknown as Cell] }),
    ).toBe(leisureLayout({ cells: a }));
  });
});
