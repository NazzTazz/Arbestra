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
const HIDDEN = Matrix.Scaling(0, 0, 0);

/**
 * Designated road cells of a gesture in progress: one thin instance per cell,
 * added once (O(1) per new cell, never a rebuild of the designation). A cell
 * the quote refuses (skipped by the placement) moves, once, to a red mesh of
 * its own while the rest of the designation keeps the gesture's tone.
 * Positions are in the local plane; `shift` follows a rebased origin.
 */
export class RoadCellPreview {
  readonly #mesh: Mesh;
  readonly #material: StandardMaterial;
  readonly #refusedMesh: Mesh;
  readonly #refusedMaterial: StandardMaterial;
  /** Instance index of each laid cell in the toned mesh. */
  readonly #keys = new Map<string, number>();
  readonly #refused = new Set<string>();
  constructor(scene: Scene) {
    this.#material = new StandardMaterial('road-cell-preview', scene);
    this.#material.specularColor = Color3.Black();
    this.#material.alpha = 0.6;
    this.#mesh = MeshBuilder.CreateBox('road-cell-preview', { size: 1 }, scene);
    this.#mesh.material = this.#material;
    this.#mesh.isPickable = false;
    this.#mesh.setEnabled(false);
    this.#refusedMaterial = new StandardMaterial('road-cell-preview-refused', scene);
    this.#refusedMaterial.specularColor = Color3.Black();
    this.#refusedMaterial.alpha = 0.7;
    this.#refusedMaterial.diffuseColor = Color3.FromHexString(TONES.invalid.diffuse);
    this.#refusedMaterial.emissiveColor = Color3.FromHexString(TONES.invalid.emissive);
    this.#refusedMesh = MeshBuilder.CreateBox('road-cell-preview-refused', { size: 1 }, scene);
    this.#refusedMesh.material = this.#refusedMaterial;
    this.#refusedMesh.isPickable = false;
    this.#refusedMesh.parent = this.#mesh;
    this.#refusedMesh.setEnabled(false);
    this.tone('place');
  }
  get count() {
    return this.#keys.size;
  }
  get refusedCount() {
    return this.#refused.size;
  }
  tone(tone: RoadCellPreviewTone) {
    this.#material.diffuseColor = Color3.FromHexString(TONES[tone].diffuse);
    this.#material.emissiveColor = Color3.FromHexString(TONES[tone].emissive);
  }
  /** Lays one cell; a key already laid is ignored. A refused cell is shown
   * red from then on (a cell refused before being laid is laid red). */
  add(key: string, x: number, y: number, z: number, size: number, refused = false) {
    const local = () =>
      Matrix.Compose(
        new Vector3(size, 0.05, size),
        Quaternion.Identity(),
        new Vector3(x - this.#mesh.position.x, y, z - this.#mesh.position.z),
      );
    if (!this.#keys.has(key)) {
      this.#keys.set(key, this.#mesh.thinInstanceAdd(refused ? HIDDEN : local()));
      this.#mesh.setEnabled(true);
    }
    if (!refused || this.#refused.has(key)) return;
    this.#refused.add(key);
    this.#mesh.thinInstanceSetMatrixAt(this.#keys.get(key)!, HIDDEN);
    // Parented to the toned mesh: same local plane, one rebase.
    this.#refusedMesh.thinInstanceAdd(local());
    this.#refusedMesh.setEnabled(true);
  }
  clear() {
    this.#keys.clear();
    this.#refused.clear();
    this.#mesh.thinInstanceCount = 0;
    this.#refusedMesh.thinInstanceCount = 0;
    this.#mesh.setEnabled(false);
    this.#refusedMesh.setEnabled(false);
  }
  visible(value: boolean) {
    this.#mesh.setEnabled(value && this.#keys.size > 0);
  }
  shift(x: number, z: number) {
    this.#mesh.position.x -= x;
    this.#mesh.position.z -= z;
  }
  dispose() {
    this.#refusedMesh.dispose();
    this.#mesh.dispose();
    this.#refusedMaterial.dispose();
    this.#material.dispose();
  }
}
