import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { vertexSurface, woodlandTrees } from '@arbestra/contracts';
import { groveSlots } from './grove-trees';
import type { NaturalFeature, VillageState } from '@arbestra/contracts';
import {
  groveHalo,
  groveHaloTrees,
  TreeHalos,
  TREE_HALO_LIFT,
  treeHaloRadius,
  treeHalos,
  type TreeHaloGrove,
} from './tree-halos';
import { HALO_MARKER, haloHalfSize } from './halo-marker';
import { RESOURCE_HALO_COLOURS } from './resource-halos';
import { Color3 } from '@babylonjs/core/Maths/math.color';
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
const WOOD = Color3.FromHexString(RESOURCE_HALO_COLOURS.wood),
  CLEAR = Color3.FromHexString(HALO_MARKER.clearColour);
const rgb = (c: Color3) => [c.r, c.g, c.b].map((v) => Math.round(v * 255));
const tintOf = (colour: number[]) => colour.slice(0, 3).map((v) => Math.round(v * 255));

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

/** A grove of `trees` trees at cell (x, 31): the fixture's terrain is known everywhere. */
function syntheticGrove(id: string, x: number, trees = 3): TreeHaloGrove {
  return {
    featureId: id,
    cellX: x,
    cellY: 31,
    anchor: { cellX: 0, cellY: 0 },
    revision: 1,
    trees: Array.from({ length: trees }, (_, i) => ({
      x: x + 0.2 + i * 0.25,
      y: 31.4,
      scale: 1,
      heightScale: 1,
      rotation: 0,
    })),
  };
}

it('places one resting « Onde » marker at the foot of every tree, sized to fit the outer wave', () => {
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
      expect(right.length()).toBeCloseTo(haloHalfSize(treeHaloRadius(tree)), 5);
      // The reference ring is the tree's halo radius; the quad leaves room around it.
      expect(right.length() * HALO_MARKER.ring).toBeCloseTo(treeHaloRadius(tree), 5);
      const colour = f.halos.colourAt(i);
      expect(tintOf(colour)).toEqual(rgb(WOOD));
      expect(colour[3]).toBe(1);
      expect(f.halos.stateAt(i)).toEqual({ validatedAt: null, mode: 'cut' });
    }
  } finally {
    f.dispose();
  }
});

it('validates a grove once, lets the shader play the waves, ends with no halo and frees its instances', () => {
  const f = fixture();
  try {
    const halo = groveHalo(grove(), 32)!;
    f.halos.setAvailable([halo]);
    f.at(0);
    f.at(300);
    expect(f.halos.colourAt(0)[3]).toBeCloseTo(1, 5);
    f.halos.setPending([halo]);
    f.at(300); // validated
    expect(f.halos.pendingCount).toBe(1);
    for (let i = 0; i < 3; i++) {
      expect(f.halos.stateAt(i)).toEqual({ validatedAt: Math.fround(0.3), mode: 'cut' });
      expect(f.halos.colourAt(i)[3]).toBe(1);
    }
    expect(f.halos.instanceWrites).toBe(3);
    // Mid-way: the waves run from the clock uniform alone, nothing is rewritten.
    f.at(300 + HALO_MARKER.flashMs / 2);
    expect(f.halos.clock - f.halos.stateAt(0).validatedAt!).toBeCloseTo(HALO_MARKER.flashMs / 2000, 6);
    expect(f.halos.instanceWrites).toBe(0);
    expect(f.halos.uploads).toBe(0);
    // The same grove offered again or kept pending does not replay its validation.
    f.halos.setAvailable([halo]);
    f.halos.setPending([halo]);
    f.at(300 + HALO_MARKER.flashMs * 0.75);
    expect(f.halos.stateAt(1).validatedAt).toBe(Math.fround(0.3));
    f.at(300 + HALO_MARKER.flashMs);
    // Still pending, flash over: nothing shown, like the cell halos.
    expect(f.halos.pendingCount).toBe(0);
    expect(f.halos.mesh.isEnabled()).toBe(false);
    expect(f.halos.colourAt(0)[3]).toBe(0);
    f.halos.setPending([halo]);
    f.at(300 + HALO_MARKER.flashMs + 700);
    expect(f.halos.mesh.isEnabled()).toBe(false);
    expect(f.halos.stateAt(0).validatedAt).toBeNull();
    f.halos.setPending([]);
    f.halos.setAvailable([]);
    f.at(300 + HALO_MARKER.flashMs + 800);
    expect(f.halos.instanceCount).toBe(0);
    expect(f.halos.mesh.isEnabled()).toBe(false);
  } finally {
    f.dispose();
  }
});

