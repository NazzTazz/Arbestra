import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { expect, it } from 'vitest';
import { bakeScenery, cloneWoodland } from './scenery-batch';

it('keeps woodland GPU positions independent when another grove is created or disposed', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const material = new StandardMaterial('leaves', scene);
    const source = bakeScenery(scene, [{ geometry: VertexData.CreateBox({ size: 1 }), material,
      position: Vector3.Zero(), scaling: Vector3.One(), rotation: Vector3.Zero() }])[0]!;
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
  } finally { scene.dispose(); engine.dispose(); }
});

it('uploads one geometry while preserving each transformed part and its shared material', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const red = new StandardMaterial('red', scene), blue = new StandardMaterial('blue', scene), shared = new MultiMaterial('shared', scene);
    shared.subMaterials = [red, blue];
    const geometry = VertexData.CreateBox({ size: 1 });
    const meshes = bakeScenery(scene, [red, blue].map((material, i) => ({ geometry, material,
      position: new Vector3(i * 10, 2, 3), scaling: new Vector3(2, 1, 1), rotation: Vector3.Zero() })), shared);
    expect(meshes).toHaveLength(1); expect(scene.geometries).toHaveLength(1);
    const mesh = meshes[0]!;
    expect(mesh.subMeshes.map(s => s.getMaterial())).toEqual([red, blue]);
    expect(mesh.getTotalVertices()).toBe(geometry.positions!.length / 3 * 2);
    const bounds = mesh.getBoundingInfo().boundingBox;
    expect(bounds.minimum.asArray()).toEqual([-1, 1.5, 2.5]); expect(bounds.maximum.asArray()).toEqual([11, 2.5, 3.5]);
    mesh.dispose(false, false); expect(scene.geometries).toHaveLength(0);
    expect(shared.subMaterials[0]).toBe(red); expect(shared.subMaterials[1]).toBe(blue);
  } finally { scene.dispose(); engine.dispose(); }
});
