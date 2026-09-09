import { expect, it } from 'vitest';
import { cellsAlongSegment } from './construction-selection';

it('review: includes every cell crossed by a shallow diagonal sweep', () => {
  expect(cellsAlongSegment({ cellX: 4, cellY: 4 }, { cellX: 7, cellY: 6 },
    { widthCells: 2048, heightCells: 1024 })).toEqual([
    { cellX: 5, cellY: 4 }, { cellX: 5, cellY: 5 }, { cellX: 6, cellY: 5 },
    { cellX: 6, cellY: 6 }, { cellX: 7, cellY: 6 },
  ]);
});
