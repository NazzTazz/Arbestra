import { describe, expect, it } from 'vitest';
import { flatRoadGeometry } from './infrastructure-surface-geometry';
import { CELL_UNITS, WorldSpace } from './world-space';

const PIXEL = CELL_UNITS / 16;
const space = () => new WorldSpace(64, 64, { cellX: 8, cellY: 8 });
const raster = (points: Array<[number, number]>) =>
  new Map(
    points.map(([x, y]) => [x + ':' + y, { x: 128 + x, y: 128 + y }] as const).map(([, p]) => [p.x + ':' + p.y, p]),
  );

/** Area of the triangles, in pixels, and whether every one faces up. */
function top(data: { positions: number[]; indices: number[] }) {
  let area = 0,
    up = true;
  for (let i = 0; i < data.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => data.indices[i + k]! * 3);
    const ux = data.positions[b!]! - data.positions[a!]!,
      uz = data.positions[b! + 2]! - data.positions[a! + 2]!,
      vx = data.positions[c!]! - data.positions[a!]!,
      vz = data.positions[c! + 2]! - data.positions[a! + 2]!;
    // y of u × v: the sign of the quads' winding is the reference.
    const normal = uz * vx - ux * vz;
    area += Math.abs(normal) / 2;
    up &&= normal > 0 === reference;
  }
  return { area: area / (PIXEL * PIXEL), up };
}
/** The winding sign of a plain quad, measured once. */
const reference = (() => {
  const data = flatRoadGeometry(raster([[0, 0]]), space(), () => 0, false, 0, 0, undefined, true) as unknown as {
    positions: number[];
    indices: number[];
  };
  const [a, b, c] = [0, 1, 2].map((k) => data.indices[k]! * 3);
  const ux = data.positions[b!]! - data.positions[a!]!,
    uz = data.positions[b! + 2]! - data.positions[a! + 2]!,
    vx = data.positions[c!]! - data.positions[a!]!,
    vz = data.positions[c! + 2]! - data.positions[a! + 2]!;
  return uz * vx - ux * vz > 0;
})();
const geometry = (points: Array<[number, number]>) =>
  flatRoadGeometry(raster(points), space(), () => 0, false, 0, 0, undefined, true) as unknown as {
    positions: number[];
    indices: number[];
  };

describe('flatRoadGeometry', () => {
  it('leaves a straight strip as its pixels', () => {
    const data = geometry([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(top(data)).toEqual({ area: 4, up: true });
  });

  it('draws the two edges of a 45° band straight: one half pixel in every notch of the staircase', () => {
    // A band two pixels wide going down-right: (i, i) and (i + 1, i).
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) points.push([i, i], [i + 1, i]);
    const { area, up } = top(geometry(points));
    // 8 pixels, and 3 notches on each edge.
    expect(area).toBeCloseTo(8 + 6 / 2, 9);
    expect(up).toBe(true);
  });

  it('chamfers a square inner corner by one pixel only', () => {
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) points.push([i, 0], [0, i]);
    const { area, up } = top(geometry(points));
    expect(area).toBeCloseTo(11 + 1 / 2, 9);
    expect(up).toBe(true);
  });
});
