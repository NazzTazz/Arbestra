import { describe, expect, it } from 'vitest';

import { desireEdges, type DesireEdge, type TravelCell } from './travel-paths.js';

const world = { widthCells: 16, heightCells: 8 };
const at = (cellX: number, cellY: number): TravelCell => ({ cellX, cellY });
const east = (cellX: number, cellY: number): DesireEdge => ({ cellX, cellY, direction: 0 });
const south = (cellX: number, cellY: number): DesireEdge => ({ cellX, cellY, direction: 1 });

describe('desire edges', () => {
  it('names a walked step by its eastern or southern edge, whichever way it was walked', () => {
    expect(desireEdges([[at(3, 2), at(4, 2)]], world)).toEqual([east(3, 2)]);
    expect(desireEdges([[at(4, 2), at(3, 2)]], world)).toEqual([east(3, 2)]);
    expect(desireEdges([[at(3, 2), at(3, 3)]], world)).toEqual([south(3, 2)]);
    expect(desireEdges([[at(3, 3), at(3, 2)]], world)).toEqual([south(3, 2)]);
  });

  it('expands a long cardinal leg of a sparse legacy path into one edge per cell', () => {
    expect(desireEdges([[at(2, 5), at(5, 5), at(5, 3)]], world)).toEqual([
      east(2, 5),
      east(3, 5),
      east(4, 5),
      south(5, 3),
      south(5, 4),
    ]);
  });

  it('wraps at the torus seam: the step from the last column to the first is the last column eastward', () => {
    expect(desireEdges([[at(15, 2), at(0, 2)]], world)).toEqual([east(15, 2)]);
    expect(desireEdges([[at(0, 2), at(15, 2)]], world)).toEqual([east(15, 2)]);
    expect(desireEdges([[at(4, 7), at(4, 0)]], world)).toEqual([south(4, 7)]);
    expect(desireEdges([[at(4, 0), at(4, 7)]], world)).toEqual([south(4, 7)]);
    // A sparse leg crossing the seam takes the short way round.
    expect(desireEdges([[at(14, 1), at(1, 1)]], world)).toEqual([east(0, 1), east(14, 1), east(15, 1)]);
  });

  it('rounds eighth-of-a-cell coordinates to their cell, as the decorative topology does', () => {
    expect(desireEdges([[at(3.125, 2.0625), at(3.875, 2.0625), at(4.125, 2), at(4.0625, 2.9375)]], world)).toEqual([
      east(3, 2),
      south(4, 2),
    ]);
    // 15.4 rounds to the last column, 0.4 to the first; 15.9 rounds up and wraps to the first.
    expect(desireEdges([[at(15.4, 2), at(0.4, 2)]], world)).toEqual([east(15, 2)]);
    expect(desireEdges([[at(15.9, 2), at(1.1, 2)]], world)).toEqual([east(0, 2)]);
  });

  it('drops a diagonal jump and keeps the steps on either side of it', () => {
    expect(desireEdges([[at(1, 1), at(2, 2)]], world)).toEqual([]);
    expect(desireEdges([[at(1, 1), at(2, 1), at(3, 2), at(3, 3)]], world)).toEqual([east(1, 1), south(3, 2)]);
  });

  it('ignores a path that does not move and a stop repeated in place', () => {
    expect(desireEdges([[at(5, 5)]], world)).toEqual([]);
    expect(desireEdges([[at(5, 5), at(5, 5), at(5.0625, 5)]], world)).toEqual([]);
    expect(desireEdges([[]], world)).toEqual([]);
    expect(desireEdges([], world)).toEqual([]);
  });

  it('counts a round trip once', () => {
    const out = [at(2, 2), at(5, 2), at(5, 4)];
    expect(desireEdges([out, [...out].reverse()], world)).toEqual(desireEdges([out], world));
    expect(desireEdges([out, [...out].reverse()], world)).toHaveLength(5);
  });

  it('counts a tour once per edge: stops walked outward, an edge shared by two legs, and the return', () => {
    const home = at(2, 2),
      first = at(5, 2),
      second = at(5, 4);
    const legs = [
      [home, at(5, 2), first], // home to the first plot
      [first, second], // first plot to the second, through (5, 3)
      [second, at(5, 2), at(2, 2)], // return, over the same ground
    ];
    expect(desireEdges(legs, world)).toEqual([east(2, 2), east(3, 2), east(4, 2), south(5, 2), south(5, 3)]);
    // A leg alone, and the whole tour twice, add nothing new.
    expect(desireEdges([...legs, ...legs], world)).toEqual(desireEdges(legs, world));
  });

  it('returns the primary-key order of the table', () => {
    const edges = desireEdges(
      [
        [at(9, 3), at(9, 1)],
        [at(1, 6), at(3, 6)],
        [at(1, 2), at(1, 3)],
      ],
      world,
    );
    expect(edges).toEqual([south(1, 2), east(1, 6), east(2, 6), south(9, 1), south(9, 2)]);
  });

  it('skips a point without finite coordinates instead of producing an edge from it', () => {
    expect(desireEdges([[at(1, 1), at(Number.NaN, 1), at(2, 1)]], world)).toEqual([east(1, 1)]);
  });
});
