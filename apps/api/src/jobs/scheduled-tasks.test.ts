import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Database } from '../database/schema.js';
import { startScheduledTaskWorker, type ScheduledWorkerObservation } from './scheduled-tasks.js';

// The pass loop without PostgreSQL: a fake database whose transaction returns
// what the test queues (a processed task, nothing due) or fails. Task
// selection and finalisation are covered by the integration tests.

type Step = 'task' | 'none' | 'fail';
function fakeDb(next: () => Step) {
  let calls = 0;
  const db = {
    transaction: () => ({
      execute: async () => {
        calls++;
        const step = next();
        if (step === 'fail') throw Error('connection lost');
        return step === 'task' ? { taskId: String(calls), outcome: 'completed' } : null;
      },
    }),
  } as unknown as Kysely<Database>;
  return { db, calls: () => calls };
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(Error('barrier timeout')), ms))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function until(check: () => boolean, ms = 4_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw Error('condition timeout');
    await pause(5);
  }
}

describe('scheduler passes', () => {
  it('looks for the next task at once after a processed one, then sleeps', async () => {
    let queued = 5;
    const fake = fakeDb(() => (queued-- > 0 ? 'task' : 'none'));
    const events: ScheduledWorkerObservation[] = [];
    const stop = startScheduledTaskWorker(fake.db, {}, 60_000, () => undefined, (e) => events.push(e), {
      passes: 1,
    });
    try {
      // Five tasks and the empty look that follows, far within one interval.
      await until(() => fake.calls() === 6, 1_000);
      await pause(50);
      expect(fake.calls()).toBe(6);
      expect(events.filter((e) => e.kind === 'processed')).toHaveLength(5);
      expect(events.at(-1)).toEqual({ kind: 'idle' });
    } finally {
      await stop();
    }
  });

  it('never spins: an idle pass looks once per interval', async () => {
    const fake = fakeDb(() => 'none');
    const stop = startScheduledTaskWorker(fake.db, {}, 50, () => undefined, undefined, { passes: 2 });
    await pause(320);
    await stop();
    // Two passes, about seven looks each in 320 ms; a busy loop would make thousands.
    expect(fake.calls()).toBeGreaterThanOrEqual(4);
    expect(fake.calls()).toBeLessThanOrEqual(2 * (320 / 50 + 2));
  });

  it('keeps every pass running after errors, and reports each one', async () => {
    const fake = fakeDb(() => 'fail');
    const errors: unknown[] = [];
    const events: ScheduledWorkerObservation[] = [];
    const stop = startScheduledTaskWorker(
      fake.db,
      {},
      10,
      (error) => {
        errors.push(error);
        throw Error('reporter failure');
      },
      (e) => events.push(e),
      { passes: 2 },
    );
    try {
      await until(() => errors.length >= 6);
      expect(errors.every((e) => e instanceof Error && e.message === 'connection lost')).toBe(true);
      expect(events.filter((e) => e.kind === 'error').length).toBeGreaterThanOrEqual(6);
      expect(events).not.toContainEqual({ kind: 'idle' });
    } finally {
      await stop();
    }
    const after = fake.calls();
    await pause(60);
    expect(fake.calls()).toBe(after);
  });

  it('stop wakes sleeping passes at once, then nothing runs', async () => {
    const fake = fakeDb(() => 'none');
    const events: ScheduledWorkerObservation[] = [];
    const stop = startScheduledTaskWorker(fake.db, {}, 60_000, () => undefined, (e) => events.push(e), {
      passes: 3,
    });
    await until(() => fake.calls() === 3);
    await within(stop(), 500);
    expect(events.at(-1)).toEqual({ kind: 'stopped' });
    await pause(50);
    expect(fake.calls()).toBe(3);
  });
});
