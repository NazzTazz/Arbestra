import type { TerrainChunk, VillageState } from '@arbestra/contracts';
import { normalize } from './world-space';

const TILE_SIZE = 2.5;
/** Clears the shore lip as well as the grass surface. */
const LIFT = 0.06;
/** The blue area lies just below its lines. */
const AREA_DROP = 0.01;

/** The displayed ground the buildable grid follows (TerrainStore). */
export interface BuildableGround {
  readonly world: { readonly chunkSize: number };
  readonly groundRevision: number;
  /** Changes whenever the chunk holding cell (x, y) publishes other ground, or its snapshot fallback changes. */
  groundRevisionAt(x: number, y: number): number;
  /** Exact rendered corner in terrain units, snapshot fallback where no chunk is loaded. */
  vertexHeight(x: number, y: number): number | null;
  /** The published chunks, by `chunkX:chunkY` (TerrainStore.entries): their raw
   * shared-vertex heights tell which corners a changed chunk actually moved. */
  readonly entries?: ReadonlyMap<string, { readonly chunk?: Pick<TerrainChunk, 'rc1'> }>;
}
type Patch = NonNullable<TerrainChunk['rc1']>;

interface Corner {
  readonly x: number;
  readonly y: number;
  height: number;
  /** Offsets of the y components drawn at this corner, in each buffer. */
  readonly area: number[];
  readonly lines: number[];
}
interface Chunk {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  revision: number;
  readonly corners: Corner[];
  /** Each corner's column and row in this chunk's shared-vertex patch. */
  readonly columns: number[];
  readonly rows: number[];
  /** The patch last read: heights to compare, and its terraces. */
  heights: readonly number[] | null;
  terraces: Patch['terraces'] | null;
}

/**
 * Positions of the construction-mode grid lines and blue area, on the
 * displayed ground (docs/SPEC-TERRAFORMATION-OUTIL.md §7.9): each corner reads
 * the terrain store (shared RC1 vertices, snapshot fallback), the same source
 * as the rendered ground. `refresh` follows a ground change in place: an O(1)
 * check while nothing changed; in a chunk whose ground revision moved, a
 * comparison of the raw patch heights at its corners (array reads), then a
 * read and rewrite of the corners whose height moved only.
 * Without vertex heights (older generations) the grid stays flat per cell and
 * is never refreshed.
 */
export class BuildableGridGeometry {
  readonly areaPositions: Float32Array;
  readonly areaIndices: number[];
  readonly linePositions: Float32Array;
  #revision: number;
  #ground: BuildableGround | null;
  readonly #chunks: Chunk[];
  private constructor(
    area: number[],
    indices: number[],
    lines: number[],
    chunks: Chunk[],
    ground: BuildableGround | null,
  ) {
    this.areaPositions = Float32Array.from(area);
    this.areaIndices = indices;
    this.linePositions = Float32Array.from(lines);
    this.#chunks = chunks;
    this.#ground = ground;
    this.#revision = ground?.groundRevision ?? 0;
  }

