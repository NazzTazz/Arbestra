import type { TravelCell } from '@arbestra/contracts';
import { coverage } from './terrain-settings';
export const CELL_UNITS = 2.5;
export const normalize = (value: number, size: number): number => ((value % size) + size) % size;
export const delta = (value: number, origin: number, size: number): number => normalize(value - origin + size / 2, size) - size / 2;

/** The only conversion between canonical cells and Babylon's local plane. */
export class WorldSpace {
  version = 0;
  constructor(public width: number, public height: number, public origin: TravelCell) {}
  project(cell: TravelCell): { x: number; z: number } {
    return { x: delta(cell.cellX, this.origin.cellX, this.width) * CELL_UNITS, z: delta(cell.cellY, this.origin.cellY, this.height) * CELL_UNITS };
  }
  inverse(x: number, z: number): TravelCell {
    return { cellX: normalize(this.origin.cellX + x / CELL_UNITS, this.width), cellY: normalize(this.origin.cellY + z / CELL_UNITS, this.height) };
  }
  projectFrom(cell: TravelCell, anchor: TravelCell): { x: number; z: number } {
    const point = this.project(anchor);
    return { x: point.x + delta(cell.cellX, anchor.cellX, this.width) * CELL_UNITS,
      z: point.z + delta(cell.cellY, anchor.cellY, this.height) * CELL_UNITS };
  }
  rebase(target: TravelCell, size: number): { x: number; z: number } | null {
    const next = { cellX: Math.floor(target.cellX / size) * size, cellY: Math.floor(target.cellY / size) * size };
    if (next.cellX === this.origin.cellX && next.cellY === this.origin.cellY) return null;
    const shift = this.project(next);
    this.origin = next; this.version++;
    return shift;
  }
  path(cells: TravelCell[]): Array<{ x: number; z: number }> {
    if (!cells.length) return [];
    const points = [this.project(cells[0]!)];
    for (let i = 1; i < cells.length; i++) {
      const previous = points[i - 1]!, a = cells[i - 1]!, b = cells[i]!;
      points.push({ x: previous.x + delta(b.cellX, a.cellX, this.width) * CELL_UNITS,
        z: previous.z + delta(b.cellY, a.cellY, this.height) * CELL_UNITS });
    }
    return points;
  }
}

export interface ChunkDemand { key: string; chunkX: number; chunkY: number; visible: boolean; distance: number }
export function terrainDemand(target: TravelCell, width: number, height: number, size: number,
  intersects: (x: number, y: number) => boolean = () => true): ChunkDemand[] {
  const { radius, ring } = coverage(width, height, size);
  const minX = Math.floor((target.cellX - radius) / size), maxX = Math.floor((target.cellX + radius) / size);
  const minY = Math.floor((target.cellY - radius) / size), maxY = Math.floor((target.cellY + radius) / size);
  const result = new Map<string, ChunkDemand>();
  for (let y = minY - ring; y <= maxY + ring; y++) for (let x = minX - ring; x <= maxX + ring; x++) {
    const chunkX = normalize(x, width / size), chunkY = normalize(y, height / size), key = `${chunkX}:${chunkY}`;
    const visible = x >= minX && x <= maxX && y >= minY && y <= maxY && intersects(chunkX, chunkY);
    result.set(key, { key, chunkX, chunkY, visible, distance: Math.max(Math.abs(x * size + size / 2 - target.cellX), Math.abs(y * size + size / 2 - target.cellY)) });
  }
  return [...result.values()].sort((a, b) => Number(b.visible) - Number(a.visible) || a.distance - b.distance);
}
