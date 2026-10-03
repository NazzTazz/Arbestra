import { afterEach, describe, expect, it } from 'vitest';
import type { NaturalFeature, StoneDeposit, TerrainChunk, TerrainResponse, TerrainUpdatesResponse, VillageState } from '@arbestra/contracts';
import { TerrainStore, type TerrainFetch } from './terrain-store';
import { terrainDemand } from './world-space';

const world = { id: 'world', generationVersion: 2, widthCells: 2048, heightCells: 1024, chunkSize: 32 };
const deposit = (revision: number, remainingAmount = 100): StoneDeposit => ({ featureId: 'stone', resourceCode: 'stone', cellX: 1, cellY: 1,
  initialAmount: 100, remainingAmount, reservedAmount: 0, availableAmount: remainingAmount, state: remainingAmount ? 'available' : 'depleted', revision, updatedAt: '2026-10-01T00:00:00Z' });
const feature = (d: StoneDeposit): NaturalFeature => ({ id: d.featureId, type: 'stone_outcrop', cellX: 1, cellY: 1, variantSeed: 0, deposit: d });
const state = (): VillageState => ({ world, region: { originCellX: 0, originCellY: 0, width: 1, height: 1, terrainCodes: [1], elevations: [8], features: [] },
  cells: [], village: { extractions: [] } }) as unknown as VillageState;
const chunk = (x = 0, y = 0): TerrainChunk => ({ chunkX: x, chunkY: y, originCellX: x * 32, originCellY: y * 32,
  terrainCodes: Array(34 ** 2).fill(1), elevations: Array(34 ** 2).fill(8), features: [], occupiedCells: [] });
