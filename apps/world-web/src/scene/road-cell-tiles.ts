import '@babylonjs/core/Meshes/thinInstanceMesh';
import {
  infrastructureSidewalkSurface,
  overlayRoadCells,
  type RoadCell,
  type RoadCellSurface,
  type RoadPixel,
} from '@arbestra/contracts';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { BuildingGeometry } from './building-geometry';
import { curbStonePiece, masonryPieces } from './infrastructure-renderer';
import { flatRoadGeometry } from './infrastructure-surface-geometry';
import { sidewalkPaving } from './sidewalk-paving';
import { CELL_UNITS, WorldSpace } from './world-space';

/**
 * Road cells drawn as thin instances of prepared tiles
 * (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4.6, S2c): one mesh per
 * shape × surface × sidewalks, built once on first use from the same raster,
 * masonry and curb recipes as the stroke renderer, for one canonical cell.
 * A cell is one instance of the tile inferred from its four neighbours,
 * turned by quarter turns and tilted on the cell's mean ground plane. A pose
 * or a removal rewrites the instances of the cell and its four neighbours
 * only: no sector, no mesh is regenerated.
 */
export type RoadTileShape = 'isolated' | 'end' | 'straight' | 'elbow' | 't' | 'crossing';
type Cell = Pick<RoadCell, 'cellX' | 'cellY' | 'surface' | 'sidewalks'>;

/** Neighbour bits: east (+x) 1, south (+y) 2, west 4, north 8. */
export const ROAD_EAST = 1,
  ROAD_SOUTH = 2,
  ROAD_WEST = 4,
  ROAD_NORTH = 8;
