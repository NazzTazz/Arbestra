import { canWalkSpawnSegment, type SpawnAccessField } from './spawn-access.js';
import { spawnDelta } from './spawn-map.js';
import type { TravelCell } from './travel-paths.js';

/**
 * Walkability of the cell grid, certified once per edge and kept per chunk
 * (docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md §3.2). One byte per cell:
 * its four undirected edges towards east, south-east, south and south-west,
 * two bits each (`MeshEdge`). The other four directions of a cell are the
 * edges of its neighbours. Serialised as two hex digits per cell, row-major.
 */
export interface ChunkNavigationMesh {
  chunkX: number;
  chunkY: number;
  cells: string;
}
/** State of one undirected edge between the nodes of two neighbouring cells. */
export const MeshEdge = { unknown: 0, blocked: 1, straight: 2, bent: 3 } as const;
export type MeshEdgeState = (typeof MeshEdge)[keyof typeof MeshEdge];
/** The eight directions, clockwise from east (y grows southwards). 0 to 3 are
 * stored by the cell itself, 4 to 7 by the neighbour they lead to. */
export const MESH_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
export interface ChunkNavigationOptions {
  /** Node of a cell, null when no point of it can be stood on; its centre by default. */
  anchor?: (cellX: number, cellY: number) => TravelCell | null;
  /** Bounded local path between the nodes of two cardinal neighbours whose straight
   * segment is blocked, contained in their two cells (`bent`); null: `blocked`. */
  detour?: (a: TravelCell, b: TravelCell) => TravelCell[] | null;
}
type Chunk = { x: number; y: number; width: number; cells: Uint8Array; changed: boolean };

