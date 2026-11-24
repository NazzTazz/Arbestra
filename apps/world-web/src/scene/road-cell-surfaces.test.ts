import { describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { triangleHeight, type RoadCellSurface } from '@arbestra/contracts';
import { ROAD_EAST, ROAD_WEST } from './road-cell-links';
import { RoadCellSurfaces, STONE_CLEARANCE } from './road-cell-surfaces';
import { roadTileGeometry } from './road-cell-tiles';
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
/**
 * The rendered terrain: shared vertices, two planar triangles per cell split along the diagonal 00 -> 11
 * (`triangleHeight`, as `buildRc1TerrainUnit` and `TerrainStore.ground`), with a twist of up to half a unit per cell.
 */
const vertexHeight = (i: number, j: number) =>
  0.5 * Math.sin(i * 2.1 + j * 0.7) + 0.45 * Math.cos(j * 1.9 - i * 0.4) + 0.3 * i;
const terrain = (x: number, y: number) => {
  const a = x + 0.5,
    b = y + 0.5,
    i = Math.floor(a),
    j = Math.floor(b);
  return triangleHeight(
    vertexHeight(i, j),
    vertexHeight(i + 1, j),
    vertexHeight(i + 1, j + 1),
    vertexHeight(i, j + 1),
    a - i,
    b - j,
  );
};
const TOP = 0.015,
  DEPTH = 0.025,
  CURB = 0.004;
const mm = (value: number) => Math.round(value * 1000) / 1000;

/** Plus petite et plus grande hauteur des sommets d'un maillage au-dessus du relief qui est dessous, au millimètre. */
function offsets(meshes: readonly Mesh[], space: WorldSpace, ground = relief) {
  const found = new Set<number>();
  for (const mesh of meshes) {
    const p = mesh.getVerticesData('position')!;
    for (let i = 0; i < p.length; i += 3) {
      const cx = space.origin.cellX + p[i]! / 2.5,
        cy = space.origin.cellY + p[i + 2]! / 2.5;
      found.add(mm(p[i + 1]! - ground(cx, cy)));
    }
  }
  // Diagonal faces of the walls, cut at mid-height, give the values in between: the extremes are what is checked.
  return [Math.min(...found), Math.max(...found)];
}
const options = (identity = 'g1') => ({
  followTerrain: true,
  groundIdentity: identity,
  groundCellIdentity: () => 'c1',
});
const kinds = (meshes: readonly Mesh[]) => new Set(meshes.map((m) => m.name.split(':')[0]));
const named = (meshes: readonly Mesh[], prefix: string) => meshes.filter((m) => m.name.startsWith(prefix));

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
        terrain,
        options(),
      );
      // The surface is there at once; the curbs wait for their slices.
      expect(kinds(surfaces.meshes)).toEqual(new Set(['infrastructure-rubble']));
      expect(surfaces.pendingJobs).toBe(4);
      surfaces.settle();
      expect(surfaces.pendingJobs).toBe(0);
      expect(kinds(surfaces.meshes)).toEqual(new Set(['infrastructure-rubble', 'infrastructure-border']));
      // Every curb vertex is 4 mm (foot) or 6.4 cm (top) above the ground under it.
      expect(offsets(named(surfaces.meshes, 'infrastructure-border'), space, terrain)).toEqual([
        mm(CURB),
        mm(CURB + 0.06),
      ]);
      surfaces.dispose();
    });
  });
});

