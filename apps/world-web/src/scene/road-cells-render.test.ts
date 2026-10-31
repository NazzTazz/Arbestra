import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { emptyInfrastructure, infrastructurePlanSurface, type RoadCellSurface } from '@arbestra/contracts';
import {
  ROAD_EAST,
  ROAD_NORTH,
  ROAD_SOUTH,
  ROAD_WEST,
  RoadCellTiles,
  TILT_CLEARANCE,
  roadCellPlane,
  roadCellClearance,
  roadTileFor,
  roadTileGeometry,
  type RoadTileShape,
} from './road-cell-tiles';
import { WorldSpace } from './world-space';

const world = { widthCells: 64, heightCells: 64 };
const cell = (cellX: number, cellY: number, surface: RoadCellSurface = 'earth', sidewalks = false) => ({
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
function withScene(run: (scene: Scene) => void) {
  const engine = new NullEngine();
  // NullEngine reports no instanced arrays, which disables thin instances.
  (engine.getCaps() as { instancedArrays: boolean }).instancedArrays = true;
  const scene = new Scene(engine);
  try {
    run(scene);
  } finally {
    scene.dispose();
    engine.dispose();
  }
}
/** World-space extent of a tile instance's pavement around its cell centre. */
function extent(tiles: RoadCellTiles, x: number, y: number, space: WorldSpace) {
  const placement = tiles.placement(x, y)!,
    [shape, surface, sidewalks] = placement.tile.split(':') as [RoadTileShape, RoadCellSurface, string];
  const positions = roadTileGeometry(shape, surface, sidewalks === '1').pavement!.positions!,
    matrix = Matrix.FromArray(tiles.matrix(x, y)!),
    centre = space.project({ cellX: x, cellY: y });
  const min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < positions.length; i += 3) {
    const v = Vector3.TransformCoordinates(new Vector3(positions[i], positions[i + 1], positions[i + 2]), matrix);
    min.minimizeInPlace(v);
    max.maximizeInPlace(v);
  }
  return { minX: min.x - centre.x, maxX: max.x - centre.x, minZ: min.z - centre.z, maxZ: max.z - centre.z };
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

  it('turns each tile so that its arms reach the neighbouring cells, across the toric seam', () => {
    withScene((scene) => {
      const tiles = new RoadCellTiles(scene),
        space = new WorldSpace(64, 64, { cellX: 0, cellY: 5 });
      // An elbow at (0, 5) whose arms go west across the seam and south.
      tiles.update([cell(63, 5), cell(0, 5), cell(0, 6)], space, () => 0);
      expect(tiles.placement(0, 5)).toMatchObject({ tile: 'elbow:earth:0', quarterTurns: 1 });
      expect(tiles.placement(63, 5)).toMatchObject({ tile: 'end:earth:0', quarterTurns: 0 });
      expect(tiles.placement(0, 6)).toMatchObject({ tile: 'end:earth:0', quarterTurns: 3 });
      const elbow = extent(tiles, 0, 5, space);
      expect(elbow.minX).toBeCloseTo(-1.25, 3);
      expect(elbow.maxZ).toBeCloseTo(1.25, 3);
      expect(elbow.maxX).toBeLessThan(0.7);
      expect(elbow.minZ).toBeGreaterThan(-0.7);
      // The cell across the seam stands one cell west of the origin, its arm towards it.
      const across = extent(tiles, 63, 5, space);
      expect(tiles.matrix(63, 5)![12]).toBeCloseTo(-2.5, 6);
      expect(across.maxX).toBeCloseTo(1.25, 3);
      expect(across.minX).toBeGreaterThan(-0.7);
      const south = extent(tiles, 0, 6, space);
      expect(south.minZ).toBeCloseTo(-1.25, 3);
      expect(south.maxZ).toBeLessThan(0.7);
      tiles.dispose();
    });
  });

  it('places a cell by rewriting at most five instances, building no mesh after first use', () => {
    withScene((scene) => {
      const tiles = new RoadCellTiles(scene),
        space = new WorldSpace(64, 64, { cellX: 32, cellY: 32 });
      let reads = 0;
      const ground = () => {
        reads++;
        return 1;
      };
      const options = { followTerrain: true, groundIdentity: 'g1', groundCellIdentity: () => 'c1' };
      // A dense block of every shape, in two surfaces with and without sidewalks.
      const cells = [
        ...Array.from({ length: 30 * 30 }, (_, i) => cell(2 + (i % 30), 2 + Math.floor(i / 30), 'rubble')),
        ...Array.from({ length: 20 }, (_, i) => cell(2 + i, 40, 'stone-1', true)),
        cell(15, 41, 'stone-1', true),
        cell(10, 42, 'stone-1', true),
        cell(30, 42, 'stone-1', true),
        cell(31, 42, 'stone-1', true),
      ];
      tiles.update(cells, space, ground, options);
      const meshes = new Set(tiles.meshes),
        built = tiles.stats.tilesBuilt,
        before = { ...tiles.stats };
      // An unrelated publication: same content in a new array, nothing written.
      reads = 0;
      tiles.update(
        cells.map((c) => ({ ...c })),
        space,
        ground,
        options,
      );
      expect(tiles.stats.writes - before.writes).toBe(0);
      expect(reads).toBe(0);
      // One more stone cell under the line: an elbow becomes a T, a new end appears.
      reads = 0;
      const placed = [...cells, cell(5, 41, 'stone-1', true)],
        mid = { ...tiles.stats };
      const touched = tiles.update(placed, space, ground, options);
      expect(touched).toBeLessThanOrEqual(5);
      expect(tiles.stats.writes - mid.writes).toBeLessThanOrEqual(5);
      expect(tiles.stats.removals - mid.removals).toBeLessThanOrEqual(5);
      // Nine ground samples per rewritten cell, at most.
      expect(reads).toBeLessThanOrEqual(5 * 9);
      expect(tiles.placement(5, 40)).toMatchObject({ tile: 't:stone-1:1', quarterTurns: 0 });
      expect(tiles.placement(5, 41)).toMatchObject({ tile: 'end:stone-1:1', quarterTurns: 3 });
      // The T and the end tiles were already in use: no new mesh.
      expect(tiles.stats.tilesBuilt).toBe(built);
      expect(tiles.meshes.every((m) => meshes.has(m))).toBe(true);
      // Removing it restores the line, again within five instances.
      const back = { ...tiles.stats };
      tiles.update(cells, space, ground, options);
      expect(tiles.stats.writes - back.writes).toBeLessThanOrEqual(5);
      expect(tiles.stats.removals - back.removals).toBeLessThanOrEqual(5);
      expect(tiles.placement(5, 41)).toBeNull();
      expect(tiles.placement(5, 40)).toMatchObject({ tile: 'straight:stone-1:1', quarterTurns: 0 });
      // A new combination builds its tile once.
      tiles.update([...cells, cell(50, 50, 'stone-2')], space, ground, options);
      expect(tiles.stats.tilesBuilt).toBe(built + 1);
      tiles.update([...cells, cell(50, 50, 'stone-2'), cell(52, 50, 'stone-2')], space, ground, options);
      expect(tiles.stats.tilesBuilt).toBe(built + 1);
      const counts = tiles.instances;
      expect(counts.get('isolated:stone-2:0')).toBe(2);
      expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(cells.length + 2);
      // Each tile mesh draws exactly its instances; an emptied tile draws nothing.
      for (const mesh of tiles.meshes) {
        const key = mesh.name.split(':').slice(1, 4).join(':');
        expect(mesh.thinInstanceCount).toBe(counts.get(key));
        expect(mesh.isVisible).toBe(counts.get(key)! > 0);
      }
      tiles.dispose();
    });
  });

  it('re-plans only the cells whose ground changed, and moves instances with the origin', () => {
    withScene((scene) => {
      const tiles = new RoadCellTiles(scene),
        space = new WorldSpace(64, 64, { cellX: 0, cellY: 0 });
      const cells = Array.from({ length: 10 }, (_, i) => cell(i, 3));
      let height = 1;
      const ground = (x: number) => (x >= 5 ? height : 1);
      tiles.update(cells, space, ground, {
        followTerrain: true,
        groundIdentity: 'a',
        groundCellIdentity: () => 'a',
      });
      height = 2;
      const before = tiles.stats.writes;
      tiles.update(cells, space, ground, {
        followTerrain: true,
        groundIdentity: 'b',
        // Only the chunk under x >= 6 republished.
        groundCellIdentity: (x) => (x >= 6 ? 'b' : 'a'),
      });
      // Cells 5 to 9 read a column from x >= 6 (their east corners).
      expect(tiles.stats.writes - before).toBe(5);
      // Earth lies on its plane, 1.5 cm up like the automatic roads: no stone clearance.
      expect(tiles.matrix(8, 3)![13]).toBeCloseTo(2, 6);
      expect(tiles.matrix(2, 3)![13]).toBeCloseTo(1, 6);
      // A rebased origin moves instances without building or planning anything.
      const built = tiles.stats.tilesBuilt;
      space.origin = { cellX: 16, cellY: 0 };
      tiles.update(cells, space, ground, {
        followTerrain: true,
        groundIdentity: 'b',
        groundCellIdentity: (x) => (x >= 6 ? 'b' : 'a'),
      });
      expect(tiles.matrix(2, 3)![12]).toBeCloseTo(-14 * 2.5, 6);
      expect(tiles.stats.tilesBuilt).toBe(built);
      tiles.dispose();
    });
  });

  it('tilts a cell onto the mean plane of its ground, never under a sampled point', () => {
    // A slope of 0.4 per cell along x, and a bump at the centre.
    const plane = roadCellPlane((x, y) => 0.4 * x + (x === 10 && y === 10 ? 0.1 : 0), 10, 10, true)!;
    expect(plane.slopeX).toBeCloseTo(0.4 / 2.5, 6);
    expect(plane.slopeZ).toBeCloseTo(0, 6);
    expect(plane.height).toBeCloseTo(4.1 + TILT_CLEARANCE, 6);
    // Off RC1, flat at the cell's height.
    expect(roadCellPlane(() => 2, 3, 3, false)).toEqual({ slopeX: 0, slopeZ: 0, height: 2 });
    expect(roadCellPlane(() => null, 3, 3, true)).toBeNull();
    expect(roadCellPlane((x) => 0.4 * x, 10, 10, true, roadCellClearance('earth'))!.height).toBeCloseTo(4, 6);
    expect(roadCellClearance('rubble')).toBe(0);
    expect(roadCellClearance('stone-1')).toBe(TILT_CLEARANCE);
  });
});
