import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { VillageState } from '@arbestra/contracts';
import { decodeBuildingAsset } from './building-asset-format';
import manifest from './garden-kit-manifest.json';
import { gardenTileStage } from './tile-appearance';

type GardenPlot = NonNullable<NonNullable<VillageState['cells'][number]['building']>['garden']>['plots'][number];
export type GardenLevel = 'near' | 'far';
interface KitGeometry {
  id: string;
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  indices: Uint32Array;
}
/** The « carré potager » kit: pieces at the origin and the manifest's placement rules, in scene axes. */
export interface GardenKitData {
  cellSize: number;
  pieces: Array<{ source: string; geometry: string; material: string }>;
  placement: {
    rows: number[];
    columns: number[];
    height: number;
    growth: Array<{ piece: string; scale: number }>;
    crate: { stage: number; position: [number, number, number]; rotationY: number };
  };
  geometries: { vertexData: KitGeometry[] };
}
/** A completed plot in scene coordinates; `open` marks sides facing another garden or none. */
export interface GardenPlotView {
  id: string;
  x: number;
  y: number;
  z: number;
  stage: number;
  open: { west: boolean; east: boolean; south: boolean; north: boolean };
  /** During a harvest: the harvested crop's stage and how many of its tufts remain. */
  harvest?: { stage: number; remaining: number };
}

/** Camera distance of the near model, with a margin against flicker. */
export const GARDEN_NEAR_DISTANCE = 120;
const HYSTERESIS = 1.1;
export const GARDEN_PLANTS = 12;

export async function fetchGardenKit(): Promise<GardenKitData> {
  const response = await fetch(manifest.kit, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Garden kit HTTP ${response.status}`);
  // Static hosts may decode Content-Encoding themselves; do not decompress twice.
  const buffer = response.headers.get('content-encoding')?.includes('gzip')
    ? await response.arrayBuffer()
    : await new Response(response.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return decodeBuildingAsset(buffer) as unknown as GardenKitData;
}

export function gardenLevel(distance: number, previous?: GardenLevel): GardenLevel {
  const limit =
    previous === 'near'
      ? GARDEN_NEAR_DISTANCE * HYSTERESIS
      : previous === 'far'
        ? GARDEN_NEAR_DISTANCE / HYSTERESIS
        : GARDEN_NEAR_DISTANCE;
  return distance < limit ? 'near' : 'far';
}

/**
 * Display only, credits nothing: the server empties the plot when the harvest is
 * reserved, so the crop seen before is the reserved amount (plus regrowth). Its
 * tufts disappear one by one over this plot's authoritative work window.
 */
export function gardenHarvestState(
  plot: GardenPlot,
  now: number,
): { stage: number; visibleStage: number; remaining: number } | null {
  const h = plot.harvest;
  if (!h) return null;
  const start = Date.parse(h.startedAt),
    stop = h.stops?.find((s) => s.cellX === plot.cellX && s.cellY === plot.cellY),
    from = start + (stop ? stop.arrivesAfterMs : h.transportMs),
    to = stop ? start + stop.workEndsAfterMs : Date.parse(h.completesAt) - h.transportMs,
    reserved = stop ? stop.reservedCarrots : h.reservedCarrots,
    progress = Math.max(0, Math.min(1, (now - from) / Math.max(1, to - from))),
    stock = (amount: number) => ({
      ...plot,
      storedCarrots: amount,
      full: plot.capacity > 0 && amount >= plot.capacity,
    });
  return {
    stage: gardenTileStage(stock(plot.storedCarrots + reserved)),
    visibleStage: gardenTileStage(stock(plot.storedCarrots + Math.floor(reserved * (1 - progress)))),
    remaining: Math.round(GARDEN_PLANTS * (1 - progress)),
  };
}

/** Deterministic per plot and slot, so a tuft keeps its place, turn and size across stages. */
export function slotVariation(plotId: string, slot: number) {
  let h = 2166136261;
  for (const c of `${plotId}#${slot}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  return {
    dx: (next() * 2 - 1) * 0.04,
    dz: (next() * 2 - 1) * 0.03,
    rotationY: next() * Math.PI * 2,
    scale: 0.9 + next() * 0.2,
  };
}

/** Tuft slots in the gardener's serpentine: rows by depth, alternately left to right and back. */
function harvestSlots(kit: Pick<GardenKitData, 'placement'>) {
  const { rows, columns } = kit.placement;
  return rows.flatMap((z, row) =>
    columns
      .map((x, column) => ({ x, z, slot: row * columns.length + column }))
      .sort((a, b) => (row % 2 ? b.x - a.x : a.x - b.x)),
  );
}

