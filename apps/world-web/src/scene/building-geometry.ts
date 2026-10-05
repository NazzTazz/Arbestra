import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';

/** A temporary factory piece: CPU geometry only, with no scene or GPU resources. */
export class BuildingGeometry {
  position = Vector3.Zero();
  rotation = Vector3.Zero();
  rotationQuaternion: Quaternion | null = null;

  constructor(readonly name: string, readonly data: VertexData) {}

  static box(name: string, options: Parameters<typeof CreateBoxVertexData>[0]) {
    return new BuildingGeometry(name, CreateBoxVertexData(options));
  }

  static cylinder(name: string, options: Parameters<typeof CreateCylinderVertexData>[0]) {
    return new BuildingGeometry(name, CreateCylinderVertexData(options));
  }

  getTotalVertices() { return (this.data.positions?.length ?? 0) / 3; }

  getVerticesData(kind: 'uv' | 'color') {
    return kind === 'uv' ? this.data.uvs : this.data.colors;
  }

  setVerticesData(kind: 'uv' | 'color', values: NonNullable<VertexData['uvs']>) {
    if (kind === 'uv') this.data.uvs = values;
    else this.data.colors = values;
  }

  /** Consumes these pieces; upload the returned batch once, after all edits. */
  static merge(parts: readonly BuildingGeometry[]) {
    if (!parts.length) throw new Error('Cannot merge an empty building batch');
    const transformed = parts.map(part => part.data.transform(Matrix.Compose(
      Vector3.One(),
      part.rotationQuaternion ?? Quaternion.RotationYawPitchRoll(part.rotation.y, part.rotation.x, part.rotation.z),
      part.position,
    )));
    return transformed[0]!.merge(transformed.slice(1), true);
  }
}
