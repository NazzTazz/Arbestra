import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { decodeBuildingAsset } from './building-asset-format';
import manifest from './garden-kit-manifest.json';

export type GardenLod = 0 | 1 | 2;
type LodKey = 'LOD0' | 'LOD1' | 'LOD2';
export interface GardenKitPlacement {
  source: string;
  role: string;
  position: [number, number, number];
  rotationY: number;
  scale: number;
}
interface KitGeometry {
  id: string;
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  indices: Uint32Array;
}
export interface GardenKitData {
  cellSize: number;
  pieces: Array<{ source: string; geometry: string; material: string }>;
  layouts: Record<LodKey, GardenKitPlacement[]>;
  fence: Record<'LOD0' | 'LOD1', { rope: string; post: string }>;
  geometries: { vertexData: KitGeometry[] };
}
/** A completed plot in scene coordinates; `open` marks sides facing another garden or none. */
export interface GardenPlotView {
  id: string;
  x: number;
  y: number;
  z: number;
  stage: number;
  full: boolean;
  open: { west: boolean; east: boolean; south: boolean; north: boolean };
}

/** Camera distances of the detailed and simplified levels, with a margin against flicker. */
export const GARDEN_LOD_DISTANCES = [32, 110] as const;
const HYSTERESIS = 1.1;

