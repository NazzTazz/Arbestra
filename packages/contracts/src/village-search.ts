import { buildingAccesses } from './building-access.js';
import { ChunkNavigationCache, MESH_DIRECTIONS, MeshEdge } from './chunk-navigation-mesh.js';
import { infrastructurePlanSurface, type RoadPixel } from './infrastructure.js';
import { canWalkSpawnSegment, type SpawnAccessField } from './spawn-access.js';
import {
  blocksTravelFootprint,
  GARDEN_CROSSING_COST,
  roadLookup,
  segmentCost,
  type TravelCell,
  type TravelGround,
  type TravelNetworkState,
} from './travel-paths.js';

/**
 * The one search of village missions (docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md
 * §3): A* on the cells of the village region, eight neighbours, octile
 * heuristic × ROAD_STEP_COST. A step joins the nodes of two cells (the centre,
 * or the nearest free eighth point when a trunk or a rock covers it) by a
 * straight segment, or by a local detour inside its two cells when a thin
 * obstacle sits on that segment (cardinal steps only). A diagonal step is
 * straight, and the four cardinal edges of the square it crosses must be
 * walkable: it never passes between two corners. The physics of the ground
 * (water, slope, rocks, trunks) is certified once per edge in a chunk mesh
 * kept per ground revision; every rule of the village (region, terrain code,
 * footprints, reservations, deposits, gardens, the destination cell) is a
 * mask applied before the mesh, and road accessories are checked on the few
 * cells that carry one. The cost of a step is its duration (decision 8):
 * segmentCost, times GARDEN_CROSSING_COST on another garden's plot.
 */

export type VillageSearchOutcome =
  | { kind: 'found'; path: TravelCell[] }
  /** The queue emptied inside the domain: no path exists. */
  | { kind: 'unreachable' }
  /** The node bound was reached first, or the goal lies outside the domain: retry, never a refusal. */
  | { kind: 'budget' };
export interface VillageSearchStats {
  /** Cells taken from the queue. */
  visited: number;
  /** Edges certified by the physical test (zero on a warm mesh). */
  certified: number;
}
export interface VillageSearchOptions {
  /** Start point instead of the town hall doors (a garden tour leg from a plot). */
  from?: TravelCell | null;
  /** Gardens crossed at no extra cost; by default the destination's own garden. */
  gardens?: ReadonlySet<string>;
  checkpoint?: () => void;
  stats?: VillageSearchStats;
  /** A lower node bound than the domain's (diagnostics and tests): reaching it ends in `budget`. */
  maxVisited?: number;
}

/** Cells of the domain: the node bound of a mission search (refonte des trajets §4.2). */
export function villageSearchBound(region: { width: number; height: number }): number {
  return region.width * region.height;
}

const wrap = (value: number, size: number): number => ((value % size) + size) % size;
const delta = (value: number, origin: number, size: number): number => {
  const direct = value - origin;
  return direct > size / 2 ? direct - size : direct < -size / 2 ? direct + size : direct;
};
const key = (p: TravelCell) => `${p.cellX}:${p.cellY}`;
const DIAGONAL = Math.SQRT2;

// --- Ground mesh, per ground revision --------------------------------------

const MESH_CHUNK = 32;
const meshes = new Map<string, ChunkNavigationCache>();
const MAX_MESHES = 4;
/** A point a walker can stand on: dry, unobstructed, of finite height. */
function free(ground: SpawnAccessField, x: number, y: number): boolean {
  const s = ground.sample(wrap(x, ground.width), wrap(y, ground.height));
  return s.dry && !s.blocked && Number.isFinite(s.elevation);
}
/** Eighth-cell offsets of a cell's points, nearest to its centre first. */
const OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const list: Array<[number, number]> = [];
  for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) list.push([ox, oy]);
  return list.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2 || a[1] - b[1] || a[0] - b[0]);
})();
/**
 * Shortest path in eighth-cell steps between two lattice points, every node
 * inside `allowed` (a set of cells) and accepted by `stand`, every step
 * accepted by `step`; stops at the first node `goal` accepts. Bounded by the
 * points of those cells. Collinear points are merged.
 */
