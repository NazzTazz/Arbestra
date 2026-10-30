import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';

/** A flat patch laid on a surface (garden cell), in local plane coordinates. */
export interface DemolitionPatch {
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
}
const PULSE_MS = 1200,
  TINT = new Color3(1, 0.36, 0.3),
  GLOW = new Color3(0.7, 0.08, 0.05);

/**
 * Colours designated targets red, pulsing. Volumes (buildings, braziers) are drawn by
 * tinted copies of their own meshes, the originals hidden meanwhile; surfaces (roads,
 * gardens) get a red skin following their shape. Tinted materials and sources are
 * cached per original, so the pulse costs one colour per distinct material.
 */
export class DemolitionTint {
  readonly #red: StandardMaterial;
  readonly #patches: Mesh;
  readonly #patchKeys = new Set<string>();
  #road: Mesh | null = null;
  readonly #materials = new Map<Material, StandardMaterial>();
  readonly #sources = new Map<Mesh, Mesh>();
  readonly #tinted = new Map<string, Array<{ original: AbstractMesh; copy: AbstractMesh }>>();
  #pulse: Observer<Scene> | null = null;
  constructor(private scene: Scene) {
    this.#red = new StandardMaterial('demolition-skin', scene);
    this.#red.diffuseColor = Color3.FromHexString('#d2382c');
    this.#red.specularColor = Color3.Black();
    this.#patches = MeshBuilder.CreateBox('demolition-patches', { size: 1 }, scene);
    this.#patches.material = this.#red;
    this.#patches.isPickable = false;
    this.#patches.setEnabled(false);
  }
  /** Copies made for `key`; zero while its baked model is still loading. */
  count(key: string) {
    return this.#tinted.get(key)?.length ?? 0;
  }
  /** Colours every visible mesh under `roots`; colouring a key again replaces its copies. */
  tint(key: string, roots: readonly AbstractMesh[]) {
    this.untint(key);
    const pairs: Array<{ original: AbstractMesh; copy: AbstractMesh }> = [];
    for (const root of roots)
      for (const original of [root, ...root.getChildMeshes()]) {
        if (!original.isVisible || original.isDisposed() || !original.getTotalVertices()) continue;
        const copy = this.#copy(original, `${original.name}-demolition`);
        if (!copy) continue;
        copy.metadata = original.metadata;
        copy.isPickable = original.isPickable;
        copy.parent = original;
        copy.position.setAll(0);
        copy.rotation.setAll(0);
        copy.rotationQuaternion = null;
        copy.scaling.setAll(1);
        copy.computeWorldMatrix(true);
        // Rebasing refreshes a frozen hierarchy, these children included.
        if (original.isWorldMatrixFrozen) copy.freezeWorldMatrix();
        original.isVisible = false;
        pairs.push({ original, copy });
      }
    if (!pairs.length) return;
    this.#tinted.set(key, pairs);
    this.#startPulse();
  }
  untint(key: string) {
    for (const { original, copy } of this.#tinted.get(key) ?? []) {
      if (!original.isDisposed()) original.isVisible = true;
      copy.dispose(false, false);
    }
    this.#tinted.delete(key);
  }
  /** Adds one flat patch; a key already laid is ignored. */
  patch(key: string, p: DemolitionPatch) {
    if (this.#patchKeys.has(key)) return;
    this.#patchKeys.add(key);
    this.#patches.thinInstanceAdd(
      Matrix.Compose(
        new Vector3(p.width, 0.03, p.depth),
        Quaternion.Identity(),
        new Vector3(p.x - this.#patches.position.x, p.y, p.z - this.#patches.position.z),
      ),
    );
    this.#patches.setEnabled(true);
    this.#startPulse();
  }
  /** Replaces the road skin, built from the exact designated road pixels. */
  road(data: VertexData | null) {
    this.#road?.dispose(false, false);
    this.#road = null;
    if (!data?.indices?.length) return;
    this.#road = new Mesh('demolition-road', this.scene);
    data.applyToMesh(this.#road);
    this.#road.material = this.#red;
    this.#road.isPickable = false;
    this.#startPulse();
  }
  clear() {
    for (const key of [...this.#tinted.keys()]) this.untint(key);
    this.#patchKeys.clear();
    this.#patches.thinInstanceCount = 0;
    this.#patches.setEnabled(false);
    this.road(null);
    if (this.#pulse) this.scene.onBeforeRenderObservable.remove(this.#pulse);
    this.#pulse = null;
  }
  /** Follows the local plane when the world origin is rebased; copies follow their originals. */
  shift(x: number, z: number) {
    for (const mesh of [this.#patches, this.#road]) {
      if (!mesh) continue;
      mesh.position.x -= x;
      mesh.position.z -= z;
    }
  }
  dispose() {
    this.clear();
    this.#patches.dispose();
    for (const source of this.#sources.values()) source.dispose(false, false);
    for (const material of this.#materials.values()) material.dispose();
    this.#red.dispose();
  }
  #copy(original: AbstractMesh, name: string): AbstractMesh | null {
    if (original instanceof InstancedMesh) {
      // Copies keep sharing draws: one tinted source per original source.
      let source = this.#sources.get(original.sourceMesh);
      if (!source) {
        source = original.sourceMesh.clone(`${original.sourceMesh.name}-demolition`, null, true);
        source.material = this.#material(original.sourceMesh.material);
        source.isVisible = false;
        source.isPickable = false;
        this.#sources.set(original.sourceMesh, source);
      }
      return source.createInstance(name);
    }
    if (!(original instanceof Mesh) || original.hasThinInstances) return null;
    const copy = original.clone(name, null, true);
    copy.material = this.#material(original.material);
    return copy;
  }
  #material(original: Material | null): Material {
    if (!(original instanceof StandardMaterial)) return this.#red;
    let tinted = this.#materials.get(original);
    if (!tinted) {
      tinted = original.clone(`${original.name}-demolition`);
      tinted.unfreeze();
      tinted.diffuseColor = original.diffuseColor.multiply(TINT);
      tinted.ambientColor = original.ambientColor.multiply(TINT);
      this.#materials.set(original, tinted);
    }
    return tinted;
  }
  #startPulse() {
    this.#pulse ??= this.scene.onBeforeRenderObservable.add(() => {
      const phase = (performance.now() % PULSE_MS) / PULSE_MS,
        s = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
      for (const material of this.#materials.values()) GLOW.scaleToRef(0.25 + 0.75 * s, material.emissiveColor);
      GLOW.scaleToRef(0.4 + 0.6 * s, this.#red.emissiveColor);
    });
  }
}
