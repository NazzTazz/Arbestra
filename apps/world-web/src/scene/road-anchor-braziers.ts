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
import { VillageBraziers, type BrazierPoint } from './village-braziers';
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
  constructor(scene: Scene) {
    this.#material = new StandardMaterial('road-anchor-markers', scene);
    this.#material.specularColor = Color3.Black();
    this.#material.diffuseColor = Color3.FromHexString('#ffd27a');
    this.#material.emissiveColor = Color3.FromHexString('#8a5a12');
    this.#material.alpha = 0.75;
    this.#mesh = MeshBuilder.CreateCylinder('road-anchor-markers', { diameter: 1, height: 1, tessellation: 12 }, scene);
    this.#mesh.material = this.#material;
    this.#mesh.isPickable = false;
    this.#mesh.setEnabled(false);
  }
  get count() {
    return this.#mesh.thinInstanceCount;
  }
  /** Replaces the markers (x, y, z in the local plane); bounded by the caller. */
  set(
    points: ReadonlyArray<{ x: number; y: number; z: number }>,
    size: number,
    removing: boolean,
    snapped: { x: number; y: number; z: number } | null = null,
  ) {
    this.#material.diffuseColor = Color3.FromHexString(removing ? '#f0a24a' : '#ffd27a');
    const all = snapped ? [...points, snapped] : points,
      buffer = new Float32Array(all.length * 16),
      m = new Matrix(),
      scale = new Vector3(size, 0.04, size),
      // The anchor the pointer snaps to: wider and taller.
      big = new Vector3(size * 1.8, 0.12, size * 1.8),
      at = new Vector3();
    all.forEach((p, i) => {
      at.set(p.x - this.#mesh.position.x, p.y, p.z - this.#mesh.position.z);
      Matrix.ComposeToRef(snapped && i === points.length ? big : scale, Quaternion.Identity(), at, m);
      m.copyToArray(buffer, i * 16);
    });
    this.#mesh.thinInstanceSetBuffer('matrix', buffer, 16, false);
    this.#mesh.setEnabled(all.length > 0);
  }
  clear() {
    if (!this.#mesh.thinInstanceCount) return;
    this.#mesh.thinInstanceCount = 0;
    this.#mesh.setEnabled(false);
  }
  visible(value: boolean) {
    this.#mesh.setEnabled(value && this.#mesh.thinInstanceCount > 0);
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
