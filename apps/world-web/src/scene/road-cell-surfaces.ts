import { overlayRoadCells, type RoadCell, type RoadCellSurface, type RoadPixel } from '@arbestra/contracts';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { flatRoadGeometry } from './infrastructure-surface-geometry';
import { ROAD_DIRECTIONS } from './road-cell-links';
import {
  ROAD_TILE_SHAPES,
  roadCellMask,
  roadTileBuilt,
  roadTileFor,
  roadTileGeometryOf,
  type RoadTileShape,
} from './road-cell-tiles';
import { freezeStaticHierarchy, refreshStaticHierarchy } from './static-transforms';
import { CELL_UNITS, WorldSpace } from './world-space';

type Cell = Pick<RoadCell, 'cellX' | 'cellY' | 'surface' | 'sidewalks'>;
type Code = RoadCellSurface | 'border';
type Ground = (x: number, y: number) => number | null;
type Identity = (x: number, y: number) => string | number;

/** Earth and rubble: one welded surface per sector, as the automatic roads. Stone: baked tiles, cell by cell. */
export const isSectorSurface = (surface: RoadCellSurface) => surface === 'earth' || surface === 'rubble';

/** Côté d'un secteur, en cases. */
export const SECTOR_CELLS = 8;
/** Une tranche de travail différé s'arrête dès qu'elle a pris ce temps (ms), pour laisser passer les images. */
export const SLICE_MS = 4;
/** Une mise à jour construit tout de suite les secteurs neufs jusqu'à ce temps (ms), le reste suit par tranches. */
export const SYNC_BUDGET_MS = 12;
/**
 * Stone has always lain 2 cm above the ground (it was the tilt clearance of the flat tiles): kept, so that stone on
 * flat ground looks as it did, and sits clear of the terrain triangles between two vertices.
 */
export const STONE_CLEARANCE = 0.02;
const COLOURS: Record<Code, string> = {
  earth: '#795b3d',
  rubble: '#b7b8b2',
  'stone-1': '#c5c6b8',
  'stone-2': '#d4d3c4',
  border: '#c5c6b8',
};
const TOP_OFFSET = 0.015,
  DEPTH = 0.025;
const wrap = (value: number, size: number) => ((value % size) + size) % size;
/** Position lue, au 1/8192 de case (0,3 mm) : clé entière (colonne × FINE_ROW + ligne). */
const FINE = 8192,
  FINE_ROW = 1 << 23;
const COS = [1, 0, -1, 0],
  SIN = [0, 1, 0, -1];