export async function fetchGardenKit(): Promise<GardenKitData> {
  const response = await fetch(manifest.kit, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Garden kit HTTP ${response.status}`);
  // Static hosts may decode Content-Encoding themselves; do not decompress twice.
  const buffer = response.headers.get('content-encoding')?.includes('gzip')
    ? await response.arrayBuffer()
    : await new Response(response.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return decodeBuildingAsset(buffer) as unknown as GardenKitData;
}

export function gardenLod(distance: number, previous?: GardenLod): GardenLod {
  const [near, far] = GARDEN_LOD_DISTANCES;
  const margin = (limit: number, level: GardenLod) =>
    previous === undefined ? limit : previous <= level ? limit * HYSTERESIS : limit / HYSTERESIS;
  return distance < margin(near, 0) ? 0 : distance < margin(far, 1) ? 1 : 2;
}

const stageSource = (source: string, stage: number) =>
  source.replace(/STADE_\d\d/, `STADE_${String(Math.min(7, Math.max(1, stage))).padStart(2, '0')}`);

/**
 * Exposed sides as two rope spans each, counter-clockwise from a plot corner,
 * in plot fractions; rotations are the scene's (left-handed) Y rotations.
 */
const SIDES = {
  south: [
    [0, 0, 0],
    [0.5, 0, 0],
  ],
  east: [
    [1, 0, -Math.PI / 2],
    [1, 0.5, -Math.PI / 2],
  ],
  north: [
    [1, 1, Math.PI],
    [0.5, 1, Math.PI],
  ],
  west: [
    [0, 1, Math.PI / 2],
    [0, 0.5, Math.PI / 2],
  ],
} as const;

/**
 * Thin-instance matrices per kit source. Pure: plots and their levels in, flat
 * 4×4 matrices out. Posts shared by neighbouring exposed sides are emitted once.
 */
export function gardenInstances(
  kit: Pick<GardenKitData, 'cellSize' | 'layouts' | 'fence'>,
  plots: readonly GardenPlotView[],
  lods: ReadonlyMap<string, GardenLod>,
): Map<string, number[]> {
  const result = new Map<string, number[]>(),
    size = kit.cellSize,
    matrix = new Matrix(),
    rotation = new Quaternion(),
    scaling = new Vector3(),
    translation = new Vector3(),
    posts = new Set<string>();
  const emit = (source: string, x: number, y: number, z: number, rotationY: number, scale: number) => {
    Quaternion.RotationYawPitchRollToRef(rotationY, 0, 0, rotation);
    scaling.setAll(scale);
    translation.set(x, y, z);
    Matrix.ComposeToRef(scaling, rotation, translation, matrix);
    let list = result.get(source);
    if (!list) result.set(source, (list = []));
    for (const value of matrix.m) list.push(value);
  };
  for (const plot of plots) {
    const lod = lods.get(plot.id) ?? 2,
      key = `LOD${lod}` as LodKey,
      cornerX = plot.x - size / 2,
      cornerZ = plot.z - size / 2;
    for (const p of kit.layouts[key]) {
      if (p.role === 'marqueur' && !plot.full) continue;
      emit(
        stageSource(p.source, plot.stage),
        cornerX + p.position[0],
        plot.y + p.position[1],
        cornerZ + p.position[2],
        p.rotationY,
        p.scale,
      );
    }
    if (lod === 2) continue;
    const fence = kit.fence[key as 'LOD0' | 'LOD1'];
    for (const side of Object.keys(SIDES) as Array<keyof typeof SIDES>) {
      if (!plot.open[side]) continue;
      for (const [u, v, rotationY] of SIDES[side])
        emit(fence.rope, cornerX + u * size, plot.y, cornerZ + v * size, rotationY, 1);
      const [[u0, v0], [u1, v1]] = SIDES[side],
        end: [number, number] = [u1 * 2 - u0, v1 * 2 - v0];
      for (const [u, v] of [[u0, v0], [u1, v1], end]) {
        const x = cornerX + u! * size,
          z = cornerZ + v! * size,
          id = `${lod}:${Math.round(x * 1000)}:${Math.round(z * 1000)}`;
        if (posts.has(id)) continue;
        posts.add(id);
        emit(fence.post, x, plot.y, z, 0, 1);
      }
    }
  }
  return result;
}

/** One mesh per kit piece; plots are thin instances of those pieces at their current level. */
export class GardenKitRenderer {
  readonly #sources = new Map<string, Mesh[]>();
  readonly #materials: StandardMaterial[] = [];
  #plots: readonly GardenPlotView[] = [];
  #lods = new Map<string, GardenLod>();
  #dirty = false;
  #visible = true;
  constructor(
    private readonly scene: Scene,
    private readonly kit: GardenKitData,
  ) {
    const materials = new Map<string, StandardMaterial>();
    const material = (name: string) => {
      let m = materials.get(name);
      if (!m) {
        m = new StandardMaterial(`garden-kit-${name}`, scene);
        m.specularColor = Color3.Black();
        const url = (manifest.textures as Record<string, string>)[name];
        // glTF textures keep their top-left origin.
        if (url) m.diffuseTexture = new Texture(url, scene, false, false);
        materials.set(name, m);
        this.#materials.push(m);
      }
      return m;
    };
    const geometries = new Map(kit.geometries.vertexData.map((g) => [g.id, g]));
    for (const piece of kit.pieces) {
      const g = geometries.get(piece.geometry)!,
        data = new VertexData();
      data.positions = g.positions;
      data.indices = g.indices;
      if (g.uvs) data.uvs = g.uvs;
      if (g.colors) data.colors = g.colors;
      data.normals = g.normals ?? [];
      if (!g.normals) VertexData.ComputeNormals(g.positions, g.indices, data.normals);
      const mesh = new Mesh(`garden-kit-${piece.source}`, scene);
      data.applyToMesh(mesh);
      mesh.material = material(piece.material);
      mesh.isPickable = false;
      mesh.setEnabled(false);
      let list = this.#sources.get(piece.source);
      if (!list) this.#sources.set(piece.source, (list = []));
      list.push(mesh);
    }
  }
  /** New plot views (state, ground or origin change). */
  setPlots(plots: readonly GardenPlotView[]): void {
    const same =
      plots.length === this.#plots.length &&
      plots.every((p, i) => {
        const q = this.#plots[i]!;
        return (
          p.id === q.id &&
          p.x === q.x &&
          p.y === q.y &&
          p.z === q.z &&
          p.stage === q.stage &&
          p.full === q.full &&
          p.open.west === q.open.west &&
          p.open.east === q.open.east &&
          p.open.south === q.open.south &&
          p.open.north === q.open.north
        );
      });
    if (same) return;
    this.#plots = plots;
    this.#dirty = true;
  }
  /** The world view hides the village, gardens included. */
  show(visible: boolean): void {
    if (visible === this.#visible) return;
    this.#visible = visible;
    for (const meshes of this.#sources.values())
      for (const mesh of meshes) mesh.setEnabled(visible && mesh.thinInstanceCount > 0);
  }
  /** Per frame: cheap distance test; buffers are rebuilt only when a level or a plot changes. */
  update(eye: Vector3): void {
    const lods = new Map<string, GardenLod>();
    let changed = this.#dirty || this.#lods.size !== this.#plots.length;
    for (const plot of this.#plots) {
      const lod = gardenLod(Math.hypot(plot.x - eye.x, plot.y - eye.y, plot.z - eye.z), this.#lods.get(plot.id));
      if (lod !== this.#lods.get(plot.id)) changed = true;
      lods.set(plot.id, lod);
    }
    if (!changed) return;
    this.#lods = lods;
    this.#dirty = false;
    const instances = gardenInstances(this.kit, this.#plots, lods);
    for (const [source, meshes] of this.#sources) {
      const values = instances.get(source);
      for (const mesh of meshes) {
        if (!values?.length) {
          mesh.thinInstanceCount = 0;
          mesh.setEnabled(false);
          continue;
        }
        mesh.thinInstanceSetBuffer('matrix', new Float32Array(values), 16, false);
        mesh.thinInstanceRefreshBoundingInfo(false);
        mesh.setEnabled(this.#visible);
      }
    }
  }
  get instanceCounts(): Record<string, number> {
    return Object.fromEntries(
      [...this.#sources].map(([source, meshes]) => [source, meshes[0]!.isEnabled() ? meshes[0]!.thinInstanceCount : 0]),
    );
  }
  dispose(): void {
    for (const meshes of this.#sources.values()) for (const mesh of meshes) mesh.dispose(false, false);
    this.#sources.clear();
    for (const m of this.#materials) m.dispose(true, true);
  }
}
