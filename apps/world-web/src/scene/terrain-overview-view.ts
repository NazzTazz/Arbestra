import type { ObservationPose } from '@arbestra/contracts';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh, type Mesh as MeshType } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Scene } from '@babylonjs/core/scene';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { TerrainOverview, TerrainVegetationOverview, TravelCell } from '@arbestra/contracts';
import { CELL_UNITS, normalize, type WorldSpace } from './world-space';
import { CosmologyWorld } from './cosmology-world';
import { TAU, illumination } from './cosmology';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import {
  attachSurfaceCamera,
  surfaceFrame,
  surfaceRadius,
  keepSurfaceCameraClear,
  blendDirection,
} from './torus-camera';
import { volumeMesh } from './regional-villages';
import { WeatherMaterial, type WeatherMap } from './weather-view';

const R = 2.4,
  TUBE = 1;
const REGION_CELLS = 640,
  REGION_STEP = 8;
/** Under the detailed terrain, the regional sheet stays this far below its lowest sample. */
export const REGIONAL_GROUND_MARGIN = 0.15;
/** Ground streams in chunk by chunk: refit the sheet at most this often. */
export const REGIONAL_GROUND_REFIT_MS = 1000;
/**
 * Detailed-ground samples one frame reads for the sheet; the rest waits for the next frames.
 * A whole refit is about 43 000 samples around Bressuire, 113 to 288 ms in one frame locally
 * (1.7 to 2.9 µs each by the ground lookups): about 7 to 12 ms per frame.
 */
export const REGIONAL_GROUND_SAMPLE_BUDGET = 4_000;
/** Height of the sheet's water where no detailed terrain is streamed. */
export const REGIONAL_WATER_HEIGHT = -0.86;
const SURFACE_RADIUS = 0.48;

function sample(data: TerrainOverview, x: number, y: number): number {
  const bx = Math.floor((normalize(x, data.world.widthCells) * data.gridWidth) / data.world.widthCells);
  const by = Math.floor((normalize(y, data.world.heightCells) * data.gridHeight) / data.world.heightCells);
  return by * data.gridWidth + bx;
}

export function torusPoint(cell: TravelCell, world: TerrainOverview['world']): Vector3 {
  const theta = (2 * Math.PI * normalize(cell.cellX, world.widthCells)) / world.widthCells;
  const phi = (2 * Math.PI * normalize(cell.cellY, world.heightCells)) / world.heightCells + Math.PI;
  return new Vector3(
    (R + TUBE * Math.cos(phi)) * Math.cos(theta),
    TUBE * Math.sin(phi),
    (R + TUBE * Math.cos(phi)) * Math.sin(theta),
  );
}

export function torusCell(point: Vector3, world: TerrainOverview['world']): TravelCell {
  const theta = Math.atan2(point.z, point.x),
    phi = Math.atan2(point.y, Math.hypot(point.x, point.z) - R);
  return {
    cellX: Math.floor(normalize(theta / (2 * Math.PI), 1) * world.widthCells) % world.widthCells,
    cellY: Math.floor(normalize((phi - Math.PI) / (2 * Math.PI), 1) * world.heightCells) % world.heightCells,
  };
}

function color(
  data: TerrainOverview,
  vegetation: TerrainVegetationOverview | null,
  index: number,
): [number, number, number] {
  const water = data.waterCoverage[index]! / 255,
    rock = data.rockCoverage[index]! / 255;
  const wood =
    vegetation &&
    vegetation.world.id === data.world.id &&
    vegetation.world.generationVersion === data.world.generationVersion &&
    vegetation.gridWidth === data.gridWidth &&
    vegetation.gridHeight === data.gridHeight
      ? vegetation.woodlandCoverage[index]! / 255
      : 0;
  const elevation = Math.min(1, Math.max(0, data.meanElevations[index]! / 25));
  const grass: [number, number, number] = [
    91 + elevation * 20 - wood * 25,
    117 + elevation * 19 - wood * 9,
    63 + elevation * 10 - wood * 25,
  ];
  const land = Math.max(0, 1 - water - rock);
  return [
    grass[0] * land + 105 * rock + 58 * water,
    grass[1] * land + 108 * rock + 105 * water,
    grass[2] * land + 92 * rock + 117 * water,
  ];
}