it('shows « Satellites » in red while clearing, and a validation keeps the shape it was made with', () => {
  const f = fixture();
  try {
    const first = syntheticGrove('first', 20),
      second = syntheticGrove('second', 24);
    f.halos.setAvailable([first, second]);
    f.settle();
    f.halos.setMode('clear');
    expect(f.halos.mode).toBe('clear');
    f.tick();
    for (let i = 0; i < 6; i++) {
      expect(f.halos.stateAt(i)).toEqual({ validatedAt: null, mode: 'clear' });
      expect(tintOf(f.halos.colourAt(i))).toEqual(rgb(CLEAR));
    }
    f.halos.setPending([first]);
    f.tick();
    const validatedAt = f.halos.stateAt(0).validatedAt!;
    expect(validatedAt).toBeCloseTo(f.halos.clock, 6);
    // Back to cutting during the dive: the validated grove keeps diving, the other one turns into a ring.
    f.halos.setMode('cut');
    f.tick();
    for (let i = 0; i < 3; i++) {
      expect(f.halos.stateAt(i)).toEqual({ validatedAt, mode: 'clear' });
      expect(tintOf(f.halos.colourAt(i))).toEqual(rgb(CLEAR));
    }
    for (let i = 3; i < 6; i++) {
      expect(f.halos.stateAt(i)).toEqual({ validatedAt: null, mode: 'cut' });
      expect(tintOf(f.halos.colourAt(i))).toEqual(rgb(WOOD));
    }
    expect(f.halos.instanceWrites).toBe(3);
  } finally {
    f.dispose();
  }
});