describe('stone road cells follow the ground too', () => {
  it('lie on the terrain vertex by vertex, paving and sidewalks, with the clearance they always had', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      const line = [
        ...[20, 21, 22].map((x) => cell(x, 20, 'stone-1', true)),
        ...[20, 21, 22].map((x) => cell(x, 22, 'stone-2', false)),
        cell(22, 21, 'stone-2'),
      ];
      surfaces.update(line, space, terrain, options());
      surfaces.settle();
      expect(kinds(surfaces.meshes)).toEqual(
        new Set(['infrastructure-stone-1', 'infrastructure-stone-2', 'infrastructure-border']),
      );
      // Pavers are 4 cm thick and top out 3 mm above the ground (+ clearance); curbs 4 mm to 6.4 cm.
      const top = 0.003 + STONE_CLEARANCE;
      for (const code of ['infrastructure-stone-1', 'infrastructure-stone-2'])
        expect(offsets(named(surfaces.meshes, code), space, terrain)).toEqual([mm(top - 0.04), mm(top)]);
      expect(offsets(named(surfaces.meshes, 'infrastructure-border'), space, terrain)).toEqual([
        mm(CURB + STONE_CLEARANCE),
        mm(CURB + 0.06 + STONE_CLEARANCE),
      ]);
      surfaces.dispose();
    });
  });

  it('is made of faces that each lie in one terrain triangle, so none leaves a gap or lets the ground through', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      // A road down a twisted slope, with sidewalks, turns and a crossing, in both paving.
      const cells = [
        ...[20, 21, 22, 23, 24].map((x) => cell(x, 20, 'stone-2', true)),
        ...[21, 22, 23].map((y) => cell(22, 20 + y - 20, 'stone-2', true)),
        ...[20, 21, 22, 23, 24].map((x) => cell(x, 25, 'stone-1', true)),
        cell(22, 24, 'stone-1', true),
        cell(22, 26, 'stone-1', true),
      ];
      surfaces.update(cells, space, terrain, options());
      surfaces.settle();
      let tops = 0,
        worst = Infinity,
        highest = -Infinity;
      for (const mesh of surfaces.meshes.filter((m) => !m.name.startsWith('infrastructure-border'))) {
        const p = mesh.getVerticesData('position')!,
          ix = mesh.getIndices()!;
        const world = (v: number) =>
          [space.origin.cellX + p[v * 3]! / 2.5, p[v * 3 + 1]!, space.origin.cellY + p[v * 3 + 2]! / 2.5] as const;
        for (let t = 0; t < ix.length; t += 3) {
          const [a, b, c] = [world(ix[t]!), world(ix[t + 1]!), world(ix[t + 2]!)];
          // Each face lies in one terrain triangle: all its vertices on one side of the cell diagonal.
          const sides = [a, b, c].map(([x, , y]) => {
            const dx = x - Math.round(x),
              dy = y - Math.round(y);
            return Math.abs(dx - dy) < 1e-6 ? 0 : Math.sign(dx - dy);
          });
          expect(sides.every((v) => v >= 0) || sides.every((v) => v <= 0)).toBe(true);
          // Faces turned up: the surface is above the terrain at every point of the face, by the paving's own margin.
          // Faces turned up, by their normal.
          if (mesh.getVerticesData('normal')![ix[t]! * 3 + 1]! <= 0.5) continue;
          tops++;
          for (const [u, v, w] of [
            [1 / 3, 1 / 3, 1 / 3],
            [0.6, 0.2, 0.2],
            [0.2, 0.6, 0.2],
            [0.2, 0.2, 0.6],
            [0.5, 0.5, 0],
            [0, 0.5, 0.5],
          ] as const) {
            const x = a[0] * u + b[0] * v + c[0] * w,
              y = a[2] * u + b[2] * v + c[2] * w,
              height = a[1] * u + b[1] * v + c[1] * w;
            worst = Math.min(worst, height - terrain(x, y));
            highest = Math.max(highest, height - terrain(x, y));
          }
        }
      }
      expect(tops).toBeGreaterThan(100);
      // The paving tops lie 3 mm over the ground, plus the 2 cm clearance: never under it, never apart from it.
      expect(worst).toBeGreaterThanOrEqual(0.003 + STONE_CLEARANCE - 1e-6);
      // ...and never apart from it: the tops of neighbouring blocks, all at that margin, meet without a step.
      expect(highest - worst).toBeLessThan(1e-6);
      surfaces.dispose();
    });
  });

  it('is the flat tile, as drawn before, on flat ground, whatever its quarter turns', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      // Two cells in a column: each is a straight tile turned one quarter (north-south), an `end` at the top.
      surfaces.update([cell(20, 20, 'stone-1', true), cell(20, 21, 'stone-1', true)], space, () => 1, options());
      surfaces.settle();
      const end = roadTileGeometry('end', 'stone-1', true),
        centre = space.project({ cellX: 20, cellY: 20 });
      const baked = surfaces.meshes.filter((m) => m.name.startsWith('infrastructure-stone-1'));
      expect(baked).toHaveLength(1);
      // The end tile (arm east) turned to south: (x, z) -> (-z, x); same heights as the flat tile, 1 m + clearance.
      const found = new Set<string>();
      const p = baked[0]!.getVerticesData('position')!;
      for (let i = 0; i < p.length; i += 3)
        found.add([p[i], p[i + 1], p[i + 2]].map((v) => Math.round(v! * 1e4)).join());
      const t = end.pavement!.positions!;
      let matched = 0;
      for (let i = 0; i < t.length; i += 3) {
        const key = [centre.x - t[i + 2]!, t[i + 1]! + 1 + STONE_CLEARANCE, centre.z + t[i]!]
          .map((v) => Math.round(v * 1e4))
          .join();
        if (found.has(key)) matched++;
      }
      expect(matched).toBe(t.length / 3);
      surfaces.dispose();
    });
  });

  it('turns its arms towards the neighbouring cells, across the toric seam', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 0, cellY: 5 }),
        surfaces = new RoadCellSurfaces(scene);
      // An elbow at (0, 5) whose arms go west across the seam and south.
      surfaces.update(
        [cell(63, 5, 'stone-1'), cell(0, 5, 'stone-1'), cell(0, 6, 'stone-1')],
        space,
        () => 0,
        options(),
      );
      surfaces.settle();
      const xs: number[] = [],
        zs: number[] = [];
      for (const mesh of surfaces.meshes) {
        const p = mesh.getVerticesData('position')!;
        for (let i = 0; i < p.length; i += 3) {
          xs.push(p[i]!);
          zs.push(p[i + 2]!);
        }
      }
      // The cell across the seam stands one cell west of the origin; the south cell one cell south.
      expect(Math.min(...xs)).toBeCloseTo(-2.5 - 0.625, 1);
      expect(Math.max(...xs)).toBeLessThan(0.7);
      expect(Math.max(...zs)).toBeCloseTo(2.5 + 0.625, 1);
      expect(Math.min(...zs)).toBeGreaterThan(-0.7);
      surfaces.dispose();
    });
  });

  it('keeps the old surface until the new one is complete, then swaps it', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      const line = [20, 21, 22].map((x) => cell(x, 20, 'stone-1', true));
      surfaces.update(line, space, relief, options());
      surfaces.settle();
      const before = surfaces.meshes;
      expect(before.length).toBeGreaterThan(0);
      surfaces.update([...line, cell(23, 20, 'stone-1', true)], space, relief, options());
      // The new cell and its neighbour are not drawn yet: nothing has been taken away meanwhile.
      expect(surfaces.pendingJobs).toBe(4);
      expect(surfaces.meshes).toEqual(before);
      expect(before.every((m) => !m.isDisposed())).toBe(true);
      surfaces.settle();
      expect(surfaces.pendingJobs).toBe(0);
      expect(before.every((m) => m.isDisposed())).toBe(true);
      expect(surfaces.meshes.length).toBeGreaterThan(0);
      surfaces.dispose();
    });
  });
});

