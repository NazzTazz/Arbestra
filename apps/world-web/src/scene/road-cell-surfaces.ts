import {
  infrastructureSidewalkSurface,
  overlayRoadCells,
  type RoadCell,
  type RoadCellSurface,
  type RoadPixel,
} from '@arbestra/contracts';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { BuildingGeometry } from './building-geometry';
import { curbStonePiece } from './infrastructure-renderer';
import { flatRoadGeometry } from './infrastructure-surface-geometry';
import { sidewalkPaving } from './sidewalk-paving';
import { freezeStaticHierarchy, refreshStaticHierarchy } from './static-transforms';
import { WorldSpace } from './world-space';

type Cell = Pick<RoadCell, 'cellX' | 'cellY' | 'surface' | 'sidewalks'>;
type Code = 'earth' | 'rubble' | 'border';
type Ground = (x: number, y: number) => number | null;
type Identity = (x: number, y: number) => string | number;

/** Revêtements dessinés par secteurs ; la pierre reste en tuiles (road-cell-tiles.ts). */
export const isSectorSurface = (surface: RoadCellSurface) => surface === 'earth' || surface === 'rubble';

/** Côté d'un secteur, en cases. */
export const SECTOR_CELLS = 8;
/** Une tranche de trottoirs s'arrête dès qu'elle a pris ce temps (ms), pour laisser passer les images. */
export const CURB_SLICE_MS = 4;
/** Une mise à jour construit tout de suite les secteurs neufs jusqu'à ce temps (ms), le reste suit par tranches. */
export const SYNC_BUDGET_MS = 12;
const COLOURS: Record<Code, string> = { earth: '#795b3d', rubble: '#b7b8b2', border: '#c5c6b8' };
const TOP_OFFSET = 0.015,
  DEPTH = 0.025,
  CURB_HEIGHT = 0.06;
const wrap = (value: number, size: number) => ((value % size) + size) % size;
/** Les positions lues sont des multiples de 1/32 de case : clé entière d'une position (ligne × ROW + colonne). */
const PRECISION = 64,
  ROW = 1 << 24;

interface Sector {
  key: string;
  /** Les cases du secteur et de sa première couronne : inchangées, rien n'est reconstruit. */
  signature: string;
  /** Surface (terre, gravats) puis trottoirs, au fil des tranches. */
  meshes: Mesh[];
  /** Hauteurs lues, pour revalider le secteur sans identité de sol. */
  probes: Map<string, number | null>;
  /** Identité des cases de sol lues (index y × largeur + x), quand l'appelant en fournit. */
  grounds: Map<number, string | number>;
  /** Hauteurs déjà lues par cette construction, pour ne pas relire un point (surface et trottoirs). */
  heights: Map<number, number | null>;
  /** Cases à trottoirs dont les bordures ne sont pas encore dessinées. */
  curbs: Cell[];
  /** Étendue des cases du bloc (voisinage compris), pour les changements d'origine. */
  block: { x0: number; y0: number; x1: number; y1: number };
}
export interface RoadCellSurfacesOptions {
  followTerrain?: boolean;
  groundIdentity?: string | undefined;
  groundCellIdentity?: Identity;
}

/**
 * Cases de route de terre et de gravats, dessinées par secteurs de 8 × 8 cases avec la géométrie des
 * routes automatiques (`flatRoadGeometry`, `curbStonePiece`) : la surface suit le terrain sommet par
 * sommet, donc se raccorde sans marche à une route automatique voisine et à une autre case, quelle que
 * soit la pente (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4.6).
 *
 * Le travail d'une mise à jour ne dépend pas de la taille du village : la liste de cases est comparée à
 * la précédente, seuls les secteurs dont une case change dans leur bloc (le secteur plus une case de
 * voisinage, pour les bras ouverts et les trottoirs) sont reconstruits, chacun à partir de la trame
 * locale de son bloc. Les bordures de trottoir, qui coûtent le plus (plusieurs ms par case), sont
 * dessinées case par case en tranches de quelques ms entre deux images. Une publication de terrain ne
 * reconstruit que les secteurs dont une case de sol lue a changé (`groundCellIdentity`) : un trait de
 * terraformation ailleurs ne lit aucune hauteur. Un changement d'origine déplace les maillages sans les
 * reconstruire.
 */