function latticePath(
  from: TravelCell,
  goal: (p: TravelCell) => boolean,
  allowed: (cellX: number, cellY: number) => boolean,
  stand: (p: TravelCell) => boolean,
  step: (a: TravelCell, b: TravelCell) => boolean,
  world: { widthCells: number; heightCells: number },
  limit: number,
): TravelCell[] | null {
  const w = world.widthCells * 8,
    h = world.heightCells * 8;
  const start = { x: wrap(Math.round(from.cellX * 8), w), y: wrap(Math.round(from.cellY * 8), h) };
  const id = (x: number, y: number) => y * w + x;
  const parents = new Map<number, number>([[id(start.x, start.y), -1]]);
  const queue = [start];
  for (let head = 0; head < queue.length && head < limit; head++) {
    const p = queue[head]!,
      point = { cellX: p.x / 8, cellY: p.y / 8 };
    if (goal(point)) {
      const nodes: TravelCell[] = [];
      for (let k = id(p.x, p.y); k >= 0; k = parents.get(k)!)
        nodes.push({ cellX: (k % w) / 8, cellY: Math.floor(k / w) / 8 });
      nodes.reverse();
      // Keep the exact start point, then merge collinear lattice points.
      const result: TravelCell[] = [from];
      for (let i = 1; i < nodes.length; i++) {
        const q = nodes[i]!;
        if (result.length >= 2 && i < nodes.length) {
          const a = result[result.length - 2]!,
            b = result[result.length - 1]!;
          const ux = delta(b.cellX, a.cellX, world.widthCells),
            uy = delta(b.cellY, a.cellY, world.heightCells),
            vx = delta(q.cellX, b.cellX, world.widthCells),
            vy = delta(q.cellY, b.cellY, world.heightCells);
          if (Math.abs(ux * vy - uy * vx) < 1e-12 && ux * vx + uy * vy > 0) result.pop();
        }
        result.push(q);
      }
      return result;
    }
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const x = wrap(p.x + dx, w),
        y = wrap(p.y + dy, h),
        k = id(x, y);
      if (parents.has(k)) continue;
      const q = { cellX: x / 8, cellY: y / 8 };
      if (
        !allowed(wrap(Math.floor(q.cellX + 0.5), world.widthCells), wrap(Math.floor(q.cellY + 0.5), world.heightCells))
      )
        continue;
      if (!stand(q) || !step(point, q)) continue;
      parents.set(k, id(p.x, p.y));
      queue.push({ x, y });
    }
  }
  return null;
}
/** The village ground mesh of a world's ground revision: nodes and detours on the physics only. */
export function villageGroundMesh(worldId: string, ground: TravelGround): ChunkNavigationCache {
  const id = JSON.stringify([worldId, ground.revision, ground.width, ground.height]);
  let mesh = meshes.get(id);
  if (mesh) {
    meshes.delete(id);
    meshes.set(id, mesh);
    return mesh;
  }
  const world = { widthCells: ground.width, heightCells: ground.height };
  const anchor = (x: number, y: number): TravelCell | null => {
    for (const [ox, oy] of OFFSETS)
      if (free(ground, x + ox / 8, y + oy / 8)) return { cellX: x + ox / 8, cellY: y + oy / 8 };
    return null;
  };
  const detour = (a: TravelCell, b: TravelCell) => {
    const ax = wrap(Math.floor(a.cellX + 0.5), ground.width),
      ay = wrap(Math.floor(a.cellY + 0.5), ground.height),
      bx = wrap(Math.floor(b.cellX + 0.5), ground.width),
      by = wrap(Math.floor(b.cellY + 0.5), ground.height);
    return latticePath(
      a,
      (p) =>
        Math.abs(delta(p.cellX, b.cellX, ground.width)) < 1e-9 &&
        Math.abs(delta(p.cellY, b.cellY, ground.height)) < 1e-9,
      (x, y) => (x === ax && y === ay) || (x === bx && y === by),
      (p) => free(ground, p.cellX, p.cellY),
      (p, q) => canWalkSpawnSegment(ground, { x: p.cellX, y: p.cellY }, { x: q.cellX, y: q.cellY }),
      world,
      128,
    );
  };
  mesh = new ChunkNavigationCache(ground, MESH_CHUNK, [], { anchor, detour });
  meshes.set(id, mesh);
  while (meshes.size > MAX_MESHES) meshes.delete(meshes.keys().next().value!);
  return mesh;
}

// --- Search ----------------------------------------------------------------