describe('road cell sectors', () => {
  it('redo one sector per pose with bounded ground reads, and nothing for an unrelated terrain stroke', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      let bump = 0;
      const ground = (x: number, y: number) => relief(x, y) + (Math.round(x) === 30 && Math.round(y) === 30 ? bump : 0);
      // A dense village: 3 × 3 sectors of earth, a sixth of it stone, with sidewalks on part of them.
      const surface = (i: number): RoadCellSurface => (i % 6 === 0 ? 'stone-1' : 'earth');
      const cells = Array.from({ length: 24 * 24 }, (_, i) =>
        cell(8 + (i % 24), 8 + Math.floor(i / 24), surface(i), i % 5 === 0),
      );
      surfaces.update(cells, space, ground, options('g1'));
      surfaces.settle();
      const before = new Set(surfaces.meshes);
      const mark = () => ({ built: surfaces.stats.sectorsBuilt, reads: surfaces.stats.groundReads });
      const since = (start: { built: number; reads: number }) => ({
        built: surfaces.stats.sectorsBuilt - start.built,
        reads: surfaces.stats.groundReads - start.reads,
      });
      // The same content in a new array and the same ground: nothing is read, nothing is redone.
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
      // A cell inside the block restyled: its own sector only (a full sector of 64 cells reads about 5 000 points).
      const restyled = placed.map((c) => (c.cellX === 12 && c.cellY === 12 ? { ...c, surface: 'rubble' as const } : c));
      start = mark();
      surfaces.update(restyled, space, ground, options('g2'));
      expect(since(start).built).toBe(1);
      expect(since(start).reads).toBeLessThanOrEqual(8 * 33 * 33);
      // Its curbs and stone follow in slices, for the cells of that sector only.
      const pending = surfaces.pendingJobs;
      expect(pending).toBeGreaterThan(0);
      expect(pending).toBeLessThanOrEqual(64);
      surfaces.settle();
      expect(surfaces.pendingJobs).toBe(0);
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

  it('moves with a rebased origin without redoing anything', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      const cells = [cell(20, 20), cell(21, 20), cell(22, 20, 'rubble', true), cell(23, 20, 'stone-2')];
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

type Vertex = readonly [number, number, number];
/** The triangles of the meshes in world coordinates, with whether each looks up (by its first vertex's normal). */
function faces(meshes: readonly Mesh[]) {
  const out: Array<{ p: readonly [Vertex, Vertex, Vertex]; up: boolean }> = [];
  for (const mesh of meshes) {
    const position = mesh.getVerticesData('position')!,
      normal = mesh.getVerticesData('normal')!,
      index = mesh.getIndices()!;
    const at = (v: number): Vertex => [
      position[v * 3]! + mesh.position.x,
      position[v * 3 + 1]!,
      position[v * 3 + 2]! + mesh.position.z,
    ];
    for (let t = 0; t < index.length; t += 3)
      out.push({
        p: [at(index[t]!), at(index[t + 1]!), at(index[t + 2]!)],
        up: normal[index[t]! * 3 + 1]! > 0.5,
      });
  }
  return out;
}
/** How many faces looking up cover the point `(dx, dy)` cells from the origin (a point off every edge counts once). */
function covering(meshes: readonly Mesh[], dx: number, dy: number) {
  const x = dx * 2.5,
    z = dy * 2.5;
  let count = 0;
  for (const { p, up } of faces(meshes)) {
    if (!up) continue;
    const [[ax, , az], [bx, , bz], [cx, , cz]] = p;
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det,
      v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    if (u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9) count++;
  }
  return count;
}
const covered = (meshes: readonly Mesh[], dx: number, dy: number) => covering(meshes, dx, dy) > 0;
/** The surfaces of `cells`, everything built; `space.origin` is (20, 20) unless given. */
function drawn(
  scene: Scene,
  cells: ReadonlyArray<ReturnType<typeof cell>>,
  origin = { cellX: 20, cellY: 20 },
  extra: { links?: ReadonlyMap<string, number>; followTerrain?: boolean } = {},
  ground = relief,
) {
  const space = new WorldSpace(64, 64, origin),
    surfaces = new RoadCellSurfaces(scene);
  surfaces.update(cells, space, ground, { ...options(), ...extra });
  surfaces.settle();
  return { space, surfaces };
}

describe('road cells that touch only by a corner', () => {
  // The corner shared by the cells (20, 20) and (21, 21) is 0.5 cell from the origin cell, both ways.
  it('are joined by a band as wide as the centre path, centre to centre, in both diagonals and either order', () => {
    withScene((scene) => {
      // Down-right (the band follows x = z) and down-left (x + z = 1), each cell list in both orders.
      const diagonals = [
        {
          cells: [cell(20, 20), cell(21, 21)],
          along: [
            [0.3, 0.3],
            [0.7, 0.7],
            [0.6, 0.4],
            [0.4, 0.6],
          ],
          off: [
            [0.75, 0.25],
            [0.25, 0.75],
          ],
        },
        {
          cells: [cell(21, 20), cell(20, 21)],
          along: [
            [0.7, 0.3],
            [0.3, 0.7],
            [0.6, 0.6],
            [0.4, 0.4],
          ],
          off: [
            [0.25, 0.25],
            [0.75, 0.75],
          ],
        },
      ] as const;
      for (const { cells, along, off } of diagonals)
        for (const list of [cells, [...cells].reverse()]) {
          const { surfaces } = drawn(scene, list);
          const meshes = surfaces.meshes;
          // The corner and the diagonal between the centre squares (a quarter cell from each centre) are paved...
          expect(covered(meshes, 0.5, 0.5)).toBe(true);
          for (const [x, y] of along) expect(covered(meshes, x!, y!)).toBe(true);
          // ... over half a cell across, not more: 0.35 cell off the diagonal there is nothing.
          for (const [x, y] of off) expect(covered(meshes, x!, y!)).toBe(false);
          surfaces.dispose();
        }
    });
  });

  it('are not joined when a third cell makes the bend, whichever it is', () => {
    withScene((scene) => {
      for (const third of [cell(20, 21), cell(21, 20)]) {
        const { surfaces } = drawn(scene, [cell(20, 20), cell(21, 21), third]);
        expect(covered(surfaces.meshes, 0.5, 0.5)).toBe(false);
        expect(covered(surfaces.meshes, 0.3, 0.3)).toBe(false);
        surfaces.dispose();
      }
      // The same two cells alone are joined.
      const { surfaces } = drawn(scene, [cell(20, 20), cell(21, 21)]);
      expect(covered(surfaces.meshes, 0.3, 0.3)).toBe(true);
      surfaces.dispose();
    });
  });

  it('are not joined when an automatic road reaches one of them from a flanking cell, and are when it does not', () => {
    withScene((scene) => {
      const pair = [cell(20, 20), cell(21, 21)];
      // East of (20, 20) is the flanking cell (21, 20): an automatic road there makes the bend.
      let drawing = drawn(scene, pair, undefined, { links: new Map([['20:20', ROAD_EAST]]) });
      expect(covered(drawing.surfaces.meshes, 0.5, 0.5)).toBe(false);
      drawing.surfaces.dispose();
      // West of it is not a flanking cell.
      drawing = drawn(scene, pair, undefined, { links: new Map([['20:20', ROAD_WEST]]) });
      expect(covered(drawing.surfaces.meshes, 0.5, 0.5)).toBe(true);
      drawing.surfaces.dispose();
    });
  });

  it('are joined across the toric seam, in x, in y and in both', () => {
    withScene((scene) => {
      const cases: Array<[Array<ReturnType<typeof cell>>, { cellX: number; cellY: number }, number, number]> = [
        // Down-right across the east seam: the corner is at (63.5, 10.5).
        [[cell(63, 10), cell(0, 11)], { cellX: 60, cellY: 8 }, 3.5, 2.5],
        // Down-left across the same seam, from the other side.
        [[cell(0, 10), cell(63, 11)], { cellX: 60, cellY: 8 }, 3.5, 2.5],
        // Across the south seam: the corner is at (10.5, 63.5).
        [[cell(10, 63), cell(11, 0)], { cellX: 8, cellY: 60 }, 2.5, 3.5],
        // Across both.
        [[cell(63, 63), cell(0, 0)], { cellX: 60, cellY: 60 }, 3.5, 3.5],
        [[cell(0, 63), cell(63, 0)], { cellX: 60, cellY: 60 }, 3.5, 3.5],
      ];
      for (const [cells, origin, x, y] of cases) {
        const { surfaces } = drawn(scene, cells, origin);
        expect(covered(surfaces.meshes, x, y)).toBe(true);
        // Each way along the band, still within the cells' quarter-cell reach of the corner.
        expect(covered(surfaces.meshes, x - 0.1, y - 0.1) || covered(surfaces.meshes, x - 0.1, y + 0.1)).toBe(true);
        surfaces.dispose();
      }
      // A mesh per sector that holds some of it: here the two cells' and the flanking cells' sectors.
      const { surfaces } = drawn(scene, [cell(63, 63), cell(0, 0)], { cellX: 60, cellY: 60 });
      expect(surfaces.meshes.map((m) => m.name).sort()).toEqual([
        'infrastructure-earth:0:0',
        'infrastructure-earth:0:7',
        'infrastructure-earth:7:0',
        'infrastructure-earth:7:7',
      ]);
      surfaces.dispose();
    });
  });

  it('draws its part in a neighbouring sector that holds no road cell, where four sectors meet', () => {
    withScene((scene) => {
      // (7, 7) and (8, 8) are in two sectors; their flanking cells (8, 7) and (7, 8), in the two others, have no road.
      const { surfaces } = drawn(scene, [cell(7, 7), cell(8, 8)], { cellX: 4, cellY: 4 });
      expect(surfaces.meshes.map((m) => m.name).sort()).toEqual([
        'infrastructure-earth:0:0',
        'infrastructure-earth:0:1',
        'infrastructure-earth:1:0',
        'infrastructure-earth:1:1',
      ]);
      // The corner is in (8, 7) as well as the three other cells; a point of the band inside each flanking cell.
      for (const [x, y] of [
        [3.6, 3.4],
        [3.4, 3.6],
      ] as const)
        expect(covering(surfaces.meshes, x, y)).toBe(1);
      surfaces.dispose();
    });
  });

  it('rebuilds exactly the sectors it touches when it appears or goes, and none other', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      const far = [cell(40, 40), cell(12, 52)];
      surfaces.update([cell(23, 23), ...far], space, relief, options());
      surfaces.settle();
      const before = new Set(surfaces.meshes),
        farMeshes = surfaces.meshes.filter((m) => m.name.endsWith(':5:5') || m.name.endsWith(':1:6'));
      expect(farMeshes).toHaveLength(2);
      const built = () => surfaces.stats.sectorsBuilt;
      // (24, 24) joins (23, 23) at a corner shared by four sectors: those four are redone, the far ones are not.
      let start = built();
      surfaces.update([cell(23, 23), cell(24, 24), ...far], space, relief, options());
      surfaces.settle();
      expect(built() - start).toBe(4);
      expect(farMeshes.every((m) => !m.isDisposed() && before.has(m))).toBe(true);
      expect(covered(surfaces.meshes, 3.5, 3.5)).toBe(true);
      // The same cells in a new list: nothing is redone, the joint is part of the signature of its sectors.
      start = built();
      surfaces.update([cell(23, 23), cell(24, 24), ...far], space, relief, options());
      expect(built() - start).toBe(0);
      // A cell that makes the bend takes the joint away: the same four sectors are looked at, three are redone, and
      // the fourth (x 16-23, y 24-31), which held only a corner of the joint, has nothing left to draw.
      const corner = surfaces.meshes.find((m) => m.name.endsWith(':2:3'))!;
      expect(corner).toBeDefined();
      start = built();
      surfaces.update([cell(23, 23), cell(24, 24), cell(24, 23), ...far], space, relief, options());
      surfaces.settle();
      expect(built() - start).toBe(3);
      expect(corner.isDisposed()).toBe(true);
      expect(surfaces.meshes.some((m) => m.name.endsWith(':2:3'))).toBe(false);
      expect(farMeshes.every((m) => !m.isDisposed() && before.has(m))).toBe(true);
      expect(covered(surfaces.meshes, 3.5, 3.5)).toBe(false);
      // Removing the pair altogether leaves the sectors empty of it.
      start = built();
      surfaces.update([cell(23, 23), ...far], space, relief, options());
      surfaces.settle();
      expect(built() - start).toBeLessThanOrEqual(4);
      expect(covered(surfaces.meshes, 3.5, 3.5)).toBe(false);
      expect(farMeshes.every((m) => !m.isDisposed())).toBe(true);
      surfaces.dispose();
    });
  });

  it('redoes a single sector when the pair and its corner lie inside it', () => {
    withScene((scene) => {
      const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
        surfaces = new RoadCellSurfaces(scene);
      const others = [cell(40, 40), cell(12, 52), cell(30, 12)];
      surfaces.update([cell(10, 10), ...others], space, relief, options());
      surfaces.settle();
      const before = new Set(surfaces.meshes),
        start = surfaces.stats.sectorsBuilt;
      surfaces.update([cell(10, 10), cell(11, 11), ...others], space, relief, options());
      surfaces.settle();
      expect(surfaces.stats.sectorsBuilt - start).toBe(1);
      expect(surfaces.meshes.filter((m) => !before.has(m)).map((m) => m.name)).toEqual(['infrastructure-earth:1:1']);
      // The corner is at (10.5, 10.5): -9.5 cells from the origin.
      expect(covered(surfaces.meshes, -9.5, -9.5)).toBe(true);
      surfaces.dispose();
    });
  });

  it('takes the humbler surface of its two cells, in either order', () => {
    withScene((scene) => {
      const expectations: Array<[RoadCellSurface, RoadCellSurface, string]> = [
        ['earth', 'stone-1', 'infrastructure-earth'],
        ['stone-2', 'rubble', 'infrastructure-rubble'],
        ['earth', 'rubble', 'infrastructure-earth'],
        ['rubble', 'earth', 'infrastructure-earth'],
        ['stone-2', 'stone-1', 'infrastructure-stone-1'],
        ['stone-1', 'stone-2', 'infrastructure-stone-1'],
        ['stone-2', 'stone-2', 'infrastructure-stone-2'],
        ['rubble', 'rubble', 'infrastructure-rubble'],
      ];
      for (const [a, b, expected] of expectations) {
        const { surfaces } = drawn(scene, [cell(20, 20, a), cell(21, 21, b)]);
        // The corner and a point of the band in each cell's own cell, outside both centre squares.
        for (const [x, y] of [
          [0.5, 0.5],
          [0.3, 0.3],
          [0.7, 0.7],
        ] as const) {
          const owners = [...kinds(surfaces.meshes)].filter((kind) => covered(named(surfaces.meshes, kind!), x, y));
          expect(owners).toEqual([expected]);
        }
        surfaces.dispose();
      }
    });
  });

  it('gives a pixel two bands meet on to the humbler of them, whichever sector reads it', () => {
    withScene((scene) => {
      // Stone-1 (20, 20) and earth (22, 20) both join the rubble cell (21, 21): the rubble-and-stone band is rubble,
      // the earth-and-rubble band is earth, and they share pixels in the north mouth of the rubble cell.
      const { surfaces } = drawn(scene, [cell(20, 20, 'stone-1'), cell(21, 21, 'rubble'), cell(22, 20, 'earth')]);
      // The centre of that pixel, a sixteenth of a cell either side of the rubble cell's north-south axis.
      const x = 1 + 0.5 / 16,
        y = 1 - 4.5 / 16;
      expect(covered(named(surfaces.meshes, 'infrastructure-earth'), x, y)).toBe(true);
      expect(covered(named(surfaces.meshes, 'infrastructure-rubble'), x, y)).toBe(false);
      surfaces.dispose();
    });
  });

  describe('of stone', () => {
    // A zigzag of stone, with sidewalks: (20, 20) -> (21, 21) -> (22, 20), on the twisted terrain.
    const zigzag = [cell(20, 20, 'stone-1', true), cell(21, 21, 'stone-1', true), cell(22, 20, 'stone-1', true)];

    it('is a job of the sector of its upper cell, drawn with the tiles, once settled', () => {
      withScene((scene) => {
        const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
          surfaces = new RoadCellSurfaces(scene);
        surfaces.update(zigzag, space, terrain, options());
        // Three tiles and two joints.
        expect(surfaces.pendingJobs).toBe(5);
        surfaces.settle();
        expect(surfaces.pendingJobs).toBe(0);
        expect(kinds(surfaces.meshes)).toEqual(new Set(['infrastructure-stone-1', 'infrastructure-border']));
        const stone = named(surfaces.meshes, 'infrastructure-stone-1');
        // Both corners and the middle of each band are paved, over one face each, so nothing is laid twice.
        for (const [x, y] of [
          [0.45, 0.52],
          [0.3, 0.33],
          [0.7, 0.66],
          [1.55, 0.52],
          [1.3, 0.66],
          [1.7, 0.33],
        ] as const)
          expect(covering(stone, x, y)).toBe(1);
        // The tile's own centre square is not covered twice either (the band stops at its edge).
        expect(covering(stone, 0.1, 0.05)).toBe(1);
        expect(covering(stone, 1.1, 1.05)).toBe(1);
        surfaces.dispose();
      });
    });

    it('lies on the terrain with the pavers, each face in one terrain triangle, outwards and up', () => {
      withScene((scene) => {
        const { space, surfaces } = drawn(scene, zigzag, undefined, {}, terrain);
        const stone = named(surfaces.meshes, 'infrastructure-stone-1');
        // Pavers' heights: the band tops at the pavers' top and its skirt reaches their foot, nothing beyond.
        const top = 0.003 + STONE_CLEARANCE;
        expect(offsets(stone, space, terrain)).toEqual([mm(top - 0.04), mm(top)]);
        let tops = 0,
          lowest = Infinity,
          highest = -Infinity;
        for (const mesh of stone) {
          const p = mesh.getVerticesData('position')!,
            n = mesh.getVerticesData('normal')!,
            ix = mesh.getIndices()!;
          const at = (v: number) =>
            [space.origin.cellX + p[v * 3]! / 2.5, p[v * 3 + 1]!, space.origin.cellY + p[v * 3 + 2]! / 2.5] as const;
          for (let t = 0; t < ix.length; t += 3) {
            const [a, b, c] = [at(ix[t]!), at(ix[t + 1]!), at(ix[t + 2]!)];
            // Each face lies on one side of the diagonal of its own cell (the one under its middle), as the tile faces
            // do: a vertex on a cell edge is in both cells, so the cell is the one of the middle.
            const cx = Math.round((a[0] + b[0] + c[0]) / 3),
              cy = Math.round((a[2] + b[2] + c[2]) / 3);
            const sides = [a, b, c].map(([x, , y]) => {
              const d = x - cx - (y - cy);
              return Math.abs(d) < 1e-6 ? 0 : Math.sign(d);
            });
            expect(sides.every((v) => v >= 0) || sides.every((v) => v <= 0)).toBe(true);
            // The face turns the way its stored normal says (Babylon's winding): up for a top, out for a skirt.
            const ab = [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
              cb = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
            // Distances here are in cells in x and z, in units in y: the sign is what matters.
            const cross = [
              ab[1]! * cb[2]! - ab[2]! * cb[1]!,
              ab[2]! * cb[0]! - ab[0]! * cb[2]!,
              ab[0]! * cb[1]! - ab[1]! * cb[0]!,
            ];
            const v = ix[t]! * 3;
            expect(cross[0]! * n[v]! + cross[1]! * n[v + 1]! + cross[2]! * n[v + 2]!).toBeGreaterThanOrEqual(-1e-9);
            if (n[v + 1]! <= 0.5) continue;
            tops++;
            // The face's middle is at the same margin over the terrain as every other top.
            const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3] as const;
            const gap = mid[1] - terrain(mid[0], mid[2]);
            lowest = Math.min(lowest, gap);
            highest = Math.max(highest, gap);
          }
        }
        expect(tops).toBeGreaterThan(100);
        expect(lowest).toBeGreaterThanOrEqual(top - 1e-6);
        expect(highest - lowest).toBeLessThan(1e-6);
        surfaces.dispose();
      });
    });

    it('does not follow the terrain when asked not to: the band slopes between its two cells', () => {
      withScene((scene) => {
        const { surfaces } = drawn(scene, zigzag, undefined, { followTerrain: false });
        const stone = named(surfaces.meshes, 'infrastructure-stone-1');
        expect(covering(stone, 0.45, 0.52)).toBe(1);
        const heights = faces(stone).flatMap((f) => f.p.map((v) => v[1]));
        expect(heights.every(Number.isFinite)).toBe(true);
        surfaces.dispose();
      });
    });
  });
});