const stores: TerrainStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });
function harness() {
  let now = 0;
  const requests: Array<{ chunks: Array<{ chunkX: number; chunkY: number }>; resolve: (r: TerrainResponse | TerrainUpdatesResponse) => void; reject: (e: Error) => void; signal: AbortSignal; updatesOnly: boolean }> = [];
  const fetch: TerrainFetch = (chunks, signal, updatesOnly) => new Promise((resolve, reject) => requests.push({ chunks, resolve, reject, signal, updatesOnly }));
  const store = new TerrainStore(state(), fetch, () => now);
  stores.push(store);
  const advance = (ms: number, maxConcurrent?: number) => { now += ms; store.tick(maxConcurrent); };
  const demand = (x = 0) => store.demandChunks([{ key: `${x}:0`, chunkX: x, chunkY: 0, visible: true, distance: 0 }]);
  const settle = async (index: number, c = chunk()) => { requests[index]!.resolve({ world, chunks: [c] }); await new Promise(r => setTimeout(r, 0)); };
  return { store, requests, advance, demand, settle };
}
describe('terrain cache authority and lifecycle', () => {
  it('pauses regional requests, ignores cancelled replies and retains immutable chunks for village return', async () => {
    const h = harness(); h.demand(); h.advance(100); await h.settle(0);
    const geometry = h.store.entries.get('0:0')!.chunk!.terrainCodes;
    h.advance(6000); expect(h.requests).toHaveLength(2);
    h.store.setPaused(true); expect(h.requests[1]!.signal.aborted).toBe(true);
    await h.settle(1, { ...chunk(), features: [feature(deposit(99))] });
    expect(h.store.entries.get('0:0')!.chunk!.features).toEqual([]);
    expect(h.store.revisions.has('stone')).toBe(false);
    h.demand(1); h.advance(9000); expect(h.requests).toHaveLength(2);
    expect(h.store.entries.get('0:0')!.chunk!.terrainCodes).toBe(geometry);
    h.store.setPaused(false); h.advance(100); expect(h.requests).toHaveLength(3);
    await h.settle(2, chunk(1));
    h.demand(); h.advance(100); expect(h.requests[3]!.updatesOnly).toBe(true);
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
    const h = harness(); h.demand(); h.advance(100); await h.settle(0);
    expect(h.requests[0]!.updatesOnly).toBe(false);
    const immutable = h.store.entries.get('0:0')!.chunk!.terrainCodes;
    h.demand(1); h.advance(100); await h.settle(1, chunk(1));
    h.advance(15000); await h.settle(2, chunk(1));
    h.demand(); h.advance(100);
    expect(h.requests[3]!.updatesOnly).toBe(true);
    const c = chunk(); c.features = [feature(deposit(7, 0))];
    const update = { chunkX: c.chunkX, chunkY: c.chunkY, originCellX: c.originCellX,
      originCellY: c.originCellY, features: c.features, occupiedCells: c.occupiedCells };
    h.requests[3]!.resolve({ world, chunks: [update] }); await new Promise(r => setTimeout(r, 0));
    expect(h.store.entries.get('0:0')!.chunk!.terrainCodes).toBe(immutable);
    expect(h.store.chunk('0:0')!.features[0]!.deposit!.revision).toBe(7);
    expect(h.store.entries.get('0:0')!.failures).toBe(0);
    for (let x = 1; x <= 64; x++) h.demand(x);
    expect(h.store.entries.has('0:0')).toBe(false);
    h.demand(); h.advance(100);
    expect(h.requests[4]!.updatesOnly).toBe(false);
  });
  it('rejects mutable data invalidated during flight but retains immutable halo', async () => {
    const h = harness(); h.demand(); h.advance(100); h.store.invalidate('0:0');
    const c = chunk(); c.features = [feature(deposit(1))]; c.occupiedCells = [{ cellX: 1, cellY: 1 }];
    await h.settle(0, c);
    expect(h.store.ground(1, 1)?.height).toBe(0.2); expect(h.store.chunk('0:0')?.features).toEqual([]);
    h.advance(1); expect(h.requests).toHaveLength(2);
    await h.settle(1, c); expect(h.store.chunk('0:0')?.occupiedCells).toEqual(c.occupiedCells);
  });
  it('preserves a tombstone against late terrain and an unrelated snapshot', async () => {
    const h = harness(); h.demand(); h.advance(100); h.store.deposit(deposit(3, 0));
    const c = chunk(); c.features = [feature(deposit(1))]; await h.settle(0, c);
    h.store.observe(state()); h.advance(1); await h.settle(1, c);
    expect(h.store.revisions.get('stone')?.state).toBe('depleted');
    expect(h.store.entries.get('0:0')?.freshAt).toBe(-Infinity);
  });
  it('polls unchanged visible chunks and does not redraw unchanged data', async () => {
    const h = harness(); h.demand(); h.advance(100); await h.settle(0); h.store.changed.clear();
    h.advance(4999); expect(h.requests).toHaveLength(1);
    h.advance(1); expect(h.requests).toHaveLength(2); await h.settle(1);
    expect(h.store.changed.size).toBe(0);
    h.store.dispose();
  });
  it('accepts a complete empty feature scope without resurrecting snapshot features or clearing another chunk', async () => {
    const h = harness(), snapshot = state(); snapshot.region.features = [feature(deposit(1))];
    h.store.observe(snapshot); h.demand(); h.advance(100);
    const first = chunk(); first.features = snapshot.region.features;
    await h.settle(0, first);
    const immutable = h.store.entries.get('0:0')!.chunk!.terrainCodes;
    h.demand(1); h.advance(100); const distant = chunk(1); distant.features = [{ ...feature(deposit(1)), id: 'distant', cellX: 33, deposit: null }];
    await h.settle(1, distant);
    h.demand(); h.advance(100); h.advance(5000); await h.settle(2);
    expect(h.store.chunk('0:0')!.features).toEqual([]);
    expect(h.store.entries.get('0:0')!.chunk!.terrainCodes).toBe(immutable);
    expect(h.store.chunk('1:0')!.features.map(f => f.id)).toEqual(['distant']);
    h.store.dispose();
  });
  it('overlays own footprints immediately and revalidates after their removal', async () => {
    const h = harness(); h.demand(); h.advance(100); await h.settle(0);
    const snapshot = state(); snapshot.cells = [{ cellX: 1, cellY: 1, footprint: {} }] as VillageState['cells'];
    h.store.observe(snapshot); expect(h.store.chunk('0:0')?.occupiedCells).toContainEqual({ cellX: 1, cellY: 1 });
    h.store.observe(state()); expect(h.store.entries.get('0:0')?.freshAt).toBe(-Infinity);
  });
  it('caps batches, evicts data, ignores an evicted incarnation, and aborts on dispose', async () => {
    const h = harness(); h.store.demandChunks(terrainDemand({ cellX: 0, cellY: 0 }, 2048, 1024, 32)); h.advance(100);
    expect(h.requests).toHaveLength(2); expect(h.requests.every(r => r.chunks.length <= 16)).toBe(true);
    for (let x = 0; x < 64; x++) h.store.demandChunks(terrainDemand({ cellX: x * 32, cellY: 512 }, 2048, 1024, 32));
    expect(h.store.entries.size).toBeLessThanOrEqual(64);
    await h.settle(0); expect(h.store.entries.get('0:0')?.chunk).toBeUndefined();
    h.store.dispose(); expect(h.requests[1]!.signal.aborted).toBe(true);
  });
  it('retries failures with bounded backoff and resumes without discarding graphics data', async () => {
    const h = harness(); h.demand(); h.advance(100); await h.settle(0); h.advance(5000);
    h.requests[1]!.reject(new Error('offline')); await new Promise(r => setTimeout(r, 0));
    h.advance(1999); expect(h.requests).toHaveLength(2); expect(h.store.chunk('0:0')).toBeDefined();
    h.advance(1); expect(h.requests).toHaveLength(3); await h.settle(2);
    h.store.revalidate(); h.advance(1); expect(h.requests).toHaveLength(4);
  });
  it('bounds distant revision retention with the data cache, including depleted tombstones', async () => {
    const h = harness();
    for (let i = 0; i < 100; i++) {
      const x = i % 64, y = Math.floor(i / 64), key = `${x}:${y}`;
      const d = { ...deposit(3, 0), featureId: `stone-${i}`, cellX: x * 32 + 1, cellY: y * 32 + 1 };
      h.store.demandChunks([{ key, chunkX: x, chunkY: y, visible: true, distance: 0 }]);
      h.store.deposit(d); h.advance(100);
      const c = chunk(x, y); c.features = [{ ...feature(d), cellX: d.cellX, cellY: d.cellY }]; await h.settle(i, c);
    }
    expect(h.store.entries.size).toBe(64); expect(h.store.revisions.size).toBe(64);
    expect(h.store.revisions.has('stone-0')).toBe(false);
    expect(h.store.chunk('35:1')!.features[0]!.deposit!.state).toBe('depleted');
  });
  it('rejects another world generation without publishing its terrain', async () => {
    const h = harness(); h.demand(); h.advance(100);
    h.requests[0]!.resolve({ world: { ...world, generationVersion: 3 }, chunks: [chunk()] });
    await new Promise(r => setTimeout(r, 0));
    expect(h.store.entries.get('0:0')!.chunk).toBeUndefined(); expect(h.store.pending).toBe(0);
    expect(h.store.degraded).toBe(true);
  });
});