it('bounds the work per frame: no rewrite at rest, even orbiting, and only the validated trees otherwise', () => {
  const f = fixture();
  try {
    // Forty groves of three trees, in clearing mode: 120 orbiting markers.
    const groves = Array.from({ length: 40 }, (_, i) => syntheticGrove(`g${i}`, 2 + i));
    f.halos.setMode('clear');
    f.halos.setAvailable(groves);
    f.settle();
    expect(f.halos.instanceCount).toBe(120);
    const rebuilds = f.halos.rebuilds,
      before = f.halos.clock;
    for (let frame = 0; frame < 100; frame++) {
      f.tick();
      expect(f.halos.instanceWrites).toBe(0);
      expect(f.halos.uploads).toBe(0);
    }
    // The orbit advances through the clock uniform only.
    expect(f.halos.clock - before).toBeCloseTo(4, 6);
    expect(f.halos.plugin.uniforms().clock[0]).toBe(f.halos.clock);
    expect(f.halos.rebuilds).toBe(rebuilds);
    // Validating two groves rewrites their six instances, in two partial uploads per attribute.
    f.halos.setPending([groves[3]!, groves[17]!]);
    f.tick();
    expect(f.halos.instanceWrites).toBe(6);
    expect(f.halos.uploads).toBe(4);
    expect(f.halos.rebuilds).toBe(rebuilds);
    // While the dive and the burst play: nothing.
    const frames = Math.ceil(HALO_MARKER.flashMs / 40) - 2;
    for (let frame = 0; frame < frames; frame++) {
      f.tick();
      expect(f.halos.instanceWrites).toBe(0);
    }
    // The end puts out those six instances only.
    f.tick();
    f.tick();
    expect(f.halos.rebuilds).toBe(rebuilds);
    for (let frame = 0; frame < 10; frame++) f.tick();
    expect(f.halos.instanceWrites).toBe(0);
    expect(f.halos.pendingCount).toBe(0);
    // A mode switch rewrites every instance once (the hidden queued ones too), then nothing.
    f.halos.setMode('cut');
    f.tick();
    expect(f.halos.instanceWrites).toBe(120);
    f.tick();
    expect(f.halos.instanceWrites).toBe(0);
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
    expect(f.halos.stateAt(1)).toEqual({ validatedAt: null, mode: 'cut' });
    expect(f.halos.colourAt(1)[3]).toBe(1);
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

it('carries the zoom fade as a uniform and frees its material', () => {
  const f = fixture();
  try {
    f.halos.setAvailable([groveHalo(grove(), 32)!]);
    f.settle();
    const writes: number[] = [];
    for (const [i, zoom] of [1, 0.8, 0.5, 0.2].entries()) {
      f.halos.update(1000 + i * 40, f.space, f.store, true, zoom);
      writes.push(f.halos.instanceWrites);
      expect(f.halos.plugin.uniforms().clock[1]).toBe(zoom);
    }
    expect(writes).toEqual([0, 0, 0, 0]);
    expect(f.scene.getMaterialByName('tree-halo')).not.toBeNull();
    f.halos.dispose();
    expect(f.scene.getMaterialByName('tree-halo')).toBeNull();
    expect(f.scene.getMeshByName('tree-halos')).toBeNull();
  } finally {
    f.store.dispose();
    f.scene.dispose();
  }
});

it('validates one tree on its own, and keeps a resting frame O(1) however many trees are offered', () => {
  const f = fixture();
  try {
    // 400 trees offered, one entry each (treeHalos), in a hundred groves.
    const slots = (id: string, x: number) =>
      groveSlots({
        ...grove({ id, cellX: x, cellY: 31 }),
        rc1: {
          trees: syntheticGrove(id, x, 4).trees.map((t) => ({ x: t.x, y: t.y, elevation: 5, size: 1, crown: 1 })),
          rocks: [],
        },
      });
    const groves = Array.from({ length: 100 }, (_, i) => ({
      id: `g${i}`,
      x: 2 + (i % 60),
      slots: slots(`g${i}`, 2 + (i % 60)),
    }));
    const offered = groves.flatMap((g) => treeHalos({ id: g.id, cellX: g.x, cellY: 31 }, g.slots, 32));
    expect(offered).toHaveLength(400);
    f.halos.setAvailable(offered);
    f.settle();
    expect(f.halos.instanceCount).toBe(400);
    const passes = f.halos.passes,
      rebuilds = f.halos.rebuilds;
    for (let frame = 0; frame < 100; frame++) {
      f.tick();
      expect(f.halos.instanceWrites).toBe(0);
    }
    // At rest, a frame no longer walks the 400 entries: only the clock advances.
    expect(f.halos.passes).toBe(passes);
    // The overlay offers the same trees again every 700 ms: still nothing to do.
    f.halos.setAvailable([...offered]);
    f.tick();
    expect(f.halos.passes).toBe(passes);
    // One tree touched: its own marker validates, no other instance is written, no rebuild.
    f.halos.setPending([offered[42]!]);
    f.tick();
    expect(f.halos.instanceWrites).toBe(1);
    expect(f.halos.rebuilds).toBe(rebuilds);
    expect(f.halos.stateAt(42).validatedAt).not.toBeNull();
    expect(f.halos.stateAt(41).validatedAt).toBeNull();
    expect(f.halos.stateAt(43).validatedAt).toBeNull();
    // Once its flash is over, the frames are O(1) again.
    for (let frame = 0; frame < Math.ceil(HALO_MARKER.flashMs / 40) + 12; frame++) f.tick();
    const after = f.halos.passes;
    for (let frame = 0; frame < 20; frame++) f.tick();
    expect(f.halos.passes).toBe(after);
  } finally {
    f.dispose();
  }
});