export class RoadCellSurfaces {
  readonly #scene: Scene;
  readonly #materials = new Map<Code, StandardMaterial>();
  readonly #sectors = new Map<string, Sector>();
  #cells: readonly Cell[] | undefined;
  #byKey = new Map<string, Cell>();
  #world = { widthCells: 0, heightCells: 0 };
  #origin = { cellX: Number.NaN, cellY: Number.NaN };
  #groundIdentity: string | undefined;
  #visible = true;
  /** Les entrées de la dernière mise à jour, que les tranches de trottoirs relisent. */
  #env: { space: WorldSpace; ground: Ground; followTerrain: boolean; identity: Identity | undefined } | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** Secteurs neufs dont la surface n'est pas encore construite. */
  readonly #later = new Set<string>();
  /** Compteurs pour les tests et les mesures : mises à jour effectives, secteurs reconstruits, lectures du sol. */
  readonly stats = { updates: 0, sectorsBuilt: 0, groundReads: 0, curbCells: 0 };
  constructor(scene: Scene) {
    this.#scene = scene;
  }
  #material(code: Code): StandardMaterial {
    let material = this.#materials.get(code);
    if (!material) {
      material = new StandardMaterial(`infrastructure-${code}`, this.#scene);
      material.diffuseColor = Color3.FromHexString(COLOURS[code]);
      material.specularColor = Color3.Black();
      this.#materials.set(code, material);
    }
    return material;
  }
  update(cells: readonly Cell[] | undefined, space: WorldSpace, ground: Ground, options: RoadCellSurfacesOptions = {}) {
    const sameWorld = space.width === this.#world.widthCells && space.height === this.#world.heightCells,
      sameOrigin = space.origin.cellX === this.#origin.cellX && space.origin.cellY === this.#origin.cellY,
      sameGround = options.groundIdentity !== undefined && options.groundIdentity === this.#groundIdentity;
    // O(1) tant que rien ne change : ni liste de cases, ni sol, ni origine.
    if (cells === this.#cells && sameWorld && sameOrigin && sameGround) return;
    this.stats.updates++;
    this.#env = {
      space,
      ground,
      followTerrain: options.followTerrain ?? false,
      identity: options.groundCellIdentity,
    };
    if (!sameWorld) {
      this.#clear();
      this.#world = { widthCells: space.width, heightCells: space.height };
      this.#byKey = new Map();
      this.#cells = undefined;
    }
    // Secteurs dont le bloc contient une case changée : la case, ses huit voisines.
    const dirty = new Set<string>(),
      forced = new Set<string>();
    const mark = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          dirty.add(this.#sectorKey(wrap(x + dx, space.width), wrap(y + dy, space.height)));
    };
    if (cells !== this.#cells) {
      const next = new Map<string, Cell>();
      for (const c of cells ?? []) next.set(c.cellX + ':' + c.cellY, c);
      for (const [key, c] of next) {
        const prior = this.#byKey.get(key);
        if (!prior || prior.surface !== c.surface || prior.sidewalks !== c.sidewalks) mark(c.cellX, c.cellY);
      }
      for (const [key, c] of this.#byKey) if (!next.has(key)) mark(c.cellX, c.cellY);
      this.#byKey = next;
      this.#cells = cells;
    }
    if (!sameOrigin) this.#moveOrigin(space, forced);
    this.#groundIdentity = options.groundIdentity;
    // Une publication de terrain ne reconstruit que les secteurs dont une hauteur lue a changé.
    const candidates = new Set([...dirty, ...forced]);
    if (!sameGround) for (const key of this.#sectors.keys()) candidates.add(key);
    const started = performance.now();
    for (const key of candidates) {
      const [sx, sy] = key.split(':').map(Number) as [number, number],
        prior = this.#sectors.get(key),
        signature = this.#signature(sx, sy, space);
      if (
        prior &&
        !forced.has(key) &&
        prior.signature === signature &&
        (sameGround || this.#groundCurrent(prior, space.width))
      )
        continue;
      // Un secteur neuf (sans surface à remplacer) peut attendre la tranche suivante ; un secteur remplacé est refait
      // tout de suite, pour qu'aucune surface ne disparaisse entre deux images.
      if (!prior && !forced.has(key) && signature && performance.now() - started > SYNC_BUDGET_MS) {
        this.#later.add(key);
        continue;
      }
      this.#later.delete(key);
      prior?.meshes.forEach((m) => m.dispose(false, false));
      const built = this.#build(sx, sy, key, signature);
      if (built) this.#sectors.set(key, built);
      else this.#sectors.delete(key);
    }
    this.#origin = { ...space.origin };
    this.#schedule();
  }
  #sample = (x: number, y: number) => {
    this.stats.groundReads++;
    return this.#env!.ground(x, y);
  };
  #sectorKey(cellX: number, cellY: number) {
    return Math.floor(cellX / SECTOR_CELLS) + ':' + Math.floor(cellY / SECTOR_CELLS);
  }
  /**
   * Le sol lu par ce secteur est-il toujours celui de sa construction ? Avec une identité par case de sol,
   * seule celle-ci décide (aucune hauteur n'est relue) ; sans elle, les hauteurs lues sont comparées.
   */
  #groundCurrent(sector: Sector, width: number): boolean {
    const identity = this.#env!.identity;
    if (identity) {
      for (const [key, id] of sector.grounds) if (identity(key % width, Math.floor(key / width)) !== id) return false;
      return true;
    }
    for (const [key, height] of sector.probes) {
      const [x, y] = key.split(':').map(Number) as [number, number];
      if (this.#sample(x, y) !== height) return false;
    }
    return true;
  }
  /** Les cases du secteur et de sa première couronne, telles que la trame les verra ; vide sans terre ni gravats. */
  #signature(sx: number, sy: number, space: WorldSpace): string {
    const x0 = sx * SECTOR_CELLS,
      y0 = sy * SECTOR_CELLS,
      x1 = Math.min(x0 + SECTOR_CELLS, space.width) - 1,
      y1 = Math.min(y0 + SECTOR_CELLS, space.height) - 1;
    let signature = '',
      drawn = false;
    for (let y = y0 - 1; y <= y1 + 1; y++)
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const cell = this.#byKey.get(wrap(x, space.width) + ':' + wrap(y, space.height));
        if (!cell) continue;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && isSectorSurface(cell.surface)) drawn = true;
        signature += `${x - x0},${y - y0},${cell.surface},${cell.sidewalks ? 1 : 0};`;
      }
    return drawn ? signature : '';
  }
  /** Les cases de la trame d'un bloc : la case `(x, y)` et les voisines jusqu'à `reach` cases. */
  #rasterAround(x0: number, y0: number, x1: number, y1: number, reach: number): Map<string, RoadPixel> {
    const { space } = this.#env!,
      block: Cell[] = [];
    for (let y = y0 - reach; y <= y1 + reach; y++)
      for (let x = x0 - reach; x <= x1 + reach; x++) {
        const cell = this.#byKey.get(wrap(x, space.width) + ':' + wrap(y, space.height));
        if (cell) block.push(cell);
      }
    const raster = new Map<string, RoadPixel>();
    overlayRoadCells(raster, block, { widthCells: space.width, heightCells: space.height });
    return raster;
  }
  /** Lecture d'une hauteur mémorisée pour le secteur : un point n'est lu qu'une fois, surface et trottoirs confondus. */
  #reader(sector: Sector): Ground {
    const { space, identity } = this.#env!;
    return (x, y) => {
      const qx = x * PRECISION,
        qy = y * PRECISION;
      // Seules les positions de la grille de lecture sont mémorisées ; un sommet de pierre découpée n'est lu qu'une fois.
      const grid = Number.isInteger(qx) && Number.isInteger(qy),
        key = qy * ROW + qx;
      let value = grid ? sector.heights.get(key) : undefined;
      if (value === undefined && !(grid && sector.heights.has(key))) {
        if (identity) {
          const cx = wrap(Math.round(x), space.width),
            cy = wrap(Math.round(y), space.height),
            k = cy * space.width + cx;
          if (!sector.grounds.has(k)) sector.grounds.set(k, identity(cx, cy));
        }
        value = this.#sample(x, y);
        if (grid) {
          sector.heights.set(key, value);
        }
        if (!identity) sector.probes.set(x + ':' + y, value);
      }
      return value ?? null;
    };
  }
  /**
   * Surface d'un secteur, depuis la seule trame de son bloc (le secteur plus deux cases autour : les bras
   * ouverts vers les voisines). Les trottoirs de ses cases sont mis en file. Null sans terre ni gravats.
   */
  #build(sx: number, sy: number, key: string, signature: string): Sector | null {
    if (!signature) return null;
    const { space, followTerrain } = this.#env!;
    const x0 = sx * SECTOR_CELLS,
      y0 = sy * SECTOR_CELLS,
      x1 = Math.min(x0 + SECTOR_CELLS, space.width) - 1,
      y1 = Math.min(y0 + SECTOR_CELLS, space.height) - 1;
    const own = new Set<string>(),
      curbs: Cell[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cell = this.#byKey.get(x + ':' + y);
        if (!cell || !isSectorSurface(cell.surface)) continue;
        own.add(x + ':' + y);
        if (cell.sidewalks) curbs.push(cell);
      }
    const sector: Sector = {
      key,
      signature,
      meshes: [],
      probes: new Map(),
      grounds: new Map(),
      heights: new Map(),
      curbs,
      block: { x0, y0, x1, y1 },
    };
    const read = this.#reader(sector);
    const raster = this.#rasterAround(x0, y0, x1, y1, 2);
    for (const code of ['earth', 'rubble'] as const) {
      // Les pixels d'un revêtement, en entier pour les murets exposés, ceux du secteur pour la surface.
      const all = new Map<string, RoadPixel>(),
        mine = new Map<string, RoadPixel>();
      for (const [point, p] of raster) {
        if (p.material !== code) continue;
        all.set(point, p);
        if (own.has(this.#cellOf(p))) mine.set(point, p);
      }
      if (!mine.size) continue;
      const data = flatRoadGeometry(mine, space, read, followTerrain, TOP_OFFSET, DEPTH, all);
      if (data.indices?.length) sector.meshes.push(this.#mesh(code, data, key));
    }
    this.stats.sectorsBuilt++;
    return sector;
  }
  #cellOf(p: { x: number; y: number }) {
    const { space } = this.#env!;
    return wrap(Math.floor((p.x + 8) / 16), space.width) + ':' + wrap(Math.floor((p.y + 8) / 16), space.height);
  }
  #mesh(code: Code, data: { applyToMesh: (mesh: Mesh) => unknown }, key: string): Mesh {
    const mesh = new Mesh(`infrastructure-${code}:${key}`, this.#scene);
    data.applyToMesh(mesh);
    mesh.material = this.#material(code);
    mesh.isPickable = false;
    mesh.setEnabled(this.#visible);
    freezeStaticHierarchy(mesh);
    return mesh;
  }
  /** Bordures de trottoir d'une case : les pierres de ses pixels, posées avec ses voisines présentes. */
  #curbPieces(sector: Sector, cell: Cell): BuildingGeometry[] {
    const { space, followTerrain } = this.#env!,
      world = { widthCells: space.width, heightCells: space.height };
    const raster = this.#rasterAround(cell.cellX, cell.cellY, cell.cellX, cell.cellY, 2),
      here = cell.cellX + ':' + cell.cellY;
    const ring = infrastructureSidewalkSurface(raster, world);
    for (const [point, p] of ring) if (this.#cellOf({ x: p.x + 0.5, y: p.y + 0.5 }) !== here) ring.delete(point);
    const read = this.#reader(sector),
      pieces: BuildingGeometry[] = [];
    for (const stone of sidewalkPaving(raster, ring, world)) {
      const piece = curbStonePiece(stone, space, read, followTerrain, CURB_HEIGHT);
      if (piece) pieces.push(piece);
    }
    return pieces;
  }
  #schedule() {
    if (this.#timer !== null || (!this.#later.size && !this.#hasCurbs())) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#slice(CURB_SLICE_MS);
      this.#schedule();
    }, 0);
  }
  #hasCurbs() {
    for (const sector of this.#sectors.values()) if (sector.curbs.length) return true;
    return false;
  }
  /** Construit les secteurs neufs puis dessine les bordures en attente, case par case, jusqu'à `budget` ms. */
  #slice(budget: number) {
    const started = performance.now();
    for (const key of [...this.#later]) {
      if (performance.now() - started >= budget) return;
      this.#later.delete(key);
      const [sx, sy] = key.split(':').map(Number) as [number, number],
        signature = this.#signature(sx, sy, this.#env!.space);
      if (this.#sectors.has(key) || !signature) continue;
      const built = this.#build(sx, sy, key, signature);
      if (built) this.#sectors.set(key, built);
    }
    for (const sector of this.#sectors.values()) {
      const pieces: BuildingGeometry[] = [];
      while (sector.curbs.length && performance.now() - started < budget) {
        pieces.push(...this.#curbPieces(sector, sector.curbs.shift()!));
        this.stats.curbCells++;
      }
      for (let i = 0; i < pieces.length; i += 1024)
        sector.meshes.push(this.#mesh('border', BuildingGeometry.merge(pieces.slice(i, i + 1024)), sector.key));
      if (performance.now() - started >= budget) return;
    }
  }
  /** Dessine tout de suite les bordures en attente (tests, captures). */
  settle() {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#slice(Infinity);
  }
  /** Nombre de secteurs neufs dont la surface n'est pas encore construite. */
  get pendingSectors(): number {
    return this.#later.size;
  }
  /** Nombre de cases dont les bordures ne sont pas encore dessinées. */
  get pendingCurbs(): number {
    let count = 0;
    for (const sector of this.#sectors.values()) count += sector.curbs.length;
    return count;
  }
  /** Déplace les maillages avec l'origine ; un secteur qui change de côté de la couture torique est reconstruit. */
  #moveOrigin(space: WorldSpace, forced: Set<string>) {
    if (!Number.isFinite(this.#origin.cellX)) return;
    const prior = new WorldSpace(space.width, space.height, this.#origin),
      shift = space.project(this.#origin);
    for (const sector of this.#sectors.values()) {
      const { x0, y0, x1, y1 } = sector.block;
      let consistent = true;
      for (const [x, y] of [
        [x0 - 2, y0 - 2],
        [x1 + 2, y1 + 2],
      ] as const) {
        const cell = { cellX: wrap(x, space.width), cellY: wrap(y, space.height) },
          before = prior.project(cell),
          now = space.project(cell);
        if (Math.abs(before.x + shift.x - now.x) > 1e-6 || Math.abs(before.z + shift.z - now.z) > 1e-6)
          consistent = false;
      }
      if (!consistent) {
        forced.add(sector.key);
        continue;
      }
      for (const mesh of sector.meshes) {
        mesh.position.x += shift.x;
        mesh.position.z += shift.z;
        refreshStaticHierarchy(mesh);
      }
    }
  }
  #clear() {
    this.#later.clear();
    for (const sector of this.#sectors.values()) sector.meshes.forEach((m) => m.dispose(false, false));
    this.#sectors.clear();
  }
  visible(value: boolean): void {
    if (value === this.#visible) return;
    this.#visible = value;
    for (const sector of this.#sectors.values()) for (const mesh of sector.meshes) mesh.setEnabled(value);
  }
  get meshes(): Mesh[] {
    return [...this.#sectors.values()].flatMap((sector) => sector.meshes);
  }
  dispose(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#clear();
    for (const material of this.#materials.values()) material.dispose();
    this.#materials.clear();
  }
}
