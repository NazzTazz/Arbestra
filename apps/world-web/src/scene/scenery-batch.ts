import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

export interface SceneryPart { geometry: VertexData; material: StandardMaterial; position: Vector3; scaling: Vector3; rotation: Vector3 }
export function cloneWoodland(source: Mesh, name: string, transforms: Float32Array): Mesh {
  const mesh = source.clone(name)!;
  // Babylon stores world0..world3 on Geometry, not on the mesh. Clones must
  // own their geometry before installing different thin-instance matrices.
  mesh.makeGeometryUnique();
  mesh.setEnabled(true); mesh.isPickable = false;
  mesh.thinInstanceSetBuffer('matrix', transforms, 16, true);
  mesh.thinInstanceRefreshBoundingInfo();
  return mesh;
}
/** Bake bounded recipes without allocating a Babylon mesh for every branch. */
export function bakeScenery(scene: Scene, parts: SceneryPart[], shared?: MultiMaterial): Mesh[] {
  const groups = new Map<StandardMaterial, { positions: number[]; normals: number[]; indices: number[] }>();
  const point = new Vector3(), normal = new Vector3();
  for (const part of parts) {
    let group = groups.get(part.material);
    if (!group) { group = { positions: [], normals: [], indices: [] }; groups.set(part.material, group); }
    const base = group.positions.length / 3;
    const quaternion = Quaternion.RotationYawPitchRoll(part.rotation.y, part.rotation.x, part.rotation.z);
    const transform = Matrix.Compose(part.scaling, quaternion, part.position), rotation = Matrix.FromQuaternionToRef(quaternion, Matrix.Identity());
    const vertices = part.geometry.positions!, normals = part.geometry.normals!;
    for (let i = 0; i < vertices.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(vertices[i]!, vertices[i + 1]!, vertices[i + 2]!, transform, point);
      group.positions.push(point.x, point.y, point.z);
      Vector3.TransformNormalFromFloatsToRef(normals[i]! / part.scaling.x, normals[i + 1]! / part.scaling.y, normals[i + 2]! / part.scaling.z, rotation, normal);
      normal.normalize(); group.normals.push(normal.x, normal.y, normal.z);
    }
    for (const index of part.geometry.indices!) group.indices.push(base + index);
  }
  if (shared && groups.size) {
    const data = new VertexData(), positions: number[] = [], normals: number[] = [], indices: number[] = [];
    const ranges: Array<{ material: number; vertexStart: number; vertexCount: number; indexStart: number; indexCount: number }> = [];
    for (const [material, group] of groups) {
      const vertexStart = positions.length / 3, indexStart = indices.length;
      positions.push(...group.positions); normals.push(...group.normals);
      for (const index of group.indices) indices.push(vertexStart + index);
      ranges.push({ material: shared.subMaterials.indexOf(material), vertexStart, vertexCount: group.positions.length / 3, indexStart, indexCount: group.indices.length });
    }
    const mesh = new Mesh('scenery-woodland', scene); data.positions = positions; data.normals = normals; data.indices = indices;
    data.applyToMesh(mesh); mesh.material = shared; mesh.isPickable = false; mesh.releaseSubMeshes();
    for (const range of ranges) new SubMesh(range.material, range.vertexStart, range.vertexCount, range.indexStart, range.indexCount, mesh);
    return [mesh];
  }
  return [...groups].map(([material, group]) => {
    const mesh = new Mesh(`scenery-${material.name}`, scene), data = new VertexData();
    data.positions = group.positions; data.normals = group.normals; data.indices = group.indices;
    data.applyToMesh(mesh); mesh.material = material; mesh.isPickable = false; return mesh;
  });
}
