import { describe, expect, it } from 'vitest';
import { emptyInfrastructure, infrastructurePlanSurface, type RoadCellSurface } from '@arbestra/contracts';
import {
  ROAD_EAST,
  ROAD_NORTH,
  ROAD_SOUTH,
  ROAD_WEST,
  roadTileFor,
  roadTileGeometry,
  type RoadTileShape,
} from './road-cell-tiles';

const world = { widthCells: 64, heightCells: 64 };
const cell = (cellX: number, cellY: number, surface: RoadCellSurface = 'stone-1', sidewalks = false) => ({
  id: `${cellX},${cellY}`,
  cellX,
  cellY,
  surface,
  sidewalks,
  gauge: 'chemin' as const,
  revision: 1,
});
/** Arms painted by navigation from the centre of (x, y): bit 0 east, 1 south, 2 west, 3 north. */
function arms(cells: ReturnType<typeof cell>[], x: number, y: number) {
  const surface = infrastructurePlanSurface({ ...emptyInfrastructure(), roadCells: cells }, world),
    manual = (px: number, py: number) => Boolean(surface.get(`${(px + 1024) % 1024}:${(py + 1024) % 1024}`)?.manual);
  const cx = x * 16,
    cy = y * 16;
  expect(manual(cx, cy)).toBe(true);
  return (
    (manual(cx + 6, cy) ? 1 : 0) |
    (manual(cx, cy + 6) ? 2 : 0) |
    (manual(cx - 6, cy) ? 4 : 0) |
    (manual(cx, cy - 6) ? 8 : 0)
  );
}

describe('road cells as painted for navigation (overlayRoadCells)', () => {
  it('connects each cell to its four neighbours, across the toric seam', () => {
    expect(arms([cell(10, 10), cell(11, 10)], 10, 10)).toBe(1);
    expect(arms([cell(9, 10), cell(10, 10), cell(11, 10), cell(10, 9), cell(10, 11)], 10, 10)).toBe(15);
    expect(arms([cell(10, 10), cell(11, 11)], 10, 10)).toBe(0);
    expect(arms([cell(63, 5), cell(0, 5)], 0, 5)).toBe(4);
  });
});

describe('road cell tiles', () => {
  it('chooses the tile and its quarter turns for every neighbour mask', () => {
    const E = ROAD_EAST,
      S = ROAD_SOUTH,
      W = ROAD_WEST,
      N = ROAD_NORTH;
    const expected: Array<[number, RoadTileShape, number]> = [
      [0, 'isolated', 0],
      [E, 'end', 0],
      [S, 'end', 1],
      [W, 'end', 2],
      [N, 'end', 3],
      [E | W, 'straight', 0],
      [S | N, 'straight', 1],
      [E | S, 'elbow', 0],
      [S | W, 'elbow', 1],
      [W | N, 'elbow', 2],
      [N | E, 'elbow', 3],
      [E | S | W, 't', 0],
      [S | W | N, 't', 1],
      [W | N | E, 't', 2],
      [N | E | S, 't', 3],
      [15, 'crossing', 0],
    ];
    expect(expected.map(([mask]) => mask).sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
    for (const [mask, shape, quarterTurns] of expected) expect(roadTileFor(mask)).toEqual({ shape, quarterTurns });
  });

  it('keeps every tile inside its cell, with curbs only when asked', () => {
    for (const shape of ['isolated', 'end', 'straight', 'elbow', 't', 'crossing'] as const)
      for (const surface of ['earth', 'rubble', 'stone-1', 'stone-2'] as const)
        for (const sidewalks of [false, true]) {
          const { pavement, curb } = roadTileGeometry(shape, surface, sidewalks);
          expect(pavement?.positions?.length).toBeGreaterThan(0);
          expect(Boolean(curb)).toBe(sidewalks);
          let reach = 0;
          for (const data of [pavement, curb])
            for (let k = 0; data && k < data.positions!.length; k += 3)
              reach = Math.max(reach, Math.abs(data.positions![k]!), Math.abs(data.positions![k + 2]!));
          expect(reach).toBeLessThanOrEqual(1.25 + 1e-6);
        }
  });
});
