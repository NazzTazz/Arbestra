import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { NaturalFeature, WoodlandTree } from '@arbestra/contracts';
import { groveSlots } from './grove-trees';
import type { Cell } from './construction-selection';
import { haloFlash, HALO_FLASH_MS, haloTexture, RESOURCE_HALO_COLOURS, RESOURCE_HALO_OPACITY } from './resource-halos';
import type { TerrainStore } from './terrain-store';
import { CELL_UNITS, type WorldSpace } from './world-space';

/** A grove whose standing trees each get a halo at their foot. */
export interface TreeHaloGrove {
  featureId: string;
  /** Deposit cell: the selection target of every tree of the grove. */
  cellX: number;
  cellY: number;
  /** Chunk origin the grove's thin instances are projected from (same as the woodland mesh). */
  anchor: Cell;
  /** Deposit revision: the layout changes with the stock. */
  revision: number;
  trees: WoodlandTree[];
}
export type GroveFeature = Pick<NaturalFeature, 'id' | 'cellX' | 'cellY' | 'variantSeed' | 'rc1' | 'deposit'>;

/** The trees of a grove that deserve a halo: the ones drawn, none once cleared or without available stock. */
export function groveHaloTrees(feature: GroveFeature): WoodlandTree[] {
  const deposit = feature.deposit;
  if (!deposit || deposit.resourceCode !== 'wood' || deposit.cleared || deposit.availableAmount <= 0) return [];
  // Around what can be cut: original trees standing and the trunk lying down, not stumps.
  return groveSlots(feature)
    .filter((slot) => slot.standing || slot.lying > 0)
    .map((slot) => slot.tree);
}

export function groveHalo(feature: GroveFeature, chunkSize: number): TreeHaloGrove | null {
  const trees = groveHaloTrees(feature);
  if (!trees.length) return null;
  return {
    featureId: feature.id,
    cellX: feature.cellX,
    cellY: feature.cellY,
    anchor: {
      cellX: Math.floor(feature.cellX / chunkSize) * chunkSize,
      cellY: Math.floor(feature.cellY / chunkSize) * chunkSize,
    },
    revision: feature.deposit!.revision,
    trees,
  };
}

/** Ring radius in scene units, just inside the crown's drip line. */
export const treeHaloRadius = (tree: Pick<WoodlandTree, 'scale'>): number =>
  0.62 * Math.max(0.5, Math.min(1.5, tree.scale));
export const TREE_HALO_LIFT = 0.08;
const RING = 0.7; // Where haloTexture draws its ring, as a fraction of the quad's half-size.
const OPACITY = RESOURCE_HALO_OPACITY;

type Entry = {
  grove: TreeHaloGrove;
  available: boolean;
  pending: boolean;
  select: boolean;
  selectedAt: number | null;
  alpha: number;
  /** Ground revision of the deposit cell the matrices were built with. */
  groundRevision: number;
  /** Space version and deposit revision the matrices were built with. */
  spaceVersion: number;
  revision: number;
  /** The grove's instance matrices, reused while nothing it depends on changed. */
  matrices: Float32Array | null;
  /** Instances actually placed (trees over known terrain). */
  count: number;
  /** Colour written for the instances last frame. */
  colour: [number, number, number, number];
};

function quad(): VertexData {
  const data = new VertexData();
  data.positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
  data.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  data.indices = [0, 2, 1, 0, 3, 2];
  return data;
}

/**
 * One thin-instanced quad per standing tree of the groves on offer, tinted and
 * faded per instance: available / selected flash / fade-out, like the cell halos.
 */