/** Une case à dessiner plus tard : ses bordures (terre, gravats) ou sa tuile entière (pierre). */
type Job = { kind: 'curb' | 'stone'; cell: Cell };
interface Sector {
  key: string;
  /** Les cases du secteur, de sa première couronne et leurs jonctions : inchangées, rien n'est refait. */
  signature: string;
  meshes: Mesh[];
  /** Hauteurs lues, pour revalider le secteur sans identité de sol. */
  probes: Map<string, number | null>;
  /** Identité des cases de sol lues (index y × largeur + x), quand l'appelant en fournit. */
  grounds: Map<number, string | number>;
  /** Hauteurs déjà lues par cette construction, par position fine, pour ne pas relire un point. */
  heights: Map<number, number | null>;
  /** Hauteurs des sommets des tuiles de pierre, par position fine (partagées entre les cases du secteur). */
  vertices: Map<number, number>;
  /** Le travail restant : tant qu'il en reste, le secteur précédent (s'il y en a un) reste affiché. */
  jobs: Job[];
  /** Les maillages sont visibles dès leur création (secteur sans précédent) ; sinon à l'échange. */
  live: boolean;
  /** Étendue des cases du bloc (voisinage compris), pour les changements d'origine. */
  block: { x0: number; y0: number; x1: number; y1: number };
}
export interface RoadCellSurfacesOptions {
  followTerrain?: boolean;
  groundIdentity?: string | undefined;
  groundCellIdentity?: Identity;
  /** Par case de route (`x:y`), les côtés où une route automatique entre (bits `ROAD_*`, road-cell-links.ts). */
  links?: ReadonlyMap<string, number>;
}
const NO_LINKS: ReadonlyMap<string, number> = new Map();
interface Baked {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/**
 * Cases de route dessinées par secteurs de 8 × 8 cases, qui suivent le terrain sommet par sommet comme les routes
 * automatiques, donc se raccordent sans marche à elles et entre elles quelle que soit la pente
 * (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4.6).
 *
 * - Terre et gravats : une surface soudée par secteur avec la géométrie des routes automatiques (`flatRoadGeometry`).
 * - Pierre (petite pierre, grands pavés) : la tuile de la case, avec son appareillage et ses bordures, est posée sur
 *   le sol : chaque sommet de la tuile plate prend la hauteur du terrain sous lui (`#bakeTile`). Sur sol plat, c'est
 *   la tuile d'avant, 2 cm au-dessus du sol.
 * - Les bordures de trottoir de la terre et des gravats sont les bordures de la même tuile, posées de la même façon ;
 *   elles et les tuiles de pierre sont faites case par case (de 0,5 à 10 ms) en
 *   tranches de quelques ms entre deux images ; le secteur précédent reste affiché jusqu'à l'échange.
 *
 * Le travail d'une mise à jour ne dépend pas de la taille du village : la liste de cases est comparée à la
 * précédente et seuls les secteurs dont une case change dans leur bloc (le secteur plus une case de voisinage, pour les
 * bras ouverts et les trottoirs) sont refaits. Une publication de terrain ne refait que les secteurs dont une case de
 * sol lue a changé (`groundCellIdentity`) : un trait de terraformation ailleurs ne lit aucune hauteur. Un changement
 * d'origine déplace les maillages sans les refaire.
 */
export class RoadCellSurfaces {
  readonly #scene: Scene;
  readonly #materials = new Map<Code, StandardMaterial>();
  /** Les secteurs affichés. */
  readonly #sectors = new Map<string, Sector>();
  /** Les secteurs en cours de construction : un nouveau secteur, ou le remplaçant d'un secteur affiché. */
  readonly #building = new Map<string, Sector>();
  /** Secteurs neufs dont la construction n'a pas encore commencé. */
  readonly #later = new Set<string>();
  #cells: readonly Cell[] | undefined;
  #byKey = new Map<string, Cell>();
  #links: ReadonlyMap<string, number> = NO_LINKS;
  #world = { widthCells: 0, heightCells: 0 };
  #origin = { cellX: Number.NaN, cellY: Number.NaN };
  #groundIdentity: string | undefined;
  #visible = true;
  /** Les entrées de la dernière mise à jour, que les tranches différées relisent. */
  #env: { space: WorldSpace; ground: Ground; followTerrain: boolean; identity: Identity | undefined } | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #prewarm: Array<[RoadTileShape, RoadCellSurface, boolean]> = [];
  #prewarmTimer: ReturnType<typeof setTimeout> | null = null;
  /** Compteurs pour les tests et les mesures. */
  readonly stats = { updates: 0, sectorsBuilt: 0, groundReads: 0, jobs: 0, tilesBuilt: 0, slices: [] as string[] };
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
    const links = options.links ?? NO_LINKS;
    // O(1) tant que rien ne change : ni liste de cases, ni sol, ni origine, ni jonction.
    if (cells === this.#cells && sameWorld && sameOrigin && sameGround && links === this.#links) return;
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
    // Une jonction ajoutée ou retirée change les bras de sa case.
    if (links !== this.#links) {
      const at = (key: string) => key.split(':').map(Number) as [number, number];
      for (const [key, mask] of links) if (this.#links.get(key) !== mask) mark(...at(key));
      for (const [key, mask] of this.#links) if (links.get(key) !== mask) mark(...at(key));
      this.#links = links;
    }
    if (!sameOrigin) this.#moveOrigin(space, forced);
    this.#groundIdentity = options.groundIdentity;
    // Une publication de terrain ne refait que les secteurs dont une hauteur lue a changé.
    const candidates = new Set([...dirty, ...forced]);
    if (!sameGround) {
      for (const key of this.#sectors.keys()) candidates.add(key);
      for (const key of this.#building.keys()) candidates.add(key);
    }
    const started = performance.now();
    for (const key of candidates) {
      const [sx, sy] = key.split(':').map(Number) as [number, number],
        current = this.#building.get(key) ?? this.#sectors.get(key),
        signature = this.#signature(sx, sy, space);
      if (
        current &&
        !forced.has(key) &&
        current.signature === signature &&
        (sameGround || this.#groundCurrent(current, space.width))
      )
        continue;
      // Un secteur neuf (sans surface à remplacer) peut attendre la tranche suivante ; un secteur remplacé garde
      // l'ancien affichage jusqu'à l'échange, sans trou entre deux images.
      if (!current && signature && performance.now() - started > SYNC_BUDGET_MS) {
        this.#later.add(key);
        continue;
      }
      this.#later.delete(key);
      this.#start(sx, sy, key, signature);
    }
    this.#origin = { ...space.origin };
    this.#schedule();
  }
  /** Remplace le travail en cours de ce secteur par un nouveau, ou le retire quand il ne reste plus de case. */
  #start(sx: number, sy: number, key: string, signature: string) {
    this.#building.get(key)?.meshes.forEach((m) => m.dispose(false, false));
    this.#building.delete(key);
    if (!signature) {
      this.#sectors.get(key)?.meshes.forEach((m) => m.dispose(false, false));
      this.#sectors.delete(key);
      return;
    }
    const next = this.#build(sx, sy, key, signature);
    if (next.jobs.length) this.#building.set(key, next);
    else this.#install(next);
  }
  /** Le secteur terminé remplace celui qui était affiché. */
  #install(sector: Sector) {
    this.#building.delete(sector.key);
    this.#sectors.get(sector.key)?.meshes.forEach((m) => m.dispose(false, false));
    for (const mesh of sector.meshes) mesh.setEnabled(this.#visible);
    sector.live = true;
    this.#sectors.set(sector.key, sector);
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
  /** Les cases du secteur et de sa première couronne, telles que la trame les verra ; vide sans case à dessiner. */
  #signature(sx: number, sy: number, space: WorldSpace): string {
    const x0 = sx * SECTOR_CELLS,
      y0 = sy * SECTOR_CELLS,
      x1 = Math.min(x0 + SECTOR_CELLS, space.width) - 1,
      y1 = Math.min(y0 + SECTOR_CELLS, space.height) - 1;
    let signature = '',
      drawn = false;
    for (let y = y0 - 1; y <= y1 + 1; y++)
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const cx = wrap(x, space.width),
          cy = wrap(y, space.height),
          cell = this.#byKey.get(cx + ':' + cy);
        if (!cell) continue;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) drawn = true;
        signature += `${x - x0},${y - y0},${cell.surface},${cell.sidewalks ? 1 : 0},${this.#links.get(cx + ':' + cy) ?? 0};`;
      }
    return drawn ? signature : '';
  }
  #cellOf(p: { x: number; y: number }) {
    const { space } = this.#env!;
    return wrap(Math.floor((p.x + 8) / 16), space.width) + ':' + wrap(Math.floor((p.y + 8) / 16), space.height);
  }
  /** Les cases de la trame d'un bloc : `[x0, x1] × [y0, y1]` et les voisines jusqu'à `reach` cases. */
  #rasterAround(x0: number, y0: number, x1: number, y1: number, reach: number): Map<string, RoadPixel> {
    const { space } = this.#env!,
      block: Cell[] = [];
    for (let y = y0 - reach; y <= y1 + reach; y++)
      for (let x = x0 - reach; x <= x1 + reach; x++) {
        const cell = this.#byKey.get(wrap(x, space.width) + ':' + wrap(y, space.height));
        if (cell) block.push(cell);
      }
    // Une case de route ouverte vers une route automatique a son bras vers elle : la case automatique est posée
    // comme voisine le temps de la trame, puis ses pixels sont retirés (la route automatique les dessine).
    const virtual = new Set<string>();
    for (const cell of [...block]) {
      const mask = this.#links.get(cell.cellX + ':' + cell.cellY);
      if (!mask) continue;
      for (const [dx, dy, bit] of ROAD_DIRECTIONS) {
        if (!(mask & bit)) continue;
        const cx = wrap(cell.cellX + dx, space.width),
          cy = wrap(cell.cellY + dy, space.height),
          key = cx + ':' + cy;
        if (this.#byKey.has(key) || virtual.has(key)) continue;
        virtual.add(key);
        block.push({ cellX: cx, cellY: cy, surface: cell.surface, sidewalks: cell.sidewalks });
      }
    }
    const raster = new Map<string, RoadPixel>();
    overlayRoadCells(raster, block, { widthCells: space.width, heightCells: space.height });
    if (virtual.size) for (const [point, p] of raster) if (virtual.has(this.#cellOf(p))) raster.delete(point);
    return raster;
  }
  /** Lecture d'une hauteur mémorisée pour le secteur : un point de la grille de lecture n'est lu qu'une fois. */
  #reader(sector: Sector): Ground {
    const { space, identity } = this.#env!;
    return (x, y) => {
      // Les coins d'une pierre découpée et les sommets d'une boîte partagent leur position : une lecture par position fine.
      const key = Math.round(x * FINE) * FINE_ROW + Math.round(y * FINE);
      let value = sector.heights.get(key);
      if (value === undefined && !sector.heights.has(key)) {
        if (identity) {
          const cx = wrap(Math.round(x), space.width),
            cy = wrap(Math.round(y), space.height),
            k = cy * space.width + cx;
          if (!sector.grounds.has(k)) sector.grounds.set(k, identity(cx, cy));
        }
        value = this.#sample(x, y);
        sector.heights.set(key, value);
        if (!identity) sector.probes.set(x + ':' + y, value);
      }
      return value ?? null;
    };
  }
  /**
   * Surface de terre et de gravats d'un secteur, depuis la seule trame de son bloc (le secteur plus deux cases autour :
   * les bras ouverts vers les voisines). Les trottoirs et les tuiles de pierre de ses cases sont mis en file.
   */
  #build(sx: number, sy: number, key: string, signature: string): Sector {
    const { space, followTerrain } = this.#env!;
    const x0 = sx * SECTOR_CELLS,
      y0 = sy * SECTOR_CELLS,
      x1 = Math.min(x0 + SECTOR_CELLS, space.width) - 1,
      y1 = Math.min(y0 + SECTOR_CELLS, space.height) - 1;
    const own = new Set<string>(),
      jobs: Job[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cell = this.#byKey.get(x + ':' + y);
        if (!cell) continue;
        if (isSectorSurface(cell.surface)) {
          own.add(x + ':' + y);
          if (cell.sidewalks) jobs.push({ kind: 'curb', cell });
        } else jobs.push({ kind: 'stone', cell });
      }
    const sector: Sector = {
      key,
      signature,
      meshes: [],
      probes: new Map(),
      grounds: new Map(),
      heights: new Map(),
      vertices: new Map(),
      jobs,
      live: !this.#sectors.has(key),
      block: { x0, y0, x1, y1 },
    };
    if (own.size) {
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
        if (data.indices?.length) sector.meshes.push(this.#mesh(code, data, sector));
      }
    }
    this.stats.sectorsBuilt++;
    return sector;
  }
  #mesh(code: Code, data: { applyToMesh: (mesh: Mesh) => unknown }, sector: Sector): Mesh {
    const mesh = new Mesh(`infrastructure-${code}:${sector.key}`, this.#scene);
    data.applyToMesh(mesh);
    mesh.material = this.#material(code);
    mesh.isPickable = false;
    mesh.setEnabled(sector.live && this.#visible);
    freezeStaticHierarchy(mesh);
    return mesh;
  }
  /**
   * Pose la tuile de pierre d'une case sur le sol : la tuile plate de sa forme (bras vers les voisines et les routes
   * automatiques), tournée de ses quarts de tour, dont chaque sommet prend la hauteur du terrain sous lui.
   */
  #bakeTile(sector: Sector, cell: Cell, into: Map<Code, Baked>, kind: Job['kind']) {
    const { space, followTerrain } = this.#env!;
    const mask =
      roadCellMask((k) => this.#byKey.has(k), cell.cellX, cell.cellY, {
        widthCells: space.width,
        heightCells: space.height,
      }) | (this.#links.get(cell.cellX + ':' + cell.cellY) ?? 0);
    const { shape, quarterTurns } = roadTileFor(mask);
    if (!roadTileBuilt(shape, cell.surface, cell.sidewalks)) this.stats.tilesBuilt++;
    const tile = roadTileGeometryOf(shape, cell.surface, cell.sidewalks);
    this.#queuePrewarm(cell.surface, cell.sidewalks);
    const read = this.#reader(sector),
      centre = read(cell.cellX, cell.cellY);
    if (centre === null) return;
    const origin = space.project(cell),
      c = COS[quarterTurns & 3]!,
      s = SIN[quarterTurns & 3]!;
    // Earth and rubble: the sector draws the surface, the tile only brings the curbs, as low as the automatic roads'.
    const clearance = kind === 'stone' ? STONE_CLEARANCE : 0;
    for (const [code, data] of [
      [cell.surface, kind === 'stone' ? tile.pavement : null],
      ['border', tile.curb],
    ] as const) {
      if (!data?.positions || !data.indices) continue;
      const target = into.get(code) ?? { positions: [], normals: [], uvs: [], indices: [] };
      into.set(code, target);
      const base = target.positions.length / 3,
        p = data.positions,
        n = data.normals!,
        uv = data.uvs;
      for (let i = 0; i < p.length; i += 3) {
        const xr = c * p[i]! - s * p[i + 2]!,
          zr = s * p[i]! + c * p[i + 2]!;
        let ground = centre;
        if (followTerrain) {
          // The corners of a box share their (x, z): one read per distinct position, whichever face they belong to.
          const gx = wrap(cell.cellX + xr / CELL_UNITS, space.width),
            gy = wrap(cell.cellY + zr / CELL_UNITS, space.height),
            key = Math.round(gx * FINE) * FINE_ROW + Math.round(gy * FINE);
          let known = sector.vertices.get(key);
          if (known === undefined) {
            known = read(gx, gy) ?? centre;
            sector.vertices.set(key, known);
          }
          ground = known;
        }
        target.positions.push(origin.x + xr, p[i + 1]! + ground + clearance, origin.z + zr);
        target.normals.push(c * n[i]! - s * n[i + 2]!, n[i + 1]!, s * n[i]! + c * n[i + 2]!);
      }
      if (uv) for (let i = 0; i < uv.length; i++) target.uvs.push(uv[i]!);
      for (const index of data.indices) target.indices.push(index + base);
    }
  }
  /** Les autres formes du style d'une tuile de pierre sont préparées une par tâche, pour qu'une pose suivante n'en construise aucune. */
  #queuePrewarm(surface: RoadCellSurface, sidewalks: boolean) {
    if (this.#prewarm.some(([, a, b]) => a === surface && b === sidewalks)) return;
    for (const shape of ROAD_TILE_SHAPES)
      if (!roadTileBuilt(shape, surface, sidewalks)) this.#prewarm.push([shape, surface, sidewalks]);
    this.#schedulePrewarm();
  }
  #schedulePrewarm() {
    if (this.#prewarmTimer !== null || !this.#prewarm.length) return;
    this.#prewarmTimer = setTimeout(() => {
      this.#prewarmTimer = null;
      const next = this.#prewarm.shift();
      if (next && !roadTileBuilt(...next)) {
        roadTileGeometryOf(...next);
        this.stats.tilesBuilt++;
      }
      this.#schedulePrewarm();
    }, 50);
  }
  #schedule() {
    if (this.#timer !== null || !this.#hasWork()) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#slice(SLICE_MS);
      this.#schedule();
    }, 0);
  }
  #hasWork() {
    return this.#later.size > 0 || this.#building.size > 0;
  }
  /** Construit les secteurs neufs puis fait les cases en attente, jusqu'à `budget` ms. */
  #slice(budget: number) {
    const started = performance.now(),
      jobs = this.stats.jobs;
    try {
      this.#sliceWork(budget, started);
    } finally {
      // Mesures du navigateur : le début de la tranche, sa durée et le nombre de cases faites (les 60 dernières).
      const took = performance.now() - started;
      if (took > 0.5 && Number.isFinite(budget)) {
        this.stats.slices.push(`${started.toFixed(0)}:${took.toFixed(1)}:${this.stats.jobs - jobs}`);
        if (this.stats.slices.length > 60) this.stats.slices.shift();
      }
    }
  }
  #sliceWork(budget: number, started: number) {
    for (const key of [...this.#later]) {
      if (performance.now() - started >= budget) return;
      this.#later.delete(key);
      const [sx, sy] = key.split(':').map(Number) as [number, number],
        signature = this.#signature(sx, sy, this.#env!.space);
      if (!this.#sectors.has(key) && !this.#building.has(key) && signature) this.#start(sx, sy, key, signature);
    }
    for (const sector of [...this.#building.values()]) {
      const baked = new Map<Code, Baked>();
      while (sector.jobs.length && performance.now() - started < budget) {
        const job = sector.jobs.shift()!;
        this.#bakeTile(sector, job.cell, baked, job.kind);
        this.stats.jobs++;
      }
      for (const [code, arrays] of baked) {
        const data = new VertexData();
        Object.assign(data, arrays);
        sector.meshes.push(this.#mesh(code, data, sector));
      }
      if (!sector.jobs.length) this.#install(sector);
      if (performance.now() - started >= budget) return;
    }
  }
  /** Fait tout de suite le travail en attente (tests, captures). */
  settle() {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#slice(Infinity);
  }
  /** Nombre de secteurs neufs dont la construction n'a pas commencé. */
  get pendingSectors(): number {
    return this.#later.size;
  }
  /** Nombre de cases (bordures, tuiles de pierre) pas encore dessinées. */
  get pendingJobs(): number {
    let count = 0;
    for (const sector of this.#building.values()) count += sector.jobs.length;
    return count;
  }
  /** Déplace les maillages avec l'origine ; un secteur qui change de côté de la couture torique est refait. */
  #moveOrigin(space: WorldSpace, forced: Set<string>) {
    if (!Number.isFinite(this.#origin.cellX)) return;
    const prior = new WorldSpace(space.width, space.height, this.#origin),
      shift = space.project(this.#origin);
    for (const sector of [...this.#sectors.values(), ...this.#building.values()]) {
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
    for (const sector of [...this.#sectors.values(), ...this.#building.values()])
      sector.meshes.forEach((m) => m.dispose(false, false));
    this.#sectors.clear();
    this.#building.clear();
  }
  visible(value: boolean): void {
    if (value === this.#visible) return;
    this.#visible = value;
    for (const sector of this.#sectors.values()) for (const mesh of sector.meshes) mesh.setEnabled(value);
    for (const sector of this.#building.values())
      for (const mesh of sector.meshes) mesh.setEnabled(sector.live && value);
  }
  /** Les maillages affichés : les secteurs terminés et le travail déjà visible des secteurs neufs. */
  get meshes(): Mesh[] {
    return [
      ...[...this.#sectors.values()].flatMap((sector) => sector.meshes),
      ...[...this.#building.values()].filter((s) => s.live).flatMap((sector) => sector.meshes),
    ];
  }
  dispose(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    if (this.#prewarmTimer !== null) clearTimeout(this.#prewarmTimer);
    this.#timer = this.#prewarmTimer = null;
    this.#prewarm = [];
    this.#clear();
    for (const material of this.#materials.values()) material.dispose();
    this.#materials.clear();
  }
}
