import { afterEach, expect, it, vi } from 'vitest';
import { watchOfferIndex, type VisibilitySource } from './market-offers';

afterEach(() => vi.useRealTimers());

function fakePage(initial = 'visible') {
  let visibility = initial;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_type: 'visibilitychange', listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: 'visibilitychange', listener: () => void) => void listeners.delete(listener),
    show() {
      visibility = 'visible';
      notify();
    },
    hide() {
      visibility = 'hidden';
      notify();
    },
    listeners,
  } satisfies VisibilitySource & { show(): void; hide(): void; listeners: Set<() => void> };
}
/** A read the test settles by hand. */
function reads() {
  const started: Array<{ signal: AbortSignal; done: () => void; fail: () => void }> = [];
  const read = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      started.push({ signal, done: resolve, fail: () => reject(new Error('Marché indisponible.')) });
    });
  return { started, read };
}

it('rereads the list when the offer index revision moves, never on a timer', async () => {
  vi.useFakeTimers();
  const page = fakePage(),
    readAt = { current: 'e:1' as string | null },
    { started, read } = reads();
  // Mounted on the revision the list was just read at: nothing to read, however long it stays open.
  let stop = watchOfferIndex({ indexRevision: 'e:1', readAt, page, read });
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(started).toHaveLength(0);
  stop();
  // The index moved: exactly one read, and it records the revision it started from.
  stop = watchOfferIndex({ indexRevision: 'e:2', readAt, page, read });
  expect(started).toHaveLength(1);
  expect(readAt.current).toBe('e:2');
  started[0]!.done();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(started).toHaveLength(1);
  stop();
  // The same revision again (another render) reads nothing.
  stop = watchOfferIndex({ indexRevision: 'e:2', readAt, page, read });
  expect(started).toHaveLength(1);
  stop();
});

it('aborts the read in flight when a newer revision restarts the watch, and reads only the newest', () => {
  const page = fakePage(),
    readAt = { current: 'e:1' as string | null },
    { started, read } = reads();
  const first = watchOfferIndex({ indexRevision: 'e:2', readAt, page, read });
  expect(started).toHaveLength(1);
  first();
  expect(started[0]!.signal.aborted).toBe(true);
  const second = watchOfferIndex({ indexRevision: 'e:3', readAt, page, read });
  expect(started).toHaveLength(2);
  expect(started[1]!.signal.aborted).toBe(false);
  expect(readAt.current).toBe('e:3');
  second();
  expect(started[1]!.signal.aborted).toBe(true);
  expect(page.listeners.size).toBe(0);
});

it('does not read a hidden page, then reads once when it becomes visible again', () => {
  const page = fakePage('hidden'),
    readAt = { current: 'e:1' as string | null },
    { started, read } = reads();
  const stop = watchOfferIndex({ indexRevision: 'e:2', readAt, page, read });
  expect(started).toHaveLength(0);
  expect(readAt.current).toBe('e:1');
  page.show();
  expect(started).toHaveLength(1);
  expect(readAt.current).toBe('e:2');
  // Becoming hidden reads nothing; one read at a time while the first is in flight.
  page.hide();
  page.show();
  expect(started).toHaveLength(1);
  started[0]!.done();
  stop();
});

it('rereads on every return to the page, even without a change (a hidden tab may have lost its stream)', async () => {
  const page = fakePage(),
    readAt = { current: 'e:2' as string | null },
    { started, read } = reads();
  const stop = watchOfferIndex({ indexRevision: 'e:2', readAt, page, read });
  expect(started).toHaveLength(0);
  page.hide();
  page.show();
  expect(started).toHaveLength(1);
  started[0]!.done();
  await Promise.resolve();
  await Promise.resolve();
  page.hide();
  page.show();
  expect(started).toHaveLength(2);
  started[1]!.done();
  stop();
});

it('keeps quiet when a read fails, and reads again on the next change', async () => {
  const page = fakePage(),
    readAt = { current: 'e:1' as string | null },
    { started, read } = reads();
  let stop = watchOfferIndex({ indexRevision: 'e:2', readAt, page, read });
  started[0]!.fail();
  await Promise.resolve();
  await Promise.resolve();
  stop();
  stop = watchOfferIndex({ indexRevision: 'e:3', readAt, page, read });
  expect(started).toHaveLength(2);
  stop();
});

it('has no revision to follow before the offer stream is loaded', () => {
  const page = fakePage(),
    readAt = { current: null as string | null },
    { started, read } = reads();
  const stop = watchOfferIndex({ indexRevision: null, readAt, page, read });
  expect(started).toHaveLength(0);
  stop();
});
