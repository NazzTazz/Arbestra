import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { NaturalFeature } from '@arbestra/contracts';
import { DEMOLITION_PULSE_MS } from './demolition-tint';
import { HALO_MARKER, HaloMarkerPlugin } from './halo-marker';
import { footprint, RESOURCE_HALO_HALF_SIZE } from './resource-halos';
import type { TerrainStore } from './terrain-store';
import type { WorldSpace } from './world-space';

/**
 * « Inspecter » on a refusal of the ground (a tree, a rock, a protected
 * clearing; Tristan, 2 November, option B: « le halo rouge au sol »,
 * docs/SPEC-TERRAFORMATION-OUTIL.md §7.6): trees and rocks are thin
 * instances that cannot be tinted alone, so a red ring lies at the foot of the
 * one in cause (the cell's centre when none is known) and pulses three times,
 * with the rhythm of the other obstacles (DemolitionTint, 3 × 1.2 s).
 *
 * The ring is the « Onde » marker of the harvest halos (HaloMarkerPlugin, at
 * rest) on the same ground-following footprint; the pulse is its shared
 * opacity, read by the plugin when the material is bound: nothing runs per
 * frame besides that uniform. One temporary mesh and material, created at the
 * inspection and released after the last pulse (or by the next inspection).
 */
export const INSPECT_PULSES = 3;
export const INSPECT_PULSE_MS = DEMOLITION_PULSE_MS;
export const INSPECT_HALO_MS = INSPECT_PULSES * INSPECT_PULSE_MS;
/** Opacity of the ring `elapsed` ms after the inspection: 0.5 − 0.5·cos, as
 * DemolitionTint's glow; dim at the start and end of each pulse, 0 after the last. */
export function inspectHaloOpacity(elapsed: number): number {
  if (elapsed < 0 || elapsed >= INSPECT_HALO_MS) return 0;
  return 0.5 - 0.5 * Math.cos(((elapsed % INSPECT_PULSE_MS) / INSPECT_PULSE_MS) * 2 * Math.PI);
}

type Cell = { cellX: number; cellY: number };
/**
 * The foot of the tree or rock of `cell` nearest to its centre, in cell
 * coordinates (a cell spans ±0.5 around its index, as the ground's samples);
 * the cell's centre when the client knows none there. Once per inspection.
 */
export function natureFoot(
  cell: Cell,
  features: readonly Pick<NaturalFeature, 'rc1'>[],
  world: { widthCells: number; heightCells: number },
): Cell {
  const wrap = (n: number, size: number) => ((n % size) + size) % size;
  let best: Cell | null = null,
    distance = Infinity;
  for (const feature of features)
    for (const p of [...(feature.rc1?.trees ?? []), ...(feature.rc1?.rocks ?? [])]) {
      if (
        wrap(Math.floor(p.x + 0.5), world.widthCells) !== cell.cellX ||
        wrap(Math.floor(p.y + 0.5), world.heightCells) !== cell.cellY
      )
        continue;
      const dx = p.x - Math.floor(p.x + 0.5),
        dy = p.y - Math.floor(p.y + 0.5),
        d = dx * dx + dy * dy;
      if (d < distance) {
        distance = d;
        best = { cellX: cell.cellX + dx, cellY: cell.cellY + dy };
      }
    }
  return best ?? { cellX: cell.cellX, cellY: cell.cellY };
}

export interface InspectHaloClock {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}
const BROWSER: InspectHaloClock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

export class InspectHalo {
  #mesh: Mesh | null = null;
  #material: StandardMaterial | null = null;
  #timer: number | null = null;
  #start = 0;
  constructor(
    private readonly scene: Scene,
    private readonly clock: InspectHaloClock = BROWSER,
  ) {}
  /** A halo is on the ground. */
  get active(): boolean {
    return this.#mesh !== null;
  }
  /** Opacity the material binds now. */
  opacity(): number {
    return inspectHaloOpacity(this.clock.now() - this.#start);
  }
  /** Lays the ring centred on `at` (cell coordinates) and starts its three
   * pulses; false while the ground there is not loaded. */
  show(at: Cell, ground: Pick<TerrainStore, 'ground'>, space: WorldSpace): boolean {
    this.clear();
    const data = footprint(at, ground);
    if (!data) return false;
    const material = new StandardMaterial('inspect-halo', this.scene);
    material.diffuseColor = Color3.Black();
    material.emissiveColor = Color3.FromHexString(HALO_MARKER.clearColour);
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    material.alphaMode = Constants.ALPHA_PREMULTIPLIED;
    new HaloMarkerPlugin(
      material,
      { clock: () => 0, opacity: () => this.opacity(), scale: 1 / RESOURCE_HALO_HALF_SIZE },
      false,
    );
    const mesh = new Mesh('inspect-halo', this.scene);
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.isPickable = false;
    const p = space.project(at);
    mesh.position.set(p.x, 0, p.z);
    this.#mesh = mesh;
    this.#material = material;
    this.#start = this.clock.now();
    this.#timer = this.clock.setTimeout(() => this.clear(), INSPECT_HALO_MS);
    return true;
  }
  /** Follows the local plane when the world origin is rebased. */
  shift(x: number, z: number): void {
    if (!this.#mesh) return;
    this.#mesh.position.x -= x;
    this.#mesh.position.z -= z;
  }
  /** Releases the ring (after its last pulse, or for the next inspection). */
  clear(): void {
    if (this.#timer !== null) this.clock.clearTimeout(this.#timer);
    this.#timer = null;
    this.#mesh?.dispose(false, false);
    this.#material?.dispose();
    this.#mesh = null;
    this.#material = null;
  }
}
