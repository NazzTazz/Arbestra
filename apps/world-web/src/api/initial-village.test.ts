import { afterEach, expect, it, vi } from 'vitest';
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  getVillage.mockReset();
  v2.read.mockReset();
  v2.enabled = false;
});
// Modules are reset between tests: the error class must be the instance the
// module under test checks against, not a copy imported at the top.
const load = async () => {
  const [village, transport] = await Promise.all([import('./initial-village'), import('./sync-v2-transport')]);
  return { ...village, SyncV2HttpError: transport.SyncV2HttpError };
};
const snapshot = { state: { world: { id: 'world' } }, serverOffsetMs: 0 };
it('shares the V2 bootstrap and keeps the historical read for a server without V2', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/village?world=another-world' });
  v2.enabled = true;
  const { initialVillageRead, SyncV2HttpError } = await load();
  v2.read.mockRejectedValue(new SyncV2HttpError(404, 'NOT_FOUND', 'Route absente.'));
  getVillage.mockResolvedValue(snapshot);
  const early = initialVillageRead();
  expect(initialVillageRead()).toBe(early);
  expect(await early).toBe(snapshot);
  expect(v2.read).toHaveBeenCalledExactlyOnceWith('another-world');
  expect(getVillage).toHaveBeenCalledExactlyOnceWith('another-world');
});
it('retries a busy V2 server instead of loading it with the historical read', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=busy' });
  v2.enabled = true;
  const { initialVillageRead, SyncV2HttpError } = await load();
  v2.read
    .mockRejectedValueOnce(new SyncV2HttpError(503, 'INTERNAL_ERROR', 'Indisponible.', 0))
    .mockResolvedValueOnce(snapshot);
  const read = initialVillageRead();
  await vi.advanceTimersByTimeAsync(1000);
  expect(await read).toBe(snapshot);
  expect(v2.read).toHaveBeenCalledTimes(2);
  expect(getVillage).not.toHaveBeenCalled();
});
// Incident: a presentation slower than the CPU lane queue answered 503 twice
// in a row and the player was left on the error screen for a loaded server.
it('keeps retrying a saturated V2 server with a capped back-off, behind the loading screen', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=saturated' });
  v2.enabled = true;
  const { initialVillageRead, INITIAL_READ_BACKOFF_MS, SyncV2HttpError } = await load();
  const busy = () => new SyncV2HttpError(503, 'INTERNAL_ERROR', 'Indisponible.', 0);
  v2.read
    .mockRejectedValueOnce(busy())
    .mockRejectedValueOnce(busy())
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockRejectedValueOnce(busy())
    .mockRejectedValueOnce(busy())
    .mockRejectedValueOnce(busy())
    .mockRejectedValueOnce(busy())
    .mockResolvedValueOnce(snapshot);
  let settled: unknown;
  const read = initialVillageRead().then((value) => (settled = value));
  // Each failure waits its step before the next attempt: 1, 2, 5, 10, 20, 30, 30 s.
  const steps = [...INITIAL_READ_BACKOFF_MS, INITIAL_READ_BACKOFF_MS.at(-1)!];
  for (const [index, step] of steps.entries()) {
    await vi.advanceTimersByTimeAsync(step - 1);
    expect(v2.read, `attempt ${index + 1}`).toHaveBeenCalledTimes(index + 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(await read).toBe(snapshot);
  expect(v2.read).toHaveBeenCalledTimes(steps.length + 1);
  expect(getVillage).not.toHaveBeenCalled();
});
it('lengthens a step for a longer Retry-After and still goes historical on a later 404', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=older' });
  v2.enabled = true;
  const { initialVillageRead, SyncV2HttpError } = await load();
  getVillage.mockResolvedValue(snapshot);
  v2.read
    .mockRejectedValueOnce(new SyncV2HttpError(503, 'NAVIGATION_BUSY', 'Occupé.', 1500))
    .mockRejectedValueOnce(new SyncV2HttpError(404, 'NOT_FOUND', 'Route absente.'));
  const read = initialVillageRead();
  await vi.advanceTimersByTimeAsync(1499);
  expect(v2.read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await read).toBe(snapshot);
  expect(v2.read).toHaveBeenCalledTimes(2);
  expect(getVillage).toHaveBeenCalledExactlyOnceWith('older');
});
it('gives up on the error screen only after the attempt bound', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=down' });
  v2.enabled = true;
  const { initialVillageRead, INITIAL_READ_ATTEMPTS, SyncV2HttpError } = await load();
  v2.read.mockRejectedValue(new SyncV2HttpError(503, 'INTERNAL_ERROR', 'Indisponible.', 0));
  const outcome = initialVillageRead().then(
    () => 'resolved',
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(30000 * INITIAL_READ_ATTEMPTS);
  expect(v2.read).toHaveBeenCalledTimes(INITIAL_READ_ATTEMPTS);
  expect(await outcome).toBeInstanceOf(SyncV2HttpError);
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
