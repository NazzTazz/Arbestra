import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { vertexSurface, woodlandTrees } from '@arbestra/contracts';
import { groveSlots } from './grove-trees';
import type { NaturalFeature, VillageState } from '@arbestra/contracts';
import { groveHalo, groveHaloTrees, TreeHalos, TREE_HALO_LIFT, treeHaloRadius } from './tree-halos';
import { TerrainStore } from './terrain-store';
import { CELL_UNITS, WorldSpace } from './world-space';

const deposit = (over: Partial<NonNullable<NaturalFeature['deposit']>> = {}): NaturalFeature['deposit'] => ({
  featureId: 'grove',
  resourceCode: 'wood',
  cellX: 31,
  cellY: 31,
  initialAmount: 300,
  remainingAmount: 220,
  reservedAmount: 20,
  availableAmount: 200,
  state: 'available',
  revision: 3,
  updatedAt: '2026-10-27T00:00:00.000Z',
  ...over,
});
const grove = (over: Partial<NaturalFeature> = {}): NaturalFeature => ({
  id: 'grove',
  type: 'woodland',
  cellX: 31,
  cellY: 31,
  variantSeed: 7,
  rc1: {
    trees: [
      { x: 30.4, y: 31.2, elevation: 2.1, size: 1, crown: 1 },
      { x: 31.6, y: 30.7, elevation: 2.3, size: 0.8, crown: 1.1 },
      { x: 32.2, y: 32.1, elevation: 2.0, size: 1.2, crown: 0.9 },
    ],
    rocks: [],
  },
  deposit: deposit(),
  ...over,
});

it('offers a halo per drawn tree, none for a cleared grove, an empty stock or another resource', () => {
  const feature = grove();
  // Full-grown trees: the stock removes trees, it no longer shrinks them.
  expect(groveHaloTrees(feature).map((t) => [t.x, t.y, t.scale])).toEqual(
    groveSlots(feature).map((s) => [s.tree.x, s.tree.y, s.tree.scale]),
  );
  expect(groveHaloTrees(feature)).toHaveLength(3);
  expect(groveHaloTrees(grove({ deposit: deposit({ cleared: true }) }))).toEqual([]);
  expect(groveHaloTrees(grove({ deposit: deposit({ availableAmount: 0 }) }))).toEqual([]);
  expect(groveHaloTrees(grove({ deposit: deposit({ resourceCode: 'stone' }) }))).toEqual([]);
  expect(groveHaloTrees(grove({ deposit: null }))).toEqual([]);
  // A grove without RC1 geometry still draws its historical layout: halos follow it.
  const legacy = grove();
  delete legacy.rc1;
  expect(groveHaloTrees(legacy).map((t) => [t.x, t.y])).toEqual(woodlandTrees(legacy).map((t) => [t.x, t.y]));
  expect(groveHalo(feature, 32)).toMatchObject({
    featureId: 'grove',
    cellX: 31,
    cellY: 31,
    anchor: { cellX: 0, cellY: 0 },
    revision: 3,
  });
  expect(groveHalo(grove({ deposit: deposit({ cleared: true }) }), 32)).toBeNull();
});

function fixture() {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    halos = new TreeHalos(scene);
  const space = new WorldSpace(64, 64, { cellX: 0, cellY: 0 });
  const surface = vertexSurface(
    { widthCells: 64, heightCells: 64 },
    (x, y) => 5 + Math.sin(x) * 0.4 + Math.cos(y) * 0.3,
    [],
  );
  const state = {
    world: { id: 'test', widthCells: 64, heightCells: 64, chunkSize: 32 },
    cells: [],
    village: { worksites: [], extractions: [] },
    region: {
      originCellX: 0,
      originCellY: 0,
      width: 64,
      height: 64,
      terrainCodes: Array(4096).fill(1),
      elevations: Array(4096).fill(0),
      features: [],
      vertexHeights: Array.from({ length: 65 * 65 }, (_, i) => surface.height(i % 65, Math.floor(i / 65))),
    },
  } as unknown as VillageState;
  const store = new TerrainStore(state, async () => {
    throw Error('No network in halo test');
  });
  let time = 0;
  const tick = (enabled = true) => halos.update((time += 40), space, store, enabled, 1);
  const at = (now: number) => {
    time = now;
    halos.update(now, space, store, true, 1);
  };
  const settle = () => {
    for (let i = 0; i < 10; i++) tick();
  };
  const dispose = () => {
    halos.dispose();
    store.dispose();
    scene.dispose();
    engine.dispose();
  };
  return { scene, halos, space, store, state, tick, at, settle, dispose };
}

