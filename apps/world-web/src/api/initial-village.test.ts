import { afterEach, expect, it, vi } from 'vitest';
const v2 = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./sync-v2-initial', () => ({ initialSyncV2Read: v2.read }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  v2.read.mockReset();
});
// Modules are reset between tests: the error classes must be the instances the
// module under test checks against, not copies imported at the top.
const load = async () => {
  const [village, transport, session, reconnect] = await Promise.all([
    import('./initial-village'),
    import('./sync-v2-transport'),
    import('./sync-v2-session'),
    import('./reconnect'),
  ]);
  return {
    ...village,
    SyncV2HttpError: transport.SyncV2HttpError,
    SyncV2SessionExpired: session.SyncV2SessionExpired,
    RECONNECT_BACKOFF_MS: reconnect.RECONNECT_BACKOFF_MS,
  };
};
const snapshot = { state: { world: { id: 'world' } }, serverOffsetMs: 0 };
it('shares the V2 bootstrap with App and repeated development mounts', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/village?world=another-world' });
  const { initialVillageRead } = await load();
  v2.read.mockResolvedValue(snapshot);
  const early = initialVillageRead(),
    mounted = initialVillageRead(),
    remounted = initialVillageRead();
  expect(mounted).toBe(early);
  expect(remounted).toBe(early);
  expect(await early).toBe(snapshot);
  expect(v2.read).toHaveBeenCalledExactlyOnceWith('another-world');
});
it('keeps a failed early read observable by App without silently starting another request', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/village?world=unavailable' });
  const { initialVillageRead } = await load();
  v2.read.mockRejectedValue(new Error('offline'));
  vi.useFakeTimers();
  const failed = initialVillageRead().then(
    () => 'resolved',
    (error: unknown) => error,
  );
  await vi.runAllTimersAsync();
  expect(await failed).toMatchObject({ message: 'offline' });
  const calls = v2.read.mock.calls.length;
  await expect(initialVillageRead()).rejects.toThrow('offline');
  expect(v2.read).toHaveBeenCalledTimes(calls);
});
it('sends an expired session straight to the login screen: one attempt, the session error itself', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=expired' });
  const { initialVillageRead, SyncV2SessionExpired } = await load();
  v2.read.mockRejectedValue(new SyncV2SessionExpired());
  const outcome = initialVillageRead().then(
    () => 'resolved',
    (error: unknown) => error,
  );
  // Neither a wait nor a second attempt: the rejection needs no timer at all.
  expect(await outcome).toBeInstanceOf(SyncV2SessionExpired);
  await vi.advanceTimersByTimeAsync(120000);
  expect(v2.read).toHaveBeenCalledExactlyOnceWith('expired');
});
it('stops at once on a missing village or world, with the server refusal for the screen', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=empty' });
  const { initialVillageRead, SyncV2HttpError } = await load();
  v2.read.mockRejectedValue(new SyncV2HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable dans ce monde.'));
  const outcome = initialVillageRead().then(
    () => 'resolved',
    (error: unknown) => error,
  );
  const error = await outcome;
  expect(error).toBeInstanceOf(SyncV2HttpError);
  expect(error).toMatchObject({ status: 404, message: 'Village introuvable dans ce monde.' });
  await vi.advanceTimersByTimeAsync(120000);
  expect(v2.read).toHaveBeenCalledExactlyOnceWith('empty');
});
it('retries a busy V2 server behind the loading screen', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=busy' });
  const { initialVillageRead, SyncV2HttpError } = await load();
  v2.read
    .mockRejectedValueOnce(new SyncV2HttpError(503, 'INTERNAL_ERROR', 'Indisponible.', 0))
    .mockResolvedValueOnce(snapshot);
  const read = initialVillageRead();
  await vi.advanceTimersByTimeAsync(1000);
  expect(await read).toBe(snapshot);
  expect(v2.read).toHaveBeenCalledTimes(2);
});
// Incident: a presentation slower than the CPU lane queue answered 503 twice
// in a row and the player was left on the error screen for a loaded server.
it('keeps retrying a saturated V2 server with a capped back-off, behind the loading screen', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=saturated' });
  const { initialVillageRead, RECONNECT_BACKOFF_MS, SyncV2HttpError } = await load();
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
  const steps = [...RECONNECT_BACKOFF_MS, RECONNECT_BACKOFF_MS.at(-1)!];
  for (const [index, step] of steps.entries()) {
    await vi.advanceTimersByTimeAsync(step - 1);
    expect(v2.read, `attempt ${index + 1}`).toHaveBeenCalledTimes(index + 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(await read).toBe(snapshot);
  expect(v2.read).toHaveBeenCalledTimes(steps.length + 1);
});
it('lengthens a step for a longer Retry-After, then a later missing village still stops the sequence', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=older' });
  const { initialVillageRead, SyncV2HttpError } = await load();
  v2.read
    .mockRejectedValueOnce(new SyncV2HttpError(503, 'NAVIGATION_BUSY', 'Occupé.', 1500))
    .mockRejectedValueOnce(new SyncV2HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable dans ce monde.'));
  const outcome = initialVillageRead().then(
    () => 'resolved',
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(1499);
  expect(v2.read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await outcome).toMatchObject({ status: 404 });
  expect(v2.read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(120000);
  expect(v2.read).toHaveBeenCalledTimes(2);
});
it('ends a session that expires after some retries on the session error, not on a retry', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=lapsed' });
  const { initialVillageRead, SyncV2HttpError, SyncV2SessionExpired } = await load();
  v2.read
    .mockRejectedValueOnce(new SyncV2HttpError(503, 'INTERNAL_ERROR', 'Indisponible.', 0))
    .mockRejectedValueOnce(new SyncV2SessionExpired());
  const outcome = initialVillageRead().then(
    () => 'resolved',
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(await outcome).toBeInstanceOf(SyncV2SessionExpired);
  await vi.advanceTimersByTimeAsync(120000);
  expect(v2.read).toHaveBeenCalledTimes(2);
});
it('gives up on the connection screen only after the attempt bound, with the last error', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=down' });
  const { initialVillageRead, INITIAL_READ_ATTEMPTS, SyncV2HttpError } = await load();
  v2.read.mockRejectedValue(new SyncV2HttpError(503, 'INTERNAL_ERROR', 'Indisponible.', 0));
  const outcome = initialVillageRead().then(
    () => 'resolved',
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(30000 * INITIAL_READ_ATTEMPTS);
  expect(v2.read).toHaveBeenCalledTimes(INITIAL_READ_ATTEMPTS);
  expect(await outcome).toBeInstanceOf(SyncV2HttpError);
  await vi.advanceTimersByTimeAsync(120000);
  expect(v2.read).toHaveBeenCalledTimes(INITIAL_READ_ATTEMPTS);
});
it('retries once on demand after the sequence gave up, and later callers share that attempt', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { href: 'http://localhost/village?world=again' });
  const { initialVillageRead, retryInitialVillageRead, INITIAL_READ_ATTEMPTS, SyncV2HttpError } = await load();
  const busy = () => new SyncV2HttpError(503, 'INTERNAL_ERROR', 'Indisponible.', 0);
  v2.read.mockRejectedValue(busy());
  const gaveUp = initialVillageRead().then(
    () => 'resolved',
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(30000 * INITIAL_READ_ATTEMPTS);
  expect(await gaveUp).toBeInstanceOf(SyncV2HttpError);
  expect(v2.read).toHaveBeenCalledTimes(INITIAL_READ_ATTEMPTS);
  // One attempt and no wait of its own: the screen schedules the next one.
  const single = retryInitialVillageRead().then(
    () => 'resolved',
    (error: unknown) => error,
  );
  expect(await single).toBeInstanceOf(SyncV2HttpError);
  expect(v2.read).toHaveBeenCalledTimes(INITIAL_READ_ATTEMPTS + 1);
  await vi.advanceTimersByTimeAsync(120000);
  expect(v2.read).toHaveBeenCalledTimes(INITIAL_READ_ATTEMPTS + 1);
  // The server is back: the next attempt resolves, and App's own call shares it.
  v2.read.mockResolvedValueOnce(snapshot);
  const recovered = retryInitialVillageRead();
  expect(initialVillageRead()).toBe(recovered);
  expect(await recovered).toBe(snapshot);
  expect(v2.read).toHaveBeenCalledTimes(INITIAL_READ_ATTEMPTS + 2);
});
it('keeps a missing session or village final for the on-demand retry too', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/village?world=final' });
  const { retryInitialVillageRead, SyncV2HttpError, SyncV2SessionExpired } = await load();
  v2.read.mockRejectedValueOnce(new SyncV2SessionExpired());
  await expect(retryInitialVillageRead()).rejects.toBeInstanceOf(SyncV2SessionExpired);
  v2.read.mockRejectedValueOnce(new SyncV2HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable dans ce monde.'));
  await expect(retryInitialVillageRead()).rejects.toMatchObject({ status: 404 });
  expect(v2.read).toHaveBeenCalledTimes(2);
});
