import '@babylonjs/core/Meshes/thinInstanceMesh';
import {
  roadAnchorAccessories,
  roadAnchorSubPoint,
  wrapCoordinate,
  type RoadAnchor,
  type RoadAnchorAccessoryView,
} from '@arbestra/contracts';
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { brazierMasonry, VillageBraziers, type BrazierPoint } from './village-braziers';
import type { WorldSpace } from './world-space';

type Cell = { cellX: number; cellY: number };
type Stored = ReadonlyArray<Pick<RoadAnchor, 'vertexX' | 'vertexY' | 'accessory'>>;
/** Height of the ground at a continuous cell position, null where not yet published. */
export type AnchorGround = (x: number, y: number) => number | null;

/** Legacy fires within this many eighths of an anchor hide its brazier (one visible fire). */
const LEGACY_OVERLAP = 2;

/**
 * Braziers of the road anchors (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §5):
 * the manual and automatic accessories of `roadAnchorAccessories`, drawn by the
 * existing fire service (instanced masonry, bounded particles and clustered
 * lights). A state change diffs the accessories by vertex: only the fires of
 * changed anchors are created or disposed; a ground or origin change moves the
 * existing fires. Until S3, an anchor whose position holds a legacy fire
 * (automatic brazier of the stroke plan or legacy equipment) is not drawn twice.
 */
