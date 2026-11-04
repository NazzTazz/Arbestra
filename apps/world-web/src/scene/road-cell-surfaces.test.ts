import { describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { RoadCellSurface } from '@arbestra/contracts';
import { RoadCellSurfaces } from './road-cell-surfaces';
import { RoadCellTiles } from './road-cell-tiles';
import { VillageRoads } from './village-roads';
import { WorldSpace } from './world-space';

const cell = (cellX: number, cellY: number, surface: RoadCellSurface = 'earth', sidewalks = false) => ({
  cellX,
  cellY,
  surface,
  sidewalks,
});
function withScene(run: (scene: Scene) => void) {
  const engine = new NullEngine();
  (engine.getCaps() as { instancedArrays: boolean }).instancedArrays = true;
  const scene = new Scene(engine);
  try {
    run(scene);
  } finally {
    scene.dispose();
    engine.dispose();
  }
}
/** Un relief continu, ni plan ni régulier : lu à n'importe quelle position fractionnaire de case. */
const relief = (x: number, y: number) => 0.3 * x + 0.2 * y + 0.2 * Math.sin(x * 2.1) * Math.cos(y * 1.7);
const TOP = 0.015,
  DEPTH = 0.025,
  CURB = 0.004;
const mm = (value: number) => Math.round(value * 1000) / 1000;

/** Hauteurs des sommets d'un maillage au-dessus du relief qui est dessous, arrondies au millimètre. */
function offsets(meshes: readonly Mesh[], space: WorldSpace) {
  const found = new Set<number>();
  for (const mesh of meshes) {
    const p = mesh.getVerticesData('position')!;
    for (let i = 0; i < p.length; i += 3) {
      const cx = space.origin.cellX + p[i]! / 2.5,
        cy = space.origin.cellY + p[i + 2]! / 2.5;
      found.add(mm(p[i + 1]! - relief(cx, cy)));
    }
  }
  return [...found].sort((a, b) => a - b);
}
const options = (identity = 'g1') => ({
  followTerrain: true,
  groundIdentity: identity,
  groundCellIdentity: () => 'c1',
});
const kinds = (meshes: readonly Mesh[]) => new Set(meshes.map((m) => m.name.split(':')[0]));

describe('earth and rubble road cells follow the ground', () => {
  it('lie on the terrain vertex by vertex, as the automatic roads do, on an uneven slope', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene),
        roads = new VillageRoads(scene);
      // A manual earth line and a rubble cell, then an automatic route continuing the line.
      surfaces.update([cell(20, 20), cell(21, 20), cell(22, 20, 'rubble')], space, relief, options());
      roads.update(
        'r',
        [
          {
            id: 'p',
            kind: 'building',
            destination: { cellX: 25, cellY: 20 },
            cells: [
              { cellX: 22, cellY: 20 },
              { cellX: 25, cellY: 20 },
            ],
          },
        ] as never,
        space,
        (c) => ({ code: 1, height: relief(c.cellX, c.cellY) }),
        true,
        'g1',
        () => 'c1',
      );
      // Top surface 1.5 cm above the ground, walls 2.5 cm below it: no tilt plane, no clearance.
      const expected = [mm(TOP - DEPTH), mm(TOP)];
      expect(offsets(surfaces.meshes, space)).toEqual(expected);
      const automatic = scene.meshes.filter((m) => m.name === 'village-road-paved') as Mesh[];
      expect(offsets(automatic, space)).toEqual(expected);
      surfaces.dispose();
      roads.dispose();
    });
  });

  it('draws the curbs of sidewalk cells on the ground too, a few cells at a time', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      surfaces.update(
        [20, 21, 22, 23].map((x) => cell(x, 20, 'rubble', true)),
        space,
        relief,
        options(),
      );
      // The surface is there at once; the curbs wait for their slices.
      expect(kinds(surfaces.meshes)).toEqual(new Set(['infrastructure-rubble']));
      expect(surfaces.pendingCurbs).toBe(4);
      surfaces.settle();
      expect(surfaces.pendingCurbs).toBe(0);
      expect(kinds(surfaces.meshes)).toEqual(new Set(['infrastructure-rubble', 'infrastructure-border']));
      const curbs = surfaces.meshes.filter((m) => m.name.startsWith('infrastructure-border'));
      // Every curb vertex is 4 mm (foot) or 6.4 cm (top) above the ground under it.
      expect(offsets(curbs, space)).toEqual([mm(CURB), mm(CURB + 0.06)]);
      surfaces.dispose();
    });
  });

  it('are not drawn as tiles, and stone cells are not drawn as sectors', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene),
        tiles = new RoadCellTiles(scene);
      const cells = [
        cell(20, 20),
        cell(21, 20, 'stone-1'),
        cell(22, 20, 'rubble', true),
        cell(21, 21, 'stone-2', true),
      ];
      surfaces.update(cells, space, relief, options());
      surfaces.settle();
      tiles.update(cells, space, relief, options());
      expect(tiles.placement(20, 20)).toBeNull();
      expect(tiles.placement(22, 20)).toBeNull();
      // The stone neighbours keep their arms towards the earth and rubble cells.
      expect(tiles.placement(21, 20)).toMatchObject({ tile: 't:stone-1:0' });
      expect(tiles.placement(21, 21)).toMatchObject({ quarterTurns: 3 });
      expect(kinds(surfaces.meshes)).toEqual(
        new Set(['infrastructure-earth', 'infrastructure-rubble', 'infrastructure-border']),
      );
      // A cell restyled from stone to earth leaves the tiles.
      tiles.update([cell(20, 20), cell(21, 20, 'earth'), cell(22, 20, 'rubble', true)], space, relief, options());
      expect(tiles.placement(21, 20)).toBeNull();
      tiles.dispose();
      surfaces.dispose();
    });
  });

  it('rebuild one sector per pose with bounded ground reads, and nothing for an unrelated terrain stroke', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      let bump = 0;
      const ground = (x: number, y: number) => relief(x, y) + (Math.round(x) === 30 && Math.round(y) === 30 ? bump : 0);
      // A dense village: 3 × 3 sectors of earth (24 × 24 cells) with sidewalks on part of them.
      const cells = Array.from({ length: 24 * 24 }, (_, i) =>
        cell(8 + (i % 24), 8 + Math.floor(i / 24), 'earth', i % 5 === 0),
      );
      surfaces.update(cells, space, ground, options('g1'));
      surfaces.settle();
      const before = new Set(surfaces.meshes);
      const mark = () => ({ built: surfaces.stats.sectorsBuilt, reads: surfaces.stats.groundReads });
      const since = (start: { built: number; reads: number }) => ({
        built: surfaces.stats.sectorsBuilt - start.built,
        reads: surfaces.stats.groundReads - start.reads,
      });
      // The same content in a new array and the same ground: nothing is read, nothing rebuilt.
      let start = mark();
      surfaces.update([...cells], space, ground, options('g1'));
      expect(since(start)).toEqual({ built: 0, reads: 0 });
      expect(surfaces.meshes.every((m) => before.has(m))).toBe(true);
      // A terraforming stroke elsewhere: new global ground identity, unchanged identity under the roads.
      start = mark();
      surfaces.update(cells, space, ground, options('g2'));
      expect(since(start)).toEqual({ built: 0, reads: 0 });
      expect(surfaces.meshes.every((m) => before.has(m))).toBe(true);
      // One more cell far from the block: one sector built, and only that one.
      start = mark();
      const placed = [...cells, cell(40, 40, 'earth')];
      surfaces.update(placed, space, ground, options('g2'));
      expect(since(start).built).toBe(1);
      expect(surfaces.meshes.filter((m) => !before.has(m)).map((m) => m.name.split(':')[0])).toEqual([
        'infrastructure-earth',
      ]);
      // A sector's surface reads each point once: at most 33 × 33 quarter-cell positions for 8 × 8 cells.
      expect(since(start).reads).toBeLessThanOrEqual(33 * 33);
      // A cell inside the block restyled: its own sector only, curbs of its sidewalk cells included.
      const restyled = placed.map((c) => (c.cellX === 12 && c.cellY === 12 ? { ...c, surface: 'rubble' as const } : c));
      start = mark();
      surfaces.update(restyled, space, ground, options('g2'));
      expect(since(start).built).toBe(1);
      // A full sector (64 cells, every one connected) reads about 5 000 points, whatever the size of the village.
      expect(since(start).reads).toBeLessThanOrEqual(8 * 33 * 33);
      // Its curbs follow in slices, for the sidewalk cells of that sector only (13 of its 64).
      const pending = surfaces.pendingCurbs;
      expect(pending).toBeGreaterThan(0);
      expect(pending).toBeLessThanOrEqual(64);
      surfaces.settle();
      expect(surfaces.pendingCurbs).toBe(0);
      // A ground change under one cell: the sectors that read it, not the others.
      start = mark();
      bump = 0.5;
      surfaces.update(restyled, space, ground, {
        ...options('g3'),
        groundCellIdentity: (x: number, y: number) => (x === 30 && y === 30 ? 'c2' : 'c1'),
      });
      expect(since(start).built).toBeGreaterThanOrEqual(1);
      expect(since(start).built).toBeLessThanOrEqual(2);
      surfaces.dispose();
    });
  });

  it('builds new sectors late when the update has no time left, but replaces a drawn sector at once', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      // Every call to the clock takes 20 ms: the synchronous budget is spent after the first test.
      let clock = 0;
      const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 20));
      try {
        const cells = [cell(2, 2), cell(10, 2), cell(18, 2)];
        surfaces.update(cells, space, relief, options());
        expect(surfaces.meshes).toHaveLength(0);
        expect(surfaces.pendingSectors).toBe(3);
        surfaces.settle();
        expect(surfaces.pendingSectors).toBe(0);
        expect(surfaces.meshes).toHaveLength(3);
        // A sector that already has its surface is replaced in the same update, never left empty.
        const before = new Set(surfaces.meshes);
        surfaces.update([...cells, cell(3, 2)], space, relief, options());
        expect(surfaces.pendingSectors).toBe(0);
        expect(surfaces.meshes).toHaveLength(3);
        expect(surfaces.meshes.filter((m) => !before.has(m))).toHaveLength(1);
      } finally {
        now.mockRestore();
      }
      surfaces.dispose();
    });
  });

  it('moves with a rebased origin without rebuilding anything', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      const cells = [cell(20, 20), cell(21, 20), cell(22, 20, 'rubble', true)];
      surfaces.update(cells, space, relief, options());
      surfaces.settle();
      const meshes = surfaces.meshes,
        built = surfaces.stats.sectorsBuilt;
      const before = meshes.map((m) => m.position.x);
      space.origin = { cellX: 28, cellY: 20 };
      surfaces.update(cells, space, relief, options());
      expect(surfaces.stats.sectorsBuilt).toBe(built);
      expect(surfaces.meshes).toEqual(meshes);
      // The origin moved 8 cells east: the meshes moved 20 units west.
      expect(surfaces.meshes.map((m) => m.position.x)).toEqual(before.map((x) => x - 20));
      surfaces.dispose();
    });
  });
});