/** Binary min-heap of (key, tie, node), typed arrays, duplicates allowed (lazy deletion). */
class NodeQueue {
  private keys = new Float64Array(64);
  private ties = new Float64Array(64);
  private nodes = new Int32Array(64);
  length = 0;
  private less(i: number, j: number) {
    const a = this.keys[i]!,
      b = this.keys[j]!;
    return (
      a < b ||
      (a === b && (this.ties[i]! < this.ties[j]! || (this.ties[i] === this.ties[j] && this.nodes[i]! < this.nodes[j]!)))
    );
  }
  private swap(i: number, j: number) {
    const k = this.keys[i]!,
      t = this.ties[i]!,
      n = this.nodes[i]!;
    this.keys[i] = this.keys[j]!;
    this.ties[i] = this.ties[j]!;
    this.nodes[i] = this.nodes[j]!;
    this.keys[j] = k;
    this.ties[j] = t;
    this.nodes[j] = n;
  }
  push(key: number, tie: number, node: number) {
    if (this.length === this.keys.length) {
      const grow = <T extends Float64Array | Int32Array>(old: T, make: (n: number) => T) => {
        const next = make(old.length * 2);
        next.set(old);
        return next;
      };
      this.keys = grow(this.keys, (n) => new Float64Array(n));
      this.ties = grow(this.ties, (n) => new Float64Array(n));
      this.nodes = grow(this.nodes, (n) => new Int32Array(n));
    }
    let i = this.length++;
    this.keys[i] = key;
    this.ties[i] = tie;
    this.nodes[i] = node;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  /** Key of the top entry. */
  get key() {
    return this.keys[0]!;
  }
  /** Removes the top entry and returns its node. */
  pop(): number {
    const node = this.nodes[0]!;
    this.length--;
    if (this.length) {
      this.keys[0] = this.keys[this.length]!;
      this.ties[0] = this.ties[this.length]!;
      this.nodes[0] = this.nodes[this.length]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < this.length && this.less(l, m)) m = l;
        if (r < this.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return node;
  }
}

/** Garden (logical building) of an active plot cell, if any. */
export function villageGardenAt(
  state: Pick<TravelNetworkState, 'cells' | 'world'>,
  cell: TravelCell,
): string | undefined {
  const x = wrap(Math.floor(cell.cellX + 0.5), state.world.widthCells),
    y = wrap(Math.floor(cell.cellY + 0.5), state.world.heightCells);
  const plot = state.cells.find(
    (c) =>
      wrap(c.cellX, state.world.widthCells) === x &&
      wrap(c.cellY, state.world.heightCells) === y &&
      c.footprint &&
      !blocksTravelFootprint(c.footprint),
  );
  return plot?.footprint?.buildingId;
}

/**
 * Path from the town hall doors (or `options.from`) to the cell `to`, inside
 * the village region. The destination cell is admitted even when its cell is
 * blocked (a deposit, a plot): the path ends at its node, or at the first
 * point of the cell it can enter.
 */
export function searchVillagePath(
  state: TravelNetworkState,
  to: TravelCell,
  ground?: TravelGround,
  options: VillageSearchOptions = {},
): VillageSearchOutcome {
  const { world, region } = state;
  const W = world.widthCells,
    H = world.heightCells;
  const checkpoint = options.checkpoint;
  checkpoint?.();
  const mesh = ground ? villageGroundMesh(world.id, ground) : undefined;
  const checksBefore = mesh?.checks ?? 0;
  const localX = (x: number) => wrap(x - region.originCellX, W),
    localY = (y: number) => wrap(y - region.originCellY, H);
  const inRegion = (x: number, y: number) => localX(x) < region.width && localY(y) < region.height;
  const target = { cellX: wrap(Math.round(to.cellX), W), cellY: wrap(Math.round(to.cellY), H) };
  const targetIndex = localY(target.cellY) * region.width + localX(target.cellX);
  // Outside the domain no search proves anything about the target (§4.2).
  if (!inRegion(target.cellX, target.cellY)) return { kind: 'budget' };

  // Cell mask of the village (refineTravelRoute's `land`, cell by cell).
  const blocked = new Set<number>();
  const index = (x: number, y: number) => wrap(y, H) * W + wrap(x, W);
  for (const c of state.cells) if (blocksTravelFootprint(c.footprint)) blocked.add(index(c.cellX, c.cellY));
  for (const f of region.features)
    if (
      !(ground?.woodedCells && f.type === 'woodland') &&
      f.deposit?.blocksCell !== false &&
      !f.deposit?.cleared &&
      f.deposit?.state !== 'depleted'
    )
      blocked.add(index(f.cellX, f.cellY));
  const footprints = new Map<number, string>();
  for (const c of state.cells) if (c.footprint) footprints.set(index(c.cellX, c.cellY), c.footprint.buildingId);
  const ground1 = (x: number, y: number) =>
    inRegion(x, y) && region.terrainCodes[localY(y) * region.width + localX(x)] === 1;
  /** A cell a path may cross; `building`: also its own footprint (a door connector). */
  const passable = (x: number, y: number, building?: string) =>
    ground1(x, y) &&
    (!blocked.has(index(x, y)) ||
      (wrap(x, W) === target.cellX && wrap(y, H) === target.cellY) ||
      (building !== undefined && footprints.get(index(x, y)) === building));

  // Gardens: another garden's plot costs GARDEN_CROSSING_COST per step.
  const owners = new Map<number, string>();
  for (const c of state.cells)
    if (c.footprint && !blocksTravelFootprint(c.footprint)) owners.set(index(c.cellX, c.cellY), c.footprint.buildingId);
  const own = options.gardens ?? new Set([villageGardenAt(state, target)].filter((g): g is string => !!g));
  const foreign = new Set<number>();
  for (const [cell, owner] of owners) if (!own.has(owner)) foreign.add(cell);
  const cellOf = (x: number, y: number) => index(Math.floor(x + 0.5), Math.floor(y + 0.5));
  const gardenFactor = foreign.size
    ? (x: number, y: number) => (foreign.has(cellOf(x, y)) ? GARDEN_CROSSING_COST : 1)
    : undefined;

  // Roads: road pixels, and the cells that hold one (a step away from them costs its length).
  let roads: ((x: number, y: number) => boolean) | undefined;
  const roadCells = new Set<number>();
  const equipment = new Map<number, Array<{ x: number; y: number }>>();
  const equipped = new Set<number>();
  if (state.infrastructure) {
    const surface = infrastructurePlanSurface(state.infrastructure, world);
    for (const p of surface.values())
      if (p.manual) roadCells.add(index(Math.floor((p.x + 8) / 16), Math.floor((p.y + 8) / 16)));
    if (roadCells.size) roads = roadLookup(surface as ReadonlyMap<string, RoadPixel>);
    for (const e of state.infrastructure.equipment) {
      const point = { x: e.x / 8, y: e.y / 8 };
      for (let y = Math.floor(point.y - 0.125); y <= Math.floor(point.y + 0.125); y++)
        for (let x = Math.floor(point.x - 0.125); x <= Math.floor(point.x + 0.125); x++) {
          const k = index(x, y),
            bin = equipment.get(k) ?? [];
          bin.push(point);
          equipment.set(k, bin);
        }
      for (const dx of [-0.25, 0, 0.25])
        for (const dy of [-0.25, 0, 0.25]) equipped.add(cellOf(point.x + dx, point.y + dy));
    }
  }
  const clearOfEquipment = (p: TravelCell) =>
    !(equipment.get(index(Math.floor(p.cellX), Math.floor(p.cellY))) ?? []).some(
      (e) => Math.abs(delta(e.x, p.cellX, W)) < 0.125 && Math.abs(delta(e.y, p.cellY, H)) < 0.125,
    );
  /** Every point of a segment, every 1/16, in a passable cell and clear of accessories. */
  const segmentLand = (a: TravelCell, b: TravelCell, building?: string, sub = 16) => {
    const dx = delta(b.cellX, a.cellX, W),
      dy = delta(b.cellY, a.cellY, H),
      n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * sub));
    for (let i = 0; i <= n; i++) {
      const p = { cellX: wrap(a.cellX + (dx * i) / n, W), cellY: wrap(a.cellY + (dy * i) / n, H) };
      if (!passable(Math.floor(p.cellX + 0.5), Math.floor(p.cellY + 0.5), building)) return false;
      if (equipment.size && !clearOfEquipment(p)) return false;
    }
    return true;
  };
  const physical = (a: TravelCell, b: TravelCell) =>
    !ground || canWalkSpawnSegment(ground, { x: a.cellX, y: a.cellY }, { x: b.cellX, y: b.cellY });
  const stand = (p: TravelCell) =>
    (!ground || free(ground, p.cellX, p.cellY)) && (!equipment.size || clearOfEquipment(p));

