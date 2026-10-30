import '@babylonjs/core/Meshes/thinInstanceMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

export type RoadCellPreviewTone = 'place' | 'remove' | 'invalid';
const TONES: Record<RoadCellPreviewTone, { diffuse: string; emissive: string }> = {
  place: { diffuse: '#95caff', emissive: '#244a73' },
  remove: { diffuse: '#f0a24a', emissive: '#6b3a0c' },
  invalid: { diffuse: '#e0645a', emissive: '#bd453b' },
};

/**
 * Designated road cells of a gesture in progress: one thin instance per cell,
 * added once (O(1) per new cell, never a rebuild of the designation).
 * Positions are in the local plane; `shift` follows a rebased origin.
 */
export class RoadCellPreview {
  readonly #mesh: Mesh;
  readonly #material: StandardMaterial;
  readonly #keys = new Set<string>();
  constructor(scene: Scene) {
    this.#material = new StandardMaterial('road-cell-preview', scene);
    this.#material.specularColor = Color3.Black();
    this.#material.alpha = 0.6;
    this.#mesh = MeshBuilder.CreateBox('road-cell-preview', { size: 1 }, scene);
    this.#mesh.material = this.#material;
    this.#mesh.isPickable = false;
    this.#mesh.setEnabled(false);
    this.tone('place');
  }
  get count() {
    return this.#keys.size;
  }
  tone(tone: RoadCellPreviewTone) {
    this.#material.diffuseColor = Color3.FromHexString(TONES[tone].diffuse);
    this.#material.emissiveColor = Color3.FromHexString(TONES[tone].emissive);
  }
  /** Lays one cell; a key already laid is ignored. */
  add(key: string, x: number, y: number, z: number, size: number) {
    if (this.#keys.has(key)) return;
    this.#keys.add(key);
    this.#mesh.thinInstanceAdd(
      Matrix.Compose(
        new Vector3(size, 0.05, size),
        Quaternion.Identity(),
        new Vector3(x - this.#mesh.position.x, y, z - this.#mesh.position.z),
      ),
    );
    this.#mesh.setEnabled(true);
  }
  clear() {
    this.#keys.clear();
    this.#mesh.thinInstanceCount = 0;
    this.#mesh.setEnabled(false);
  }
  visible(value: boolean) {
    this.#mesh.setEnabled(value && this.#keys.size > 0);
  }
  shift(x: number, z: number) {
    this.#mesh.position.x -= x;
    this.#mesh.position.z -= z;
  }
  dispose() {
    this.#mesh.dispose();
    this.#material.dispose();
  }
}
