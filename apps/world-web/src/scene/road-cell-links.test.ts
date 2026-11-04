import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { RoadCellSurface, TravelRoute } from '@arbestra/contracts';
import { NO_ROAD_LINKS, ROAD_SOUTH, ROAD_WEST, roadCellLinks } from './road-cell-links';
import { RoadCellSurfaces } from './road-cell-surfaces';
import { villageRoadDisplayRoutes } from './road-profile';
import { VillageRoads } from './village-roads';
import { WorldSpace } from './world-space';

const world = { widthCells: 64, heightCells: 64 };
const route = (...cells: Array<[number, number]>): TravelRoute =>
  ({
    id: 'r' + cells[0]!.join(','),
    kind: 'building',
    destination: { cellX: cells.at(-1)![0], cellY: cells.at(-1)![1] },
    cells: cells.map(([cellX, cellY]) => ({ cellX, cellY })),
  }) as TravelRoute;
const manual = (cellX: number, cellY: number, surface: RoadCellSurface = 'earth') => ({
  cellX,
  cellY,
  surface,
  sidewalks: false,
});
const relief = (x: number, y: number) => 0.3 * x + 0.2 * y + 0.2 * Math.sin(x * 2.1) * Math.cos(y * 1.7);
const options = { followTerrain: true, groundIdentity: 'g', groundCellIdentity: () => 'c' };

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
/** The ground (x, z) triangles of the meshes: what is painted, seen from above. */
function triangles(meshes: readonly Mesh[]) {
  const out: number[][] = [];
  for (const mesh of meshes) {
    const p = mesh.getVerticesData('position')!,
      ix = mesh.getIndices()!;
    for (let i = 0; i < ix.length; i += 3) {
      const [a, b, c] = [ix[i]!, ix[i + 1]!, ix[i + 2]!];
      out.push([p[a * 3]!, p[a * 3 + 2]!, p[b * 3]!, p[b * 3 + 2]!, p[c * 3]!, p[c * 3 + 2]!]);
    }
  }
  return out;
}
const inside = (t: number[], x: number, z: number) => {
  const side = (ax: number, az: number, bx: number, bz: number) => (bx - ax) * (z - az) - (bz - az) * (x - ax);
  const d = [side(t[0]!, t[1]!, t[2]!, t[3]!), side(t[2]!, t[3]!, t[4]!, t[5]!), side(t[4]!, t[5]!, t[0]!, t[1]!)];
  return d.every((v) => v >= -1e-9) || d.every((v) => v <= 1e-9);
};
/** Cell-coordinate points along a polyline, every 0.04 cell. */
function along(points: Array<[number, number]>) {
  const out: Array<[number, number]> = [];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!,
      [x1, y1] = points[i]!,
      n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.04);
    for (let k = 0; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}

/** The scene's own wiring: displayed automatic roads, plus the junctions when asked. */
function draw(scene: Scene, routes: TravelRoute[], roadCells: ReturnType<typeof manual>[], linked: boolean) {
  const space = new WorldSpace(64, 64, { cellX: 20, cellY: 20 }),
    state = { travelRoutes: routes, cells: [], world, roadCells } as never;
  const links = linked ? roadCellLinks(state) : NO_ROAD_LINKS;
  const roads = new VillageRoads(scene),
    surfaces = new RoadCellSurfaces(scene);
  roads.update(
    'k',
    villageRoadDisplayRoutes(state),
    space,
    (c) => ({ code: 1, height: relief(c.cellX, c.cellY) }),
    true,
    'g',
    () => 'c',
    links.stubs,
  );
  surfaces.update(roadCells, space, relief, { ...options, links: links.masks });
  surfaces.settle();
  const automatic = scene.meshes.filter((m) => m.name === 'village-road-paved') as Mesh[];
  const tris = triangles([...automatic, ...surfaces.meshes]);
  const toWorld = (cx: number, cy: number) =>
    [(cx - space.origin.cellX) * 2.5, (cy - space.origin.cellY) * 2.5] as const;
  const covered = (cx: number, cy: number) => {
    const [x, z] = toWorld(cx, cy);
    return tris.some((t) => inside(t, x, z));
  };
  /** World-x extent, in cells, of the surface meshes of one cell row. */
  const reach = () => {
    const xs = triangles(surfaces.meshes).flatMap((t) => [t[0]!, t[2]!, t[4]!]);
    return [Math.min(...xs) / 2.5 + space.origin.cellX, Math.max(...xs) / 2.5 + space.origin.cellX] as const;
  };
  return { links, covered, reach, dispose: () => [roads, surfaces].forEach((x) => x.dispose()) };
}
const gaps = (covered: (x: number, y: number) => boolean, path: Array<[number, number]>) =>
  along(path).filter(([x, y]) => !covered(x, y));

describe('a hand-drawn road cell next to an automatic road', () => {
  // Reproduction of the staging report: before the junction arms, the automatic road stopped at the centre of its
  // last cell, the road cell opened no arm towards it, and the two did not meet.
  it('leaves a hole in a straight line without the junction arms, and none with them', () => {
    withScene((scene) => {
      const path: Array<[number, number]> = [
        [8, 30],
        [14, 30],
      ];
      const routes = [route([8, 30], [9, 30], [10, 30], [11, 30], [12, 30], [13, 30], [14, 30])],
        cells = [manual(11, 30)];
      const without = draw(scene, routes, cells, false);
      expect(gaps(without.covered, path).length).toBeGreaterThan(20);
      without.dispose();
      const linked = draw(scene, routes, cells, true);
      expect(linked.links.masks.get('11:30')).toBe(5);
      expect(linked.links.stubs).toHaveLength(2);
      expect(gaps(linked.covered, path)).toEqual([]);
      linked.dispose();
    });
  });

  it('meets an automatic road at an elbow, the manual cell opening its two arms', () => {
    withScene((scene) => {
      const routes = [route([8, 30], [9, 30], [10, 30], [11, 30], [11, 31], [11, 32], [11, 33])],
        cells = [manual(11, 30, 'rubble')],
        path: Array<[number, number]> = [
          [8, 30],
          [11, 30],
          [11, 33],
        ];
      const without = draw(scene, routes, cells, false);
      expect(gaps(without.covered, path).length).toBeGreaterThan(20);
      without.dispose();
      const linked = draw(scene, routes, cells, true);
      expect(linked.links.masks.get('11:30')).toBe(ROAD_WEST | ROAD_SOUTH);
      expect(gaps(linked.covered, path)).toEqual([]);
      linked.dispose();
    });
  });

  it('opens the arms of a stone cell too, and does not link a road that only passes by', () => {
    withScene((scene) => {
      const routes = [route([8, 30], [9, 30], [10, 30], [11, 30], [12, 30])];
      // Stone paving has joints, so what is checked is how far the tile reaches: the edges of its cell, both sides.
      const without = draw(scene, routes, [manual(11, 30, 'stone-1')], false),
        [west0, east0] = without.reach();
      without.dispose();
      expect(east0 - west0).toBeLessThan(0.8);
      const stone = draw(scene, routes, [manual(11, 30, 'stone-1')], true),
        [west, east] = stone.reach();
      expect(west).toBeCloseTo(10.5, 1);
      expect(east).toBeCloseTo(11.5, 1);
      stone.dispose();
      // A manual cell beside the route, not on it: no junction.
      const beside = draw(scene, routes, [manual(10, 31)], true);
      expect(beside.links.masks.size).toBe(0);
      expect(beside.links.stubs).toHaveLength(0);
      beside.dispose();
    });
  });
});