export class ChunkNavigationCache {
  private chunks = new Map<string, Chunk>();
  private anchors = new Map<number, TravelCell | null>();
  private detours = new Map<number, TravelCell[]>();
  /** Edges answered from the mesh, and edges certified by the physical test. */
  hits = 0;
  checks = 0;
  constructor(
    private readonly field: SpawnAccessField,
    private readonly size: number,
    meshes: readonly ChunkNavigationMesh[] = [],
    private readonly options: ChunkNavigationOptions = {},
  ) {
    if (!Number.isSafeInteger(size) || size < 1) throw Error('Invalid navigation chunk size');
    for (const mesh of meshes) {
      if (
        !Number.isSafeInteger(mesh.chunkX) ||
        !Number.isSafeInteger(mesh.chunkY) ||
        mesh.chunkX < 0 ||
        mesh.chunkY < 0 ||
        mesh.chunkX * size >= field.width ||
        mesh.chunkY * size >= field.height
      )
        continue;
      const chunk = this.chunk(mesh.chunkX, mesh.chunkY);
      if (mesh.cells.length !== chunk.cells.length * 2 || !/^[0-9a-f]*$/.test(mesh.cells)) continue;
      for (let i = 0; i < chunk.cells.length; i++) chunk.cells[i] = parseInt(mesh.cells.slice(i * 2, i * 2 + 2), 16);
    }
  }
  private chunk(x: number, y: number) {
    const key = `${x}:${y}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      const width = Math.max(0, Math.min(this.size, this.field.width - x * this.size)),
        height = Math.max(0, Math.min(this.size, this.field.height - y * this.size));
      chunk = { x, y, width, cells: new Uint8Array(width * height), changed: false };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }
  private wrap(value: number, size: number) {
    return ((value % size) + size) % size;
  }
  /** Node of a cell (wrapped coordinates); memoised, it depends on the field only. */
  anchor(cellX: number, cellY: number): TravelCell | null {
    const x = this.wrap(cellX, this.field.width),
      y = this.wrap(cellY, this.field.height),
      k = y * this.field.width + x;
    if (!this.options.anchor) return { cellX: x, cellY: y };
    if (this.anchors.has(k)) return this.anchors.get(k)!;
    const node = this.options.anchor(x, y);
    this.anchors.set(k, node);
    return node;
  }
  /**
   * State of the edge from cell (x, y) towards `direction` (index of
   * MESH_DIRECTIONS), certified on first use. Both orientations of an edge
   * share one entry and one test, always run from its stored origin. On a
   * world of two cells or less along a moved axis both arcs join the same
   * cells: such edges are tested every time, never stored.
   */
  edge(cellX: number, cellY: number, direction: number): MeshEdgeState {
    const [dx, dy] = MESH_DIRECTIONS[direction]!;
    const w = this.field.width,
      h = this.field.height;
    let x = this.wrap(cellX, w),
      y = this.wrap(cellY, h),
      index = direction;
    if (direction >= 4) {
      x = this.wrap(x + dx, w);
      y = this.wrap(y + dy, h);
      index = direction - 4;
    }
    const stored = (!dx || w > 2) && (!dy || h > 2);
    const cx = Math.floor(x / this.size),
      cy = Math.floor(y / this.size),
      chunk = stored ? this.chunk(cx, cy) : undefined,
      cell = chunk ? (y - cy * this.size) * chunk.width + x - cx * this.size : 0,
      shift = index * 2;
    if (chunk) {
      const value = ((chunk.cells[cell]! >> shift) & 3) as MeshEdgeState;
      if (value !== MeshEdge.unknown) {
        this.hits++;
        return value;
      }
    }
    this.checks++;
    const [ox, oy] = MESH_DIRECTIONS[index]!;
    const a = this.anchor(x, y),
      b = this.anchor(x + ox, y + oy);
    let value: MeshEdgeState = MeshEdge.blocked;
    if (a && b) {
      if (canWalkSpawnSegment(this.field, { x: a.cellX, y: a.cellY }, { x: b.cellX, y: b.cellY }))
        value = MeshEdge.straight;
      else if (index % 2 === 0 && this.options.detour) {
        const path = this.options.detour(a, b);
        if (path) {
          value = MeshEdge.bent;
          this.detours.set((y * w + x) * 4 + index, path);
        }
      }
    }
    if (chunk) {
      chunk.cells[cell] = (chunk.cells[cell]! & ~(3 << shift)) | (value << shift);
      chunk.changed = true;
    }
    return value;
  }
  /**
   * Points of an edge from the node of (x, y) to the node of its neighbour,
   * both nodes included; null when it is blocked. A bent edge read from a
   * restored mesh recomputes its detour once (deterministic).
   */
  geometry(cellX: number, cellY: number, direction: number): TravelCell[] | null {
    const state = this.edge(cellX, cellY, direction);
    if (state === MeshEdge.blocked) return null;
    const [dx, dy] = MESH_DIRECTIONS[direction]!;
    const a = this.anchor(cellX, cellY)!,
      b = this.anchor(cellX + dx, cellY + dy)!;
    if (state === MeshEdge.straight) return [a, b];
    const w = this.field.width,
      reverse = direction >= 4,
      x = reverse ? this.wrap(cellX + dx, w) : this.wrap(cellX, w),
      y = reverse ? this.wrap(cellY + dy, this.field.height) : this.wrap(cellY, this.field.height),
      key = (y * w + x) * 4 + (reverse ? direction - 4 : direction);
    let path = this.detours.get(key);
    if (!path) {
      path = this.options.detour?.(reverse ? b : a, reverse ? a : b) ?? undefined;
      if (!path) return null;
      this.detours.set(key, path);
    }
    return reverse ? [...path].reverse() : path;
  }
  /** Straight walk between two points; unit cardinal segments between cell
   * centres are answered by the mesh (the commercial planner's interface). */
  walk = (a: TravelCell, b: TravelCell): boolean => {
    const dx = spawnDelta(b.cellX, a.cellX, this.field.width),
      dy = spawnDelta(b.cellY, a.cellY, this.field.height);
    const direction =
      dx === 1 && dy === 0 ? 0 : dy === 1 && dx === 0 ? 2 : dx === -1 && dy === 0 ? 4 : dy === -1 && dx === 0 ? 6 : -1;
    if (direction < 0 || this.options.anchor || ![a.cellX, a.cellY, b.cellX, b.cellY].every(Number.isInteger))
      return canWalkSpawnSegment(this.field, { x: a.cellX, y: a.cellY }, { x: b.cellX, y: b.cellY });
    return this.edge(a.cellX, a.cellY, direction) === MeshEdge.straight;
  };
  changed(): ChunkNavigationMesh[] {
    return [...this.chunks.values()]
      .filter((c) => c.changed)
      .map((c) => ({
        chunkX: c.x,
        chunkY: c.y,
        cells: [...c.cells].map((n) => n.toString(16).padStart(2, '0')).join(''),
      }));
  }
}