  static build(state: VillageState, ground?: BuildableGround | null): BuildableGridGeometry {
    const area: number[] = [],
      indices: number[] = [],
      lines: number[] = [];
    const { widthCells: w, heightCells: h } = state.world;
    const chunkSize = ground?.world.chunkSize ?? 32;
    const r = state.region;
    const vertexHeights = r.vertexHeights;
    const half = TILE_SIZE / 2;
    const corners = new Map<string, Corner>();
    const chunks = new Map<string, Chunk>();
    const corner = (vx: number, vy: number, regionX: number, regionY: number): Corner => {
      const x = normalize(vx, w),
        y = normalize(vy, h),
        key = `${x}:${y}`;
      let found = corners.get(key);
      if (found) return found;
      const fallback = vertexHeights![regionY * (r.width + 1) + regionX]!;
      found = { x, y, height: ground?.vertexHeight(x, y) ?? fallback, area: [], lines: [] };
      corners.set(key, found);
      // A corner on a chunk border reads either chunk (TerrainStore.vertexHeight).
      for (const cy of y % chunkSize === 0 ? [y, normalize(y - 1, h)] : [y])
        for (const cx of x % chunkSize === 0 ? [x, normalize(x - 1, w)] : [x]) {
          const chunkKey = `${Math.floor(cx / chunkSize)}:${Math.floor(cy / chunkSize)}`;
          let chunk = chunks.get(chunkKey);
          if (!chunk) {
            const patch = ground?.entries?.get(chunkKey)?.chunk?.rc1;
            chunk = {
              key: chunkKey,
              x: cx,
              y: cy,
              revision: ground?.groundRevisionAt(cx, cy) ?? 0,
              corners: [],
              columns: [],
              rows: [],
              heights: patch?.model === 'vertices' ? patch.heights : null,
              terraces: patch?.terraces ?? null,
            };
            chunks.set(chunkKey, chunk);
          }
          chunk.corners.push(found);
          chunk.columns.push(normalize(x - Math.floor(cx / chunkSize) * chunkSize, w));
          chunk.rows.push(normalize(y - Math.floor(cy / chunkSize) * chunkSize, h));
        }
      return found;
    };
    const segments = new Set<string>();
    for (const cell of state.cells) {
      if (!cell.canBuild) continue;
      const regionX = (cell.cellX - r.originCellX + w) % w;
      const regionY = (cell.cellY - r.originCellY + h) % h;
      const offsets = [
        [-half, -half, 0, 0],
        [half, -half, 1, 0],
        [half, half, 1, 1],
        [-half, half, 0, 1],
      ] as const;
      if (vertexHeights) {
        const shared = offsets.map(([, , dx, dy]) =>
          corner(cell.cellX + dx, cell.cellY + dy, regionX + dx, regionY + dy),
        );
        const first = area.length / 3;
        offsets.forEach(([ox, oz], i) => {
          shared[i]!.area.push(area.length + 1);
          area.push(cell.x + ox, shared[i]!.height * TILE_SIZE + LIFT - AREA_DROP, cell.z + oz);
        });
        indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
        for (let i = 0; i < 4; i++) {
          const a = shared[i]!,
            b = shared[(i + 1) % 4]!;
          const key = `${a.x}:${a.y}` < `${b.x}:${b.y}` ? `${a.x}:${a.y}|${b.x}:${b.y}` : `${b.x}:${b.y}|${a.x}:${a.y}`;
          if (segments.has(key)) continue;
          segments.add(key);
          for (const [end, [ox, oz]] of [
            [a, offsets[i]!],
            [b, offsets[(i + 1) % 4]!],
          ] as const) {
            end.lines.push(lines.length + 1);
            lines.push(cell.x + ox, end.height * TILE_SIZE + LIFT, cell.z + oz);
          }
        }
        continue;
      }
      // Older generations: one flat elevation per cell, a shared edge at the higher one.
      const elevation = regionX < r.width && regionY < r.height ? (r.elevations[regionY * r.width + regionX] ?? 0) : 0;
      const y = elevation * 0.025 + LIFT;
      const first = area.length / 3;
      for (const [ox, oz] of offsets) area.push(cell.x + ox, y - AREA_DROP, cell.z + oz);
      indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
      for (let i = 0; i < 4; i++) lines.push(cell.x + offsets[i]![0], y, cell.z + offsets[i]![1]);
    }
    if (!vertexHeights) return new BuildableGridGeometry(area, indices, flatEdges(lines), [], null);
    return new BuildableGridGeometry(area, indices, lines, [...chunks.values()], ground ?? null);
  }

  /** Follows the displayed ground; returns the number of corners rewritten. */
  refresh(ground: BuildableGround | null | undefined): number {
    if (!ground || (ground === this.#ground && ground.groundRevision === this.#revision)) return 0;
    // Another store (a new terrain session): its revisions are not comparable.
    const all = ground !== this.#ground;
    this.#ground = ground;
    this.#revision = ground.groundRevision;
    let rewritten = 0;
    for (const chunk of this.#chunks) {
      const revision = ground.groundRevisionAt(chunk.x, chunk.y);
      if (!all && revision === chunk.revision) continue;
      chunk.revision = revision;
      // Same patch layout and terraces (a prediction, an answer): only the
      // corners whose raw height differs are read again; otherwise all of them.
      const patch = ground.entries?.get(chunk.key)?.chunk?.rc1,
        heights = patch?.model === 'vertices' ? patch.heights : null,
        previous = chunk.heights,
        stride = patch?.stride ?? 0,
        comparable =
          !all &&
          heights !== null &&
          previous !== null &&
          heights.length === previous.length &&
          (patch!.terraces === chunk.terraces || (patch!.terraces.length === 0 && chunk.terraces?.length === 0));
      chunk.heights = heights;
      chunk.terraces = patch?.terraces ?? null;
      for (let i = 0; i < chunk.corners.length; i++) {
        if (comparable) {
          const index = chunk.rows[i]! * stride + chunk.columns[i]!;
          if (heights[index] === previous[index]) continue;
        }
        const corner = chunk.corners[i]!;
        const height = ground.vertexHeight(corner.x, corner.y);
        if (height === null || height === corner.height) continue;
        corner.height = height;
        rewritten++;
        const y = height * TILE_SIZE + LIFT;
        for (const offset of corner.area) this.areaPositions[offset] = y - AREA_DROP;
        for (const offset of corner.lines) this.linePositions[offset] = y;
      }
    }
    return rewritten;
  }
}

/** Flat cells, four corners each: one segment per shared edge, at the higher cell. */
function flatEdges(corners: number[]): number[] {
  const segments = new Map<string, number[]>();
  for (let cell = 0; cell < corners.length; cell += 12)
    for (let i = 0; i < 4; i++) {
      const a = cell + i * 3,
        b = cell + ((i + 1) % 4) * 3;
      const from = corners.slice(a, a + 3),
        to = corners.slice(b, b + 3);
      const ka = `${from[0]}:${from[2]}`,
        kb = `${to[0]}:${to[2]}`;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const previous = segments.get(key);
      if (previous) from[1] = to[1] = Math.max(from[1]!, previous[1]!);
      segments.set(key, [...from, ...to]);
    }
  return [...segments.values()].flat();
}
