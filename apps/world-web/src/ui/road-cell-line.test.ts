import { describe, expect, it } from 'vitest';
import { wrappedDistance } from '@arbestra/contracts';
import { inRoadCellCore, sweptCells8 } from './road-cell-line';
import { sweptCells4 } from './road-cell-gesture';

const world = { widthCells: 64, heightCells: 32 };
type Cell = { cellX: number; cellY: number };
const c = (cellX: number, cellY: number): Cell => ({ cellX, cellY });
/** Steps (dx, dy) of a chain starting at `from`, on the torus. */
const steps = (from: Cell, cells: Cell[], w = world) => {
  const out: Array<[number, number]> = [];
  let prev = from;
  for (const cell of cells) {
    out.push([
      wrappedDistance(cell.cellX, prev.cellX, w.widthCells),
      wrappedDistance(cell.cellY, prev.cellY, w.heightCells),
    ]);
    prev = cell;
  }
  return out;
};
const inWorld = (cell: Cell, w = world) =>
  cell.cellX >= 0 && cell.cellX < w.widthCells && cell.cellY >= 0 && cell.cellY < w.heightCells;

describe('sweptCells8', () => {
  it('is the target alone without a start, and empty on the same cell', () => {
    expect(sweptCells8(null, c(3, 4), world)).toEqual([c(3, 4)]);
    expect(sweptCells8(c(3, 4), c(3, 4), world)).toEqual([]);
  });

  it('designates only the corner-to-corner cells of a pure diagonal, in all four directions', () => {
    expect(sweptCells8(c(2, 2), c(6, 6), world)).toEqual([c(3, 3), c(4, 4), c(5, 5), c(6, 6)]);
    expect(sweptCells8(c(6, 6), c(2, 2), world)).toEqual([c(5, 5), c(4, 4), c(3, 3), c(2, 2)]);
    expect(sweptCells8(c(2, 6), c(5, 3), world)).toEqual([c(3, 5), c(4, 4), c(5, 3)]);
    expect(sweptCells8(c(5, 3), c(2, 6), world)).toEqual([c(4, 4), c(3, 5), c(2, 6)]);
    // One diagonal step is one cell, not the two cells of a 4-connected elbow.
    expect(sweptCells8(c(8, 8), c(9, 9), world)).toEqual([c(9, 9)]);
    expect(sweptCells4(c(8, 8), c(9, 9), world)).toHaveLength(2);
  });

  it('keeps a cardinal move as it was, row or column', () => {
    expect(sweptCells8(c(5, 5), c(8, 5), world)).toEqual([c(6, 5), c(7, 5), c(8, 5)]);
    expect(sweptCells8(c(5, 5), c(5, 2), world)).toEqual([c(5, 4), c(5, 3), c(5, 2)]);
    for (const [from, to] of [
      [c(0, 0), c(1, 0)],
      [c(0, 0), c(0, 1)],
      [c(7, 9), c(7, 3)],
      [c(7, 9), c(15, 9)],
    ] as const)
      expect(sweptCells8(from, to, world)).toEqual(sweptCells4(from, to, world));
  });

  it('mixes cardinal and diagonal steps on a shallow slope', () => {
    expect(sweptCells8(c(0, 0), c(4, 1), world)).toEqual([c(1, 0), c(2, 1), c(3, 1), c(4, 1)]);
    const line = sweptCells8(c(0, 0), c(5, 2), world);
    expect(line).toEqual([c(1, 0), c(2, 1), c(3, 1), c(4, 2), c(5, 2)]);
    const kinds = steps(c(0, 0), line).map(([dx, dy]) => Math.abs(dx) + Math.abs(dy));
    expect(kinds).toEqual([1, 2, 1, 2, 1]);
    // A steep slope is the same line seen from the other axis.
    expect(sweptCells8(c(0, 0), c(2, 5), world)).toEqual([c(0, 1), c(1, 2), c(1, 3), c(2, 4), c(2, 5)]);
  });

  it('crosses the toric seams by the shortest way', () => {
    expect(sweptCells8(c(62, 31), c(1, 0), world)).toEqual([c(63, 31), c(0, 0), c(1, 0)]);
    expect(sweptCells8(c(63, 31), c(0, 0), world)).toEqual([c(0, 0)]);
    // The way back is the same length, through the seams, not across the whole map.
    expect(sweptCells8(c(1, 0), c(62, 31), world)).toEqual([c(0, 0), c(63, 31), c(62, 31)]);
    expect(sweptCells8(c(0, 5), c(63, 5), world)).toEqual([c(63, 5)]);
    // A pure diagonal across the corner of the torus stays diagonal.
    expect(sweptCells8(c(62, 30), c(1, 1), world)).toEqual([c(63, 31), c(0, 0), c(1, 1)]);
  });

  it('is bounded by the limit and a later call catches up from the last cell', () => {
    const big = { widthCells: 256, heightCells: 256 };
    const full = sweptCells8(c(0, 0), c(90, 45), big);
    expect(full).toHaveLength(90);
    const first = sweptCells8(c(0, 0), c(90, 45), big, 64);
    expect(first).toHaveLength(64);
    expect(first).toEqual(full.slice(0, 64));
    const rest = sweptCells8(first.at(-1)!, c(90, 45), big, 64);
    expect(rest).toHaveLength(26);
    expect(rest.at(-1)).toEqual(c(90, 45));
    expect(sweptCells8(c(0, 0), c(90, 45), big, 0)).toEqual([]);
  });

  it('is deterministic and always an 8-connected chain that reaches the target, on every pair', () => {
    // Deterministic pseudo-random pairs (LCG), including the seams and both orientations.
    let seed = 12345;
    const next = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    // One assertion at the end (thousands of expects are slow): the pairs that break a rule.
    const broken: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const from = c(next(world.widthCells), next(world.heightCells)),
        to = c(next(world.widthCells), next(world.heightCells));
      const line = sweptCells8(from, to, world);
      const dx = Math.abs(wrappedDistance(to.cellX, from.cellX, world.widthCells)),
        dy = Math.abs(wrappedDistance(to.cellY, from.cellY, world.heightCells));
      const moves = steps(from, line);
      const ok =
        JSON.stringify(sweptCells8(from, to, world)) === JSON.stringify(line) &&
        line.length === Math.max(dx, dy) &&
        (!line.length || (line.at(-1)!.cellX === to.cellX && line.at(-1)!.cellY === to.cellY)) &&
        line.every((cell) => inWorld(cell)) &&
        // Each step is one cell in each axis at most, and never stays in place.
        moves.every(([sx, sy]) => Math.abs(sx) <= 1 && Math.abs(sy) <= 1 && (sx !== 0 || sy !== 0)) &&
        // Exactly min(|dx|, |dy|) diagonal steps: the rest are cardinal.
        moves.filter(([sx, sy]) => sx !== 0 && sy !== 0).length === Math.min(dx, dy);
      if (!ok) broken.push(`${from.cellX}:${from.cellY} -> ${to.cellX}:${to.cellY}`);
    }
    expect(broken).toEqual([]);
  });
});

describe('inRoadCellCore', () => {
  it('holds the centre and its surroundings, neither the corners nor the middles of the sides', () => {
    const inside = [
        [80, 40],
        [83, 40],
        [80, 37],
        [81, 42],
        [-8, -8],
        [-9, -6],
      ],
      outside = [
        [84, 44],
        [83, 43],
        [84, 40],
        [78, 42],
        [77, 37],
      ];
    for (const [x, y] of inside) expect(inRoadCellCore({ x: x!, y: y! })).toBe(true);
    for (const [x, y] of outside) expect(inRoadCellCore({ x: x!, y: y! })).toBe(false);
  });

  it('lets a drag along a diagonal, an eighth of a cell off, miss the two side cells', () => {
    // From the centre of (10, 5) to the centre of (11, 6), shifted by one eighth towards (11, 5).
    const cores = new Set<string>();
    for (let i = 0; i <= 8; i++) {
      const point = { x: 80 + i + 1, y: 40 + i - 1 };
      if (inRoadCellCore(point)) cores.add(Math.floor((point.x + 4) / 8) + ':' + Math.floor((point.y + 4) / 8));
    }
    expect([...cores]).toEqual(['10:5', '11:6']);
  });
});
