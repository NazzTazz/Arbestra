import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { VillageState } from '@arbestra/contracts';
import { decodeBuildingAsset } from './building-asset-format';
import {
  gardenHarvestState,
  gardenInstances,
  gardenLevel,
  slotVariation,
  type GardenKitData,
  type GardenLevel,
  type GardenPlotView,
} from './garden-kit';
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
  open,
  ...extra,
});
const counts = (instances: Map<string, number[]>) =>
  Object.fromEntries([...instances].map(([source, values]) => [source, values.length / 16]));
const levels = (plots: GardenPlotView[], level: GardenLevel) => new Map(plots.map((p) => [p.id, level]));
const positions = (values: number[]) => {
  const out: Vector3[] = [];
  for (let i = 0; i < values.length; i += 16)
    out.push(Vector3.TransformCoordinates(Vector3.Zero(), Matrix.FromArray(values, i)));
  return out;
};

it('assembles an isolated plot near and far, following the stock stage', () => {
  const plots = [plot('a', 0, 0)];
  expect(counts(gardenInstances(kit, plots, levels(plots, 'near')))).toEqual({
    SOCLE: 1,
    TOUFFE_MURE: 12,
    CAGETTE: 1,
    BORDURE: 4,
    POTEAU: 4,
  });
  expect(counts(gardenInstances(kit, plots, levels(plots, 'far')))).toEqual({ LOINTAIN_STADE_7: 1 });
  const young = [plot('a', 0, 0, { stage: 3 })];
  expect(counts(gardenInstances(kit, young, levels(young, 'near'))).TOUFFE_JEUNE).toBe(12);
  expect(counts(gardenInstances(kit, young, levels(young, 'near'))).CAGETTE).toBeUndefined();
  expect(counts(gardenInstances(kit, young, levels(young, 'far')))).toEqual({ LOINTAIN_STADE_3: 1 });
});

it('borders only the outside of an L garden, one post per corner', () => {
  // (0,0), (1,0), (0,1): perimeter of 8 cell sides and 8 corners.
  const plots = [
    plot('00', 0, 0, { open: { ...closed, west: true, south: true } }),
    plot('10', 2.5, 0, { open: { ...closed, east: true, south: true, north: true } }),
    plot('01', 0, 2.5, { open: { ...closed, west: true, east: true, north: true } }),
  ];
  const near = gardenInstances(kit, plots, levels(plots, 'near'));
  expect(counts(near).BORDURE).toBe(8);
  const posts = positions(near.get('POTEAU')!).map((p) => `${p.x.toFixed(2)}:${p.z.toFixed(2)}`);
  expect(new Set(posts).size).toBe(posts.length);
  expect(posts.sort()).toEqual(
    [
      [-1.25, -1.25],
      [1.25, -1.25],
      [3.75, -1.25],
      [3.75, 1.25],
      [1.25, 1.25],
      [1.25, 3.75],
      [-1.25, 3.75],
      [-1.25, 1.25],
    ]
      .map(([x, z]) => `${x!.toFixed(2)}:${z!.toFixed(2)}`)
      .sort(),
  );
});

it('lays each border along its side, from corner to corner, inner side towards the plot', () => {
  const values = gardenInstances(kit, [plot('a', 10, 20)], new Map([['a', 'near' as GardenLevel]])).get('BORDURE')!;
  const corner = (p: Vector3) => [8.75, 11.25].includes(+p.x.toFixed(2)) && [18.75, 21.25].includes(+p.z.toFixed(2));
  for (let i = 0; i < values.length; i += 16) {
    const m = Matrix.FromArray(values, i),
      a = Vector3.TransformCoordinates(Vector3.Zero(), m),
      b = Vector3.TransformCoordinates(new Vector3(2.5, 0, 0), m),
      inside = Vector3.TransformCoordinates(new Vector3(1.25, 0, 0.5), m);
    expect(corner(a) && corner(b)).toBe(true);
    expect(Math.abs(inside.x - 10) < 1.25 && Math.abs(inside.z - 20) < 1.25).toBe(true);
  }
});

it('keeps each tuft at the same place, turn and size across stages', () => {
  const at = (stage: number) =>
    gardenInstances(kit, [plot('p', 0, 0, { stage })], new Map([['p', 'near' as GardenLevel]]));
  const young = at(3).get('TOUFFE_JEUNE')!,
    mature = at(7).get('TOUFFE_MURE')!;
  expect(positions(young).map((p) => [p.x.toFixed(4), p.z.toFixed(4)])).toEqual(
    positions(mature).map((p) => [p.x.toFixed(4), p.z.toFixed(4)]),
  );
  expect(slotVariation('p', 3)).toEqual(slotVariation('p', 3));
  expect(slotVariation('p', 3)).not.toEqual(slotVariation('q', 3));
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
  expect(gardenLevel(60)).toBe('near');
  expect(gardenLevel(500)).toBe('far');
  expect(gardenLevel(125, 'near')).toBe('near');
  expect(gardenLevel(115, 'far')).toBe('far');
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

it('removes a harvested plot’s tufts over its authoritative work window', () => {
  const p = harvested();
  expect(gardenHarvestState(p, start + 5_000)).toEqual({ stage: 7, visibleStage: 7, remaining: 12 });
  // Work window: arrival after 10 s, departure 10 s before completion.
  expect(gardenHarvestState(p, start + 35_000)!.remaining).toBe(6);
  expect(gardenHarvestState(p, start + 60_000)).toEqual({ stage: 7, visibleStage: 1, remaining: 0 });
  expect(gardenHarvestState({ ...p, harvest: null }, start)).toBeNull();
});

it('uses this plot’s own stop of a garden tour', () => {
  const p = harvested({
    reservedCarrots: 60,
    stops: [
      { cellX: 3, cellY: 5, path: [], arrivesAfterMs: 5_000, workEndsAfterMs: 15_000, reservedCarrots: 40 },
      { cellX: 4, cellY: 5, path: [], arrivesAfterMs: 20_000, workEndsAfterMs: 40_000, reservedCarrots: 20 },
    ],
  });
  expect(gardenHarvestState(p, start + 15_000)).toEqual({ stage: 4, visibleStage: 4, remaining: 12 });
  expect(gardenHarvestState(p, start + 30_000)!.remaining).toBe(6);
});

it('takes the tufts in the gardener’s serpentine during a harvest, without a crate', () => {
  const near = (remaining: number) =>
    gardenInstances(
      kit,
      [plot('a', 0, 0, { stage: 1, harvest: { stage: 7, remaining } })],
      new Map([['a', 'near' as GardenLevel]]),
    );
  expect(counts(near(12)).TOUFFE_MURE).toBe(12);
  expect(counts(near(12)).CAGETTE).toBeUndefined();
  // Five gone: the first row (lowest z) left to right, then the second row's rightmost.
  const left = positions(near(7).get('TOUFFE_MURE')!);
  expect(left).toHaveLength(7);
  const rows = [...new Set(left.map((p) => Math.round(p.z * 2) / 2))].sort((a, b) => a - b);
  expect(rows).toHaveLength(2);
  const second = left.filter((p) => Math.round(p.z * 2) / 2 === rows[0]).map((p) => p.x);
  expect(second).toHaveLength(3);
  expect(Math.max(...second)).toBeLessThan(0.5);
  expect(
    counts(gardenInstances(kit, [plot('a', 0, 0, { stage: 1, harvest: { stage: 7, remaining: 7 } })], new Map())),
  ).toEqual({ LOINTAIN_STADE_1: 1 });
});
