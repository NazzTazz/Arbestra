import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { PointLight } from '@babylonjs/core/Lights/pointLight';
import { staticTransformRevision } from './static-transforms';

/** The bounded light path needs nearby receivers, not every static object.
 * Dynamic receivers remain live; LOD/visibility is filtered at query time. */
export class BrazierMeshIndex {
  readonly #cells = new Map<string, AbstractMesh[]>();
  readonly #order = new Map<AbstractMesh, number>();
  #moving: AbstractMesh[] = [];
  #revision = -1;
  readonly #added;
  readonly #removed;
  constructor(private readonly scene: Scene) {
    this.#added = scene.onNewMeshAddedObservable.add(() => {
      this.#revision = -1;
    });
    this.#removed = scene.onMeshRemovedObservable.add(() => {
      this.#revision = -1;
    });
  }
  nearby(lights: readonly PointLight[]): AbstractMesh[] {
    if (this.#revision !== staticTransformRevision(this.scene)) {
      this.#cells.clear();
      this.#order.clear();
      this.#moving = [];
      this.scene.meshes.forEach((mesh, index) => {
        this.#order.set(mesh, index);
        if (!mesh.isWorldMatrixFrozen) {
          this.#moving.push(mesh);
          return;
        }
        const p = mesh.getBoundingInfo().boundingSphere.centerWorld;
        const key = `${Math.floor(p.x / 5)}:${Math.floor(p.z / 5)}`;
        let cell = this.#cells.get(key);
        if (!cell) {
          cell = [];
          this.#cells.set(key, cell);
        }
        cell.push(mesh);
      });
      this.#revision = staticTransformRevision(this.scene);
    }
    const candidates = new Set<AbstractMesh>();
    for (const light of lights) {
      const x = Math.floor(light.position.x / 5),
        z = Math.floor(light.position.z / 5);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          for (const mesh of this.#cells.get(`${x + dx}:${z + dz}`) ?? []) candidates.add(mesh);
    }
    for (const mesh of this.#moving) candidates.add(mesh);
    return [...candidates]
      .filter((mesh) => !mesh.isDisposed() && mesh.isEnabled() && mesh.isVisible)
      .sort((a, b) => this.#order.get(a)! - this.#order.get(b)!);
  }
  dispose(): void {
    this.scene.onNewMeshAddedObservable.remove(this.#added);
    this.scene.onMeshRemovedObservable.remove(this.#removed);
    this.#cells.clear();
    this.#order.clear();
    this.#moving = [];
  }
}