export class RoadAnchorBraziers {
  readonly fires: VillageBraziers;
  #cells: readonly Cell[] | undefined = undefined;
  #stored: Stored | undefined = undefined;
  #legacy: ReadonlySet<string> | undefined = undefined;
  #world = '';
  #ground: string | undefined = undefined;
  #views: RoadAnchorAccessoryView[] = [];
  /** Anchors hidden because a legacy fire stands there (browser check). */
  hiddenByLegacy = 0;
  constructor(scene: Scene) {
    this.fires = new VillageBraziers(scene);
  }
  /** Returns the number of fires created or disposed (0 when nothing changed). */
  update(
    cells: readonly Cell[] | undefined,
    stored: Stored | undefined,
    space: WorldSpace,
    ground: AnchorGround,
    legacy: ReadonlySet<string> | undefined,
    groundIdentity: string | undefined,
  ): number {
    const world = `${space.width}:${space.height}`,
      sameAccessories =
        cells === this.#cells && stored === this.#stored && legacy === this.#legacy && world === this.#world,
      placement = `${groundIdentity}|${space.version}`;
    if (sameAccessories && placement === this.#ground) return 0;
    if (!sameAccessories) {
      const shape = { widthCells: space.width, heightCells: space.height };
      const views = roadAnchorAccessories(cells ?? [], stored ?? [], shape);
      this.#views = legacy?.size ? views.filter((v) => !nearLegacy(v, legacy, shape)) : views;
      this.hiddenByLegacy = views.length - this.#views.length;
      this.#cells = cells;
      this.#stored = stored;
      this.#legacy = legacy;
      this.#world = world;
    }
    this.#ground = placement;
    const points: BrazierPoint[] = [];
    for (const v of this.#views) {
      const height = ground(v.vertexX - 0.5, v.vertexY - 0.5);
      if (height === null) continue;
      const p = space.project({ cellX: v.vertexX - 0.5, cellY: v.vertexY - 0.5 });
      points.push({
        x: p.x,
        // Above the road tiles, laid 2 cm over the highest sampled ground point.
        y: height + 0.03,
        z: p.z,
        seed: ((v.vertexX * 13 + v.vertexY * 7) % 97) / 97,
        // Not an equipment id: anchor fires are not picked by the legacy tools.
        renderKey: `anchor:${v.vertexX}:${v.vertexY}`,
      });
    }
    const before = this.fires.stats.created + this.fires.stats.removed;
    this.fires.updatePoints(points);
    return this.fires.stats.created + this.fires.stats.removed - before;
  }
  animate(now: number, night: boolean, alpha: number) {
    this.fires.animate(now, night, alpha);
  }
  dispose() {
    this.fires.dispose();
  }
}

function nearLegacy(
  v: RoadAnchorAccessoryView,
  legacy: ReadonlySet<string>,
  world: { widthCells: number; heightCells: number },
): boolean {
  const p = roadAnchorSubPoint(v, world);
  for (let dy = -LEGACY_OVERLAP; dy <= LEGACY_OVERLAP; dy++)
    for (let dx = -LEGACY_OVERLAP; dx <= LEGACY_OVERLAP; dx++)
      if (
        legacy.has(
          `${wrapCoordinate(p.x + dx, world.widthCells * 8)}:${wrapCoordinate(p.y + dy, world.heightCells * 8)}`,
        )
      )
        return true;
  return false;
}

/**
 * Highlighted anchors of the lighting tool: one thin instance per anchor near
 * the pointer, the whole (bounded) set rewritten when the pointer reaches
 * another vertex. Positions are in the local plane; `shift` follows a rebase.
 */
export class RoadAnchorMarkers {
  readonly #mesh: Mesh;
  readonly #material: StandardMaterial;
  // The snapped anchor glows: a bright core over a wide, faint halo (no glow
  // layer, which would add a full-screen pass to every frame).
  readonly #core: Mesh;
  readonly #halo: Mesh;
  readonly #coreMaterial: StandardMaterial;
  readonly #haloMaterial: StandardMaterial;
  constructor(scene: Scene) {
    const disc = (name: string, material: StandardMaterial) => {
      const mesh = MeshBuilder.CreateCylinder(name, { diameter: 1, height: 1, tessellation: 32 }, scene);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      return mesh;
    };
    const flat = (name: string, colour: string, alpha: number) => {
      const material = new StandardMaterial(name, scene);
      material.specularColor = Color3.Black();
      material.disableLighting = true;
      material.emissiveColor = Color3.FromHexString(colour);
      material.alpha = alpha;
      return material;
    };
    this.#material = flat('road-anchor-markers', '#5aa8e6', 0.55);
    this.#coreMaterial = flat('road-anchor-snap-core', '#c8f0ff', 0.95);
    this.#haloMaterial = flat('road-anchor-snap-halo', '#7fd0ff', 0.45);
    this.#mesh = disc('road-anchor-markers', this.#material);
    this.#core = disc('road-anchor-snap-core', this.#coreMaterial);
    this.#halo = disc('road-anchor-snap-halo', this.#haloMaterial);
  }
  /** Discs drawn: the free anchors, plus the snapped one. */
  get count() {
    return this.#mesh.thinInstanceCount + (this.#snapped ? 1 : 0);
  }
  get #meshes() {
    return [this.#mesh, this.#core, this.#halo];
  }
  /** Replaces the markers (x, y, z in the local plane); bounded by the caller. */
  set(
    points: ReadonlyArray<{ x: number; y: number; z: number }>,
    size: number,
    removing: boolean,
    snapped: { x: number; y: number; z: number } | null = null,
  ) {
    this.#material.emissiveColor = Color3.FromHexString(removing ? '#e6865a' : '#5aa8e6');
    this.#coreMaterial.emissiveColor = Color3.FromHexString(removing ? '#ffd2b8' : '#c8f0ff');
    this.#haloMaterial.emissiveColor = Color3.FromHexString(removing ? '#ff9a6a' : '#7fd0ff');
    const free = snapped ? points.filter((p) => p.x !== snapped.x || p.z !== snapped.z) : points,
      buffer = new Float32Array(free.length * 16),
      m = new Matrix(),
      at = new Vector3();
    const place = (mesh: Mesh, p: { x: number; y: number; z: number }) =>
      at.set(p.x - mesh.position.x, p.y, p.z - mesh.position.z);
    free.forEach((p, i) => {
      Matrix.ComposeToRef(new Vector3(size, 0.02, size), Quaternion.Identity(), place(this.#mesh, p), m);
      m.copyToArray(buffer, i * 16);
    });
    this.#mesh.thinInstanceSetBuffer('matrix', buffer, 16, false);
    this.#mesh.setEnabled(free.length > 0);
    this.#snapped = snapped !== null;
    // Placing, the brazier ghost stands on the snapped anchor: only the halo
    // remains under it, so the core does not hide the ghost.
    this.#cored = this.#snapped && removing;
    for (const [mesh, scale, lift] of [
      [this.#core, size * 1.15, 0.02],
      [this.#halo, size * 2.4, 0],
    ] as const) {
      if (snapped) {
        mesh.scaling.set(scale, 0.02, scale);
        mesh.position.set(snapped.x, snapped.y + lift, snapped.z);
      }
    }
    this.#core.setEnabled(this.#cored);
    this.#halo.setEnabled(this.#snapped);
  }
  #snapped = false;
  #cored = false;
  clear() {
    if (!this.#mesh.thinInstanceCount && !this.#snapped) return;
    this.#mesh.thinInstanceCount = 0;
    this.#snapped = this.#cored = false;
    for (const mesh of this.#meshes) mesh.setEnabled(false);
  }
  visible(value: boolean) {
    this.#mesh.setEnabled(value && this.#mesh.thinInstanceCount > 0);
    this.#core.setEnabled(value && this.#cored);
    this.#halo.setEnabled(value && this.#snapped);
  }
  shift(x: number, z: number) {
    for (const mesh of this.#meshes) {
      mesh.position.x -= x;
      mesh.position.z -= z;
    }
  }
  dispose() {
    for (const mesh of this.#meshes) mesh.dispose();
    for (const material of [this.#material, this.#coreMaterial, this.#haloMaterial]) material.dispose();
  }
}

/**
 * Translucent brazier following the pointer of the lighting tool: faint where
 * it floats, clearer once it snaps to an anchor where it can be placed. One
 * mesh moved per pointer sample; nothing else is rebuilt.
 */
export class RoadAnchorGhost {
  readonly #mesh: Mesh;
  readonly #material: StandardMaterial;
  constructor(scene: Scene) {
    this.#material = new StandardMaterial('road-anchor-ghost', scene);
    this.#material.specularColor = Color3.Black();
    this.#material.disableLighting = true;
    this.#material.emissiveColor = Color3.FromHexString('#bfe6ff');
    this.#mesh = brazierMasonry(scene, this.#material, 'road-anchor-ghost');
    this.#mesh.setEnabled(false);
  }
  get shown() {
    return this.#mesh.isEnabled();
  }
  get position() {
    return this.#mesh.position;
  }
  /** Shows the ghost at `point` (local plane), or hides it with null. */
  set(point: { x: number; y: number; z: number } | null, snapped: boolean) {
    if (!point) {
      this.#mesh.setEnabled(false);
      return;
    }
    this.#material.alpha = snapped ? 0.6 : 0.25;
    this.#mesh.position.set(point.x, point.y, point.z);
    this.#mesh.setEnabled(true);
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
