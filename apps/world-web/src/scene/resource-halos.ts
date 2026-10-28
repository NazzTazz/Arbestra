import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { Cell } from './construction-selection';
import { HALO_MARKER, haloHalfSize, HaloMarkerPlugin, type HarvestMode } from './halo-marker';
import type { TerrainStore } from './terrain-store';
import { CELL_UNITS, type WorldSpace } from './world-space';

type Resource = 'wood' | 'stone' | 'carrot';
export type ResourceHaloCell = Cell & { garden?: boolean | undefined; resource?: Resource | undefined };
type MarkerState = { validatedAt: number | null; mode: HarvestMode };
type Halo = {
  cell: ResourceHaloCell;
  available: boolean;
  pending: boolean;
  select: boolean;
  selectedAt: number | null;
  mesh: Mesh | null;
  alpha: number;
  revision: number;
  selectionMaterial: StandardMaterial | null;
};
export const RESOURCE_HALO_LIFT = 0.045;
/** Reference ring radius of a cell halo, scene units (the « Onde » ring sits a little inside it). */
export const RESOURCE_HALO_RING = 0.854;
/** Half-size of the footprint: room for the outer wave of a validation. */
export const RESOURCE_HALO_HALF_SIZE = haloHalfSize(RESOURCE_HALO_RING);
const RADIUS = RESOURCE_HALO_HALF_SIZE,
  SEGMENTS = 4;
// Light enough to read on grass, rock and soil alike (Tristan: « le cercle est un peu illisible »).
const COLOURS = { wood: '#e8b77e', stone: '#e8edf1', carrot: '#ffad5c' };
export const RESOURCE_HALO_COLOURS: Readonly<typeof COLOURS> = COLOURS;
const resource = (cell: ResourceHaloCell): Resource => cell.resource ?? (cell.garden ? 'carrot' : 'wood');
const RESTING: MarkerState = { validatedAt: null, mode: 'cut' };

/** A translucent footprint on the actual terrain triangles, rather than a ring at sea level. */
function footprint(cell: ResourceHaloCell, ground: Pick<TerrainStore, 'ground'>): VertexData | null {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  // GardenPlots has a flat crop surface at centre ground + .11 + .05.
  const crop = cell.garden ? ground.ground(cell.cellX, cell.cellY) : null;
  if (cell.garden && !crop) return null;
  for (let z = 0; z <= SEGMENTS; z++)
    for (let x = 0; x <= SEGMENTS; x++) {
      const dx = ((x / SEGMENTS) * 2 - 1) * RADIUS,
        dz = ((z / SEGMENTS) * 2 - 1) * RADIUS;
      const sample = ground.ground(cell.cellX + dx / CELL_UNITS, cell.cellY + dz / CELL_UNITS);
      if (!sample) return null; // Never invent a height while the terrain is still streaming.
      positions.push(dx, (crop ? crop.height + 0.16 : sample.height) + RESOURCE_HALO_LIFT, dz);
      uvs.push(x / SEGMENTS, z / SEGMENTS);
    }
  for (let z = 0; z < SEGMENTS; z++)
    for (let x = 0; x < SEGMENTS; x++) {
      const a = z * (SEGMENTS + 1) + x,
        b = a + 1,
        d = a + SEGMENTS + 1,
        c = d + 1;
      indices.push(a, c, b, a, d, c); // Same NW–SE diagonal as the shared vertex surface.
    }
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  data.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  return data;
}

/**
 * Scene-owned materials: one per resource at rest, one per halo while its
 * validation plays. HaloMarkerPlugin draws « Onde » (or « Satellites » for a
 * wood cell while clearing) from a clock uniform, so a frame changes no
 * geometry. Updates reuse meshes until their fade-out finishes.
 */
