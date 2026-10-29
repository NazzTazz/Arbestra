import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';

export interface DemolitionBox {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}
const PULSE_MS = 1200;

/**
 * Red pulsing volumes over designated targets. One thin-instanced box and one shared
 * material: a frame costs a single alpha update, whatever the number of marks.
 */
export class DemolitionMarks {
  readonly #mesh: Mesh;
  readonly #material: StandardMaterial;
  readonly #keys = new Set<string>();
  #pulse: Observer<Scene> | null = null;
  constructor(private scene: Scene) {
    this.#material = new StandardMaterial('demolition-mark', scene);
    this.#material.diffuseColor = Color3.FromHexString('#d2382c');
    this.#material.emissiveColor = Color3.FromHexString('#8c1a12');
    this.#material.specularColor = Color3.Black();
    this.#material.alpha = 0.4;
    this.#material.backFaceCulling = false;
    this.#mesh = MeshBuilder.CreateBox('demolition-marks', { size: 1 }, scene);
    this.#mesh.material = this.#material;
    this.#mesh.isPickable = false;
    this.#mesh.setEnabled(false);
  }
  get size() {
    return this.#keys.size;
  }
  /** Adds one volume; a key already marked is ignored. */
  add(key: string, box: DemolitionBox) {
    if (this.#keys.has(key)) return;
    this.#keys.add(key);
    this.#mesh.thinInstanceAdd(
      Matrix.Compose(
        new Vector3(box.width, box.height, box.depth),
        Quaternion.Identity(),
        new Vector3(box.x - this.#mesh.position.x, box.y, box.z - this.#mesh.position.z),
      ),
    );
    this.#mesh.setEnabled(true);
    this.#pulse ??= this.scene.onBeforeRenderObservable.add(() => {
      const phase = (performance.now() % PULSE_MS) / PULSE_MS;
      this.#material.alpha = 0.22 + 0.3 * (0.5 - 0.5 * Math.cos(phase * 2 * Math.PI));
    });
  }
  clear() {
    this.#keys.clear();
    this.#mesh.thinInstanceCount = 0;
    this.#mesh.setEnabled(false);
    if (this.#pulse) this.scene.onBeforeRenderObservable.remove(this.#pulse);
    this.#pulse = null;
  }
  /** Follows the local plane when the world origin is rebased. */
  shift(x: number, z: number) {
    this.#mesh.position.x -= x;
    this.#mesh.position.z -= z;
  }
  dispose() {
    this.clear();
    this.#mesh.dispose();
    this.#material.dispose();
  }
}
