import { afterEach, describe, expect, it } from 'vitest';
import type { TerrainChunk, TerrainResponse, VillageState } from '@arbestra/contracts';
import { TerrainStore, type TerrainFetch } from './terrain-store';
import { BuildableGridGeometry, type BuildableGround } from './buildable-grid';

const TILE = 2.5;
const world = { id: 'world', generationVersion: 3, widthCells: 512, heightCells: 256, chunkSize: 32 };
/** A 6 × 4 village from (28,0), across chunks 0:0 and 1:0; every cell buildable. */
const village = (): VillageState =>
  ({
    world,
    region: {
      originCellX: 28,
      originCellY: 0,
      width: 6,
      height: 4,
      terrainCodes: Array(24).fill(1),
      elevations: Array(24).fill(40),
      vertexHeights: Array(7 * 5).fill(1),
      features: [],
    },
    cells: Array.from({ length: 24 }, (_, i) => {
      const cellX = 28 + (i % 6),
        cellY = Math.floor(i / 6);
      return { id: `c${i}`, cellX, cellY, canBuild: true, x: cellX * TILE + TILE / 2, z: cellY * TILE + TILE / 2 };
    }),
    village: { extractions: [] },
  }) as unknown as VillageState;
const ground = (x: number): TerrainChunk => ({
  chunkX: x,
  chunkY: 0,
  originCellX: x * 32,
  originCellY: 0,
  terrainCodes: Array(34 ** 2).fill(1),
  elevations: Array(34 ** 2).fill(40),
  features: [],
  occupiedCells: [],
  rc1: { model: 'vertices', stride: 33, heights: Array(33 ** 2).fill(1), water: Array(33 ** 2).fill(0), terraces: [] },
});
const stores: TerrainStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
});
async function loadedStore(): Promise<TerrainStore> {
  let resolve!: (r: TerrainResponse) => void;
  const fetch: TerrainFetch = () => new Promise((r) => (resolve = r as (r: TerrainResponse) => void));
  let now = 0;
  const store = new TerrainStore(village(), fetch, () => now);
  stores.push(store);
  store.demandChunks([
    { key: '0:0', chunkX: 0, chunkY: 0, visible: true, distance: 0 },
    { key: '1:0', chunkX: 1, chunkY: 0, visible: true, distance: 0 },
  ]);
  now += 100;
  store.tick();
  resolve({ world, chunks: [ground(0), ground(1)] });
  await new Promise((r) => setTimeout(r, 0));
  return store;
}
/** Every height drawn at vertex (vx, vy): area corners lie 0.01 below the lines. */
function heightsAt(geometry: BuildableGridGeometry, vx: number, vy: number): number[] {
  const out: number[] = [];
  const scan = (positions: Float32Array, offset: number) => {
    for (let i = 0; i < positions.length; i += 3)
      if (Math.abs(positions[i]! - vx * TILE) < 1e-4 && Math.abs(positions[i + 2]! - vy * TILE) < 1e-4)
        out.push(Math.round((positions[i + 1]! + offset) * 1000) / 1000);
  };
  scan(geometry.areaPositions, 0.01);
  scan(geometry.linePositions, 0);
  return out;
}
/** Counts the ground reads of the grid. */
function counted(store: TerrainStore): BuildableGround & { reads: number } {
  const probe = {
    reads: 0,
    world: store.world,
    entries: store.entries,
    get groundRevision() {
      return store.groundRevision;
    },
    groundRevisionAt: (x: number, y: number) => store.groundRevisionAt(x, y),
    vertexHeight: (x: number, y: number) => {
      probe.reads++;
      return store.vertexHeight(x, y);
    },
  };
  return probe;
}

