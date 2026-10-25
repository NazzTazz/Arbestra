import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { decodeBuildingAsset } from './building-asset-format';
import {
  gardenHarvestState,
  gardenInstances,
  gardenLod,
  type GardenKitData,
  type GardenLod,
  type GardenPlotView,
} from './garden-kit';
import type { VillageState } from '@arbestra/contracts';
import manifest from './garden-kit-manifest.json';

const bytes = gunzipSync(readFileSync(new URL(`../../public${manifest.kit}`, import.meta.url)));
const kit = decodeBuildingAsset(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
) as unknown as GardenKitData;
const closed = { west: false, east: false, south: false, north: false },
  open = { west: true, east: true, south: true, north: true };
const plot = (id: string, x: number, z: number, extra: Partial<GardenPlotView> = {}): GardenPlotView => ({
  id,
  x,
  y: 0,
  z,
  stage: 7,
  full: true,
  open,
  ...extra,
});
const counts = (instances: Map<string, number[]>) =>
  Object.fromEntries([...instances].map(([source, values]) => [source, values.length / 16]));
const lods = (plots: GardenPlotView[], lod: GardenLod) => new Map(plots.map((p) => [p.id, lod]));

it('assembles an isolated mature plot at each level within the agreed pieces', () => {
  const plots = [plot('a', 0, 0)];
  const near = counts(gardenInstances(kit, plots, lods(plots, 0)));
  expect(
    Object.entries(near)
      .filter(([s]) => s.startsWith('CAROTTE_STADE_07'))
      .map(([, n]) => n),
  ).toEqual([48]);
  expect(near.CORDE_LOD0).toBe(8);
  expect(near.PIQUET_LOD0).toBe(8);
  expect(near.MARQUEUR_LOD0).toBe(1);
  const middle = counts(gardenInstances(kit, plots, lods(plots, 1)));
  expect(
    ['RANG_STADE_07_VAR_1_LOD1', 'RANG_STADE_07_VAR_2_LOD1', 'RANG_STADE_07_VAR_3_LOD1'].map((s) => middle[s]),
  ).toEqual([1, 1, 1]);
  expect(middle.CORDE_LOD1).toBe(8);
  expect(Object.keys(middle).some((s) => s.includes('LOD0'))).toBe(false);
  expect(counts(gardenInstances(kit, plots, lods(plots, 2)))).toEqual({ PARCELLE_STADE_07_LOD2: 1 });
});

it('follows the stock stage and shows the marker only on a full plot', () => {
  const plots = [plot('a', 0, 0, { stage: 3, full: false })];
  const middle = counts(gardenInstances(kit, plots, lods(plots, 1)));
  expect(middle.RANG_STADE_03_VAR_1_LOD1).toBe(1);
  expect(Object.keys(middle).some((s) => s.includes('STADE_07'))).toBe(false);
  expect(middle.MARQUEUR_LOD1).toBeUndefined();
  expect(counts(gardenInstances(kit, plots, lods(plots, 2)))).toEqual({ PARCELLE_STADE_03_LOD2: 1 });
});

it('fences only the outside of an L garden, with one post per corner', () => {
  // (0,0), (1,0), (0,1): the notice's reference L, 16 ropes and 16 posts.
  const plots = [
    plot('00', 0, 0, { open: { ...closed, west: true, south: true } }),
    plot('10', 2.5, 0, { open: { ...closed, east: true, south: true, north: true } }),
    plot('01', 0, 2.5, { open: { ...closed, west: true, east: true, north: true } }),
  ];
  const fence = counts(gardenInstances(kit, plots, lods(plots, 1)));
  expect(fence.CORDE_LOD1).toBe(16);
  expect(fence.PIQUET_LOD1).toBe(16);
  const isolated = counts(gardenInstances(kit, [plots[0]!], lods([plots[0]!], 1)));
  expect(isolated.CORDE_LOD1).toBe(4);
});

it('places ropes on their plot edges, end to end along each exposed side', () => {
  const instances = gardenInstances(kit, [plot('a', 10, 20)], new Map([['a', 1 as GardenLod]]));
  const rope = kit.geometries.vertexData.find((g) => g.id.startsWith('CORDE_LOD1'))!;
  let length = 0;
  for (let i = 0; i < rope.positions.length; i += 3) length = Math.max(length, rope.positions[i]!);
  expect(length).toBeCloseTo(1.25, 2);
  const ends = [];
  const values = instances.get('CORDE_LOD1')!;
  for (let i = 0; i < values.length; i += 16) {
    const m = Matrix.FromArray(values, i);
    ends.push([
      Vector3.TransformCoordinates(Vector3.Zero(), m),
      Vector3.TransformCoordinates(new Vector3(1.25, 0, 0), m),
    ]);
  }
  for (const [a, b] of ends) {
    // Every span stays on the square's outline: x or z constant at an edge.
    const onEdge = (p: Vector3) =>
      [8.75, 11.25].some((x) => Math.abs(p.x - x) < 1e-6) || [18.75, 21.25].some((z) => Math.abs(p.z - z) < 1e-6);
    expect(onEdge(a!) && onEdge(b!)).toBe(true);
    expect(Vector3.Distance(a!, b!)).toBeCloseTo(1.25, 6);
  }
});