export class TreeHalos {
  readonly #entries = new Map<string, Entry>();
  readonly #mesh: Mesh;
  readonly #material: StandardMaterial;
  readonly #texture: RawTexture;
  readonly #tint = Color3.FromHexString(RESOURCE_HALO_COLOURS.wood);
  #available: TreeHaloGrove[] = [];
  #pending: TreeHaloGrove[] = [];
  #matrices = new Float32Array(0);
  #colours = new Float32Array(0);
  #order: Entry[] = [];
  #layoutDirty = true;
  #spaceVersion = -1;
  #lastTime: number | null = null;
  #instanceCount = 0;
  #pendingShown = 0;
  /** Milliseconds spent rebuilding instance matrices, for diagnostics. */
  rebuildMs = 0;
  rebuilds = 0;
  constructor(private readonly scene: Scene) {
    this.#texture = haloTexture(scene, { name: 'tree-halo-soft', size: 128, core: 0.06, soft: 0.14, fill: 0.16 });
    const material = new StandardMaterial('tree-halo', scene);
    material.diffuseTexture = this.#texture;
    material.useAlphaFromDiffuseTexture = true;
    // White everywhere: the per-instance colour carries the tint and the fade.
    material.diffuseColor = Color3.White();
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    this.#material = material;
    const mesh = new Mesh('tree-halos', scene);
    quad().applyToMesh(mesh);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    this.#mesh = mesh;
  }
  get mesh(): Mesh {
    return this.#mesh;
  }
  get instanceCount(): number {
    return this.#instanceCount;
  }
  setAvailable(groves: TreeHaloGrove[]): void {
    this.#available = groves;
    this.#sync();
  }
  setPending(groves: TreeHaloGrove[]): void {
    this.#pending = groves;
    this.#sync();
  }
  #sync(): void {
    const available = new Map(this.#available.map((g) => [g.featureId, g]));
    const pending = new Map(this.#pending.map((g) => [g.featureId, g]));
    for (const [key, grove] of [...available, ...pending])
      if (!this.#entries.has(key)) {
        this.#entries.set(key, {
          grove,
          available: false,
          pending: false,
          select: false,
          selectedAt: null,
          alpha: 0,
          groundRevision: -1,
          spaceVersion: -1,
          revision: -1,
          matrices: null,
          count: 0,
          colour: [0, 0, 0, 0],
        });
        this.#layoutDirty = true;
      }
    for (const [key, entry] of this.#entries) {
      const grove = pending.get(key) ?? available.get(key);
      if (grove && grove.revision !== entry.grove.revision) this.#layoutDirty = true;
      if (grove) entry.grove = grove;
      // Trees skipped over unknown terrain get another chance at the next offer.
      if (entry.matrices && entry.count < entry.grove.trees.length) {
        entry.matrices = null;
        this.#layoutDirty = true;
      }
      if (pending.has(key) && !entry.pending) entry.select = true;
      entry.available = available.has(key);
      entry.pending = pending.has(key);
    }
  }
  /** A grove's instance matrices: one per tree over known terrain, tilted to the slope. */
  #place(
    grove: TreeHaloGrove,
    space: WorldSpace,
    ground: Pick<TerrainStore, 'ground' | 'groundRevisionAt'>,
  ): Float32Array {
    // The woodland mesh itself waits for the deposit cell's ground: so do its halos.
    const cellGround = ground.ground(grove.cellX, grove.cellY);
    if (!cellGround) return new Float32Array(0);
    const matrices = new Float32Array(grove.trees.length * 16);
    const normal = new Vector3(),
      rotation = new Quaternion(),
      scaling = new Vector3(),
      position = new Vector3(),
      matrix = new Matrix();
    let placed = 0;
    for (const tree of grove.trees) {
      const foot = tree.elevation === undefined ? cellGround.height : tree.elevation * CELL_UNITS;
      const radius = treeHaloRadius(tree),
        half = radius / RING,
        d = radius / CELL_UNITS;
      const west = ground.ground(tree.x - d, tree.y)?.height,
        east = ground.ground(tree.x + d, tree.y)?.height,
        north = ground.ground(tree.x, tree.y - d)?.height,
        south = ground.ground(tree.x, tree.y + d)?.height;
      if (west === undefined || east === undefined || north === undefined || south === undefined) normal.set(0, 1, 0);
      else normal.set(-(east - west) / (2 * radius), 1, -(south - north) / (2 * radius)).normalize();
      Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, normal, rotation);
      const at = space.projectFrom({ cellX: tree.x, cellY: tree.y }, grove.anchor);
      scaling.set(half, 1, half);
      position.set(at.x, foot + TREE_HALO_LIFT, at.z);
      Matrix.ComposeToRef(scaling, rotation, position, matrix);
      matrix.copyToArray(matrices, placed * 16);
      placed++;
    }
    return placed === grove.trees.length ? matrices : matrices.slice(0, placed * 16);
  }
  #rebuild(space: WorldSpace, ground: Pick<TerrainStore, 'ground' | 'groundRevisionAt'>): void {
    const started = performance.now();
    this.#order = [...this.#entries.values()];
    let placed = 0;
    for (const entry of this.#order) {
      const grove = entry.grove,
        groundRevision = ground.groundRevisionAt(grove.cellX, grove.cellY);
      if (
        !entry.matrices ||
        entry.groundRevision !== groundRevision ||
        entry.spaceVersion !== space.version ||
        entry.revision !== grove.revision
      ) {
        entry.matrices = this.#place(grove, space, ground);
        entry.groundRevision = groundRevision;
        entry.spaceVersion = space.version;
        entry.revision = grove.revision;
      }
      entry.count = entry.matrices.length / 16;
      placed += entry.count;
    }
    const matrices = new Float32Array(placed * 16);
    let offset = 0;
    for (const entry of this.#order) {
      matrices.set(entry.matrices!, offset);
      offset += entry.matrices!.length;
    }
    this.#matrices = matrices;
    this.#colours = new Float32Array(placed * 4);
    this.#instanceCount = placed;
    for (const entry of this.#order) entry.colour = [0, 0, 0, 0];
    if (placed) {
      this.#mesh.thinInstanceSetBuffer('matrix', this.#matrices, 16, true);
      this.#mesh.thinInstanceSetBuffer('color', this.#colours, 4, false);
    } else this.#mesh.thinInstanceSetBuffer('matrix', null, 16);
    this.#spaceVersion = space.version;
    this.#layoutDirty = false;
    this.rebuildMs = performance.now() - started;
    this.rebuilds++;
  }
  update(
    now: number,
    space: WorldSpace,
    ground: Pick<TerrainStore, 'ground' | 'groundRevisionAt'>,
    enabled: boolean,
    zoomOpacity: number,
  ): void {
    const elapsed = this.#lastTime === null ? 0 : Math.max(0, now - this.#lastTime);
    this.#lastTime = now;
    const zoom = Math.max(0, Math.min(1, zoomOpacity));
    for (const [key, entry] of this.#entries) {
      const target =
        enabled && ((entry.available && !entry.pending) || entry.select || entry.selectedAt !== null) ? 1 : 0;
      entry.alpha =
        target > entry.alpha
          ? Math.min(target, entry.alpha + elapsed / 220)
          : Math.max(target, entry.alpha - elapsed / 320);
      if (entry.select && enabled) {
        entry.selectedAt = now;
        entry.select = false;
        entry.alpha = 1;
      }
      if (entry.selectedAt !== null && now - entry.selectedAt >= HALO_FLASH_MS) {
        entry.selectedAt = null;
        entry.alpha = 0;
      }
      if (!entry.available && !entry.pending && !entry.select && entry.selectedAt === null && entry.alpha === 0) {
        this.#entries.delete(key);
        this.#layoutDirty = true;
        continue;
      }
      if (entry.groundRevision !== ground.groundRevisionAt(entry.grove.cellX, entry.grove.cellY))
        this.#layoutDirty = true;
    }
    if (this.#layoutDirty || this.#spaceVersion !== space.version) this.#rebuild(space, ground);
    let changed = false,
      shown = false,
      offset = 0;
    this.#pendingShown = 0;
    for (const entry of this.#order) {
      let opacity = OPACITY,
        white = 0;
      if (entry.selectedAt !== null) {
        const flash = haloFlash(Math.max(0, now - entry.selectedAt));
        white = flash.white;
        opacity = flash.opacity;
      }
      const a = entry.alpha * zoom * opacity;
      const colour: Entry['colour'] = [
        this.#tint.r + (1 - this.#tint.r) * white,
        this.#tint.g + (1 - this.#tint.g) * white,
        this.#tint.b + (1 - this.#tint.b) * white,
        a,
      ];
      if (a > 0 && entry.count) {
        shown = true;
        if (entry.pending) this.#pendingShown++;
      }
      if (colour.some((v, i) => v !== entry.colour[i])) {
        entry.colour = colour;
        changed = true;
        for (let i = 0; i < entry.count; i++) this.#colours.set(colour, (offset + i) * 4);
      }
      offset += entry.count;
    }
    if (changed && this.#instanceCount) this.#mesh.thinInstanceBufferUpdated('color');
    this.#mesh.setEnabled(shown && this.#instanceCount > 0);
  }
  /** Groves whose selection flash is still on screen. */
  get pendingCount(): number {
    return this.#pendingShown;
  }
  /** Per-instance colour, for tests and diagnostics. */
  colourAt(index: number): [number, number, number, number] {
    return [
      this.#colours[index * 4]!,
      this.#colours[index * 4 + 1]!,
      this.#colours[index * 4 + 2]!,
      this.#colours[index * 4 + 3]!,
    ];
  }
  /** Per-instance world matrix, for tests and diagnostics. */
  matrixAt(index: number): Matrix {
    return Matrix.FromArray(this.#matrices, index * 16);
  }
  clear(): void {
    this.#entries.clear();
    this.#available = [];
    this.#pending = [];
    this.#order = [];
    this.#instanceCount = 0;
    this.#pendingShown = 0;
    this.#mesh.thinInstanceSetBuffer('matrix', null, 16);
    this.#mesh.setEnabled(false);
    this.#layoutDirty = true;
  }
  dispose(): void {
    this.clear();
    this.#mesh.dispose(false, false);
    this.#material.dispose();
    this.#texture.dispose();
  }
}
