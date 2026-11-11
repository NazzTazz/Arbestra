import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { expect, it, vi } from 'vitest';
import { Ray } from '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Culling/ray';
import { bakeScenery, cloneWoodland } from './scenery-batch';

it('keeps woodland GPU positions independent when another grove is created or disposed', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const material = new StandardMaterial('leaves', scene);
    const source = bakeScenery(scene, [
      {
        geometry: VertexData.CreateBox({ size: 1 }),
        material,
        position: Vector3.Zero(),
        scaling: Vector3.One(),
        rotation: Vector3.Zero(),
      },
    ])[0]!;
    source.setEnabled(false);
    const first = cloneWoodland(source, 'first', new Float32Array(Matrix.Translation(10, 0, 0).toArray()));
    const firstBuffer = first.getVertexBuffer('world3');
    const second = cloneWoodland(source, 'second', new Float32Array(Matrix.Translation(90, 0, 0).toArray()));
    expect(first.getVertexBuffer('world3')).toBe(firstBuffer);
    expect(first.getVertexBuffer('world3')).not.toBe(second.getVertexBuffer('world3'));
    expect((first.getVertexBuffer('world3')!.getData() as Float32Array)[12]).toBe(10);
    second.dispose(false, false);
    expect((first.getVertexBuffer('world3')!.getData() as Float32Array)[12]).toBe(10);
    expect(first.getBoundingInfo().boundingSphere.centerWorld.x).toBe(10);
    expect(source.getVertexBuffer('world3')).toBeFalsy();
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it('shares the kit geometry between groves: no vertex copy, independent trees, safe disposal, picking kept', () => {
  // A grove copied its whole tree piece and re-uploaded it (makeGeometryUnique):
  // 22 to 50 ms per grove of about ten trees (Bressuire, 11 November).
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const material = new StandardMaterial('bark', scene);
    const source = bakeScenery(scene, [
      {
        geometry: VertexData.CreateBox({ size: 1 }),
        material,
        position: Vector3.Zero(),
        scaling: Vector3.One(),
        rotation: Vector3.Zero(),
      },
    ])[0]!;
    source.setEnabled(false);
    const references = source.geometry!.getIndexBuffer()!.references;
    const cloned = vi.spyOn(source, 'clone');
    const created = vi.spyOn(engine, 'createVertexBuffer'),
      indices = vi.spyOn(engine, 'createIndexBuffer');
    const groves = [10, 30, 50].map((x) =>
      cloneWoodland(source, `grove-${x}`, new Float32Array(Matrix.Translation(x, 0, 0).toArray()), false),
    );
    // Only the matrices are new buffers: four per grove (world0..world3 share one), no vertex data.
    expect(indices).not.toHaveBeenCalled();
    // Nor Mesh.clone, which copies every property by introspection (about 1 ms per piece).
    expect(cloned).not.toHaveBeenCalled();
    expect(created.mock.calls.every(([data]) => (data as ArrayLike<number>).length === 16)).toBe(true);
    for (const grove of groves) {
      for (const kind of ['position', 'normal'])
        expect(grove.getVertexBuffer(kind)!.getBuffer()).toBe(source.getVertexBuffer(kind)!.getBuffer());
      expect(grove.geometry!.getIndexBuffer()).toBe(source.geometry!.getIndexBuffer());
      expect(grove.getIndices()).toHaveLength(source.getIndices()!.length);
      grove.thinInstanceEnablePicking = true;
    }
    expect((groves[1]!.getVertexBuffer('world3')!.getData() as Float32Array)[12]).toBe(30);
    // Picking finds the grove's own tree.
    const hit = scene.pickWithRay(new Ray(new Vector3(30, 10, 0), new Vector3(0, -1, 0)), (m) =>
      groves.includes(m as never),
    );
    expect(hit?.pickedMesh?.name).toBe('grove-30');
    // Disposing groves never frees the kit: the source keeps rendering data.
    for (const grove of groves) grove.dispose(false, false);
    expect(source.geometry!.getIndexBuffer()!.references).toBe(references);
    expect(source.getVertexBuffer('position')!.getData()).toBeTruthy();
    const again = cloneWoodland(source, 'again', new Float32Array(Matrix.Translation(70, 0, 0).toArray()));
    expect(again.getTotalVertices()).toBe(source.getTotalVertices());
    expect(again.getBoundingInfo().boundingSphere.centerWorld.x).toBeCloseTo(70);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it('uploads one geometry while preserving each transformed part and its shared material', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const red = new StandardMaterial('red', scene),
      blue = new StandardMaterial('blue', scene),
      shared = new MultiMaterial('shared', scene);
    shared.subMaterials = [red, blue];
    const geometry = VertexData.CreateBox({ size: 1 });
    const meshes = bakeScenery(
      scene,
      [red, blue].map((material, i) => ({
        geometry,
        material,
        position: new Vector3(i * 10, 2, 3),
        scaling: new Vector3(2, 1, 1),
        rotation: Vector3.Zero(),
      })),
      shared,
    );
    expect(meshes).toHaveLength(1);
    expect(scene.geometries).toHaveLength(1);
    const mesh = meshes[0]!;
    expect(mesh.subMeshes.map((s) => s.getMaterial())).toEqual([red, blue]);
    expect(mesh.getTotalVertices()).toBe((geometry.positions!.length / 3) * 2);
    const bounds = mesh.getBoundingInfo().boundingBox;
    expect(bounds.minimum.asArray()).toEqual([-1, 1.5, 2.5]);
    expect(bounds.maximum.asArray()).toEqual([11, 2.5, 3.5]);
    mesh.dispose(false, false);
    expect(scene.geometries).toHaveLength(0);
    expect(shared.subMaterials[0]).toBe(red);
    expect(shared.subMaterials[1]).toBe(blue);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