const NEIGHBOURS = [
  [1, 0, ROAD_EAST],
  [0, 1, ROAD_SOUTH],
  [-1, 0, ROAD_WEST],
  [0, -1, ROAD_NORTH],
] as const;
/** Canonical masks: each shape's tile is generated with these arms. */
const CANONICAL: Record<RoadTileShape, number> = {
  isolated: 0,
  end: ROAD_EAST,
  straight: ROAD_EAST | ROAD_WEST,
  elbow: ROAD_EAST | ROAD_SOUTH,
  t: ROAD_EAST | ROAD_SOUTH | ROAD_WEST,
  crossing: 15,
};
/** One quarter turn maps east to south, south to west, west to north. */
const turnMask = (mask: number, turns: number) => {
  let m = mask;
  for (let i = 0; i < turns; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
};
const TILES: Array<{ shape: RoadTileShape; quarterTurns: number }> = Array.from({ length: 16 }, (_, mask) => {
  for (const shape of Object.keys(CANONICAL) as RoadTileShape[])
    for (let quarterTurns = 0; quarterTurns < 4; quarterTurns++)
      if (turnMask(CANONICAL[shape], quarterTurns) === mask) return { shape, quarterTurns };
  throw new Error(`No road tile for mask ${mask}`);
});
/** The tile and its quarter turns for a cell's neighbour mask. */
export function roadTileFor(mask: number): { shape: RoadTileShape; quarterTurns: number } {
  return TILES[mask & 15]!;
}
const wrap = (value: number, size: number) => ((value % size) + size) % size;
const cellKey = (x: number, y: number) => x + ':' + y;
/** The four-neighbour mask of a cell, across the toric seams. */
export function roadCellMask(
  has: (key: string) => boolean,
  x: number,
  y: number,
  world: { widthCells: number; heightCells: number },
): number {
  let mask = 0;
  for (const [dx, dy, bit] of NEIGHBOURS)
    if (has(cellKey(wrap(x + dx, world.widthCells), wrap(y + dy, world.heightCells)))) mask |= bit;
  return mask;
}

const PAVEMENT_HEIGHT = 0.04,
  CURB_HEIGHT = 0.06;
/**
 * The canonical tile's geometry around (0, 0, 0), cell centre on flat ground:
 * the cell's own raster (centre square and arms) and the curb stones whose
 * fragment lies in the cell, computed with its neighbours present so that
 * arms stay open and sidewalks turn the corners as on a continuous road.
 */
export function roadTileGeometry(
  shape: RoadTileShape,
  surface: RoadCellSurface,
  sidewalks: boolean,
): { pavement: VertexData | null; curb: VertexData | null } {
  const world = { widthCells: 8, heightCells: 8 },
    centre = 4,
    space = new WorldSpace(8, 8, { cellX: centre, cellY: centre }),
    mask = CANONICAL[shape];
  const cells: Cell[] = [{ cellX: centre, cellY: centre, surface, sidewalks }];
  for (const [dx, dy, bit] of NEIGHBOURS)
    if (mask & bit) cells.push({ cellX: centre + dx, cellY: centre + dy, surface, sidewalks });
  const raster = new Map<string, RoadPixel>();
  overlayRoadCells(raster, cells, world);
  const inCell = (x: number, y: number) => Math.floor((x + 8) / 16) === centre && Math.floor((y + 8) / 16) === centre;
  const own = new Map([...raster].filter(([, p]) => inCell(p.x, p.y)));
  const flat = () => 0;
  let pavement: VertexData | null = null;
  if (surface === 'earth' || surface === 'rubble') {
    const data = flatRoadGeometry(own, space, flat, false, 0.015, 0.025, own);
    pavement = data.indices?.length ? data : null;
  } else {
    const pieces = masonryPieces(surface, own.values(), own, space, flat, false, PAVEMENT_HEIGHT);
    pavement = pieces.length ? BuildingGeometry.merge(pieces) : null;
  }
  let curb: VertexData | null = null;
  if (sidewalks) {
    // Stones are fragments of one sidewalk pixel: the cell's own pixels give its own stones,
    // laid against the whole raster (open arms, corners turned with the neighbours).
    const own = new Map(
      [...infrastructureSidewalkSurface(raster, world)].filter(([, p]) => inCell(p.x + 0.5, p.y + 0.5)),
    );
    const positions: number[] = [],
      normals: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    for (const stone of sidewalkPaving(raster, own, world)) {
      const data = curbStonePiece(stone, space, flat, false, CURB_HEIGHT)?.data;
      if (!data) continue;
      const offset = positions.length / 3;
      positions.push(...data.positions!);
      normals.push(...data.normals!);
      uvs.push(...data.uvs!);
      for (const i of data.indices!) indices.push(i + offset);
    }
    if (indices.length) {
      curb = new VertexData();
      Object.assign(curb, { positions, normals, uvs, indices });
    }
  }
  return { pavement, curb };
}

/**
 * Raise of a tilted tile above its plane: the stone paving tops sit only
 * 3 mm above the ground they were cut for, and a plane is not the terrain
 * (z-fighting and terrain showing through the paving in the browser).
 * Earth and rubble already lie 1.5 cm above their plane, as automatic roads
 * above the terrain: raised again, they looked thicker than the automatic
 * roads they join.
 */
export const TILT_CLEARANCE = 0.02;
export const roadCellClearance = (surface: RoadCellSurface) =>
  surface === 'earth' || surface === 'rubble' ? 0 : TILT_CLEARANCE;
/** The cell's ground plane: slopes per scene unit along x and z, and its height at the centre. */
export interface RoadCellPlane {
  slopeX: number;
  slopeZ: number;
  height: number;
}
/**
 * Mean plane of the ground under a cell: slopes from its four corners, raised
 * so that no sampled point (corners, edge midpoints, centre) is above it.
 * Flat at the centre height off RC1 (constant ground per cell), or when a
 * corner is unknown. Null when the centre itself is unknown.
 */
export function roadCellPlane(
  ground: (x: number, y: number) => number | null,
  x: number,
  y: number,
  followTerrain: boolean,
  clearance = TILT_CLEARANCE,
): RoadCellPlane | null {
  const centre = ground(x, y);
  if (centre === null) return null;
  if (!followTerrain) return { slopeX: 0, slopeZ: 0, height: centre };
  const nw = ground(x - 0.5, y - 0.5),
    ne = ground(x + 0.5, y - 0.5),
    sw = ground(x - 0.5, y + 0.5),
    se = ground(x + 0.5, y + 0.5);
  if (nw === null || ne === null || sw === null || se === null) return { slopeX: 0, slopeZ: 0, height: centre };
  const slopeX = (ne + se - nw - sw) / 2 / CELL_UNITS,
    slopeZ = (sw + se - nw - ne) / 2 / CELL_UNITS,
    mean = (nw + ne + sw + se) / 4;
  let lift = 0;
  const check = (dx: number, dy: number, value: number | null) => {
    if (value !== null) lift = Math.max(lift, value - (mean + (slopeX * dx + slopeZ * dy) * CELL_UNITS));
  };
  check(0, 0, centre);
  for (const [dx, dy, value] of [
    [-0.5, -0.5, nw],
    [0.5, -0.5, ne],
    [-0.5, 0.5, sw],
    [0.5, 0.5, se],
  ] as const)
    check(dx, dy, value);
  for (const [dx, dy] of [
    [0, -0.5],
    [0.5, 0],
    [0, 0.5],
    [-0.5, 0],
  ] as const)
    check(dx, dy, ground(x + dx, y + dy));
  return { slopeX, slopeZ, height: mean + lift + clearance };
}

const COS = [1, 0, -1, 0],
  SIN = [0, 1, 0, -1];
/** Writes a tile instance's matrix: quarter turns, then a shear onto the plane, then the cell's position. */
export function writeRoadTileMatrix(
  target: Float32Array,
  offset: number,
  quarterTurns: number,
  plane: RoadCellPlane | null,
  x: number,
  z: number,
): void {
  const c = COS[quarterTurns & 3]!,
    s = SIN[quarterTurns & 3]!,
    shown = plane ? 1 : 0,
    a = plane?.slopeX ?? 0,
    b = plane?.slopeZ ?? 0;
  // Row vectors (Babylon): x' = c x - s z, z' = s x + c z, y' = y + a x' + b z' + h.
  target[offset] = c * shown;
  target[offset + 1] = (a * c + b * s) * shown;
  target[offset + 2] = s * shown;
  target[offset + 3] = 0;
  target[offset + 4] = 0;
  target[offset + 5] = shown;
  target[offset + 6] = 0;
  target[offset + 7] = 0;
  target[offset + 8] = -s * shown;
  target[offset + 9] = (b * c - a * s) * shown;
  target[offset + 10] = c * shown;
  target[offset + 11] = 0;
  target[offset + 12] = x;
  target[offset + 13] = plane?.height ?? 0;
  target[offset + 14] = z;
  target[offset + 15] = 1;
}

interface Tile {
  key: string;
  parts: Mesh[];
  matrices: Float32Array;
  /** Cell key of each live slot, for swap removal. */
  owners: string[];
  count: number;
  dirty: Set<number>;
  resized: boolean;
  min: Vector3;
  max: Vector3;
}
interface Placed {
  tile: Tile;
  slot: number;
  x: number;
  y: number;
  quarterTurns: number;
  plane: RoadCellPlane | null;
  ground: string;
}
export interface RoadCellTilesOptions {
  followTerrain?: boolean;
  groundIdentity?: string | undefined;
  groundCellIdentity?: (x: number, y: number) => string | number;
}

const COLOURS: Record<RoadCellSurface | 'border', string> = {
  earth: '#795b3d',
  rubble: '#b7b8b2',
  'stone-1': '#c5c6b8',
  'stone-2': '#d4d3c4',
  border: '#c5c6b8',
};

export class RoadCellTiles {
  readonly #scene: Scene;
  readonly #materials = new Map<string, StandardMaterial>();
  readonly #tiles = new Map<string, Tile>();
  readonly #placed = new Map<string, Placed>();
  #cells: readonly Cell[] | undefined;
  #byKey = new Map<string, Cell>();
  #world = { widthCells: 0, heightCells: 0 };
  #origin = { cellX: Number.NaN, cellY: Number.NaN };
  #groundIdentity: string | undefined;
  #visible = true;
  /** Counters for tests and diagnostics: tiles built, instance matrices written and removed. */
  readonly stats = { tilesBuilt: 0, writes: 0, removals: 0, updates: 0 };
  readonly #prewarm: boolean;
  #prewarmQueue: Array<[RoadTileShape, RoadCellSurface, boolean]> = [];
  #prewarmTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * `prewarm`: once a style (surface, sidewalks) is first drawn, its other
   * shapes are built one per idle task, so that a later gesture in that style
   * builds no geometry while it is accepted.
   */
  constructor(scene: Scene, options: { prewarm?: boolean } = {}) {
    this.#scene = scene;
    this.#prewarm = options.prewarm ?? false;
  }
  #schedulePrewarm() {
    if (this.#prewarmTimer !== null || !this.#prewarmQueue.length) return;
    this.#prewarmTimer = setTimeout(() => {
      this.#prewarmTimer = null;
      const next = this.#prewarmQueue.shift();
      if (next) this.#tile(...next);
      this.#schedulePrewarm();
    }, 50);
  }
  #material(code: RoadCellSurface | 'border'): StandardMaterial {
    let material = this.#materials.get(code);
    if (!material) {
      material = new StandardMaterial(`road-cell-${code}`, this.#scene);
      material.diffuseColor = Color3.FromHexString(COLOURS[code]);
      material.specularColor = Color3.Black();
      this.#materials.set(code, material);
    }
    return material;
  }
  #tile(shape: RoadTileShape, surface: RoadCellSurface, sidewalks: boolean): Tile {
    const key = `${shape}:${surface}:${sidewalks ? 1 : 0}`;
    let tile = this.#tiles.get(key);
    if (tile) return tile;
    const geometry = roadTileGeometry(shape, surface, sidewalks),
      parts: Mesh[] = [];
    for (const [code, data] of [
      [surface, geometry.pavement],
      ['border', geometry.curb],
    ] as const) {
      if (!data) continue;
      const mesh = new Mesh(`road-cell-tile:${key}:${code}`, this.#scene);
      data.applyToMesh(mesh);
      mesh.material = this.#material(code);
      mesh.isPickable = false;
      // Without instances a thin instance mesh draws its base geometry: hidden until it has some.
      mesh.isVisible = false;
      // Bounds follow the instances (below), never a scan of the whole buffer.
      mesh.doNotSyncBoundingInfo = true;
      mesh.freezeWorldMatrix();
      mesh.setEnabled(this.#visible);
      parts.push(mesh);
    }
    tile = {
      key,
      parts,
      matrices: new Float32Array(16 * 16),
      owners: [],
      count: 0,
      dirty: new Set(),
      resized: true,
      min: new Vector3(Infinity, Infinity, Infinity),
      max: new Vector3(-Infinity, -Infinity, -Infinity),
    };
    this.#tiles.set(key, tile);
    this.stats.tilesBuilt++;
    if (this.#prewarm && !this.#prewarmQueue.some(([, a, b]) => a === surface && b === sidewalks)) {
      for (const other of Object.keys(CANONICAL) as RoadTileShape[])
        if (!this.#tiles.has(`${other}:${surface}:${sidewalks ? 1 : 0}`))
          this.#prewarmQueue.push([other, surface, sidewalks]);
      this.#schedulePrewarm();
    }
    return tile;
  }
  /** Number of instances per tile key, for tests. */
  get instances(): ReadonlyMap<string, number> {
    return new Map([...this.#tiles].map(([key, tile]) => [key, tile.count]));
  }
  /** The tile and quarter turns drawn for a cell, for tests. */
  placement(x: number, y: number): { tile: string; quarterTurns: number; shown: boolean } | null {
    const placed = this.#placed.get(cellKey(x, y));
    return placed ? { tile: placed.tile.key, quarterTurns: placed.quarterTurns, shown: placed.plane !== null } : null;
  }
  /** The instance matrix of a cell, for tests. */
  matrix(x: number, y: number): Float32Array | null {
    const placed = this.#placed.get(cellKey(x, y));
    return placed ? placed.tile.matrices.slice(placed.slot * 16, placed.slot * 16 + 16) : null;
  }
  /**
   * Brings the instances in line with the village's road cells. O(1) while
   * nothing changes; a new cell list costs a diff of the list plus the
   * rewrite of changed cells and their four neighbours; a ground publication
   * re-plans only the cells whose ground identity changed; a rebased origin
   * moves every instance (no geometry).
   */
  update(
    cells: readonly Cell[] | undefined,
    space: WorldSpace,
    ground: (x: number, y: number) => number | null,
    options: RoadCellTilesOptions = {},
  ): number {
    const sameWorld = space.width === this.#world.widthCells && space.height === this.#world.heightCells,
      sameOrigin = space.origin.cellX === this.#origin.cellX && space.origin.cellY === this.#origin.cellY,
      sameGround = options.groundIdentity !== undefined && options.groundIdentity === this.#groundIdentity;
    if (cells === this.#cells && sameWorld && sameOrigin && sameGround) return 0;
    this.stats.updates++;
    const touched = new Set<string>();
    const world = { widthCells: space.width, heightCells: space.height };
    const mark = (x: number, y: number) => {
      touched.add(cellKey(x, y));
      for (const [dx, dy] of NEIGHBOURS) touched.add(cellKey(wrap(x + dx, space.width), wrap(y + dy, space.height)));
    };
    if (!sameWorld) {
      // A new world: every placement is planned again.
      for (const key of this.#placed.keys()) touched.add(key);
      this.#byKey = new Map();
      this.#cells = undefined;
    }
    if (cells !== this.#cells) {
      const next = new Map<string, Cell>();
      for (const c of cells ?? []) next.set(cellKey(c.cellX, c.cellY), c);
      for (const [key, c] of next) {
        const prior = this.#byKey.get(key);
        if (!prior || prior.surface !== c.surface || prior.sidewalks !== c.sidewalks) mark(c.cellX, c.cellY);
      }
      for (const [key, c] of this.#byKey) if (!next.has(key)) mark(c.cellX, c.cellY);
      this.#byKey = next;
      this.#cells = cells;
    }
    this.#world = world;
    const identity = (x: number, y: number) =>
      options.groundCellIdentity
        ? `${options.groundCellIdentity(x, y)}|${options.groundCellIdentity(wrap(x + 1, space.width), y)}|${options.groundCellIdentity(x, wrap(y + 1, space.height))}|${options.groundCellIdentity(wrap(x + 1, space.width), wrap(y + 1, space.height))}`
        : String(options.groundIdentity);
    if (!sameGround) {
      for (const [key, placed] of this.#placed) if (placed.ground !== identity(placed.x, placed.y)) touched.add(key);
      this.#groundIdentity = options.groundIdentity;
    }
    const followTerrain = options.followTerrain ?? false;
    for (const key of touched) {
      const cell = this.#byKey.get(key),
        placed = this.#placed.get(key);
      if (!cell) {
        if (placed) this.#remove(key, placed);
        continue;
      }
      const { shape, quarterTurns } = roadTileFor(
          roadCellMask((k) => this.#byKey.has(k), cell.cellX, cell.cellY, world),
        ),
        tile = this.#tile(shape, cell.surface, cell.sidewalks),
        plane = roadCellPlane(ground, cell.cellX, cell.cellY, followTerrain, roadCellClearance(cell.surface));
      let target = placed;
      if (target && target.tile !== tile) {
        this.#remove(key, target);
        target = undefined;
      }
      if (!target) {
        if (tile.count * 16 >= tile.matrices.length) {
          const grown = new Float32Array(tile.matrices.length * 2);
          grown.set(tile.matrices);
          tile.matrices = grown;
          tile.resized = true;
        }
        target = { tile, slot: tile.count++, x: cell.cellX, y: cell.cellY, quarterTurns, plane, ground: '' };
        tile.owners[target.slot] = key;
        this.#placed.set(key, target);
      }
      target.quarterTurns = quarterTurns;
      target.plane = plane;
      target.ground = identity(cell.cellX, cell.cellY);
      // A rebased origin rewrites every instance below, once.
      if (sameOrigin) this.#write(target, space);
    }
    if (!sameOrigin) {
      for (const placed of this.#placed.values()) this.#write(placed, space);
      for (const tile of this.#tiles.values()) {
        // Bounds follow the moved instances.
        tile.min.setAll(Infinity);
        tile.max.setAll(-Infinity);
        for (let i = 0; i < tile.count; i++)
          this.#extend(tile, tile.matrices[i * 16 + 12]!, tile.matrices[i * 16 + 13]!, tile.matrices[i * 16 + 14]!);
      }
      this.#origin = { ...space.origin };
    }
    this.#flush();
    return touched.size;
  }
  #write(placed: Placed, space: WorldSpace) {
    const p = space.project({ cellX: placed.x, cellY: placed.y }),
      tile = placed.tile;
    writeRoadTileMatrix(tile.matrices, placed.slot * 16, placed.quarterTurns, placed.plane, p.x, p.z);
    tile.dirty.add(placed.slot);
    this.#extend(tile, p.x, placed.plane?.height ?? 0, p.z);
    this.stats.writes++;
  }
  #extend(tile: Tile, x: number, y: number, z: number) {
    // Half a diagonal plus margin; the tilt stays well under half a unit per cell.
    const r = 1.9;
    tile.min.set(Math.min(tile.min.x, x - r), Math.min(tile.min.y, y - 0.6), Math.min(tile.min.z, z - r));
    tile.max.set(Math.max(tile.max.x, x + r), Math.max(tile.max.y, y + 0.6), Math.max(tile.max.z, z + r));
  }
  #remove(key: string, placed: Placed) {
    const tile = placed.tile,
      last = --tile.count;
    if (placed.slot !== last) {
      // Swap the last instance into the freed slot: O(1), the order is irrelevant.
      tile.matrices.copyWithin(placed.slot * 16, last * 16, last * 16 + 16);
      const moved = tile.owners[last]!;
      tile.owners[placed.slot] = moved;
      this.#placed.get(moved)!.slot = placed.slot;
      tile.dirty.add(placed.slot);
    }
    tile.owners.length = last;
    tile.dirty.delete(last);
    this.#placed.delete(key);
    this.stats.removals++;
  }
  #flush() {
    for (const tile of this.#tiles.values()) {
      if (!tile.resized && !tile.dirty.size && tile.parts.every((m) => m.thinInstanceCount === tile.count)) continue;
      for (const mesh of tile.parts) {
        if (tile.resized) mesh.thinInstanceSetBuffer('matrix', tile.matrices, 16, false);
        mesh.thinInstanceCount = tile.count;
        if (!tile.resized) {
          if (tile.dirty.size > 4) mesh.thinInstanceBufferUpdated('matrix');
          else for (const slot of tile.dirty) mesh.thinInstancePartialBufferUpdate('matrix', 1, slot);
        }
        mesh.isVisible = tile.count > 0;
        if (tile.count > 0) mesh.getBoundingInfo().reConstruct(tile.min, tile.max, mesh.getWorldMatrix());
      }
      tile.resized = false;
      tile.dirty.clear();
    }
  }
  visible(value: boolean) {
    if (value === this.#visible) return;
    this.#visible = value;
    for (const tile of this.#tiles.values()) for (const mesh of tile.parts) mesh.setEnabled(value);
  }
  get meshes(): Mesh[] {
    return [...this.#tiles.values()].flatMap((tile) => tile.parts);
  }
  dispose() {
    if (this.#prewarmTimer !== null) clearTimeout(this.#prewarmTimer);
    this.#prewarmTimer = null;
    this.#prewarmQueue = [];
    for (const tile of this.#tiles.values()) for (const mesh of tile.parts) mesh.dispose(false, false);
    this.#tiles.clear();
    this.#placed.clear();
    for (const material of this.#materials.values()) material.dispose();
    this.#materials.clear();
  }
}
