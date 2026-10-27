import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NaturalFeature,
  StoneDeposit,
  TerrainChunk,
  TerrainResponse,
  TerrainUpdatesResponse,
  VillageState,
} from '@arbestra/contracts';
import { TerrainStore, type TerrainFetch } from './terrain-store';
import { terrainDemand } from './world-space';
import { nearestExploitationTarget } from '../ui/exploitation-navigation';

const world = { id: 'world', generationVersion: 2, widthCells: 2048, heightCells: 1024, chunkSize: 32 };
const deposit = (revision: number, remainingAmount = 100): StoneDeposit => ({
  featureId: 'stone',
  resourceCode: 'stone',
  cellX: 1,
  cellY: 1,
  initialAmount: 100,
  remainingAmount,
  reservedAmount: 0,
  availableAmount: remainingAmount,
  state: remainingAmount ? 'available' : 'depleted',
  revision,
  updatedAt: '2026-10-01T00:00:00Z',
});
const feature = (d: StoneDeposit): NaturalFeature => ({
  id: d.featureId,
  type: 'stone_outcrop',
  cellX: 1,
  cellY: 1,
  variantSeed: 0,
  deposit: d,
});
const state = (): VillageState =>
  ({
    world,
    region: { originCellX: 0, originCellY: 0, width: 1, height: 1, terrainCodes: [1], elevations: [8], features: [] },
    cells: [],
    village: { extractions: [] },
  }) as unknown as VillageState;