/** Each exposed side's start corner, in plot fractions, and the scene's (left-handed) Y rotation. */
const SIDES = {
  south: [0, 0, 0],
  east: [1, 0, -Math.PI / 2],
  north: [1, 1, Math.PI],
  west: [0, 1, Math.PI / 2],
} as const;

/**
 * Thin-instance matrices per kit piece. Pure: plots and their levels in, flat
 * 4×4 matrices out. Posts shared by neighbouring exposed sides are emitted once.
 */
export function gardenInstances(
  kit: Pick<GardenKitData, 'cellSize' | 'placement'>,
  plots: readonly GardenPlotView[],
  levels: ReadonlyMap<string, GardenLevel>,
): Map<string, number[]> {
  const result = new Map<string, number[]>(),
    size = kit.cellSize,
    { placement } = kit,
    matrix = new Matrix(),
    rotation = new Quaternion(),
    scaling = new Vector3(),
    translation = new Vector3(),
    posts = new Set<string>(),
    order = harvestSlots(kit);
  const emit = (source: string, x: number, y: number, z: number, rotationY = 0, scale = 1) => {
    Quaternion.RotationYawPitchRollToRef(rotationY, 0, 0, rotation);
    scaling.setAll(scale);
    translation.set(x, y, z);
    Matrix.ComposeToRef(scaling, rotation, translation, matrix);
    let list = result.get(source);
    if (!list) result.set(source, (list = []));
    for (const value of matrix.m) list.push(value);
  };
  const stageOf = (stage: number) => Math.min(placement.growth.length, Math.max(1, stage));
  for (const plot of plots) {
    const cornerX = plot.x - size / 2,
      cornerZ = plot.z - size / 2;
    if ((levels.get(plot.id) ?? 'far') === 'far') {
      emit(`LOINTAIN_STADE_${stageOf(plot.stage)}`, cornerX, plot.y, cornerZ);
      continue;
    }
    emit('SOCLE', cornerX, plot.y, cornerZ);
    // A harvest shows the harvested crop, its first tufts gone in the gardener's order.
    const stage = stageOf(plot.harvest?.stage ?? plot.stage),
      growth = placement.growth[stage - 1]!,
      slots = plot.harvest
        ? order.slice(order.length - Math.max(0, Math.min(order.length, plot.harvest.remaining)))
        : order;
    for (const { x, z, slot } of slots) {
      const v = slotVariation(plot.id, slot);
      emit(
        growth.piece,
        cornerX + x + v.dx,
        plot.y + placement.height,
        cornerZ + z + v.dz,
        v.rotationY,
        growth.scale * v.scale,
      );
    }
    if (!plot.harvest && stage === placement.crate.stage) {
      const [x, y, z] = placement.crate.position;
      emit('CAGETTE', cornerX + x, plot.y + y, cornerZ + z, placement.crate.rotationY);
    }
    for (const side of Object.keys(SIDES) as Array<keyof typeof SIDES>) {
      if (!plot.open[side]) continue;
      const [u, v, rotationY] = SIDES[side],
        x = cornerX + u * size,
        z = cornerZ + v * size;
      emit('BORDURE', x, plot.y, z, rotationY);
      // The border runs along its local X: the side's far end turns with it.
      for (const [px, pz] of [
        [x, z],
        [x + Math.cos(rotationY) * size, z - Math.sin(rotationY) * size],
      ] as const) {
        const id = `${Math.round(px * 1000)}:${Math.round(pz * 1000)}`;
        if (posts.has(id)) continue;
        posts.add(id);
        emit('POTEAU', px, plot.y, pz);
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
  #levels = new Map<string, GardenLevel>();
  #dirty = false;
  #visible = true;
  constructor(
    scene: Scene,
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
  /** New plot views (state, ground, origin or harvest progress). */
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
          p.open.west === q.open.west &&
          p.open.east === q.open.east &&
          p.open.south === q.open.south &&
          p.open.north === q.open.north &&
          p.harvest?.stage === q.harvest?.stage &&
          p.harvest?.remaining === q.harvest?.remaining
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
    const levels = new Map<string, GardenLevel>();
    let changed = this.#dirty || this.#levels.size !== this.#plots.length;
    for (const plot of this.#plots) {
      const level = gardenLevel(Math.hypot(plot.x - eye.x, plot.y - eye.y, plot.z - eye.z), this.#levels.get(plot.id));
      if (level !== this.#levels.get(plot.id)) changed = true;
      levels.set(plot.id, level);
    }
    if (!changed) return;
    this.#levels = levels;
    this.#dirty = false;
    const instances = gardenInstances(this.kit, this.#plots, levels);
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
  dispose(): void {
    for (const meshes of this.#sources.values()) for (const mesh of meshes) mesh.dispose(false, false);
    this.#sources.clear();
    for (const m of this.#materials) m.dispose(true, true);
  }
}
