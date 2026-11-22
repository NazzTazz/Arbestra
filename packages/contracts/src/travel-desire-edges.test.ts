import { describe, expect, it } from 'vitest';

import { desireEdges, type DesireEdge, type TravelCell } from './travel-paths.js';

const world = { widthCells: 16, heightCells: 8 };
const at = (cellX: number, cellY: number): TravelCell => ({ cellX, cellY });
const east = (cellX: number, cellY: number): DesireEdge => ({ cellX, cellY, direction: 0 });
const south = (cellX: number, cellY: number): DesireEdge => ({ cellX, cellY, direction: 1 });
const southEast = (cellX: number, cellY: number): DesireEdge => ({ cellX, cellY, direction: 2 });
const southWest = (cellX: number, cellY: number): DesireEdge => ({ cellX, cellY, direction: 3 });

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

  it('names a unit diagonal step by its south-eastern or south-western edge, whichever way it was walked', () => {
    expect(desireEdges([[at(1, 1), at(2, 2)]], world)).toEqual([southEast(1, 1)]);
    expect(desireEdges([[at(2, 2), at(1, 1)]], world)).toEqual([southEast(1, 1)]);
    expect(desireEdges([[at(2, 1), at(1, 2)]], world)).toEqual([southWest(2, 1)]);
    expect(desireEdges([[at(1, 2), at(2, 1)]], world)).toEqual([southWest(2, 1)]);
    // Between cardinal steps, and several in a row.
    expect(desireEdges([[at(1, 1), at(2, 1), at(3, 2), at(3, 3)]], world)).toEqual([
      east(1, 1),
      southEast(2, 1),
      south(3, 2),
    ]);
    expect(desireEdges([[at(5, 5), at(6, 6), at(7, 7), at(6, 8)]], world)).toEqual([
      southEast(5, 5),
      southEast(6, 6),
      southWest(7, 7),
    ]);
  });

  it('drops a jump longer than one cell that is not cardinal, and keeps the steps on either side of it', () => {
    expect(desireEdges([[at(1, 1), at(3, 2)]], world)).toEqual([]);
    expect(desireEdges([[at(1, 1), at(3, 3)]], world)).toEqual([]);
    expect(desireEdges([[at(0, 1), at(1, 1), at(3, 3), at(3, 4)]], world)).toEqual([east(0, 1), south(3, 3)]);
  });

  it('wraps the diagonal edges at both seams of the torus, in both directions of walk', () => {
    // East seam: south-east from the last column, south-west from the first one.
    expect(desireEdges([[at(15, 2), at(0, 3)]], world)).toEqual([southEast(15, 2)]);
    expect(desireEdges([[at(0, 3), at(15, 2)]], world)).toEqual([southEast(15, 2)]);
    expect(desireEdges([[at(0, 2), at(15, 3)]], world)).toEqual([southWest(0, 2)]);
    expect(desireEdges([[at(15, 3), at(0, 2)]], world)).toEqual([southWest(0, 2)]);
    // South seam: the origin is in the last row.
    expect(desireEdges([[at(4, 7), at(5, 0)]], world)).toEqual([southEast(4, 7)]);
    expect(desireEdges([[at(5, 0), at(4, 7)]], world)).toEqual([southEast(4, 7)]);
    expect(desireEdges([[at(4, 7), at(3, 0)]], world)).toEqual([southWest(4, 7)]);
    expect(desireEdges([[at(3, 0), at(4, 7)]], world)).toEqual([southWest(4, 7)]);
    // The corners of the world, both seams at once.
    expect(desireEdges([[at(15, 7), at(0, 0)]], world)).toEqual([southEast(15, 7)]);
    expect(desireEdges([[at(0, 7), at(15, 0)]], world)).toEqual([southWest(0, 7)]);
    // Unwrapped coordinates name the same edges.
    expect(desireEdges([[at(15, 2), at(16, 3)]], world)).toEqual([southEast(15, 2)]);
    expect(desireEdges([[at(-1, 7), at(0, 8)]], world)).toEqual([southEast(15, 7)]);
  });

  it('names a step by its two cells when its eighth-cell detour stays within them', () => {
    // A trunk on the straight line from (3, 5) to (4, 5): round it by the southern border of the
    // two cells (y = 5.5, which alone rounds to row 6).
    const around = [at(3, 5), at(3.25, 5.375), at(3.25, 5.5), at(3.75, 5.5), at(3.875, 5.25), at(4, 5)];
    expect(desireEdges([around], world)).toEqual([east(3, 5)]);
    // Without its centres it is an ordinary legacy path, rounded point by point.
    expect(desireEdges([around.slice(1, -1)], world)).toEqual([south(3, 5), east(3, 6), south(4, 5)]);
    // A diagonal step goes round through the corner its two cells share.
    const diagonal = [at(3, 5), at(3.5, 5.125), at(3.5, 5.5), at(3.875, 5.5), at(4, 6)];
    expect(desireEdges([diagonal], world)).toEqual([southEast(3, 5)]);
    expect(desireEdges([[...diagonal].reverse()], world)).toEqual([southEast(3, 5)]);
    expect(desireEdges([[at(4, 5), at(3.5, 5.5), at(3.375, 5.875), at(3, 6)]], world)).toEqual([southWest(4, 5)]);
    // Across the seam, from the last column to the first.
    expect(desireEdges([[at(15, 2), at(15.5, 2.25), at(-0.375, 2.5), at(0, 2)]], world)).toEqual([east(15, 2)]);
    // A run that leaves the two cells is not a detour: rounded point by point, as before.
    expect(desireEdges([[at(3, 5), at(3, 5.625), at(4, 5.625), at(4, 5)]], world)).toEqual([
      south(3, 5),
      east(3, 6),
      south(4, 5),
    ]);
  });

  it('counts a diagonal round trip once, and a diagonal apart from the cardinal steps round its corner', () => {
    const out = [at(2, 2), at(3, 3), at(4, 3)];
    expect(desireEdges([out, [...out].reverse()], world)).toEqual([southEast(2, 2), east(3, 3)]);
    expect(desireEdges([out, [at(2, 2), at(3, 2), at(3, 3)]], world)).toEqual([
      east(2, 2),
      southEast(2, 2),
      south(3, 2),
      east(3, 3),
    ]);
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
        [at(2, 3), at(1, 2), at(2, 1), at(1, 0)],
        [at(1, 6), at(0, 7)],
      ],
      world,
    );
    expect(edges).toEqual([
      southEast(1, 0),
      south(1, 2),
      southEast(1, 2),
      east(1, 6),
      southWest(1, 6),
      southWest(2, 1),
      east(2, 6),
      south(9, 1),
      south(9, 2),
    ]);
  });

  it('skips a point without finite coordinates instead of producing an edge from it', () => {
    expect(desireEdges([[at(1, 1), at(Number.NaN, 1), at(2, 1)]], world)).toEqual([east(1, 1)]);
  });
});
