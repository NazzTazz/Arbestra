import { describe, expect, it } from 'vitest';
import { torusCell, torusPoint } from './terrain-overview-view';

const world = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', generationVersion: 2,
  widthCells: 2048, heightCells: 1024, chunkSize: 32 };

describe('canonical torus navigation', () => {
  it('returns the selected cell at both seams and the inner and outer faces', () => {
    for (const cell of [
      { cellX: 0, cellY: 0 }, { cellX: 2047, cellY: 1023 },
      { cellX: 0, cellY: 512 }, { cellX: 1024, cellY: 0 },
      { cellX: 1777, cellY: 467 },
    ]) {
      const recovered = torusCell(torusPoint({ cellX: cell.cellX + 0.5, cellY: cell.cellY + 0.5 }, world), world);
      expect(recovered).toEqual(cell);
    }
  });
});
