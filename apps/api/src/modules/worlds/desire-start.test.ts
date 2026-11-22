import { describe, expect, it } from 'vitest';

import type { TravelCell, TravelRoute } from '@arbestra/contracts';

import { displayedDesireEdges } from './desire-start.js';

const world = { widthCells: 16, heightCells: 8 };
const at = (cellX: number, cellY: number): TravelCell => ({ cellX, cellY });
const route = (cells: TravelCell[]): TravelRoute => ({ id: 'r', kind: 'wood', destination: cells.at(-1)!, cells });

describe('the start state of the desire paths (T3d) after the diagonal edges (R2a)', () => {
  it('stores what the decorative topology draws: cardinal steps only, a unit diagonal jump left out', () => {
    expect(displayedDesireEdges([route([at(1, 1), at(2, 1), at(3, 2), at(3, 3)])], world)).toEqual([
      { cellX: 1, cellY: 1, direction: 0 },
      { cellX: 3, cellY: 2, direction: 1 },
    ]);
  });

  it('rounds a route point by point, as it is drawn, even where a mission path would be a local detour', () => {
    // An eighth-cell staircase through the corner two diagonal cells share, between their centres:
    // drawn as east then south, which is what the start state keeps.
    const staircase = [at(3, 5), at(3.5, 5.125), at(3.5, 5.5), at(3.875, 5.5), at(4, 6)];
    expect(displayedDesireEdges([route(staircase)], world)).toEqual([
      { cellX: 3, cellY: 5, direction: 0 },
      { cellX: 4, cellY: 5, direction: 1 },
    ]);
    // A point without finite coordinates is skipped, as before.
    expect(displayedDesireEdges([route([at(Number.NaN, 1), at(1, 1), at(2, 1)])], world)).toEqual([
      { cellX: 1, cellY: 1, direction: 0 },
    ]);
  });
});