  // Nodes: the mesh's, but on a cell with an accessory one clear of it too.
  const nodes = new Map<number, TravelCell | null>();
  const node = (x: number, y: number): TravelCell | null => {
    const k = index(x, y);
    if (nodes.has(k)) return nodes.get(k)!;
    let n: TravelCell | null = mesh ? mesh.anchor(x, y) : { cellX: wrap(x, W), cellY: wrap(y, H) };
    if (n && equipped.has(k) && !clearOfEquipment(n)) {
      n = null;
      for (let r = 1; r <= 3 && !n; r++)
        for (let oy = -r; oy <= r && !n; oy++)
          for (let ox = -r; ox <= r && !n; ox++) {
            if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
            const p = { cellX: wrap(x + ox / 8, W), cellY: wrap(y + oy / 8, H) };
            if (stand(p)) n = p;
          }
    }
    nodes.set(k, n);
    return n;
  };
  // Edges: geometry from the node of a cell to its neighbour's, or null.
  const edges = new Map<number, TravelCell[] | null>();
  const edge = (x: number, y: number, direction: number): TravelCell[] | null => {
    const [dx, dy] = MESH_DIRECTIONS[direction]!;
    const nx = x + dx,
      ny = y + dy;
    // Canonical key: both orientations share one evaluation.
    const reverse = direction >= 4,
      ox = reverse ? wrap(nx, W) : wrap(x, W),
      oy = reverse ? wrap(ny, H) : wrap(y, H),
      k = (oy * W + ox) * 4 + (reverse ? direction - 4 : direction);
    let geometry = edges.get(k);
    if (geometry === undefined) {
      geometry = evaluate(ox, oy, reverse ? direction - 4 : direction);
      edges.set(k, geometry);
    }
    return geometry && reverse ? [...geometry].reverse() : geometry;
  };
  const evaluate = (x: number, y: number, direction: number): TravelCell[] | null => {
    const [dx, dy] = MESH_DIRECTIONS[direction]!;
    const nx = x + dx,
      ny = y + dy;
    if (!passable(x, y) || !passable(nx, ny)) return null;
    if (dx && dy) {
      // A diagonal: straight, inside a square whose four sides are walkable.
      if (!edge(x, y, 0 + (dx > 0 ? 0 : 4)) || !edge(x, y, 2)) return null;
      if (!edge(x + dx, y, 2) || !edge(x, y + dy, dx > 0 ? 0 : 4)) return null;
    }
    const a = node(x, y),
      b = node(nx, ny);
    if (!a || !b) return null;
    const fine =
      equipped.has(index(x, y)) ||
      equipped.has(index(nx, ny)) ||
      (dx !== 0 && dy !== 0 && (equipped.has(index(nx, y)) || equipped.has(index(x, ny))));
    const meshNodes =
      mesh &&
      (!fine ||
        (key(a) === key(mesh.anchor(x, y) ?? { cellX: NaN, cellY: NaN }) &&
          key(b) === key(mesh.anchor(nx, ny) ?? { cellX: NaN, cellY: NaN })));
    if (mesh && meshNodes) {
      const state = mesh.edge(x, y, direction);
      if (state === MeshEdge.straight && (!fine || segmentLand(a, b))) return [a, b];
      if (dx && dy) return null;
      if (state === MeshEdge.bent && !fine) return mesh.geometry(x, y, direction);
      if (state === MeshEdge.blocked && !fine) return null;
    } else if (physical(a, b) && (!fine || segmentLand(a, b))) return [a, b];
    if (dx && dy) return null;
    // A cardinal step whose straight segment is blocked: a local detour inside its two cells.
    const ax = wrap(x, W),
      ay = wrap(y, H),
      bx = wrap(nx, W),
      by = wrap(ny, H);
    return latticePath(
      a,
      (p) => Math.abs(delta(p.cellX, b.cellX, W)) < 1e-9 && Math.abs(delta(p.cellY, b.cellY, H)) < 1e-9,
      (cx, cy) => (cx === ax && cy === ay) || (cx === bx && cy === by),
      stand,
      physical,
      world,
      128,
    );
  };
  /** Cost of a path's points, decision 8, times the garden factor. */
  const cost = (points: readonly TravelCell[]) => {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      const near =
        (roads && (roadCells.has(cellOf(a.cellX, a.cellY)) || roadCells.has(cellOf(b.cellX, b.cellY)))) ||
        (gardenFactor && (foreign.has(cellOf(a.cellX, a.cellY)) || foreign.has(cellOf(b.cellX, b.cellY))));
      total = near
        ? segmentCost(a, b, world, roads, gardenFactor, total)
        : segmentCost(a, b, world, undefined, undefined, total);
    }
    return total;
  };

  // Seeds: the town hall doors, or the given start point.
  const seeds: Array<{ cell: number; points: TravelCell[] }> = [];
  const connect = (outside: TravelCell, prefix: TravelCell[], building?: string) => {
    const ox = Math.floor(outside.cellX + 0.5),
      oy = Math.floor(outside.cellY + 0.5);
    const near: Array<[number, number]> = [];
    for (const x of new Set([Math.floor(outside.cellX), Math.ceil(outside.cellX), ox]))
      for (const y of new Set([Math.floor(outside.cellY), Math.ceil(outside.cellY), oy])) near.push([x, y]);
    let joined = false;
    for (const [x, y] of near) {
      if (!passable(x, y) || !inRegion(x, y)) continue;
      const n = node(x, y);
      if (!n) continue;
      let points: TravelCell[] | null = null;
      if (key(n) === key(outside)) points = [];
      else if (segmentLand(outside, n, building) && physical(outside, n)) points = [n];
      else
        for (const bend of [
          { cellX: n.cellX, cellY: outside.cellY },
          { cellX: outside.cellX, cellY: n.cellY },
        ])
          if (
            segmentLand(outside, bend, building) &&
            segmentLand(bend, n) &&
            physical(outside, bend) &&
            physical(bend, n)
          ) {
            points = [bend, n];
            break;
          }
      if (!points) continue;
      joined = true;
      seeds.push({ cell: localY(y) * region.width + localX(x), points: [...prefix, ...points] });
    }
    if (joined) return;
    // No straight or bent connector: a local lattice path to the nearest node.
    const cells = new Set(near.map(([x, y]) => index(x, y)));
    const path = latticePath(
      outside,
      (p) => {
        const x = Math.floor(p.cellX + 0.5),
          y = Math.floor(p.cellY + 0.5),
          n = passable(x, y) && inRegion(x, y) ? node(x, y) : null;
        return !!n && key(n) === key(p);
      },
      (x, y) => cells.has(index(x, y)) && (passable(x, y, building) || false),
      stand,
      (a, b) => physical(a, b) && segmentLand(a, b, building),
      world,
      512,
    );
    if (path) {
      const end = path.at(-1)!;
      seeds.push({
        cell: localY(Math.floor(end.cellY + 0.5)) * region.width + localX(Math.floor(end.cellX + 0.5)),
        points: [...prefix, ...path.slice(1)],
      });
    }
  };
  if (options.from) {
    const from = { cellX: wrap(options.from.cellX, W), cellY: wrap(options.from.cellY, H) };
    if (inRegion(Math.floor(from.cellX + 0.5), Math.floor(from.cellY + 0.5))) connect(from, [from]);
  } else {
    const anchor = state.cells.find(
      (c) => c.cellX === state.village.anchorCellX && c.cellY === state.village.anchorCellY,
    );
    const hallId = state.village.townHallBuildingId ?? anchor?.footprint?.buildingId ?? anchor?.building?.id;
    const hall = state.cells.find((c) => c.building?.id === hallId && c.building?.type === 'town-hall');
    if (hall?.building)
      for (const access of buildingAccesses(state, hall.building.id))
        if (
          segmentLand(access.position, access.outside, hall.building.id, 32) &&
          physical(access.position, access.outside)
        )
          connect(access.outside, [access.position, access.outside], hall.building.id);
  }

  // A*, on local indices of the region (a region as wide as the world wraps).
  const RW = region.width,
    RH = region.height,
    size = RW * RH,
    wrapsX = RW === W,
    wrapsY = RH === H;
  const cellAt = (i: number) => ({
    cellX: wrap(region.originCellX + (i % RW), W),
    cellY: wrap(region.originCellY + Math.floor(i / RW), H),
  });
  const neighbour = (i: number, direction: number) => {
    const [dx, dy] = MESH_DIRECTIONS[direction]!;
    let x = (i % RW) + dx,
      y = ((i / RW) | 0) + dy;
    if (x < 0 || x >= RW) {
      if (!wrapsX) return -1;
      x = wrap(x, RW);
    }
    if (y < 0 || y >= RH) {
      if (!wrapsY) return -1;
      y = wrap(y, RH);
    }
    return y * RW + x;
  };
  // Heuristic: the exact cost to the destination on the village mask alone
  // (no ground physics), each step at its lowest factor (a road cell 0.7, a
  // foreign plot GARDEN_CROSSING_COST). Physics only removes or lengthens
  // steps: a consistent lower bound, far tighter than octile × 0.7 once
  // roads exist, and it proves unreachable at once whatever the mask encloses.
  // Both are computed on demand: the bound spreads from the destination only
  // as far as the search needs it, never over the whole region.
  const mask = new Int8Array(size).fill(-1),
    floorFactor = new Float64Array(size);
  const open = (i: number) => {
    if (mask[i]! < 0) {
      const c = cellAt(i),
        k = index(c.cellX, c.cellY);
      mask[i] = passable(c.cellX, c.cellY) ? 1 : 0;
      floorFactor[i] = (roadCells.has(k) ? 0.7 : 1) * (foreign.has(k) ? GARDEN_CROSSING_COST : 1);
    }
    return mask[i] === 1;
  };
  const lower = new Float64Array(size).fill(Infinity),
    settled = new Uint8Array(size),
    spread = new NodeQueue();
  if (open(targetIndex)) {
    lower[targetIndex] = 0;
    spread.push(0, 0, targetIndex);
  }
  /** Settles the bound of `until` (or empties the queue); returns it, Infinity if none. */
  const settle = (until: number): number => {
    while (!settled[until] && spread.length) {
      const f = spread.key,
        i = spread.pop();
      if (settled[i] || f > lower[i]!) continue;
      settled[i] = 1;
      for (let direction = 0; direction < 8; direction++) {
        const j = neighbour(i, direction);
        if (j < 0 || settled[j] || !open(j)) continue;
        const diagonal = direction % 2 === 1;
        if (diagonal) {
          const side1 = neighbour(i, (direction + 7) % 8),
            side2 = neighbour(i, (direction + 1) % 8);
          if (side1 < 0 || side2 < 0 || !open(side1) || !open(side2)) continue;
        }
        const value = f + (diagonal ? DIAGONAL : 1) * Math.min(floorFactor[i]!, floorFactor[j]!);
        if (value < lower[j]!) {
          lower[j] = value;
          spread.push(value, 0, j);
        }
      }
    }
    return settled[until] ? lower[until]! : Infinity;
  };
  /** A lower bound now, without spreading: exact once settled, else the spread's frontier. */
  const bound = (i: number) => (settled[i] ? lower[i]! : spread.length ? spread.key : Infinity);
  // A path ends at the destination's node, or enters its cell from a cardinal
  // neighbour (any point within 3/8 of its centre): checked before searching.
  const entries = new Map<number, TravelCell[]>();
  let enterable = false;
  if (open(targetIndex))
    for (let direction = 0; direction < 8; direction++) {
      const i = neighbour(targetIndex, direction);
      if (i < 0 || !open(i)) continue;
      const c = cellAt(i),
        back = (direction + 4) % 8;
      if (edge(c.cellX, c.cellY, back)) {
        enterable = true;
        continue;
      }
      const a = node(c.cellX, c.cellY);
      if (direction % 2 === 1 || !a) continue;
      const ax = c.cellX,
        ay = c.cellY;
      const points = latticePath(
        a,
        (p) =>
          wrap(Math.floor(p.cellX + 0.5), W) === target.cellX &&
          wrap(Math.floor(p.cellY + 0.5), H) === target.cellY &&
          Math.abs(delta(p.cellX, target.cellX, W)) <= 0.375 + 1e-9 &&
          Math.abs(delta(p.cellY, target.cellY, H)) <= 0.375 + 1e-9,
        (x, y) => (x === ax && y === ay) || (x === target.cellX && y === target.cellY),
        stand,
        physical,
        world,
        128,
      );
      if (points) {
        entries.set(i, points);
        enterable = true;
      }
    }
  // Ties of equal cost go to the path with fewer changes of direction: a
  // turn adds TURN to the search key only, never to a cost or a duration.
  const TURN = 1e-7;
  const g = new Float64Array(size).fill(Infinity),
    estimate = new Float64Array(size),
    incoming = new Int8Array(size).fill(-1),
    parent = new Int32Array(size).fill(-1),
    closed = new Uint8Array(size),
    via = new Map<number, TravelCell[]>(),
    queue = new NodeQueue();
  const relax = (i: number, value: number, from: number, direction: number, points: TravelCell[]) => {
    if (closed[i] || value >= g[i]!) return;
    const h = bound(i);
    if (h === Infinity) return;
    g[i] = value;
    parent[i] = from;
    incoming[i] = direction;
    via.set(i, points);
    estimate[i] = h;
    queue.push(value + h, h, i);
  };
  if (enterable)
    for (const seed of seeds)
      if (settle(seed.cell) < Infinity) relax(seed.cell, cost(seed.points), -1, -1, seed.points);
  const limit = Math.min(villageSearchBound(region), options.maxVisited ?? Infinity);
  let visited = 0,
    found = false;
  while (queue.length) {
    const f = queue.key,
      i = queue.pop();
    if (closed[i] || f > g[i]! + estimate[i]!) continue;
    // Expand on the exact bound only: a frontier estimate is refined and requeued.
    if (!settled[i]) {
      const h = settle(i);
      if (h === Infinity) continue;
      estimate[i] = h;
      queue.push(g[i]! + h, h, i);
      continue;
    }
    if (visited >= limit) {
      queue.push(f, estimate[i]!, i);
      break;
    }
    visited++;
    if ((visited & 255) === 0) checkpoint?.();
    closed[i] = 1;
    if (i === targetIndex) {
      found = true;
      break;
    }
    const c = cellAt(i);
    for (let direction = 0; direction < 8; direction++) {
      const j = neighbour(i, direction);
      if (j < 0 || closed[j] || !open(j)) continue;
      const [dx, dy] = MESH_DIRECTIONS[direction]!;
      // No step is cheaper than 0.7 per unit of the straight distance between
      // its nodes: skip a neighbour it cannot improve before certifying it.
      const a = node(c.cellX, c.cellY),
        b = j === targetIndex ? null : node(c.cellX + dx, c.cellY + dy);
      const reach = a && b ? Math.hypot(delta(b.cellX, a.cellX, W), delta(b.cellY, a.cellY, H)) : 0;
      if (g[i]! + reach * 0.7 >= g[j]!) continue;
      const points = edge(c.cellX, c.cellY, direction) ?? (j === targetIndex ? entries.get(i) : undefined);
      if (!points) continue;
      relax(
        j,
        g[i]! + cost(points) + (incoming[i]! >= 0 && incoming[i] !== direction ? TURN : 0),
        i,
        direction,
        points,
      );
    }
  }
  if (options.stats) {
    options.stats.visited += visited;
    options.stats.certified += (mesh?.checks ?? 0) - checksBefore;
  }
  if (!found) return queue.length ? { kind: 'budget' } : { kind: 'unreachable' };
  const legs: TravelCell[][] = [];
  for (let i = targetIndex; i >= 0; i = parent[i]!) legs.push(via.get(i)!);
  legs.reverse();
  const path: TravelCell[] = [];
  for (const leg of legs)
    for (const p of leg) {
      const last = path.at(-1);
      if (!last || key(last) !== key(p)) path.push(p);
    }
  return { kind: 'found', path };
}

