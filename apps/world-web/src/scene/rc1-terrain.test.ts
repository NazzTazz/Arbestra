import { expect, it } from 'vitest';
import { vertexSurface } from '@arbestra/contracts';
import { rc1Height } from './rc1-terrain';
it('samples the rendered two-triangle surface exactly like the server, including torus chunk edges', () => {
  const s = vertexSurface({ widthCells: 512, heightCells: 256 }, (x, y) => Math.sin(x) * 0.2 + Math.cos(y) * 0.1, []);
  for (const [originCellX, originCellY] of [
    [0, 0],
    [480, 224],
    [32, 32],
  ]) {
    const heights = Array.from({ length: 1089 }, (_, i) =>
      s.height(originCellX! + (i % 33), originCellY! + Math.floor(i / 33)),
    );
    const chunk = {
      originCellX: originCellX!,
      originCellY: originCellY!,
      rc1: { model: 'vertices' as const, stride: 33, heights, water: heights.map(() => 0), terraces: [] },
    };
    for (const x of [0, 0.1, 0.5, 1, 31.9, 32])
      for (const y of [0, 0.1, 0.5, 1, 31.9, 32]) {
        const px = originCellX! - 0.5 + x,
          py = originCellY! - 0.5 + y;
        expect(rc1Height(chunk, px, py)).toBeCloseTo(s.sample(px, py) * 2.5, 10);
      }
  }
});
