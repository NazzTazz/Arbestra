import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BuildingGeometry } from './building-geometry';
import { timberBeamGeometry } from './timber-thatch';

it('preserves the mesh merger positions, normals, grain, colors and winding without temporary GPU geometry', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const pieces = [new BuildingGeometry('stone', timberBeamGeometry(2, .3, .2, true, 1)),
      BuildingGeometry.box('board', { width: 2, height: .05, depth: .4 }),
      BuildingGeometry.cylinder('peg', { diameter: .035, height: .018, tessellation: 6 })];
    pieces[0]!.rotationQuaternion = Quaternion.RotationAxis(Vector3.Forward(), .8);
    pieces[1]!.rotation.set(.1, Math.PI / 2, .4);
    const originals = pieces.map((part, i) => {
      part.position.set(i * .3, i - 1, -i);
      part.data.colors = Array(part.getTotalVertices() * 4).fill(.8 + i * .05);
      const mesh = new Mesh(part.name, scene);
      part.data.applyToMesh(mesh);
      mesh.position.copyFrom(part.position); mesh.rotation.copyFrom(part.rotation);
      mesh.rotationQuaternion = part.rotationQuaternion?.clone() ?? null;
      return mesh;
    });
    const reference = Mesh.MergeMeshes(originals, true, true)!;
    const data = BuildingGeometry.merge(pieces), expected = VertexData.ExtractFromMesh(reference);
    for (const key of ['positions', 'normals', 'uvs', 'colors', 'indices'] as const) {
      expect(data[key]!.length).toBe(expected[key]!.length);
      for (let i = 0; i < data[key]!.length; i++) expect(data[key]![i]).toBeCloseTo(expected[key]![i]!, 5);
    }
    expect(scene.meshes).toHaveLength(1);
  } finally { scene.dispose(); engine.dispose(); }
});