it('places one tinted instance at the foot of every tree, projected like the woodland mesh', () => {
  const f = fixture();
  try {
    const feature = grove();
    f.halos.setAvailable([groveHalo(feature, 32)!]);
    f.tick();
    f.settle();
    const trees = groveSlots(feature).map((s) => s.tree);
    expect(f.halos.instanceCount).toBe(trees.length);
    expect(f.halos.mesh.isEnabled()).toBe(true);
    expect(f.halos.mesh.isPickable).toBe(false);
    for (const [i, tree] of trees.entries()) {
      const matrix = f.halos.matrixAt(i);
      const at = f.space.projectFrom({ cellX: tree.x, cellY: tree.y }, { cellX: 0, cellY: 0 });
      const position = matrix.getTranslation();
      expect(position.x).toBeCloseTo(at.x, 5);
      expect(position.z).toBeCloseTo(at.z, 5);
      expect(position.y).toBeCloseTo(tree.elevation! * CELL_UNITS + TREE_HALO_LIFT, 5);
      // The ring scales with the tree and lies on the terrain: its up axis points upward.
      const up = Vector3.TransformNormal(Vector3.Up(), matrix);
      expect(up.y).toBeGreaterThan(0.9);
      const right = Vector3.TransformNormal(Vector3.Right(), matrix);
      expect(right.length()).toBeCloseTo(treeHaloRadius(tree) / 0.7, 5);
      const [r, g, b, a] = f.halos.colourAt(i);
      expect([r, g, b].map((v) => Math.round(v * 255))).toEqual([0xac, 0x80, 0x56]);
      expect(a).toBeCloseTo(0.65, 5);
    }
  } finally {
    f.dispose();
  }
});

it('flashes a selected grove white, fades it out, and frees its instances afterwards', () => {
  const f = fixture();
  try {
    const halo = groveHalo(grove(), 32)!;
    f.halos.setAvailable([halo]);
    f.at(0);
    f.at(300);
    expect(f.halos.colourAt(0)[3]).toBeCloseTo(0.65, 5);
    f.halos.setPending([halo]);
    f.at(300);
    expect(f.halos.pendingCount).toBe(1);
    expect(f.halos.colourAt(0)[3]).toBeCloseTo(0.65, 5);
    f.at(550);
    const [r, g, b] = f.halos.colourAt(1);
    expect(r).toBeCloseTo(0xac / 255 + (1 - 0xac / 255) * 0.5, 5);
    expect(g).toBeCloseTo(0x80 / 255 + (1 - 0x80 / 255) * 0.5, 5);
    expect(b).toBeCloseTo(0x56 / 255 + (1 - 0x56 / 255) * 0.5, 5);
    f.at(800);
    expect(f.halos.colourAt(2).slice(0, 3)).toEqual([1, 1, 1]);
    expect(f.halos.colourAt(2)[3]).toBeCloseTo(0.65, 5);
    f.at(1300);
    expect(f.halos.colourAt(0)[3]).toBeCloseTo(0.325, 5);
    f.at(1800);
    // Still pending, flash over: nothing shown, like the cell halos.
    expect(f.halos.pendingCount).toBe(0);
    expect(f.halos.mesh.isEnabled()).toBe(false);
    f.halos.setPending([]);
    f.halos.setAvailable([]);
    f.at(1900);
    expect(f.halos.instanceCount).toBe(0);
    expect(f.halos.mesh.isEnabled()).toBe(false);
  } finally {
    f.dispose();
  }
});

it('rebuilds on a toric rebase, a terrain revision or a new stock, and hides outside exploitation', () => {
  const f = fixture();
  try {
    const feature = grove();
    f.halos.setAvailable([groveHalo(feature, 32)!]);
    f.tick();
    f.settle();
    const rebuilds = f.halos.rebuilds;
    const before = f.halos.matrixAt(0).getTranslation();
    f.space.rebase({ cellX: 63, cellY: 63 }, 32);
    f.tick();
    expect(f.halos.rebuilds).toBe(rebuilds + 1);
    const after = f.halos.matrixAt(0).getTranslation();
    expect(after.x).toBeCloseTo(before.x - 32 * CELL_UNITS, 5);
    expect(after.z).toBeCloseTo(before.z - 32 * CELL_UNITS, 5);
    f.tick();
    expect(f.halos.rebuilds).toBe(rebuilds + 1);
    f.store.observe({
      ...f.state,
      region: { ...f.state.region, vertexHeights: f.state.region.vertexHeights!.map((h) => h + 2) },
    });
    f.tick();
    expect(f.halos.rebuilds).toBe(rebuilds + 2);
    // Fewer trees after a cut: the deposit revision changes the layout.
    const cut = grove({
      rc1: { trees: feature.rc1!.trees.slice(1), rocks: [] },
      deposit: deposit({ revision: 4, remainingAmount: 150, availableAmount: 150 }),
    });
    f.halos.setAvailable([groveHalo(cut, 32)!]);
    f.tick();
    expect(f.halos.rebuilds).toBe(rebuilds + 3);
    expect(f.halos.instanceCount).toBe(2);
    f.tick(false);
    expect(f.halos.mesh.isEnabled()).toBe(true);
    for (let i = 0; i < 10; i++) f.tick(false);
    expect(f.halos.mesh.isEnabled()).toBe(false);
  } finally {
    f.dispose();
  }
});

it('waits for the deposit cell terrain instead of placing rings at an invented height', () => {
  const f = fixture();
  try {
    const halo = groveHalo(grove(), 32)!;
    f.halos.setAvailable([halo]);
    f.halos.update(0, f.space, { ground: () => null, groundRevisionAt: () => 0 }, true, 1);
    expect(f.halos.instanceCount).toBe(0);
    expect(f.halos.mesh.isEnabled()).toBe(false);
    // The next periodic offer retries the trees left out, even without a revision change.
    f.halos.setAvailable([halo]);
    f.tick();
    f.settle();
    expect(f.halos.instanceCount).toBe(3);
    f.halos.clear();
    expect(f.halos.instanceCount).toBe(0);
    expect(f.halos.mesh.isEnabled()).toBe(false);
  } finally {
    f.dispose();
  }
});