it('keeps converted faces front-facing for the left-handed scene', () => {
  for (const g of kit.geometries.vertexData.filter((g) => g.normals)) {
    const computed: number[] = [];
    VertexData.ComputeNormals(g.positions, g.indices, computed);
    let agree = 0;
    for (let i = 0; i < computed.length; i += 3)
      if (
        computed[i]! * g.normals![i]! + computed[i + 1]! * g.normals![i + 1]! + computed[i + 2]! * g.normals![i + 2]! >
        0
      )
        agree++;
    expect(agree / (computed.length / 3), g.id).toBeGreaterThan(0.9);
  }
});

it('switches levels with hysteresis', () => {
  expect(gardenLod(10)).toBe(0);
  expect(gardenLod(60)).toBe(1);
  expect(gardenLod(500)).toBe(2);
  expect(gardenLod(33, 0)).toBe(0);
  expect(gardenLod(31, 1)).toBe(1);
});

type Plot = NonNullable<NonNullable<VillageState['cells'][number]['building']>['garden']>['plots'][number];
const start = Date.parse('2026-10-25T10:00:00.000Z');
const harvested = (extra: Partial<NonNullable<Plot['harvest']>> = {}): Plot => ({
  cellX: 4,
  cellY: 5,
  storedCarrots: 0,
  capacity: 40,
  productionPerHour: 10,
  productionUpdatedAt: '2026-10-25T10:00:00.000Z',
  full: false,
  harvest: {
    id: '00000000-0000-4000-8000-000000000001',
    startedAt: new Date(start).toISOString(),
    completesAt: new Date(start + 70_000).toISOString(),
    reservedCarrots: 40,
    transportMs: 10_000,
    path: [],
    ...extra,
  },
});

it('removes a harvested plot’s plants over its authoritative work window', () => {
  const plot = harvested();
  expect(gardenHarvestState(plot, start + 5_000)).toEqual({ stage: 7, visibleStage: 7, remaining: 48 });
  // Work window: arrival after 10 s, departure 10 s before completion.
  expect(gardenHarvestState(plot, start + 35_000)!.remaining).toBe(24);
  expect(gardenHarvestState(plot, start + 60_000)).toEqual({ stage: 7, visibleStage: 1, remaining: 0 });
  expect(gardenHarvestState({ ...plot, harvest: null }, start)).toBeNull();
});

it('uses this plot’s own stop of a garden tour', () => {
  const plot = harvested({
    reservedCarrots: 60,
    stops: [
      { cellX: 3, cellY: 5, path: [], arrivesAfterMs: 5_000, workEndsAfterMs: 15_000, reservedCarrots: 40 },
      { cellX: 4, cellY: 5, path: [], arrivesAfterMs: 20_000, workEndsAfterMs: 40_000, reservedCarrots: 20 },
    ],
  });
  expect(gardenHarvestState(plot, start + 15_000)).toEqual({ stage: 4, visibleStage: 4, remaining: 48 });
  expect(gardenHarvestState(plot, start + 30_000)!.remaining).toBe(24);
});

it('shows the remaining plants individually, the first row’s plants going first', () => {
  const plots = [plot('a', 0, 0, { stage: 1, full: false, harvest: { stage: 7, remaining: 40 } })];
  for (const lod of [0, 1] as const) {
    const instances = gardenInstances(kit, plots, lods(plots, lod));
    const plants = instances.get('CAROTTE_STADE_07_LOD0')!;
    expect(plants.length / 16).toBe(40);
    expect([...instances.keys()].some((s) => s.startsWith('RANG_'))).toBe(false);
    // The 8 removed plants are the start of the nearest row (lowest z), taken from the left.
    const z = [];
    for (let i = 0; i < plants.length; i += 16) z.push(plants[i + 14]!);
    const firstRow = Math.min(...z);
    expect(z.filter((v) => Math.abs(v - firstRow) < 0.2)).toHaveLength(8);
  }
  expect(counts(gardenInstances(kit, plots, lods(plots, 2)))).toEqual({ PARCELLE_STADE_01_LOD2: 1 });
});
