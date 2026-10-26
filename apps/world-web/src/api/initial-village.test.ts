import { afterEach, expect, it, vi } from 'vitest';
import { SyncV2HttpError } from './sync-v2-transport';
const getVillage = vi.hoisted(() => vi.fn());
const v2 = vi.hoisted(() => ({ enabled: false, read: vi.fn() }));
vi.mock('./client', () => ({ getVillage }));
vi.mock('./sync-v2-initial', () => ({
  get SYNC_V2_VILLAGE() {
    return v2.enabled;
  },
  initialSyncV2Read: v2.read,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  getVillage.mockReset();
  v2.read.mockReset();
  v2.enabled = false;
});
it('shares the V2 bootstrap and keeps the historical read for a server without V2', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/village?world=another-world' });
  v2.enabled = true;
  v2.read.mockRejectedValue(new SyncV2HttpError(404, 'NOT_FOUND', 'Route absente.'));
  const snapshot = { state: { world: { id: 'world' } }, serverOffsetMs: 0 };
  getVillage.mockResolvedValue(snapshot);
  const { initialVillageRead } = await import('./initial-village');
  const early = initialVillageRead();
  expect(initialVillageRead()).toBe(early);
  expect(await early).toBe(snapshot);
  expect(v2.read).toHaveBeenCalledExactlyOnceWith('another-world');
  expect(getVillage).toHaveBeenCalledExactlyOnceWith('another-world');
});
it('retries a busy V2 server instead of loading it with the historical read', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/village?world=busy' });
  v2.enabled = true;
  const snapshot = { state: { world: { id: 'world' } }, serverOffsetMs: 0 };
  v2.read
    .mockRejectedValueOnce(new SyncV2HttpError(503, 'INTERNAL_ERROR', 'Indisponible.', 0))
    .mockResolvedValueOnce(snapshot);
  const { initialVillageRead } = await import('./initial-village');
  expect(await initialVillageRead()).toBe(snapshot);
  expect(v2.read).toHaveBeenCalledTimes(2);
  expect(getVillage).not.toHaveBeenCalled();
});
// Historical transport (localStorage arbestra:sync-v2=0 or VITE_SYNC_V2=0).
it('shares the early read with App and repeated development mounts', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/village?world=another-world' });
  let release!: (value: unknown) => void;
  getVillage.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { initialVillageRead } = await import('./initial-village');
  const early = initialVillageRead(),
    mounted = initialVillageRead(),
    remounted = initialVillageRead();
  expect(getVillage).toHaveBeenCalledExactlyOnceWith('another-world');
  expect(mounted).toBe(early);
  expect(remounted).toBe(early);
  const snapshot = { state: { world: { id: 'world' } }, serverOffsetMs: 0 };
  release(snapshot);
  expect(await mounted).toBe(snapshot);
});
it('keeps a failed early read observable by App without silently starting another request', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/village?world=unavailable' });
  getVillage.mockRejectedValue(new Error('offline'));
  const { initialVillageRead } = await import('./initial-village');
  await expect(initialVillageRead()).rejects.toThrow('offline');
  await expect(initialVillageRead()).rejects.toThrow('offline');
  expect(getVillage).toHaveBeenCalledTimes(1);
});
