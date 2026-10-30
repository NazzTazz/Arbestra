import { describe, expect, it } from 'vitest';
import {
  automaticRoadBraziers,
  roadAnchorAccessories,
  roadAnchorCells,
  roadAnchorSubPoint,
  roadAnchorsRequestIsValid,
  roadCellAnchors,
} from './road-anchors.js';

const world = { widthCells: 16, heightCells: 16 };
const cells = (...list: Array<[number, number]>) => list.map(([cellX, cellY]) => ({ cellX, cellY }));
const vertices = (...list: Array<[number, number]>) => list.map(([vertexX, vertexY]) => ({ vertexX, vertexY }));

describe('road anchors', () => {
  it('addresses a vertex by the top-left corner of its cell, canonically on the torus', () => {
    expect(roadAnchorCells({ vertexX: 0, vertexY: 5 }, world)).toEqual(cells([15, 4], [0, 4], [15, 5], [0, 5]));
    expect(roadCellAnchors({ cellX: 15, cellY: 15 }, world)).toEqual(vertices([15, 15], [0, 15], [15, 0], [0, 0]));
    // Cell centres are integers: vertex (3,4) lies at (2.5, 3.5) cells.
    expect(roadAnchorSubPoint({ vertexX: 3, vertexY: 4 }, world)).toEqual({ x: 20, y: 28 });
    expect(roadAnchorSubPoint({ vertexX: 0, vertexY: 0 }, world)).toEqual({ x: 124, y: 124 });
  });

  it('puts automatic braziers on re-entrant corners only: exactly three of four cells', () => {
    // Straight line: none.
    expect(automaticRoadBraziers(cells([2, 2], [3, 2], [4, 2]), world)).toEqual([]);
    // Elbow: the inner corner of the turn.
    expect(automaticRoadBraziers(cells([2, 2], [3, 2], [2, 3]), world)).toEqual(vertices([3, 3]));
    // T: two inner corners.
    expect(automaticRoadBraziers(cells([1, 2], [2, 2], [3, 2], [2, 3]), world)).toEqual(vertices([2, 3], [3, 3]));
    // Crossing: four.
    expect(automaticRoadBraziers(cells([1, 2], [2, 2], [3, 2], [2, 1], [2, 3]), world)).toEqual(
      vertices([2, 2], [2, 3], [3, 2], [3, 3]),
    );
    // A 2 × 2 block: its shared vertex has four cells, not a corner.
    expect(automaticRoadBraziers(cells([2, 2], [3, 2], [2, 3], [3, 3]), world)).toEqual([]);
    // Across the seam of the torus.
    expect(automaticRoadBraziers(cells([15, 15], [0, 15], [15, 0]), world)).toEqual(vertices([0, 0]));
  });

  it('shows stored accessories and unsuppressed automatic braziers', () => {
    const elbow = cells([2, 2], [3, 2], [2, 3]);
    expect(roadAnchorAccessories(elbow, [], world)).toEqual([
      { vertexX: 3, vertexY: 3, kind: 'brazier', automatic: true },
    ]);
    expect(roadAnchorAccessories(elbow, [{ vertexX: 3, vertexY: 3, accessory: 'none' }], world)).toEqual([]);
    expect(roadAnchorAccessories(elbow, [{ vertexX: 2, vertexY: 2, accessory: 'brazier' }], world)).toEqual([
      { vertexX: 2, vertexY: 2, kind: 'brazier', automatic: false },
      { vertexX: 3, vertexY: 3, kind: 'brazier', automatic: true },
    ]);
  });

  it('validates the command body', () => {
    const anchors = vertices([1, 2]);
    const commandId = '00000000-0000-4000-8000-000000000000';
    expect(
      roadAnchorsRequestIsValid({
        commandId,
        action: 'place',
        accessory: 'brazier',
        anchors,
        expectedQuote: { stone: 2, wood: 1 },
      }),
    ).toBe(true);
    expect(roadAnchorsRequestIsValid({ commandId, action: 'remove', anchors })).toBe(true);
    expect(
      roadAnchorsRequestIsValid({
        commandId,
        action: 'place',
        accessory: 'bush',
        anchors,
        expectedQuote: { stone: 0, wood: 0 },
      }),
    ).toBe(false);
    expect(roadAnchorsRequestIsValid({ commandId, action: 'remove', anchors: [] })).toBe(false);
  });
});
