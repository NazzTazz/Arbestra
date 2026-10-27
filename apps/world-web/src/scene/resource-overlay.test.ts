import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Ray } from '@babylonjs/core/Culling/ray';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { NaturalFeature } from '@arbestra/contracts';
import { groveRayPredicate, pickedGrove, resourceOverlay } from './resource-overlay';

const world = { widthCells: 512, heightCells: 256, chunkSize: 32 };
let seq = 0;
function feature(
  resourceCode: 'wood' | 'stone',
  cellX: number,
  cellY: number,
  trees = 0,
  over: Partial<NonNullable<NaturalFeature['deposit']>> = {},
): NaturalFeature {
  const id = `${resourceCode}-${cellX}-${cellY}-${seq++}`;
  return {
    id,
    type: resourceCode === 'wood' ? 'woodland' : 'stone-formation',
    cellX,
    cellY,
    variantSeed: 1,
    ...(resourceCode === 'wood'
      ? {
          rc1: {
            trees: Array.from({ length: trees }, (_, i) => ({
              x: cellX + i * 0.3,
              y: cellY + 0.2,
              elevation: 1,
              size: 1,
              crown: 1,
            })),
            rocks: [],
          },
        }
      : {}),
    deposit: {
      featureId: id,
      resourceCode,
      cellX,
      cellY,
      initialAmount: 300,
      remainingAmount: 200,
      reservedAmount: 0,
      availableAmount: 200,
      state: 'available',
      revision: 1,
      updatedAt: '2026-10-27T00:00:00.000Z',
      ...over,
    },
  };
}

it('gives wood a halo per tree and the other resources a halo per cell', () => {
  const wood = feature('wood', 100, 100, 5),
    stone = feature('stone', 101, 100);
  const { cells, groves } = resourceOverlay({
    gardens: ['90:90'],
    features: [
      wood,
      stone,
      feature('wood', 102, 100, 4, { cleared: true }),
      feature('wood', 103, 100, 4, { availableAmount: 0 }),
    ],
    shown: () => true,
    target: { cellX: 100, cellY: 100 },
    world,
  });
  expect(cells).toEqual([
    { ...stone, resource: 'stone' },
    { cellX: 90, cellY: 90, garden: true, resource: 'carrot' },
  ]);
  expect(groves).toHaveLength(1);
  expect(groves[0]).toMatchObject({ featureId: wood.id, cellX: 100, cellY: 100, anchor: { cellX: 96, cellY: 96 } });
  expect(groves[0]!.trees.map((t) => [t.x, t.y])).toEqual(wood.rc1!.trees.map((t) => [t.x, t.y]));
});

it('keeps groves whole, nearest the camera target first, until the tree budget is spent', () => {
  const near = feature('wood', 100, 100, 10),
    middle = feature('wood', 100, 104, 10),
    farAcrossTheSeam = feature('wood', 510, 100, 10),
    far = feature('wood', 100, 120, 10);
  const { groves } = resourceOverlay({
    gardens: [],
    features: [far, middle, farAcrossTheSeam, near],
    shown: () => true,
    target: { cellX: 0, cellY: 100 }, // 510 is two cells away across the toric seam; 100 is a hundred away.
    world,
    treeCap: 25,
  });
  expect(groves.map((g) => g.featureId)).toEqual([farAcrossTheSeam.id, near.id]);
  // The nearest grove is always offered, even when it alone exceeds the budget.
  expect(
    resourceOverlay({
      gardens: [],
      features: [near],
      shown: () => true,
      target: { cellX: 100, cellY: 100 },
      world,
      treeCap: 3,
    }).groves,
  ).toHaveLength(1);
});

it('leaves out cells whose terrain is not on screen, and caps the cell halos', () => {
  const stones = Array.from({ length: 10 }, (_, i) => feature('stone', 100 + i, 100));
  const { cells, groves } = resourceOverlay({
    gardens: ['200:200'],
    features: [...stones, feature('wood', 100, 110, 3)],
    shown: (c) => c.cellX < 106 && c.cellY === 100,
    target: { cellX: 100, cellY: 100 },
    world,
    cellCap: 4,
  });
  expect(cells.map((c) => c.cellX)).toEqual([100, 101, 102, 103]);
  expect(groves).toEqual([]);
});

it('reads the grove a woodland thin instance belongs to', () => {
  const metadata = { instanceFeatureIds: ['grove-a', 'grove-a'], featureId: 'grove-a', cellX: 12, cellY: 34 };
  expect(pickedGrove({ pickedMesh: { metadata }, thinInstanceIndex: 1 })).toEqual({
    featureId: 'grove-a',
    hint: { cellX: 12, cellY: 34 },
  });
  expect(pickedGrove({ pickedMesh: { metadata }, thinInstanceIndex: -1 })).toBeNull();
  expect(pickedGrove({ pickedMesh: { metadata }, thinInstanceIndex: 5 })).toBeNull();
  expect(pickedGrove({ pickedMesh: null, thinInstanceIndex: 0 })).toBeNull();
  expect(pickedGrove({ pickedMesh: { metadata: { siteId: 'x' } }, thinInstanceIndex: 0 })).toBeNull();
});

it('picks the tree under a ray through its grove thin instances, skipping trees away from the ray', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const tree = MeshBuilder.CreateCylinder('tree', { height: 2.8, diameterBottom: 1.2, diameterTop: 0.1 }, scene);
    tree.position.y = 1.4; // Base at the instance origin, like the woodland source.
    tree.bakeCurrentTransformIntoVertices();
    const transforms = new Float32Array(3 * 16);
    Matrix.Translation(0, 0, 0).copyToArray(transforms, 0);
    Matrix.Translation(6, 0, 0).copyToArray(transforms, 16);
    Matrix.Translation(0, 0, 6).copyToArray(transforms, 32);
    tree.thinInstanceSetBuffer('matrix', transforms, 16, true);
    tree.thinInstanceEnablePicking = true;
    tree.isPickable = true;
    tree.metadata = { instanceFeatureIds: ['grove-a', 'grove-a', 'grove-a'], featureId: 'grove-a', cellX: 5, cellY: 6 };
    const tested: number[] = [];
    const ray = new Ray(new Vector3(6.2, 20, 0.1), new Vector3(0, -1, 0), 100);
    const predicate = groveRayPredicate(ray);
    const hit = scene.pickWithRay(ray, (mesh, index) => {
      const near = predicate(mesh, index);
      if (index >= 0 && near) tested.push(index);
      return near;
    })!;
    expect(hit.hit).toBe(true);
    expect(hit.thinInstanceIndex).toBe(1);
    expect(tested).toEqual([1]);
    expect(pickedGrove(hit)).toEqual({ featureId: 'grove-a', hint: { cellX: 5, cellY: 6 } });
    const miss = new Ray(new Vector3(3, 20, 3), new Vector3(0, -1, 0), 100);
    expect(scene.pickWithRay(miss, groveRayPredicate(miss))!.hit).toBe(false);
    expect(groveRayPredicate(miss)(MeshBuilder.CreateBox('other', {}, scene), 0)).toBe(false);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
