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
/** One pulse of the demolition red; the Oracle's « Inspecter » shows three. */
export const DEMOLITION_PULSE_MS = 1200;
const PULSE_MS = DEMOLITION_PULSE_MS,
  TINT = new Color3(1, 0.36, 0.3),
  GLOW = new Color3(0.7, 0.08, 0.05),
  TEXTURE_SLOTS = [
    'diffuseTexture',
    'ambientTexture',
    'opacityTexture',
    'reflectionTexture',
    'emissiveTexture',
    'specularTexture',
    'bumpTexture',
    'lightmapTexture',
    'refractionTexture',
  ] as const;
/** The red of a designated target: a copy of `original`, its colours tinted
 * (shared by the scene's pulse and the « Détruire » icon, which keeps `glow`). */
export function demolitionTintedMaterial(original: StandardMaterial, glow = 0): StandardMaterial {
  const tinted = original.clone(`${original.name}-demolition`);
  // The clone copies the textures too, and a copied DynamicTexture (the kit's grains)
  // never becomes ready: the « Détruire » icon then waited forever. Share the originals.
  for (const slot of TEXTURE_SLOTS) {
    const copy = tinted[slot];
    if (copy === original[slot]) continue;
    copy?.dispose();
    tinted[slot] = original[slot];
  }
  tinted.unfreeze();
  tinted.diffuseColor = original.diffuseColor.multiply(TINT);
  tinted.ambientColor = original.ambientColor.multiply(TINT);
  if (glow) tinted.emissiveColor = GLOW.scale(glow);
  return tinted;
}

/** Phase (0..1) of the pulse at `now` for a cycle started at `epoch`; the glow
 * is 0.5 − 0.5·cos(2π·phase): dim at 0, brightest at ½. */
export const demolitionPulsePhase = (now: number, epoch = 0) =>
  ((((now - epoch) % PULSE_MS) + PULSE_MS) % PULSE_MS) / PULSE_MS;

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
  /** Start of the pulse cycle: 0 for designations (the shared clock); a
   * counted pulse (`pulseFrom`) starts dim and ends dim after whole pulses. */
  #epoch = 0;
  constructor(private scene: Scene) {
    this.#red = new StandardMaterial('demolition-skin', scene);
    this.#red.diffuseColor = Color3.FromHexString('#d2382c');
    this.#red.specularColor = Color3.Black();
    this.#patches = MeshBuilder.CreateBox('demolition-patches', { size: 1 }, scene);
    this.#patches.material = this.#red;
    this.#patches.isPickable = false;
    this.#patches.setEnabled(false);
  }
  /** Restarts the pulse cycle at `time` (performance.now()). */
  pulseFrom(time: number) {
    this.#epoch = time;
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
      tinted = demolitionTintedMaterial(original);
      this.#materials.set(original, tinted);
    }
    return tinted;
  }
  #startPulse() {
    this.#pulse ??= this.scene.onBeforeRenderObservable.add(() => {
      const phase = demolitionPulsePhase(performance.now(), this.#epoch),
        s = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
      for (const material of this.#materials.values()) GLOW.scaleToRef(0.25 + 0.75 * s, material.emissiveColor);
      GLOW.scaleToRef(0.4 + 0.6 * s, this.#red.emissiveColor);
    });
  }
}