/**
 * A mission path (a resource, a science target): from the town hall doors to
 * `route.destination`. A destination outside the village region is reached
 * through the last local point of `route.cells` (a coarse witness), whose
 * remaining points are kept as they are; from inside the region alone no
 * search can prove such a target unreachable, so it ends in `budget`.
 */
export function planVillageRoute(
  state: TravelNetworkState,
  route: { cells: readonly TravelCell[]; destination: TravelCell },
  ground?: TravelGround,
  options: VillageSearchOptions = {},
): VillageSearchOutcome {
  const { world, region } = state;
  const local = (p: TravelCell) =>
    wrap(Math.round(p.cellX) - region.originCellX, world.widthCells) < region.width &&
    wrap(Math.round(p.cellY) - region.originCellY, world.heightCells) < region.height;
  if (local(route.destination)) return searchVillagePath(state, route.destination, ground, options);
  const last = route.cells.findLastIndex(local);
  if (last < 0) return { kind: 'budget' };
  const outcome = searchVillagePath(state, route.cells[last]!, ground, options);
  if (outcome.kind !== 'found') return { kind: 'budget' };
  return { kind: 'found', path: [...outcome.path, ...route.cells.slice(last + 1)] };
}

/** One leg of a garden tour (refonte des trajets §4.1): from the town hall
 * doors (`from` null) or from a plot, to a cell. The gardens of both ends are
 * crossed at no extra cost, every other plot at GARDEN_CROSSING_COST per step.
 * Null when no path exists; `onLimit` when the search ends in `budget`. */
export function planVillageLeg(
  state: TravelNetworkState,
  from: TravelCell | null,
  to: TravelCell,
  ground?: TravelGround,
  checkpoint?: () => void,
  onLimit?: () => void,
  stats?: VillageSearchStats,
): TravelCell[] | null {
  const gardens = new Set<string>();
  for (const end of from ? [from, to] : [to]) {
    const garden = villageGardenAt(state, end);
    if (garden !== undefined) gardens.add(garden);
  }
  const outcome = searchVillagePath(state, to, ground, {
    from,
    gardens,
    ...(checkpoint ? { checkpoint } : {}),
    ...(stats ? { stats } : {}),
  });
  if (outcome.kind === 'budget') onLimit?.();
  return outcome.kind === 'found' ? outcome.path : null;
}
