import { expect, it } from 'vitest';
import { vertexSurface } from '@arbestra/contracts';
import { rc1Height, bedColour, RC1_BED_FULL_DEPTH } from './rc1-terrain';
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

it('keeps dry ground and the sandy shore, then darkens and blues the bed with depth', () => {
  expect(bedColour(-1)).toEqual([1, 1, 1, 1]);
  expect(bedColour(0)).toEqual([0.8, 0.75, 0.6, 1]);
  const shallow = bedColour(0.2),
    deep = bedColour(RC1_BED_FULL_DEPTH),
    deeper = bedColour(5);
  // Darker with depth, blue dominant at the bottom, and no change past full depth.
  expect(shallow[0]! + shallow[1]! + shallow[2]!).toBeGreaterThan(deep[0]! + deep[1]! + deep[2]!);
  expect(deep[2]).toBeGreaterThan(deep[0]!);
  expect(deeper).toEqual(deep);
});