const chunk = (x = 0, y = 0): TerrainChunk => ({
  chunkX: x,
  chunkY: y,
  originCellX: x * 32,
  originCellY: y * 32,
  terrainCodes: Array(34 ** 2).fill(1),
  elevations: Array(34 ** 2).fill(8),
  features: [],
  occupiedCells: [],
});
const stores: TerrainStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
});
function harness(initial: VillageState = state()) {
  let now = 0;
  const requests: Array<{
    chunks: Array<{ chunkX: number; chunkY: number }>;
    resolve: (r: TerrainResponse | TerrainUpdatesResponse) => void;
    reject: (e: Error) => void;
    signal: AbortSignal;
    updatesOnly: boolean;
  }> = [];
  const fetch: TerrainFetch = (chunks, signal, updatesOnly) =>
    new Promise((resolve, reject) => requests.push({ chunks, resolve, reject, signal, updatesOnly }));
  const store = new TerrainStore(initial, fetch, () => now);
  stores.push(store);
  const advance = (ms: number, maxConcurrent?: number) => {
    now += ms;
    store.tick(maxConcurrent);
  };
  const demand = (x = 0) => store.demandChunks([{ key: `${x}:0`, chunkX: x, chunkY: 0, visible: true, distance: 0 }]);
  const settle = async (index: number, c = chunk()) => {
    requests[index]!.resolve({ world: initial.world, chunks: [c] });
    await new Promise((r) => setTimeout(r, 0));
  };
  return { store, requests, advance, demand, settle };
}
describe('terrain cache authority and lifecycle', () => {
  it('starts a terrain brush from visible cached corners outside the village snapshot without another request', async () => {
    const initial = state();
    initial.world = { ...initial.world, generationVersion: 3, widthCells: 512, heightCells: 256 };
    const h = harness(initial);
    h.demand(1);
    h.advance(100);
    const heights = Array.from({ length: 33 ** 2 }, (_, i) => 0.25 + (i % 33) / 4);
    await h.settle(0, {
      ...chunk(1),
      rc1: { model: 'vertices', stride: 33, heights, water: Array(33 ** 2).fill(0), terraces: [] },
    });
    expect(h.store.vertexHeight(33, 1)).toBe(0.5);
    expect(h.store.vertexHeight(34, 1)).toBe(0.75);
    expect(h.store.vertexHeight(33, 2)).toBe(0.5);
    expect(h.store.vertexHeight(34, 2)).toBe(0.75);
    expect(h.store.vertexHeight(64, 1)).toBe(8.25); // retained edge, next chunk absent
    expect(h.requests).toHaveLength(1);
    const seam = harness(initial);
    seam.store.demandChunks([{ key: '15:7', chunkX: 15, chunkY: 7, visible: true, distance: 0 }]);
    seam.advance(100);
    await seam.settle(0, {
      ...chunk(15, 7),
      rc1: { model: 'vertices', stride: 33, heights, water: Array(33 ** 2).fill(0), terraces: [] },
    });
    expect(seam.store.vertexHeight(0, 0)).toBe(8.25);
    expect(seam.requests).toHaveLength(1);
  });
  it('keeps every cell of a leveling site and refreshes its ground after completion', async () => {
    const initial = state(),
      site = { id: 'site', type: 'leveling-site', variantSeed: 0, deposit: null };
    initial.region.features = [
      { ...site, cellX: 1, cellY: 1 },
      { ...site, cellX: 2, cellY: 1 },
    ];
    const h = harness(initial);
    h.demand();
    h.advance(100);
    await h.settle(0, { ...chunk(), features: initial.region.features });
    expect(h.store.chunk('0:0')!.features).toHaveLength(2);
    expect(h.store.naturalFeatures()).toHaveLength(2);
    h.store.observe({ ...initial, region: { ...initial.region, features: [], elevations: [9] } });
    h.advance(100);
    expect(h.requests[1]!.updatesOnly).toBe(true);
    await h.settle(1);
    expect(h.store.chunk('0:0')!.features).toEqual([]);
    expect(h.store.naturalFeatures()).toEqual([]);
  });
  it('can begin the initial fixed-camera transfer without waiting for motion coalescing', async () => {
    const h = harness();
    h.store.demandChunks([{ key: '0:0', chunkX: 0, chunkY: 0, visible: true, distance: 0 }], true);
    h.store.tick(2, true);
    expect(h.requests).toHaveLength(1);
    await h.settle(0);
  });
  it('reserves startup requests for visible missing terrain, then resumes refresh and prefetch', async () => {
    const h = harness();
    h.store.demandChunks([
      { key: '0:0', chunkX: 0, chunkY: 0, visible: true, distance: 0 },
      { key: '1:0', chunkX: 1, chunkY: 0, visible: false, distance: 1 },
    ]);
    // Advance the injected clock without admitting a background batch.
    h.store.setPaused(true);
    h.advance(100);
    h.store.setPaused(false);
    h.store.tick(2, true);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.chunks.map((c) => c.chunkX)).toEqual([0]);
    await h.settle(0);
    h.store.setPaused(true);
    h.advance(6000);
    h.store.setPaused(false);
    h.store.tick(2, true);
    expect(h.requests).toHaveLength(1);
    // Real invalidations remain eligible even behind the loading screen.
    h.store.invalidate('0:0');
    h.store.tick(2, true);
    expect(h.requests[1]!.updatesOnly).toBe(true);
    await h.settle(1);
    h.store.tick();
    expect(h.requests[2]!.chunks.map((c) => c.chunkX)).toEqual([1]);
    await h.settle(2, chunk(1));
    h.advance(6000);
    expect(h.requests[3]!.updatesOnly).toBe(true);
    await h.settle(3);
  });
  it('versions ground availability, live RC1 edits and eviction without invalidating for economic feature changes', async () => {
    const initial = state();
    initial.world = { ...initial.world, generationVersion: 3, widthCells: 512, heightCells: 256 };
    const h = harness(initial),
      rc1 = { stride: 65, heights: Array(65 ** 2).fill(0.25), water: Array(65 ** 2).fill(0), terraces: [] };
    expect(h.store.ground(1, 1)).toBeNull();
    const unavailable = h.store.groundRevision;
    h.demand();
    h.advance(100);
    await h.settle(0, { ...chunk(), rc1 });
    const available = h.store.groundRevision;
    expect(available).toBeGreaterThan(unavailable);
    expect(h.store.ground(1, 1)!.height).toBe(0.625);
    const local = h.store.groundRevisionAt(1, 1);
    expect(local).toBe(available);
    expect(h.store.groundRevisionAt(513, 257)).toBe(local);
    h.advance(5000);
    h.requests[1]!.resolve({
      world: initial.world,
      chunks: [
        {
          chunkX: 0,
          chunkY: 0,
          originCellX: 0,
          originCellY: 0,
          features: [feature(deposit(1))],
          occupiedCells: [],
          rc1Edits: { terraces: [] },
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.store.groundRevision).toBe(available);
    expect(h.store.groundRevisionAt(1, 1)).toBe(local);
    h.advance(5000);
    h.requests[2]!.resolve({
      world: initial.world,
      chunks: [
        {
          chunkX: 0,
          chunkY: 0,
          originCellX: 0,
          originCellY: 0,
          features: [],
          occupiedCells: [],
          rc1Edits: { terraces: [{ cellX: 1, cellY: 1, height: 0.5 }] },
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.store.groundRevision).toBeGreaterThan(available);
    expect(h.store.ground(1, 1)!.height).toBe(1.25);
    expect(h.store.groundRevisionAt(1, 1)).toBeGreaterThan(local);
    expect(h.store.groundRevisionAt(40, 1)).toBe(unavailable);
    const beforeEviction = h.store.groundRevision;
    // Fill only cache entries, without starting transport or admitting any terrain meshes.
    for (let i = 1; i <= 65; i++)
      h.store.demandChunks([
        {
          key: (i % 16) + ':' + Math.floor(i / 16),
          chunkX: i % 16,
          chunkY: Math.floor(i / 16),
          visible: true,
          distance: 0,
        },
      ]);
    expect(h.store.entries.size).toBe(64);
    expect(h.store.chunk('0:0')).toBeUndefined();
    expect(h.store.ground(1, 1)).toBeNull();
    expect(h.store.groundRevision).toBeGreaterThan(beforeEviction);
    expect(h.store.groundRevisionAt(1, 1)).toBe(unavailable);
    h.demand();
    h.advance(100);
    await h.settle(3, { ...chunk(), rc1 });
    const restored = h.store.groundRevision;
    expect(h.store.ground(1, 1)!.height).toBe(0.625);
    h.store.geographyChanged();
    expect(h.store.groundRevision).toBeGreaterThan(restored);
    expect(h.store.ground(1, 1)).toBeNull();
  });
  it('keeps loaded substrate identities when another chunk or snapshot fallback changes', async () => {
    const initial = state(),
      h = harness(initial);
    h.demand();
    h.advance(100);
    await h.settle(0);
    const first = h.store.groundRevisionAt(1, 1);
    h.demand(1);
    h.advance(100);
    await h.settle(1, chunk(1));
    expect(h.store.groundRevisionAt(1, 1)).toBe(first);
    expect(h.store.groundRevisionAt(33, 1)).not.toBe(first);
    const fallback = h.store.groundRevisionAt(70, 1);
    h.store.observe({ ...initial, region: { ...initial.region, originCellX: 64, elevations: [24] } });
    expect(h.store.groundRevisionAt(1, 1)).toBe(first);
    expect(h.store.groundRevisionAt(70, 1)).not.toBe(fallback);
    expect(h.store.ground(64, 0)?.height).toBeCloseTo(0.6);
    h.store.geographyChanged();
    expect(h.store.groundRevisionAt(1, 1)).not.toBe(first);
  });
  it('releases timed-out requests even when transport never settles and rejects their late replies', async () => {
    vi.useFakeTimers();
    const h = harness();
    try {
      h.demand();
      h.advance(100);
      expect(h.store.pending).toBe(1);
      await vi.advanceTimersByTimeAsync(30001);
      expect(h.requests[0]!.signal.aborted).toBe(true);
      expect(h.store.pending).toBe(0);
      h.advance(2000);
      expect(h.requests).toHaveLength(2);
      h.requests[1]!.resolve({ world, chunks: [chunk()] });
      await vi.advanceTimersByTimeAsync(0);
      h.requests[0]!.resolve({ world, chunks: [{ ...chunk(), features: [feature(deposit(99))] }] });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.store.chunk('0:0')!.features).toEqual([]);
      expect(h.store.degraded).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('finds the nearest known resource outside the rendered demand and respects current depletion', async () => {
    const near = { ...feature(deposit(1)), cellX: 130, cellY: 0, deposit: { ...deposit(1), cellX: 130, cellY: 0 } };
    const far = {
      ...feature(deposit(1)),
      id: 'far',
      cellX: 10,
      cellY: 0,
      deposit: { ...deposit(1), featureId: 'far', cellX: 10, cellY: 0 },
    };
    const initial = state();
    initial.world = { ...initial.world, widthCells: 512, heightCells: 256 };
    initial.region.features = [far];
    let now = 0;
    const c = { ...chunk(4), features: [near] };
    const store = new TerrainStore(
      initial,
      async () => ({ world: initial.world, chunks: [c] }),
      () => now,
    );
    stores.push(store);
    const demand = { key: '4:0', chunkX: 4, chunkY: 0, visible: true, distance: 0 };
    store.demandChunks([demand]);
    now = 100;
    store.tick();
    await new Promise((r) => setTimeout(r, 0));
    const nearest = () =>
      nearestExploitationTarget(initial, 'stone', { cellX: 100, cellY: 0 }, store.naturalFeatures());
    expect(nearest()).toEqual({ cellX: 130, cellY: 0 });
    store.demandChunks([{ ...demand, visible: false }]);
    expect(nearest()).toEqual({ cellX: 130, cellY: 0 });
    store.demandChunks([]);
    expect(nearest()).toEqual({ cellX: 130, cellY: 0 });
    store.deposit({ ...near.deposit, revision: 2, remainingAmount: 0, availableAmount: 0, state: 'depleted' });
    expect(nearest()).toEqual({ cellX: 10, cellY: 0 });
  });
  it('reads continuous RC1 slopes without snapping the cursor to a cell centre', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    const c = {
      ...chunk(),
      rc1: {
        stride: 65,
        heights: Array.from({ length: 65 ** 2 }, (_, i) => ((i % 65) / 2) * 0.2 + 1),
        water: Array(65 ** 2).fill(0),
        terraces: [{ cellX: 2, cellY: 1, height: 1.5 }],
      },
    };
    await h.settle(0, c);
    expect(h.store.ground(1.25, 1)?.height).toBeCloseTo(3.375);
    expect(h.store.ground(1.49, 1)?.height).toBeCloseTo(3.495);
    expect(h.store.ground(1.51, 1)?.height).toBeCloseTo(3.75);
  });
  it('replaces RC1 terraces on a live updates response while keeping the immutable substrate', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    const first = {
      ...chunk(),
      rc1: { stride: 65, heights: Array(65 ** 2).fill(0.25), water: Array(65 ** 2).fill(0), terraces: [] },
    };
    await h.settle(0, first);
    expect(h.store.ground(1, 1)?.height).toBe(0.625);
    h.store.changed.clear();
    h.advance(6000);
    const patch = {
      chunkX: 0,
      chunkY: 0,
      originCellX: 0,
      originCellY: 0,
      features: [],
      occupiedCells: [],
      rc1: { ...first.rc1, terraces: [{ cellX: 1, cellY: 1, height: 0.5 }] },
    };
    h.requests[1]!.resolve({ world, chunks: [patch] });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.store.ground(1, 1)?.height).toBe(1.25);
    expect(h.store.ground(2, 1)?.height).toBe(0.625);
    expect(h.store.changed.has('0:0')).toBe(true);
  });
  it('replaces only RC1 edits while retaining height/water arrays, including an empty terrace scope', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    const rc1 = { stride: 65, heights: Array(65 ** 2).fill(0.25), water: Array(65 ** 2).fill(0), terraces: [] };
    await h.settle(0, { ...chunk(), rc1 });
    for (const terraces of [[{ cellX: 1, cellY: 1, height: 0.5 }], []]) {
      h.advance(5000);
      const request = h.requests.at(-1)!;
      request.resolve({
        world,
        chunks: [
          {
            chunkX: 0,
            chunkY: 0,
            originCellX: 0,
            originCellY: 0,
            features: [],
            occupiedCells: [],
            rc1Edits: { terraces },
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(h.store.chunk('0:0')!.rc1!.heights).toBe(rc1.heights);
      expect(h.store.chunk('0:0')!.rc1!.water).toBe(rc1.water);
      expect(h.store.ground(1, 1)!.height).toBe(terraces.length ? 1.25 : 0.625);
    }
  });
  it('requests newly authorized ground after a returned map instead of retaining an unknown cached chunk', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    await h.settle(0, { ...chunk(), terrainCodes: new Array(34 ** 2).fill(0) });
    h.store.geographyChanged();
    h.advance(1);
    expect(h.requests[1]!.updatesOnly).toBe(false);
    await h.settle(1);
    expect(h.store.entries.get('0:0')!.chunk!.terrainCodes[0]).toBe(1);
  });
  it('pauses regional requests, ignores cancelled replies and retains immutable chunks for village return', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    await h.settle(0);
    const geometry = h.store.entries.get('0:0')!.chunk!.terrainCodes;
    h.advance(6000);
    expect(h.requests).toHaveLength(2);
    h.store.setPaused(true);
    expect(h.requests[1]!.signal.aborted).toBe(true);
    await h.settle(1, { ...chunk(), features: [feature(deposit(99))] });
    expect(h.store.entries.get('0:0')!.chunk!.features).toEqual([]);
    expect(h.store.revisions.has('stone')).toBe(false);
    h.demand(1);
    h.advance(9000);
    expect(h.requests).toHaveLength(2);
    expect(h.store.entries.get('0:0')!.chunk!.terrainCodes).toBe(geometry);
    h.store.setPaused(false);
    h.advance(100);
    expect(h.requests).toHaveLength(3);
    await h.settle(2, chunk(1));
    h.demand();
    h.advance(100);
    expect(h.requests[3]!.updatesOnly).toBe(true);
    expect(h.store.entries.get('0:0')!.chunk!.terrainCodes).toBe(geometry);
  });
  it('reserves a network slot for an explicitly requested world overview', async () => {
    const h = harness();
    h.store.demandChunks(terrainDemand({ cellX: 0, cellY: 0 }, 2048, 1024, 32));
    h.advance(100, 1);
    expect(h.requests).toHaveLength(1);
    h.store.tick(1);
    expect(h.requests).toHaveLength(1);
    await h.settle(0);
    h.store.tick(1);
    expect(h.requests).toHaveLength(2);
    expect(h.store.pending).toBe(1);
  });
  it('refreshes cached chunks without terrain arrays after 15 seconds away, and fetches geometry only after eviction', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    await h.settle(0);
    expect(h.requests[0]!.updatesOnly).toBe(false);
    const immutable = h.store.entries.get('0:0')!.chunk!.terrainCodes;
    h.demand(1);
    h.advance(100);
    await h.settle(1, chunk(1));
    h.advance(15000);
    await h.settle(2, chunk(1));
    h.demand();
    h.advance(100);
    expect(h.requests[3]!.updatesOnly).toBe(true);
    const c = chunk();
    c.features = [feature(deposit(7, 0))];
    const update = {
      chunkX: c.chunkX,
      chunkY: c.chunkY,
      originCellX: c.originCellX,
      originCellY: c.originCellY,
      features: c.features,
      occupiedCells: c.occupiedCells,
    };
    h.requests[3]!.resolve({ world, chunks: [update] });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.store.entries.get('0:0')!.chunk!.terrainCodes).toBe(immutable);
    expect(h.store.chunk('0:0')!.features[0]!.deposit!.revision).toBe(7);
    expect(h.store.entries.get('0:0')!.failures).toBe(0);
    for (let x = 1; x <= 64; x++) h.demand(x);
    expect(h.store.entries.has('0:0')).toBe(false);
    h.demand();
    h.advance(100);
    expect(h.requests[4]!.updatesOnly).toBe(false);
  });
  it('rejects mutable data invalidated during flight but retains immutable halo', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    h.store.invalidate('0:0');
    const c = chunk();
    c.features = [feature(deposit(1))];
    c.occupiedCells = [{ cellX: 1, cellY: 1 }];
    await h.settle(0, c);
    expect(h.store.ground(1, 1)?.height).toBe(0.2);
    expect(h.store.chunk('0:0')?.features).toEqual([]);
    h.advance(1);
    expect(h.requests).toHaveLength(2);
    await h.settle(1, c);
    expect(h.store.chunk('0:0')?.occupiedCells).toEqual(c.occupiedCells);
  });
  // Alpha, 27 October: groves jumped between their real trees and a generic
  // three-tree layout whenever their chunk waited for a refresh.
  it('keeps the chunk tree geometry of a grove when an invalidated chunk shows the snapshot feature', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    const grove = { ...feature(deposit(1)), id: 'stone', type: 'woodland' };
    const c = chunk();
    c.features = [{ ...grove, rc1: { trees: [{ x: 1.2, y: 1.4, elevation: 8, size: 1, crown: 1 }], rocks: [] } } as NaturalFeature];
    await h.settle(0, c);
    const snapshot = state();
    snapshot.region.features = [grove];
    h.store.observe(snapshot);
    h.store.invalidate('0:0');
    expect(h.store.entries.get('0:0')?.freshAt).toBe(-Infinity);
    expect(h.store.chunk('0:0')?.features[0]?.rc1?.trees).toEqual([{ x: 1.2, y: 1.4, elevation: 8, size: 1, crown: 1 }]);
  });
  it('preserves a tombstone against late terrain and an unrelated snapshot', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    h.store.deposit(deposit(3, 0));
    const c = chunk();
    c.features = [feature(deposit(1))];
    await h.settle(0, c);
    h.store.observe(state());
    h.advance(1);
    await h.settle(1, c);
    expect(h.store.revisions.get('stone')?.state).toBe('depleted');
    expect(h.store.entries.get('0:0')?.freshAt).toBe(-Infinity);
  });
  it('polls unchanged visible chunks and does not redraw unchanged data', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    await h.settle(0);
    h.store.changed.clear();
    h.advance(4999);
    expect(h.requests).toHaveLength(1);
    h.advance(1);
    expect(h.requests).toHaveLength(2);
    await h.settle(1);
    expect(h.store.changed.size).toBe(0);
    h.store.dispose();
  });
  it('accepts a complete empty feature scope without resurrecting snapshot features or clearing another chunk', async () => {
    const h = harness(),
      snapshot = state();
    snapshot.region.features = [feature(deposit(1))];
    h.store.observe(snapshot);
    h.demand();
    h.advance(100);
    const first = chunk();
    first.features = snapshot.region.features;
    await h.settle(0, first);
    const immutable = h.store.entries.get('0:0')!.chunk!.terrainCodes;
    h.demand(1);
    h.advance(100);
    const distant = chunk(1);
    distant.features = [{ ...feature(deposit(1)), id: 'distant', cellX: 33, deposit: null }];
    await h.settle(1, distant);
    h.demand();
    h.advance(100);
    h.advance(5000);
    await h.settle(2);
    expect(h.store.chunk('0:0')!.features).toEqual([]);
    expect(h.store.entries.get('0:0')!.chunk!.terrainCodes).toBe(immutable);
    expect(h.store.chunk('1:0')!.features.map((f) => f.id)).toEqual(['distant']);
    h.store.dispose();
  });
  it('overlays own footprints immediately and revalidates after their removal', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    await h.settle(0);
    const snapshot = state();
    snapshot.cells = [{ cellX: 1, cellY: 1, footprint: {} }] as VillageState['cells'];
    h.store.observe(snapshot);
    expect(h.store.chunk('0:0')?.occupiedCells).toContainEqual({ cellX: 1, cellY: 1 });
    h.store.observe(state());
    expect(h.store.entries.get('0:0')?.freshAt).toBe(-Infinity);
  });
  it('caps batches, evicts data, ignores an evicted incarnation, and aborts on dispose', async () => {
    const h = harness();
    h.store.demandChunks(terrainDemand({ cellX: 0, cellY: 0 }, 2048, 1024, 32));
    h.advance(100);
    expect(h.requests).toHaveLength(2);
    expect(h.requests.every((r) => r.chunks.length <= 16)).toBe(true);
    for (let x = 0; x < 64; x++) h.store.demandChunks(terrainDemand({ cellX: x * 32, cellY: 512 }, 2048, 1024, 32));
    expect(h.store.entries.size).toBeLessThanOrEqual(64);
    await h.settle(0);
    expect(h.store.entries.get('0:0')?.chunk).toBeUndefined();
    h.store.dispose();
    expect(h.requests[1]!.signal.aborted).toBe(true);
  });
  it('retries failures with bounded backoff and resumes without discarding graphics data', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    await h.settle(0);
    h.advance(5000);
    h.requests[1]!.reject(new Error('offline'));
    await new Promise((r) => setTimeout(r, 0));
    h.advance(1999);
    expect(h.requests).toHaveLength(2);
    expect(h.store.chunk('0:0')).toBeDefined();
    h.advance(1);
    expect(h.requests).toHaveLength(3);
    await h.settle(2);
    h.store.revalidate();
    h.advance(1);
    expect(h.requests).toHaveLength(4);
  });
  it('bounds distant revision retention with the data cache, including depleted tombstones', async () => {
    const h = harness();
    for (let i = 0; i < 100; i++) {
      const x = i % 64,
        y = Math.floor(i / 64),
        key = `${x}:${y}`;
      const d = { ...deposit(3, 0), featureId: `stone-${i}`, cellX: x * 32 + 1, cellY: y * 32 + 1 };
      h.store.demandChunks([{ key, chunkX: x, chunkY: y, visible: true, distance: 0 }]);
      h.store.deposit(d);
      h.advance(100);
      const c = chunk(x, y);
      c.features = [{ ...feature(d), cellX: d.cellX, cellY: d.cellY }];
      await h.settle(i, c);
    }
    expect(h.store.entries.size).toBe(64);
    expect(h.store.revisions.size).toBe(64);
    expect(h.store.revisions.has('stone-0')).toBe(false);
    expect(h.store.chunk('35:1')!.features[0]!.deposit!.state).toBe('depleted');
  });
  it('rejects another world generation without publishing its terrain', async () => {
    const h = harness();
    h.demand();
    h.advance(100);
    h.requests[0]!.resolve({ world: { ...world, generationVersion: 3 }, chunks: [chunk()] });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.store.entries.get('0:0')!.chunk).toBeUndefined();
    expect(h.store.pending).toBe(0);
    expect(h.store.degraded).toBe(true);
  });
});
