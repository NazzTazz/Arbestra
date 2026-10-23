import { expect, it } from 'vitest';
import type { TravelRoute } from '@arbestra/contracts';
import { roadEdges, VillageRoads } from './village-roads';
import { automaticRoadStrokes, infrastructureSurface, emptyInfrastructure } from '@arbestra/contracts';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { WorldSpace } from './world-space';
import { InfrastructureRenderer } from './infrastructure-renderer';
import { pavedProfiles, roadTileBorders, roadTileRects } from './road-profile';

it('shares excavation across the toric seam and closes every grass-facing edge of bends and junctions', () => {
  const a = { cellX: 63, cellY: 2 },
    b = { cellX: 0, cellY: 2 },
    c = { cellX: 0, cellY: 3 };
  const profiles = pavedProfiles([{ id: 'a', kind: 'building', cells: [a, b, c], destination: c }], 64, 64);
  expect(profiles.get('63:2')).toBe(1);
  expect(profiles.get('0:2')).toBe(6);
  for (const mask of [3, 5, 6, 7, 15]) {
    const rectangles = roadTileRects(mask),
      borders = roadTileBorders(mask);
    for (const e of borders) {
      const x = (e.x0 + e.x1) / 2,
        z = (e.z0 + e.z1) / 2;
      const at = (px: number, pz: number) =>
        rectangles.find((r) => px > r.x0 && px < r.x1 && pz > r.z0 && pz < r.z1)?.dug;
      expect(at(x - e.nx * 0.001, z - e.nz * 0.001)).toBe(true);
      expect(at(x + e.nx * 0.001, z + e.nz * 0.001)).toBe(false);
    }
    expect(borders.length).toBeGreaterThan(0);
  }
});

it('classifies shared building and resource edges without changing route kinds or order', () => {
  const a = { cellX: 63, cellY: 3 },
    b = { cellX: 0, cellY: 3 },
    c = { cellX: 0, cellY: 4 };
  const routes: TravelRoute[] = [
    { id: 'house', kind: 'building', cells: [a, b], destination: b },
    { id: 'stone', kind: 'stone', cells: [a, b, c], destination: c },
    { id: 'garden', kind: 'garden', cells: [c, b], destination: b },
  ];
  const before = JSON.stringify(routes);
  const edges = roadEdges(routes);
  expect(edges).toHaveLength(2);
  expect(edges.filter((e) => e.kind === 'paved')).toHaveLength(1);
  expect(edges.find((e) => e.kind === 'earth')).toEqual({ from: b, to: c, kind: 'earth' });
  expect(roadEdges([...routes].reverse()).sort((x, y) => x.kind.localeCompare(y.kind))).toEqual(
    edges.sort((x, y) => x.kind.localeCompare(y.kind)),
  );
  expect(JSON.stringify(routes)).toBe(before);
});

it('keeps the approved raised stone sidewalks and correctly oriented top faces', () => {
  const routes: TravelRoute[] = [
      {
        id: 'wood',
        kind: 'wood',
        cells: [
          { cellX: 10, cellY: 10 },
          { cellX: 11, cellY: 10 },
        ],
        destination: { cellX: 11, cellY: 10 },
      },
    ],
    world = { widthCells: 512, heightCells: 256 };
  const before = JSON.stringify(routes),
    roads = automaticRoadStrokes(routes, world).map((r) => ({ ...r, material: 'stone-1' as const, border: true }));
  expect(roads.every((r) => r.width === 4 && r.material === 'stone-1' && r.border)).toBe(true);
  const surface = infrastructureSurface(roads, world);
  expect([...surface.values()].filter((p) => p.x === 168)).toHaveLength(8); // 8 sixteenths = 4 subdivisions.
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    renderer.update(
      { ...emptyInfrastructure(), roads },
      new WorldSpace(512, 256, { cellX: 10, cellY: 10 }),
      () => 0,
      false,
      0,
      undefined,
      false,
      [],
      { followTerrain: true },
    );
    const pavement = scene.meshes.find((m) => m.name === 'infrastructure-stone-1')!,
      curbs = scene.meshes.find((m) => m.name === 'infrastructure-border')!;
    expect(pavement.material!.name).toBe('infrastructure-stone-1');
    expect(curbs.material!.name).toBe('infrastructure-border');
    const z = pavement.getVerticesData('position')!.filter((_, i) => i % 3 === 2);
    expect(Math.max(...z) - Math.min(...z)).toBeCloseTo(1.25 - 0.008);
    const edges = curbs.getVerticesData('position')!.filter((_, i) => i % 3 === 2);
    expect(Math.max(...edges) - Math.min(...edges)).toBeGreaterThan(2.45);
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(2.5);
    const roadY = pavement.getVerticesData('position')!.filter((_, i) => i % 3 === 1),
      curbY = curbs.getVerticesData('position')!.filter((_, i) => i % 3 === 1);
    expect(Math.max(...roadY)).toBeCloseTo(0.003);
    expect(Math.min(...curbY)).toBeCloseTo(0.004);
    expect(Math.max(...curbY) - Math.max(...roadY)).toBeCloseTo(0.061);
    const positions = curbs.getVerticesData('position')!,
      normals = curbs.getVerticesData('normal')!;
    const topNormals = Array.from(positions).flatMap((y, i) =>
      i % 3 === 1 && Math.abs(y - 0.064) < 1e-6 && Math.abs(normals[i]!) > 0.5 ? [normals[i]!] : [],
    );
    expect(topNormals.length).toBeGreaterThan(0);
    expect(topNormals.every((y) => y > 0.99)).toBe(true);
    expect(curbs.getVerticesData('uv')).toHaveLength((positions.length / 3) * 2);
    expect(JSON.stringify(routes)).toBe(before);
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('renders automatic earth paths four subdivisions wide without sidewalks', () => {
  const routes: TravelRoute[] = [
      {
        id: 'wood',
        kind: 'wood',
        cells: [
          { cellX: 10, cellY: 10 },
          { cellX: 11, cellY: 10 },
        ],
        destination: { cellX: 11, cellY: 10 },
      },
    ],
    world = { widthCells: 512, heightCells: 256 };
  const before = JSON.stringify(routes),
    roads = automaticRoadStrokes(routes, world);
  expect(roads.every((r) => r.width === 4 && r.material === 'earth' && !r.border)).toBe(true);
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new VillageRoads(scene);
  try {
    renderer.update(
      'earth',
      routes,
      new WorldSpace(512, 256, { cellX: 10, cellY: 10 }),
      () => ({ code: 1, height: 0 }),
      true,
    );
    const road = scene.meshes.find((m) => m.material?.name === 'infrastructure-earth')!;
    expect(road).toBeDefined();
    expect(scene.meshes.some((m) => m.material?.name === 'infrastructure-border')).toBe(false);
    const y = road.getVerticesData('position')!.filter((_, i) => i % 3 === 1);
    expect(Math.max(...y)).toBeCloseTo(0.015);
    expect(Math.min(...y)).toBeLessThan(0);
    const z = road.getVerticesData('position')!.filter((_, i) => i % 3 === 2);
    expect(Math.max(...z) - Math.min(...z)).toBeCloseTo(1.25);
    expect(JSON.stringify(routes)).toBe(before);
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});
