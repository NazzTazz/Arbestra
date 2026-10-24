import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';

export const RENDER_SWITCHES = {
  lightsEnabled: 'Éclairage',
  particlesEnabled: 'Particules',
  fogEnabled: 'Brouillard',
  postProcessesEnabled: 'Post-traitements',
  renderTargetsEnabled: 'Rendus intermédiaires',
} as const;
export type RenderSwitch = keyof typeof RENDER_SWITCHES;
export interface MeshFamily {
  family: string;
  meshes: number;
  enabled: number;
  vertices: number;
  hidden: boolean;
}

/** Family of a mesh: its name without trailing identifiers or indexes. */
export function meshFamily(name: string): string {
  return (
    name
      .split(/[:#]/)[0]!
      .replace(/[-_ ]?[0-9a-f]{8}-[0-9a-f-]+.*$/i, '')
      .replace(/[-_ ]?\d+$/, '') || '(sans nom)'
  );
}

/**
 * Measurement switches for a live scene: Babylon's own global switches, and
 * hiding whole mesh families from the camera (layerMask, which no other scene
 * code touches) to compare GPU frame times with and without them.
 */
export class RenderLab {
  readonly #hidden = new Set<string>();
  readonly #masks = new WeakMap<AbstractMesh, number>();
  readonly #added = new Set<AbstractMesh>();
  constructor(private readonly scene: Scene) {
    // Streamed or rebuilt meshes of a hidden family stay hidden. A mesh is
    // announced before Babylon finishes initializing it: apply before rendering.
    scene.onNewMeshAddedObservable.add((mesh) => {
      if (this.#hidden.size) this.#added.add(mesh);
    });
    scene.onBeforeRenderObservable.add(() => {
      for (const mesh of this.#added) if (this.#hidden.has(meshFamily(mesh.name))) this.#hide(mesh);
      this.#added.clear();
    });
  }
  switches(): Record<RenderSwitch, boolean> {
    const values = {} as Record<RenderSwitch, boolean>;
    for (const key of Object.keys(RENDER_SWITCHES) as RenderSwitch[]) values[key] = this.scene[key];
    return values;
  }
  setSwitch(key: RenderSwitch, value: boolean): void {
    this.scene[key] = value;
  }
  families(): MeshFamily[] {
    const families = new Map<string, MeshFamily>();
    for (const mesh of this.scene.meshes) {
      const family = meshFamily(mesh.name);
      const entry = families.get(family) ?? {
        family,
        meshes: 0,
        enabled: 0,
        vertices: 0,
        hidden: this.#hidden.has(family),
      };
      entry.meshes++;
      if (mesh.isEnabled() && mesh.isVisible) {
        entry.enabled++;
        entry.vertices += mesh.getTotalVertices();
      }
      families.set(family, entry);
    }
    return [...families.values()].sort((a, b) => b.vertices - a.vertices || b.meshes - a.meshes);
  }
  setFamilyHidden(family: string, hidden: boolean): void {
    if (hidden) this.#hidden.add(family);
    else this.#hidden.delete(family);
    for (const mesh of this.scene.meshes)
      if (meshFamily(mesh.name) === family) {
        if (hidden) this.#hide(mesh);
        else if (this.#masks.has(mesh)) {
          mesh.layerMask = this.#masks.get(mesh)!;
          this.#masks.delete(mesh);
        }
      }
  }
  #hide(mesh: AbstractMesh) {
    if (!this.#masks.has(mesh)) this.#masks.set(mesh, mesh.layerMask);
    mesh.layerMask = 0;
  }
}
