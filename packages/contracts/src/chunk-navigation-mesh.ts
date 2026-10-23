import { canWalkSpawnSegment } from './spawn-access.js';
import { spawnDelta } from './spawn-map.js';
import type { RouteField } from './route-planner.js';
import type { TravelCell } from './travel-paths.js';

/** Two bits per directed cardinal edge: unknown, blocked, or physically certified. */
export interface ChunkNavigationMesh {
  chunkX: number;
  chunkY: number;
  cells: string;
}
export class ChunkNavigationCache {
  private chunks = new Map<string, { x: number; y: number; width: number; cells: Uint8Array; changed: boolean }>();
  hits = 0;
  checks = 0;
  constructor(
    private readonly field: RouteField,
    private readonly size: number,
    meshes: readonly ChunkNavigationMesh[] = [],
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
  walk = (a: TravelCell, b: TravelCell): boolean => {
    const dx = spawnDelta(b.cellX, a.cellX, this.field.width),
      dy = spawnDelta(b.cellY, a.cellY, this.field.height);
    const direction =
      dx === 1 && dy === 0 ? 0 : dy === 1 && dx === 0 ? 1 : dx === -1 && dy === 0 ? 2 : dy === -1 && dx === 0 ? 3 : -1;
    if (direction < 0 || ![a.cellX, a.cellY, b.cellX, b.cellY].every(Number.isInteger))
      return canWalkSpawnSegment(this.field, { x: a.cellX, y: a.cellY }, { x: b.cellX, y: b.cellY });
    const x = Math.floor(a.cellX / this.size),
      y = Math.floor(a.cellY / this.size),
      chunk = this.chunk(x, y);
    const index = (a.cellY - y * this.size) * chunk.width + a.cellX - x * this.size,
      shift = direction * 2;
    const value = (chunk.cells[index]! >> shift) & 3;
    if (value === 1 || value === 2) {
      this.hits++;
      return value === 2;
    }
    this.checks++;
    const valid = canWalkSpawnSegment(this.field, { x: a.cellX, y: a.cellY }, { x: b.cellX, y: b.cellY });
    chunk.cells[index] = (chunk.cells[index]! & ~(3 << shift)) | ((valid ? 2 : 1) << shift);
    chunk.changed = true;
    // Unit cardinal segments sample the same binary-exact points in reverse.
    // Exclude a half-world tie, whose reverse delta may select the other arc.
    if ((dx !== 0 ? this.field.width : this.field.height) > 2) {
      const bx = Math.floor(b.cellX / this.size),
        by = Math.floor(b.cellY / this.size),
        back = this.chunk(bx, by);
      const bi = (b.cellY - by * this.size) * back.width + b.cellX - bx * this.size,
        bs = ((direction + 2) % 4) * 2;
      back.cells[bi] = (back.cells[bi]! & ~(3 << bs)) | ((valid ? 2 : 1) << bs);
      back.changed = true;
    }
    return valid;
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