export class RegionalOverview {
  #mesh: MeshType | null = null;
  #masses: MeshType | null = null;
  readonly #massMaterial: StandardMaterial;
  #material: StandardMaterial;
  #centerX = NaN;
  #centerY = NaN;
  /** Local position of the centre cell when the sheet was laid out (before any later rebase). */
  #originX = 0;
  #originZ = 0;
  #data: TerrainOverview | null = null;
  #vegetation: TerrainVegetationOverview | null = null;
  #baseColors: Float32Array | null = null;
  #litColors: Float32Array | null = null;
  #extent = 0;
  #subdivisions = 0;
  #lightAt = 0;
  #lastLightPhase = NaN;
  /** Canonical cell of each vertex, and its height from the regional means. */
  #vertexCells: Float64Array | null = null;
  #baseHeights: Float32Array | null = null;
  /** The sheet's positions, rewritten in place: the mesh is built once per extent. */
  #positions: Float32Array | null = null;
  #groundRevision = NaN;
  #groundAt = -Infinity;
  /** Lowest detailed sample of each block (NaN: none), and the ground revision at each sheet vertex when read. */
  #blockLows: Float64Array | null = null;
  #blockRevisions: Float64Array | null = null;
  /** Blocks to read again: one flag per block, and their queue, nearest to the centre first. */
  #pending: Uint8Array | null = null;
  #queue: number[] = [];
  #queueHead = 0;
  /** Detailed-ground samples read by the last fitGround call, for diagnostics and tests. */
  groundSamples = 0;
  constructor(
    private readonly scene: Scene,
    weather: () => WeatherMap | null = () => null,
    space: () => WorldSpace | null = () => null,
  ) {
    this.#massMaterial = new StandardMaterial('regional-masses-material', scene);
    this.#massMaterial.diffuseColor = Color3.White();
    this.#massMaterial.specularColor = Color3.Black();
    this.#material = new StandardMaterial('regional-overview-material', scene);
    this.#material.diffuseColor = Color3.White();
    this.#material.specularColor = Color3.Black();
    this.#material.backFaceCulling = false;
    this.#material.disableLighting = true;
    this.#material.emissiveColor = Color3.White();
    new WeatherMaterial(this.#material, 'ground', weather, space);
    new WeatherMaterial(this.#massMaterial, 'ground', weather, space);
  }
  /**
   * The vegetation overview comes back every 30 s for the same geography: it
   * recolours the sheet in place and keeps its fit. Rebuilding the sheet and
   * refitting it under all the streamed ground cost a 67 to 78 ms frame twice
   * a minute on staging (docs/SPEC-TERRAFORMATION-OUTIL.md §7.14).
   */
  set(data: TerrainOverview, vegetation: TerrainVegetationOverview | null = null): void {
    const recolour = data === this.#data && this.#mesh !== null && !Number.isNaN(this.#centerX);
    this.#data = data;
    this.#vegetation = vegetation;
    if (!recolour) {
      this.#centerX = NaN;
      return;
    }
    const cells = this.#vertexCells!,
      colors = this.#baseColors!;
    for (let v = 0; v < cells.length / 2; v++) {
      const [r, g, b] = color(data, vegetation, sample(data, cells[v * 2]!, cells[v * 2 + 1]!));
      colors[v * 4] = r / 255;
      colors[v * 4 + 1] = g / 255;
      colors[v * 4 + 2] = b / 255;
    }
    this.#litColors!.set(colors);
    this.#mesh!.updateVerticesData('color', this.#litColors!);
    this.#lightAt = 0;
    this.#lastLightPhase = NaN;
    this.#buildMasses();
  }
  /**
   * Follows the camera by steps of 16 cells. The mesh is kept and rewritten in
   * place, and the blocks already fitted move with it: the next fitGround
   * reads only the blocks entering the region.
   */
  update(space: WorldSpace, target: TravelCell): void {
    if (!this.#data) return;
    const cx = Math.floor(target.cellX / 16) * 16,
      cy = Math.floor(target.cellY / 16) * 16;
    if (cx === this.#centerX && cy === this.#centerY) return;
    const data = this.#data;
    // Whole 8-cell blocks, aligned on canonical cells: a 16-cell move shifts the fit by two blocks.
    const side = Math.min(data.world.widthCells, data.world.heightCells) - 1;
    const extent = Math.min(REGION_CELLS, Math.floor(side / REGION_STEP) * REGION_STEP || side);
    const n = Math.max(1, Math.ceil(extent / REGION_STEP)),
      step = extent / n,
      count = (n + 1) * (n + 1);
    // A shift by whole blocks keeps the fit (NaN after set(): a new geography or a first sheet).
    const di = (cx - this.#centerX) / step,
      dj = (cy - this.#centerY) / step;
    const keep =
      extent === this.#extent &&
      n === this.#subdivisions &&
      Number.isInteger(di) &&
      Number.isInteger(dj) &&
      Math.abs(di) < n &&
      Math.abs(dj) < n &&
      this.#blockLows !== null &&
      this.#pending !== null;
    const reuse = this.#mesh !== null && this.#positions?.length === count * 3;
    this.#centerX = cx;
    this.#centerY = cy;
    this.#extent = extent;
    this.#subdivisions = n;
    this.#lightAt = 0;
    this.#lastLightPhase = NaN;
    const positions = reuse ? this.#positions! : new Float32Array(count * 3),
      colors = reuse ? this.#baseColors! : new Float32Array(count * 4),
      cells = reuse ? this.#vertexCells! : new Float64Array(count * 2),
      base = reuse ? this.#baseHeights! : new Float32Array(count);
    const point = space.project({ cellX: cx, cellY: cy });
    this.#originX = point.x;
    this.#originZ = point.z;
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const v = j * (n + 1) + i,
          x = cx - extent / 2 + i * step,
          y = cy - extent / 2 + j * step;
        const index = sample(data, x, y),
          isWater = data.waterCoverage[index]! > 127;
        cells[v * 2] = x;
        cells[v * 2 + 1] = y;
        base[v] = isWater ? REGIONAL_WATER_HEIGHT : data.meanElevations[index]! * 0.025 - 0.28;
        positions[v * 3] = point.x + (x - cx) * CELL_UNITS;
        positions[v * 3 + 1] = base[v]!;
        positions[v * 3 + 2] = point.z + (y - cy) * CELL_UNITS;
        const [r, g, b] = color(data, this.#vegetation, index);
        colors[v * 4] = r / 255;
        colors[v * 4 + 1] = g / 255;
        colors[v * 4 + 2] = b / 255;
        colors[v * 4 + 3] = 1;
      }
    this.#vertexCells = cells;
    this.#baseHeights = base;
    this.#positions = positions;
    this.#baseColors = colors;
    if (keep) {
      const moved = <T extends Float64Array | Uint8Array>(from: T, side: number, empty: number): T => {
        const to = from.slice().fill(empty) as T;
        for (let j = 0; j < side; j++)
          for (let i = 0; i < side; i++) {
            const oi = i + di,
              oj = j + dj;
            if (oi >= 0 && oj >= 0 && oi < side && oj < side) to[j * side + i] = from[oj * side + oi]!;
          }
        return to;
      };
      this.#blockLows = moved(this.#blockLows!, n, NaN);
      if (this.#blockRevisions) this.#blockRevisions = moved(this.#blockRevisions, n + 1, NaN);
      this.#pending = moved(this.#pending!, n, 0);
      this.#enqueue();
      for (let v = 0; v < count; v++) positions[v * 3 + 1] = this.#fitted(v);
    } else {
      this.#blockLows = this.#blockRevisions = this.#pending = null;
      this.#queue = [];
      this.#queueHead = 0;
    }
    this.#groundRevision = NaN; // a moved sheet is fitted at once, not throttled
    if (reuse) this.#litColors!.set(colors);
    else this.#litColors = new Float32Array(colors);
    if (reuse) {
      const mesh = this.#mesh!;
      mesh.position.set(0, 0, 0);
      mesh.updateVerticesData('position', positions, true);
      mesh.updateVerticesData('color', this.#litColors!);
    } else {
      const indices: number[] = [];
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const a = j * (n + 1) + i,
            b = a + 1,
            c = a + n + 1,
            d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      const mesh = new Mesh('regional-overview', this.scene);
      const vertex = new VertexData();
      vertex.positions = positions;
      vertex.indices = indices;
      vertex.colors = this.#litColors!;
      const normals = new Float32Array(count * 3);
      for (let index = 1; index < normals.length; index += 3) normals[index] = 1;
      vertex.normals = normals;
      vertex.applyToMesh(mesh, true);
      mesh.material = this.#material;
      mesh.isPickable = false;
      this.#mesh?.dispose(false, false);
      this.#mesh = mesh;
    }
    // An unfitted sheet rises above the detailed ground in hollows: it shows once fitted.
    if (!keep) this.#mesh!.setEnabled(false);
    this.#buildMasses();
  }
  #buildMasses(): void {
    const data = this.#data!;
    // RC1 has real streamed trees/rocks. These historical anonymous cuboids
    // otherwise appear as additional, uninspectable deposits at regional zoom.
    if (data.world.generationVersion === 3) {
      this.#masses?.dispose();
      this.#masses = null;
      return;
    }
    const n = this.#subdivisions,
      step = this.#extent / n,
      cx = this.#centerX,
      cy = this.#centerY;
    // Same frame as the sheet, which may have been rebased since it was laid out.
    const ox = this.#originX + (this.#mesh?.position.x ?? 0),
      oz = this.#originZ + (this.#mesh?.position.z ?? 0);
    const masses: Parameters<typeof volumeMesh>[2] = [];
    for (let j = 0; j < n; j += 2)
      for (let i = 0; i < n; i += 2) {
        const x = cx - this.#extent / 2 + (i + 1) * step,
          y = cy - this.#extent / 2 + (j + 1) * step;
        const index = sample(data, x, y);
        if (data.waterCoverage[index]! > 96) continue;
        const wood = this.#vegetation?.woodlandCoverage[index] ?? 0,
          rock = data.rockCoverage[index]!;
        if (wood < 48 && rock < 96) continue;
        const forest = wood >= 48,
          height = forest ? 4 + wood / 64 : 2 + rock / 128;
        masses.push({
          x: ox + (x - cx) * CELL_UNITS,
          z: oz + (y - cy) * CELL_UNITS,
          y: data.meanElevations[index]! * 0.025 + height / 2,
          width: step * CELL_UNITS * (forest ? 1.5 : 1.2),
          depth: step * CELL_UNITS * (forest ? 1.5 : 1.2),
          height,
          color: forest ? [0.18, 0.29, 0.12] : [0.43, 0.45, 0.38],
        });
      }
    this.#masses?.dispose();
    this.#masses = volumeMesh(this.scene, 'regional-forest-rock-masses', masses, this.#massMaterial);
  }
  get mesh(): MeshType | null {
    return this.#mesh;
  }
  /** Rebuilds the queue from the pending flags, nearest block to the centre first. */
  #enqueue(): void {
    const n = this.#subdivisions,
      pending = this.#pending!,
      queue: number[] = [];
    for (let b = 0; b < pending.length; b++) if (pending[b]) queue.push(b);
    const distance = (b: number) => ((b % n) - (n - 1) / 2) ** 2 + (Math.floor(b / n) - (n - 1) / 2) ** 2;
    queue.sort((a, b) => distance(a) - distance(b));
    this.#queue = queue;
    this.#queueHead = 0;
  }
  /** Height of vertex v: under the lowest detailed sample of its four blocks, else the regional mean. */
  #fitted(v: number): number {
    const n = this.#subdivisions,
      blocks = this.#blockLows!,
      i = v % (n + 1),
      j = Math.floor(v / (n + 1));
    let low = Infinity;
    for (const [bi, bj] of [
      [i - 1, j - 1],
      [i, j - 1],
      [i - 1, j],
      [i, j],
    ] as const)
      if (bi >= 0 && bj >= 0 && bi < n && bj < n) {
        const value = blocks[bj * n + bi]!;
        if (!Number.isNaN(value) && value < low) low = value;
      }
    return Math.min(this.#baseHeights![v]!, low - REGIONAL_GROUND_MARGIN);
  }
  /**
   * The sheet is a backdrop for terrain not streamed yet. Its vertices follow
   * regional means, so in a hollow they rose above the detailed ground and
   * shimmered through it (an « oil slick », Tristan, 28 October). Where detailed
   * ground exists, each vertex sinks below the lowest sample of the blocks around
   * it, so every triangle stays under the real surface, river beds included:
   * the real bed is what shows through the water.
   *
   * Incremental with `revisionAt` (TerrainStore.groundSourceRevision): a block
   * (8 cells, within 2 × 2 chunks) is queued again only when the revision at
   * one of its corners changed, at most once per REGIONAL_GROUND_REFIT_MS.
   * Called every frame: the queue is read for at most `budget` samples (plus
   * one block), nearest to the centre first, and an empty queue costs O(1). A
   * whole refit read every streamed block in one frame (66 to 140 ms on
   * staging, docs/SPEC-TERRAFORMATION-OUTIL.md §7.14 and §7.14).
   */
  fitGround(
    ground: (x: number, y: number) => { code: number; height: number } | null,
    revision: number,
    now: number,
    revisionAt?: (x: number, y: number) => number,
    budget = Infinity,
  ): void {
    const mesh = this.#mesh,
      cells = this.#vertexCells,
      data = this.#data,
      positions = this.#positions;
    this.groundSamples = 0;
    if (!mesh || !cells || !data || !positions) return;
    const n = this.#subdivisions,
      w = data.world.widthCells,
      h = data.world.heightCells;
    if (
      revision !== this.#groundRevision &&
      (Number.isNaN(this.#groundRevision) || now - this.#groundAt >= REGIONAL_GROUND_REFIT_MS)
    ) {
      this.#groundRevision = revision;
      this.#groundAt = now;
      const fresh = this.#blockLows?.length !== n * n || !this.#pending;
      if (fresh) {
        this.#blockLows = new Float64Array(n * n).fill(NaN);
        this.#pending = new Uint8Array(n * n);
        this.#blockRevisions = null;
      }
      const pending = this.#pending!;
      if (revisionAt) {
        // The revision at each sheet vertex: a block is stale when one of its four corners changed.
        const prior = fresh ? null : this.#blockRevisions,
          lattice = new Float64Array((n + 1) * (n + 1)),
          changed = new Uint8Array((n + 1) * (n + 1));
        for (let v = 0; v < lattice.length; v++) {
          lattice[v] = revisionAt(normalize(Math.round(cells[v * 2]!), w), normalize(Math.round(cells[v * 2 + 1]!), h));
          changed[v] = prior && prior[v] === lattice[v] ? 0 : 1;
        }
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const v = j * (n + 1) + i;
            if (changed[v] || changed[v + 1] || changed[v + n + 1] || changed[v + n + 2]) pending[j * n + i] = 1;
          }
        this.#blockRevisions = lattice;
      } else pending.fill(1);
      this.#enqueue();
    }
    if (this.#queueHead >= this.#queue.length) return;
    const step = this.#extent / n,
      blocks = this.#blockLows!,
      pending = this.#pending!;
    let samples = 0;
    const at = (x: number, y: number) => {
      samples++;
      return ground(normalize(Math.round(x), w), normalize(Math.round(y), h))?.height ?? null;
    };
    const touched: number[] = [];
    while (this.#queueHead < this.#queue.length && (samples === 0 || samples < budget)) {
      const b = this.#queue[this.#queueHead++]!;
      if (!pending[b]) continue;
      pending[b] = 0;
      const i = b % n,
        j = Math.floor(b / n),
        v = j * (n + 1) + i;
      touched.push(v, v + 1, v + n + 1, v + n + 2);
      const x0 = cells[v * 2]!,
        y0 = cells[v * 2 + 1]!;
      blocks[b] = NaN;
      // Most of the region has no detailed ground: five probes rule a block out.
      const probes = [
        [x0, y0],
        [x0 + step, y0],
        [x0, y0 + step],
        [x0 + step, y0 + step],
        [x0 + step / 2, y0 + step / 2],
      ] as const;
      if (probes.every(([x, y]) => at(x, y) === null)) continue;
      let low = Infinity;
      for (let dy = 0; dy <= step; dy++)
        for (let dx = 0; dx <= step; dx++) {
          const height = at(x0 + dx, y0 + dy);
          if (height !== null && height < low) low = height;
        }
      if (low !== Infinity) blocks[b] = low;
    }
    this.groundSamples = samples;
    for (const v of touched) positions[v * 3 + 1] = this.#fitted(v);
    mesh.updateVerticesData('position', positions);
    // A new sheet shows once all its blocks are read.
    if (this.#queueHead >= this.#queue.length && !mesh.isEnabled()) mesh.setEnabled(true);
  }
  shift(x: number, z: number): void {
    for (const mesh of [this.#mesh, this.#masses])
      if (mesh) {
        mesh.position.x -= x;
        mesh.position.z -= z;
      }
  }
  detailBlend(blend: number): void {
    if (this.#masses) this.#masses.visibility = blend;
  }
  setPresentationLight(factor: number): void {
    const light = 0.24 + 0.76 * factor;
    this.#material.emissiveColor.copyFromFloats(light, light, light);
  }
  clear(): void {
    this.#mesh?.dispose();
    this.#masses?.dispose();
    this.#mesh = this.#masses = null;
    this.#data = this.#vegetation = null;
    this.#centerX = NaN;
    this.#positions = this.#blockLows = this.#blockRevisions = this.#pending = null;
    this.#queue = [];
    this.#queueHead = 0;
  }
  updateLighting(phase: number, now: number): void {
    if (
      !this.#mesh ||
      !this.#data ||
      !this.#baseColors ||
      !this.#litColors ||
      now < this.#lightAt ||
      phase === this.#lastLightPhase
    )
      return;
    this.#lightAt = now + 400;
    this.#lastLightPhase = phase;
    // A bounded canonical lattice, independent of which detailed chunks are resident.
    const size = 16,
      field = new Float32Array((size + 1) ** 2);
    for (let j = 0; j <= size; j++)
      for (let i = 0; i <= size; i++) {
        const x = this.#centerX - this.#extent / 2 + (this.#extent * i) / size;
        const y = this.#centerY - this.#extent / 2 + (this.#extent * j) / size;
        field[j * (size + 1) + i] =
          0.34 +
          0.66 *
            illumination(
              (x / this.#data.world.widthCells) * TAU,
              (y / this.#data.world.heightCells) * TAU + Math.PI,
              phase,
            ).direct;
      }
    for (let j = 0; j <= this.#subdivisions; j++)
      for (let i = 0; i <= this.#subdivisions; i++) {
        const x = (i / this.#subdivisions) * size,
          y = (j / this.#subdivisions) * size;
        const ix = Math.min(size - 1, Math.floor(x)),
          iy = Math.min(size - 1, Math.floor(y)),
          fx = x - ix,
          fy = y - iy;
        const a = iy * (size + 1) + ix;
        const top = field[a]! * (1 - fx) + field[a + 1]! * fx;
        const bottom = field[a + size + 1]! * (1 - fx) + field[a + size + 2]! * fx;
        const light = top * (1 - fy) + bottom * fy,
          index = (j * (this.#subdivisions + 1) + i) * 4;
        for (let c = 0; c < 3; c++) this.#litColors[index + c] = this.#baseColors[index + c]! * light;
      }
    this.#mesh.updateVerticesData('color', this.#litColors);
  }
  dispose(): void {
    this.#mesh?.dispose(false, false);
    this.#masses?.dispose();
    this.#massMaterial.dispose();
    this.#material.dispose();
  }
}

export class TorusOverview {
  observationPose(): Extract<ObservationPose, { mode: 'world' }> {
    this.camera.getViewMatrix(true);
    const inverse = this.#cosmology.root.computeWorldMatrix(true).clone().invert();
    const local = this.camera.parent === this.#cosmology.root;
    const eye = local ? this.camera.position : Vector3.TransformCoordinates(this.camera.globalPosition, inverse),
      target = this.camera.getTarget();
    const canonicalTarget = local ? target : Vector3.TransformCoordinates(target, inverse);
    const up = local ? this.camera.upVector : Vector3.TransformNormal(this.camera.upVector, inverse).normalize();
    return {
      mode: 'world',
      eye: eye.asArray() as [number, number, number],
      target: canonicalTarget.asArray() as [number, number, number],
      up: up.asArray() as [number, number, number],
      fov: this.camera.fov,
    };
  }
  applyObservationPose(p: Extract<ObservationPose, { mode: 'world' }>) {
    this.camera.parent = this.#cosmology.root;
    this.camera.upVector = Vector3.FromArray(p.up);
    this.camera.setTarget(Vector3.FromArray(p.target));
    this.camera.setPosition(Vector3.FromArray(p.eye));
    this.camera.fov = p.fov;
    this.camera.inertialAlphaOffset = this.camera.inertialBetaOffset = this.camera.inertialRadiusOffset = 0;
  }
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly #mesh: MeshType;
  readonly #material: StandardMaterial;
  readonly #texture: DynamicTexture;
  readonly #villageMarker: MeshType;
  readonly #targetMarker: MeshType;
  readonly #cosmology: CosmologyWorld;
  readonly #stats: SceneInstrumentation;
  #fitRadius = 8.2;
  #anchor = Vector3.Zero();
  #surfaceView = false;
  #globalModelAvailable = true;
  #entryRadius = SURFACE_RADIUS;
  #normal = Vector3.Up();
  #previousRadius = Infinity;
  #flyover = false;
  #lastDisplayPhase: number | null = null;
  #displayPhaseOffset = 0;
  #savedNavigation: { target: Vector3; position: Vector3; up: Vector3; radius: number } | null = null;
  #data: TerrainOverview;
  #vegetation: TerrainVegetationOverview | null = null;
  constructor(
    engine: Engine,
    data: TerrainOverview,
    village: TravelCell,
    target: TravelCell,
    weather: () => WeatherMap | null = () => null,
  ) {
    this.#data = data;
    this.scene = new Scene(engine);
    this.#stats = new SceneInstrumentation(this.scene);
    this.#stats.captureRenderTime = true;
    try {
      this.scene.clearColor = new Color4(0, 0, 0, 1);
      this.camera = new ArcRotateCamera('world-camera', 0.5, 0.68, 8.2, Vector3.Zero(), this.scene);
      this.camera.lowerRadiusLimit = 5.8;
      this.camera.upperRadiusLimit = 11;
      this.camera.lowerBetaLimit = 0.05;
      this.camera.upperBetaLimit = Math.PI - 0.05;
      this.camera.panningSensibility = 0;
      this.camera.wheelDeltaPercentage = 0.015;
      this.camera.pinchDeltaPercentage = 0.015;
      this.fit(engine);
      this.#texture = new DynamicTexture(
        'world-overview-texture',
        { width: data.gridWidth, height: data.gridHeight },
        this.scene,
        true,
      );
      this.#texture.wrapU = Texture.WRAP_ADDRESSMODE;
      this.#texture.wrapV = Texture.WRAP_ADDRESSMODE;
      this.#material = new StandardMaterial('world-overview-material', this.scene);
      this.#material.diffuseTexture = this.#texture;
      this.#material.emissiveColor = Color3.Black();
      this.#material.linkEmissiveWithDiffuse = true;
      this.#material.specularColor = Color3.Black();
      this.#material.backFaceCulling = false;
      this.#mesh = MeshBuilder.CreateTorus(
        'canonical-world-torus',
        { diameter: R * 2, thickness: TUBE * 2, tessellation: 96 },
        this.scene,
      );
      this.#mesh.material = this.#material;
      this.#villageMarker = MeshBuilder.CreateSphere('village-marker', { diameter: 0.13, segments: 8 }, this.scene);
      this.#targetMarker = MeshBuilder.CreateSphere('target-marker', { diameter: 0.11, segments: 8 }, this.scene);
      for (const [marker, hex] of [
        [this.#villageMarker, '#f5db83'],
        [this.#targetMarker, '#dcf1ee'],
      ] as const) {
        const material = new StandardMaterial(`${marker.name}-material`, this.scene);
        material.emissiveColor = Color3.FromHexString(hex);
        material.disableLighting = true;
        marker.material = material;
        marker.isPickable = false;
      }
      this.#cosmology = new CosmologyWorld(this.scene, this.#mesh, [this.#villageMarker, this.#targetMarker], weather);
      this.mark(village, target);
      this.#draw();
      const focus = torusPoint(target, data.world);
      this.camera.alpha = Math.atan2(focus.z, focus.x);
    } catch (error) {
      this.scene.dispose();
      throw error;
    }
  }
  setVegetation(data: TerrainVegetationOverview): void {
    this.#vegetation = data;
    this.#draw();
  }
  setGeography(data: TerrainOverview): void {
    this.#data = data;
    this.#draw();
  }
  setGlobalModel(available: boolean): void {
    this.#globalModelAvailable = available;
    this.camera.upperRadiusLimit = available
      ? this.#fitRadius * 2.8
      : Math.max(this.#entryRadius, Math.min(0.48, this.#entryRadius * 1.6));
    if (!available) this.camera.radius = Math.min(this.camera.radius, this.camera.upperRadiusLimit);
  }
  fit(engine: Engine): void {
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const radius = Math.max(8.2, 3.9 / (Math.tan(this.camera.fov / 2) * aspect));
    this.#fitRadius = radius;
    this.camera.lowerRadiusLimit = this.#surfaceView ? this.#entryRadius * 0.67 : radius * 0.72;
    this.camera.upperRadiusLimit = radius * 2.8;
    if (!this.#surfaceView && this.camera.radius < radius) this.camera.radius = radius;
    if (!this.#globalModelAvailable) this.setGlobalModel(false);
  }
  enter(target: TravelCell, planarAlpha: number, planarRadius = 260, planarBeta = 0, planarFov = 0.8): void {
    this.#lastDisplayPhase = null;
    this.#displayPhaseOffset = 0;
    this.#savedNavigation = null;
    this.camera.fov = planarFov;
    this.#entryRadius = surfaceRadius(target, this.#data.world, planarRadius, planarBeta);
    this.#normal = Vector3.FromArray([...surfaceFrame(target, this.#data.world).normal]);
    this.#surfaceView = true;
    this.#previousRadius = this.#entryRadius;
    this.camera.minZ = 0.01;
    this.camera.lowerRadiusLimit = this.#entryRadius * 0.67;
    this.#anchor = attachSurfaceCamera(
      this.camera,
      this.#cosmology.root,
      target,
      this.#data.world,
      planarAlpha,
      this.#entryRadius,
    );
    this.setGlobalModel(this.#globalModelAvailable);
  }
  mark(village: TravelCell, target: TravelCell): void {
    for (const [marker, cell] of [
      [this.#villageMarker, village],
      [this.#targetMarker, target],
    ] as const) {
      const p = torusPoint(cell, this.#data.world);
      const theta = (2 * Math.PI * normalize(cell.cellX, this.#data.world.widthCells)) / this.#data.world.widthCells;
      const center = new Vector3(R * Math.cos(theta), 0, R * Math.sin(theta));
      marker.position = p.add(p.subtract(center).normalize().scale(0.065));
    }
  }
  select(x: number, y: number): TravelCell | null {
    const hit = this.scene.pick(x, y, (mesh) => mesh === this.#mesh, false, this.camera);
    return hit?.hit && hit.pickedPoint
      ? torusCell(
          Vector3.TransformCoordinates(hit.pickedPoint, this.#cosmology.root.computeWorldMatrix(true).clone().invert()),
          this.#data.world,
        )
      : null;
  }
  updateCosmology(phase: number, turns: number, now: number, debug: boolean): void {
    const markerScale = Math.min(1, this.camera.radius / this.#fitRadius);
    this.#villageMarker.scaling.setAll(markerScale);
    this.#targetMarker.scaling.setAll(markerScale);
    if (this.#surfaceView && !this.#flyover) {
      const radius = this.camera.radius,
        limit = this.camera.lowerRadiusLimit ?? 0.06;
      if (radius < this.#previousRadius && radius < this.#entryRadius * 3) {
        this.camera.getViewMatrix(true);
        const amount = Math.min(1, ((this.#previousRadius - radius) / Math.max(0.001, radius - limit)) * 2);
        const direction = blendDirection(this.camera.position.subtract(this.#anchor).normalize(), this.#normal, amount);
        this.camera.setPosition(this.#anchor.add(direction.scale(radius)));
      }
      this.#previousRadius = radius;
      keepSurfaceCameraClear(this.camera, this.#anchor, this.#normal);
    }
    if (this.#lastDisplayPhase !== null) {
      const step = Math.atan2(Math.sin(phase - this.#lastDisplayPhase), Math.cos(phase - this.#lastDisplayPhase));
      // Follow pauses/seeks, and accelerate elapsed motion rather than multiplying the epoch.
      if (Math.abs(step) < 0.05) this.#displayPhaseOffset += step * 4;
      else this.#displayPhaseOffset = 0;
    }
    this.#lastDisplayPhase = phase;
    // Recover the local lighting phase before crossing back through the cloud mask.
    const blend = this.#surfaceView ? Math.max(0, Math.min(1, (this.camera.radius / this.#entryRadius - 1) / 2)) : 1;
    const smooth = blend * blend * (3 - 2 * blend);
    this.#cosmology.update(phase + this.#displayPhaseOffset * smooth, turns, now, debug);
  }
  /** One orbit in the torus frame, then a normal-aligned descent to the village. */
  flyover(elapsed: number, target: TravelCell, heading: number): boolean {
    if (!this.#flyover) {
      this.enter(target, heading, 260, 0, 0.8);
      this.#flyover = true;
    }
    const frame = surfaceFrame(target, this.#data.world),
      normal = Vector3.FromArray([...frame.normal]);
    const radius = this.camera.upperRadiusLimit ?? this.#fitRadius * 2.8;
    const azimuth = Math.atan2(normal.z, normal.x);
    this.camera.detachControl();
    this.camera.inertialAlphaOffset = this.camera.inertialBetaOffset = this.camera.inertialRadiusOffset = 0;
    if (elapsed < 12000) {
      const angle = azimuth + (Math.PI * 2 * Math.max(0, elapsed)) / 12000;
      this.camera.upVector = Vector3.Up();
      this.camera.setTarget(Vector3.Zero());
      this.camera.setPosition(
        new Vector3(Math.cos(angle) * 0.86, 0.51, Math.sin(angle) * 0.86).normalize().scale(radius),
      );
    } else {
      const t = Math.min(1, (elapsed - 12000) / 6000),
        eased = t * t * (3 - 2 * t);
      const from = new Vector3(Math.cos(azimuth) * 0.86, 0.51, Math.sin(azimuth) * 0.86).normalize();
      const direction = blendDirection(from, normal, eased);
      const up = Vector3.FromArray([...frame.east])
        .scale(-Math.cos(heading))
        .add(Vector3.FromArray([...frame.north]).scale(-Math.sin(heading)))
        .normalize();
      this.camera.upVector = blendDirection(Vector3.Up(), up, eased);
      const aim = this.#anchor.scale(eased);
      this.camera.setTarget(aim);
      this.camera.setPosition(aim.add(direction.scale(radius + (this.#entryRadius * 0.7 - radius) * eased)));
    }
    return elapsed >= 18000;
  }
  finishFlyover(): void {
    if (this.#flyover) this.camera.setTarget(this.#anchor);
    this.#flyover = false;
    this.#previousRadius = this.camera.radius;
  }
  eyesVisible(): boolean {
    return this.#surfaceView && this.#cosmology.eyesVisible();
  }
  observed(): TravelCell {
    return (
      this.select(this.scene.getEngine().getRenderWidth() / 2, this.scene.getEngine().getRenderHeight() / 2) ??
      torusCell(this.#anchor, this.#data.world)
    );
  }
  planarHeading(): number {
    const cell = this.observed(),
      frame = surfaceFrame(cell, this.#data.world);
    const upWorld = Vector3.TransformNormal(Vector3.Up(), this.camera.getViewMatrix(true).clone().invert());
    const up = Vector3.TransformNormal(
      upWorld,
      this.#cosmology.root.computeWorldMatrix(true).clone().invert(),
    ).normalize();
    return Math.atan2(
      -Vector3.Dot(up, Vector3.FromArray([...frame.north])),
      -Vector3.Dot(up, Vector3.FromArray([...frame.east])),
    );
  }
  focus(target: TravelCell): void {
    const next = torusPoint(target, this.#data.world);
    const offset = this.camera.position.subtract(this.camera.target);
    this.#anchor = next;
    this.#normal = Vector3.FromArray([...surfaceFrame(target, this.#data.world).normal]);
    this.camera.setTarget(next);
    this.camera.setPosition(next.add(offset));
  }
  restoreNavigation(): void {
    const saved = this.#savedNavigation;
    if (!saved) return;
    this.camera.lowerRadiusLimit = this.#entryRadius * 0.67;
    this.camera.parent = this.#cosmology.root;
    this.camera.upVector = saved.up;
    this.camera.setTarget(saved.target);
    this.camera.setPosition(saved.position);
    this.camera.radius = saved.radius;
    this.#surfaceView = true;
    this.camera.lowerRadiusLimit = this.#entryRadius * 0.67;
    this.camera.inertialAlphaOffset = this.camera.inertialBetaOffset = this.camera.inertialRadiusOffset = 0;
    this.#savedNavigation = null;
  }
  metrics() {
    return {
      worldRenderMs: this.#stats.renderTimeCounter.current,
      worldMeshes: this.scene.meshes.length,
      shadowBytes: 512 * 512 * 6 * 4,
    };
  }
  navigationMetrics() {
    const root = this.#cosmology.root.computeWorldMatrix(true);
    const anchor = Vector3.TransformCoordinates(this.#anchor, root);
    const viewport = this.camera.viewport.toGlobal(
      this.scene.getEngine().getRenderWidth(),
      this.scene.getEngine().getRenderHeight(),
    );
    const screen = Vector3.Project(anchor, Matrix.Identity(), this.scene.getTransformMatrix(), viewport);
    return {
      sticky: this.camera.parent === this.#cosmology.root,
      anchor: this.#anchor.asArray(),
      screen: [screen.x / viewport.width, screen.y / viewport.height],
      position: this.camera.globalPosition.asArray(),
      radius: this.camera.radius,
      alpha: this.camera.alpha,
      beta: this.camera.beta,
    };
  }
  showSolarProfile(): void {
    if (!this.#globalModelAvailable) return;
    if (!this.#savedNavigation)
      this.#savedNavigation = {
        target: this.camera.target.clone(),
        position: this.camera.position.clone(),
        up: this.camera.upVector.clone(),
        radius: this.camera.radius,
      };
    this.camera.lowerRadiusLimit = this.#fitRadius * 0.7;
    this.#surfaceView = false;
    this.camera.parent = null;
    this.camera.upVector = Vector3.Up();
    this.camera.setTarget(Vector3.Zero());
    this.camera.radius = this.#fitRadius * 1.6;
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = Math.PI / 2;
  }
  showCatEyes(): void {
    if (!this.#globalModelAvailable) return;
    this.showSolarProfile();
    const eyes = this.#cosmology.eyePosition();
    this.camera.setTarget(eyes);
    this.camera.setPosition(eyes.add(eyes.negate().normalize().scale(6)));
    this.camera.inertialAlphaOffset = this.camera.inertialBetaOffset = this.camera.inertialRadiusOffset = 0;
    this.camera.inertialPanningX = this.camera.inertialPanningY = 0;
  }
  #draw(): void {
    const data = this.#data,
      width = data.gridWidth,
      height = data.gridHeight;
    const context = this.#texture.getContext();
    const image = new ImageData(width, height);
    const xBuckets = new Uint16Array(width),
      yBuckets = new Uint16Array(height);
    for (let x = 0; x < width; x++) {
      const outer = (2 * Math.PI * (x + 0.5)) / width - Math.PI / 2;
      const matrix = Matrix.Translation(R, 0, 0).multiply(Matrix.RotationY(outer));
      const point = Vector3.TransformCoordinates(new Vector3(TUBE, 0, 0), matrix);
      const cell = torusCell(point, data.world);
      xBuckets[x] = Math.floor((cell.cellX * width) / data.world.widthCells);
    }
    const outerZero = Matrix.Translation(R, 0, 0).multiply(Matrix.RotationY(-Math.PI / 2));
    for (let y = 0; y < height; y++) {
      const inner = 2 * Math.PI * (1 - (y + 0.5) / height) + Math.PI;
      const point = Vector3.TransformCoordinates(
        new Vector3(TUBE * Math.cos(inner), TUBE * Math.sin(inner), 0),
        outerZero,
      );
      const cell = torusCell(point, data.world);
      yBuckets[y] = Math.floor((cell.cellY * height) / data.world.heightCells);
    }
    const palette = new Uint8Array(width * height * 3);
    for (let index = 0; index < width * height; index++) {
      const [r, g, b] = color(data, this.#vegetation, index);
      const offset = index * 3;
      palette[offset] = r;
      palette[offset + 1] = g;
      palette[offset + 2] = b;
    }
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const colorOffset = (yBuckets[y]! * width + xBuckets[x]!) * 3,
          offset = (y * width + x) * 4;
        image.data[offset] = palette[colorOffset]!;
        image.data[offset + 1] = palette[colorOffset + 1]!;
        image.data[offset + 2] = palette[colorOffset + 2]!;
        image.data[offset + 3] = 255;
      }
    context.putImageData(image, 0, 0);
    this.#texture.update(false);
  }
  dispose(): void {
    this.#stats.dispose();
    this.scene.dispose();
  }
}