describe('buildable grid on the displayed ground (docs/SPEC-TERRAFORMATION-OUTIL.md §7.9)', () => {
  it('draws the heights of the terrain store, not of the village snapshot', async () => {
    const store = await loadedStore();
    store.predict([{ vertexX: 30, vertexY: 2, height: 3 }]);
    const geometry = BuildableGridGeometry.build(village(), store);
    // Four cells share the vertex: four area corners and four line ends.
    expect(heightsAt(geometry, 30, 2)).toEqual(Array(8).fill(3 * TILE + 0.06));
    expect(heightsAt(geometry, 31, 2)).toEqual(Array(8).fill(TILE + 0.06));
  });

  it('follows a live stroke in place, rewriting only the moved vertices', async () => {
    const store = await loadedStore();
    const probe = counted(store);
    const geometry = BuildableGridGeometry.build(village(), probe);
    const area = geometry.areaPositions,
      lines = geometry.linePositions;
    // Nothing changed: an O(1) check, no ground read.
    probe.reads = 0;
    expect(geometry.refresh(probe)).toBe(0);
    expect(probe.reads).toBe(0);
    // (32,1) is on the border of both chunks.
    store.predict([
      { vertexX: 32, vertexY: 1, height: 2 },
      { vertexX: 29, vertexY: 3, height: 0 },
    ]);
    expect(geometry.refresh(probe)).toBe(2);
    expect(heightsAt(geometry, 32, 1)).toEqual(Array(8).fill(2 * TILE + 0.06));
    expect(heightsAt(geometry, 29, 3)).toEqual(Array(8).fill(0.06));
    // The same buffers, written in place.
    expect(geometry.areaPositions).toBe(area);
    expect(geometry.linePositions).toBe(lines);
    // A fast stroke along the chunk border: one prediction per frame; each
    // frame reads only the corner whose raw height moved (twice on the border,
    // once per chunk) and rewrites it alone, never the other 34 corners.
    for (let frame = 0; frame < 30; frame++) {
      const vertex = { vertexX: 30 + (frame % 4), vertexY: 1 + (frame % 3), height: 2 + (frame % 5) };
      const before = store.vertexHeight(vertex.vertexX, vertex.vertexY);
      store.predict([vertex]);
      probe.reads = 0;
      expect(geometry.refresh(probe)).toBe(before === vertex.height ? 0 : 1);
      expect(probe.reads).toBeLessThanOrEqual(vertex.vertexX === 32 ? 2 : 1);
      expect(heightsAt(geometry, vertex.vertexX, vertex.vertexY)).toEqual(Array(8).fill(vertex.height * TILE + 0.06));
    }
    // Without the raw patches, a changed chunk is read whole, still in place.
    const blind: BuildableGround = {
      world: store.world,
      get groundRevision() {
        return store.groundRevision;
      },
      groundRevisionAt: (x, y) => store.groundRevisionAt(x, y),
      vertexHeight: (x, y) => store.vertexHeight(x, y),
    };
    geometry.refresh(blind);
    store.predict([{ vertexX: 29, vertexY: 1, height: 4 }]);
    expect(geometry.refresh(blind)).toBe(1);
    expect(heightsAt(geometry, 29, 1)).toEqual(Array(8).fill(4 * TILE + 0.06));
  });

  it('falls back to the village snapshot where no chunk is loaded, and follows its update', () => {
    let state = village();
    const store = new TerrainStore(
      state,
      () => new Promise(() => {}),
      () => 0,
    );
    stores.push(store);
    state.region.vertexHeights![2 * 7 + 1] = 4;
    store.observe(state);
    const geometry = BuildableGridGeometry.build(state, store);
    expect(heightsAt(geometry, 29, 2)).toEqual(Array(8).fill(4 * TILE + 0.06));
    // The deferred presentation reread brings the applied edit.
    state = { ...state, region: { ...state.region, vertexHeights: state.region.vertexHeights!.map(() => 1) } };
    store.observe(state);
    expect(geometry.refresh(store)).toBe(1);
    expect(heightsAt(geometry, 29, 2)).toEqual(Array(8).fill(TILE + 0.06));
  });
});

describe('buildable grid without vertex heights (older generations)', () => {
  it('draws each cell flat and a shared edge once, at the higher cell', () => {
    const state = village();
    delete state.region.vertexHeights;
    state.region.elevations[1] = 80;
    state.cells.splice(2);
    const geometry = BuildableGridGeometry.build(state, null);
    // Two cells: seven distinct edges.
    expect(geometry.linePositions.length).toBe(7 * 6);
    // Area corners at each cell; line ends at 1.06 on the lower cell's top edge only.
    expect(heightsAt(geometry, 29, 0).sort()).toEqual([1.06, 1.06, 2.06, 2.06, 2.06]);
    expect(geometry.refresh(null)).toBe(0);
  });
});