export class ResourceHalos {
  readonly #entries = new Map<string, Halo>();
  readonly #materials: Record<Resource, StandardMaterial>;
  #available: ResourceHaloCell[] = [];
  #pending: ResourceHaloCell[] = [];
  #lastTime: number | null = null;
  #epoch: number | null = null;
  #clock = 0;
  #mode: HarvestMode = 'cut';
  /** Footprints the last update built or rebuilt: 0 at rest. */
  footprintBuilds = 0;
  constructor(private readonly scene: Scene) {
    this.#materials = {
      wood: this.#material('wood', COLOURS.wood, () => ({ validatedAt: null, mode: this.#mode })),
      stone: this.#material('stone', COLOURS.stone),
      carrot: this.#material('carrot', COLOURS.carrot),
    };
  }
  #material(name: string, color: string, state: () => MarkerState = () => RESTING): StandardMaterial {
    const m = new StandardMaterial(`resource-halo-${name}`, this.scene);
    m.diffuseColor = Color3.Black();
    m.emissiveColor = Color3.FromHexString(color);
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    m.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    m.alphaMode = Constants.ALPHA_PREMULTIPLIED;
    new HaloMarkerPlugin(m, { clock: () => this.#clock, opacity: () => 1, scale: 1 / RADIUS, state }, false);
    return m;
  }
  /** Wood tool mode: a wood cell without trees shows « Satellites » while clearing. */
  setMode(mode: HarvestMode): void {
    this.#mode = mode;
    this.#materials.wood.emissiveColor = Color3.FromHexString(
      mode === 'clear' ? HALO_MARKER.clearColour : COLOURS.wood,
    );
  }
  setAvailable(cells: ResourceHaloCell[]): void {
    this.#available = cells;
    this.#sync();
  }
  setPending(cells: ResourceHaloCell[]): void {
    this.#pending = cells;
    this.#sync();
  }
  #sync(): void {
    const available = new Map(this.#available.map((c) => [`${c.cellX}:${c.cellY}`, c]));
    const pending = new Map(this.#pending.map((c) => [`${c.cellX}:${c.cellY}`, c]));
    for (const [key, cell] of [...available, ...pending])
      if (!this.#entries.has(key))
        this.#entries.set(key, {
          cell,
          available: false,
          pending: false,
          select: false,
          selectedAt: null,
          mesh: null,
          alpha: 0,
          revision: -1,
          selectionMaterial: null,
        });
    for (const [key, entry] of this.#entries) {
      const offered = available.get(key),
        selected = pending.get(key);
      const cell = {
        ...entry.cell,
        ...offered,
        ...selected,
        resource: selected?.resource ?? offered?.resource ?? entry.cell.resource,
        garden: offered?.garden ?? selected?.garden ?? entry.cell.garden,
      };
      if (entry.cell.garden !== cell.garden) entry.revision = -1;
      entry.cell = cell;
      if (pending.has(key) && !entry.pending) entry.select = true;
      entry.available = available.has(key);
      entry.pending = pending.has(key);
    }
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
    const epoch = (this.#epoch ??= now);
    this.#clock = (now - epoch) / 1000;
    this.footprintBuilds = 0;
    for (const [key, entry] of this.#entries) {
      if (!entry.available && !entry.pending && !entry.mesh) {
        this.#entries.delete(key);
        continue;
      }
      const target =
        enabled && ((entry.available && !entry.pending) || entry.select || entry.selectedAt !== null) ? 1 : 0;
      entry.alpha =
        target > entry.alpha
          ? Math.min(target, entry.alpha + elapsed / 220)
          : Math.max(target, entry.alpha - elapsed / 320);
      const revision = ground.groundRevisionAt(entry.cell.cellX, entry.cell.cellY);
      if (!entry.mesh || entry.revision !== revision) {
        const data = footprint(entry.cell, ground);
        if (!data) {
          entry.mesh?.setEnabled(false);
          entry.alpha = 0;
          continue;
        }
        entry.mesh ??= new Mesh(`resource-halo-${key}`, this.scene);
        data.applyToMesh(entry.mesh);
        entry.mesh.isPickable = false;
        // Keep terrain depth: a hill/building must occlude the halo naturally.
        entry.revision = revision;
        this.footprintBuilds++;
      }
      const kind = resource(entry.cell),
        base = this.#materials[kind];
      if (entry.select && enabled) {
        // The marker keeps the shape and tint it was validated with.
        const validated: MarkerState = {
          validatedAt: (now - epoch) / 1000,
          mode: kind === 'wood' ? this.#mode : 'cut',
        };
        entry.selectionMaterial?.dispose();
        entry.selectionMaterial = this.#material(`selection-${key}`, base.emissiveColor.toHexString(), () => validated);
        entry.selectedAt = now;
        entry.select = false;
        entry.alpha = 1;
      }
      if (entry.selectedAt !== null && now - entry.selectedAt >= HALO_MARKER.flashMs) {
        entry.selectionMaterial!.dispose();
        entry.selectionMaterial = null;
        entry.selectedAt = null;
        entry.alpha = 0;
      }
      entry.mesh.material = entry.selectionMaterial ?? base;
      const p = space.project(entry.cell);
      entry.mesh.position.set(p.x, 0, p.z);
      entry.mesh.visibility = entry.alpha * Math.max(0, Math.min(1, zoomOpacity));
      entry.mesh.setEnabled(entry.mesh.visibility > 0);
      if (!entry.available && !entry.pending && !entry.select && entry.selectedAt === null && entry.alpha === 0) {
        entry.mesh.dispose(false, false);
        this.#entries.delete(key);
      }
    }
  }
  /** Scene clock the shader animates with, seconds. */
  get clock(): number {
    return this.#clock;
  }
  get pendingCount(): number {
    return [...this.#entries.values()].filter((e) => e.pending && e.mesh?.isEnabled()).length;
  }
  clear(): void {
    for (const entry of this.#entries.values()) {
      entry.mesh?.dispose(false, false);
      entry.selectionMaterial?.dispose();
    }
    this.#entries.clear();
    this.#available = [];
    this.#pending = [];
  }
  dispose(): void {
    this.clear();
    for (const material of Object.values(this.#materials)) material.dispose();
  }
}
