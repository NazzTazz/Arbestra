import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { Cell } from './construction-selection';
import type { TerrainStore } from './terrain-store';
import { CELL_UNITS, type WorldSpace } from './world-space';

type Resource = 'wood' | 'stone' | 'carrot';
export type ResourceHaloCell = Cell & { garden?: boolean | undefined; resource?: Resource | undefined };
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
const RADIUS = 1.22,
  SEGMENTS = 4;
// Light enough to read on grass, rock and soil alike (Tristan: « le cercle est un peu illisible »).
const COLOURS = { wood: '#e8b77e', stone: '#e8edf1', carrot: '#ffad5c' };
export const RESOURCE_HALO_COLOURS: Readonly<typeof COLOURS> = COLOURS;
export const RESOURCE_HALO_OPACITY = 0.85;
/** A validated item lights up: quick rise to a bright white, held, then out. */
export const HALO_FLASH = { riseMs: 150, holdMs: 900, fadeMs: 900 } as const;
const FLASH_END = HALO_FLASH.riseMs + HALO_FLASH.holdMs + HALO_FLASH.fadeMs;
/** Flash state at `age` ms after validation: whiteness, and opacity relative to full. */
export function haloFlash(age: number): { white: number; opacity: number } {
  const rise = Math.min(1, Math.max(0, age / HALO_FLASH.riseMs)),
    fade = Math.min(1, Math.max(0, (age - HALO_FLASH.riseMs - HALO_FLASH.holdMs) / HALO_FLASH.fadeMs));
  return { white: rise, opacity: (RESOURCE_HALO_OPACITY + (1 - RESOURCE_HALO_OPACITY) * rise) * (1 - fade) };
}
export const HALO_FLASH_MS = FLASH_END;
const OPACITY = RESOURCE_HALO_OPACITY;
const resource = (cell: ResourceHaloCell): Resource => cell.resource ?? (cell.garden ? 'carrot' : 'wood');

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

/** A white ring at 70 % of the quad over a faint disc, alpha only: the material tints it. */
export function haloTexture(
  scene: Scene,
  { name = 'resource-halo-soft', size = 256, core = 0.035, soft = 0.09, fill = 0.14 } = {},
): RawTexture {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1);
      // The disc reads as a zone; it fades out just inside the ring.
      const disc = fill * Math.min(1, Math.max(0, (0.7 - r) / 0.12));
      const alpha =
        0.95 * Math.exp(-Math.pow((r - 0.7) / core, 2)) + 0.22 * Math.exp(-Math.pow((r - 0.7) / soft, 2)) + disc;
      const i = (y * size + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  const texture = RawTexture.CreateRGBATexture(pixels, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = name;
  texture.hasAlpha = true;
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/** Scene-owned shared materials/texture. Updates reuse meshes until their fade-out finishes. */
export class ResourceHalos {
  readonly #entries = new Map<string, Halo>();
  readonly #materials: Record<Resource, StandardMaterial>;
  readonly #texture: RawTexture;
  #available: ResourceHaloCell[] = [];
  #pending: ResourceHaloCell[] = [];
  #lastTime: number | null = null;
  constructor(private readonly scene: Scene) {
    this.#texture = haloTexture(scene);
    this.#materials = {
      wood: this.#material('wood', COLOURS.wood),
      stone: this.#material('stone', COLOURS.stone),
      carrot: this.#material('carrot', COLOURS.carrot),
    };
  }
  #material(name: string, color: string): StandardMaterial {
    const m = new StandardMaterial(`resource-halo-${name}`, this.scene);
    m.diffuseTexture = this.#texture;
    m.useAlphaFromDiffuseTexture = true;
    m.diffuseColor = Color3.Black();
    m.emissiveColor = Color3.FromHexString(color);
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    m.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    return m;
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
      }
      const base = this.#materials[resource(entry.cell)];
      if (entry.select && enabled) {
        entry.selectionMaterial ??= this.#material(`selection-${key}`, COLOURS[resource(entry.cell)]);
        // Added light, not a veil: the validated halo glows on the ground.
        entry.selectionMaterial.alphaMode = Constants.ALPHA_ADD;
        entry.selectedAt = now;
        entry.select = false;
        entry.alpha = 1;
      }
      let opacity = OPACITY;
      if (entry.selectedAt !== null) {
        const age = Math.max(0, now - entry.selectedAt),
          flash = haloFlash(age);
        const tint = entry.selectionMaterial!.emissiveColor;
        tint.set(
          base.emissiveColor.r + (1 - base.emissiveColor.r) * flash.white,
          base.emissiveColor.g + (1 - base.emissiveColor.g) * flash.white,
          base.emissiveColor.b + (1 - base.emissiveColor.b) * flash.white,
        );
        opacity = flash.opacity;
        if (age >= FLASH_END) {
          entry.selectionMaterial!.dispose();
          entry.selectionMaterial = null;
          entry.selectedAt = null;
          entry.alpha = 0;
        }
      }
      entry.mesh.material = entry.selectionMaterial ?? base;
      const p = space.project(entry.cell);
      entry.mesh.position.set(p.x, 0, p.z);
      entry.mesh.visibility = entry.alpha * Math.max(0, Math.min(1, zoomOpacity)) * opacity;
      entry.mesh.setEnabled(entry.mesh.visibility > 0);
      if (!entry.available && !entry.pending && !entry.select && entry.selectedAt === null && entry.alpha === 0) {
        entry.mesh.dispose(false, false);
        this.#entries.delete(key);
      }
    }
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
    this.#texture.dispose();
  }
}
