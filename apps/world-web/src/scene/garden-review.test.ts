import { expect, it } from 'vitest';
import { cellsAlongSegment } from './construction-selection';

it('review: includes every cell crossed by a shallow diagonal sweep', () => {
  expect(cellsAlongSegment({ cellX: 4, cellY: 4 }, { cellX: 7, cellY: 6 },
    { widthCells: 2048, heightCells: 1024 })).toEqual([
    { cellX: 5, cellY: 4 }, { cellX: 5, cellY: 5 }, { cellX: 6, cellY: 5 },
    { cellX: 6, cellY: 6 }, { cellX: 7, cellY: 6 },
  ]);
});

it('uses the real intra-cell pointer positions rather than replacing them with cell centres', () => {
  expect(cellsAlongSegment({ cellX: 4.4, cellY: 4.4 }, { cellX: 6.6, cellY: 5.6 },
    { widthCells: 2048, heightCells: 1024 })).toEqual([
    { cellX: 5, cellY: 4 }, { cellX: 5, cellY: 5 }, { cellX: 6, cellY: 5 },
    { cellX: 6, cellY: 6 }, { cellX: 7, cellY: 6 },
  ]);
});

it('traverses the reverse diagonal in reverse order and crosses both torus seams', () => {
  const world = { widthCells: 2048, heightCells: 1024 };
  expect(cellsAlongSegment({ cellX: 7, cellY: 6 }, { cellX: 4, cellY: 4 }, world)).toEqual([
    { cellX: 6, cellY: 6 }, { cellX: 6, cellY: 5 }, { cellX: 5, cellY: 5 },
    { cellX: 5, cellY: 4 }, { cellX: 4, cellY: 4 },
  ]);
  expect(cellsAlongSegment({ cellX: 2047, cellY: 1023 }, { cellX: 2, cellY: 1 }, world)).toEqual([
    { cellX: 0, cellY: 1023 }, { cellX: 0, cellY: 0 }, { cellX: 1, cellY: 0 },
    { cellX: 1, cellY: 1 }, { cellX: 2, cellY: 1 },
  ]);
  expect(cellsAlongSegment({ cellX: 1, cellY: 1 }, { cellX: 2, cellY: 2 }, world)).toEqual([{ cellX: 2, cellY: 2 }]);
});
