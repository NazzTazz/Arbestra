import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createDatabase } from '../database/connection.js';
import { testDatabaseUrl } from '../database/test-environment.js';
import type { Database } from '../database/schema.js';
import type { SlowTaskLine } from '../modules/operations/scheduler-timing.js';
import { startScheduledTaskWorker, type ScheduledWorkerObservation } from './scheduled-tasks.js';

// Independent passes: a pass held by a long task never keeps the others from
// taking a task due meanwhile, and stopping waits for the task in progress
// without starting another. Private schema, as in the busy-village tests.

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected scheduler test database');
const root = createDatabase(url),
  schema = 'scheduler_passes_' + randomUUID().replaceAll('-', '');
let db: Kysely<Database>;
beforeAll(async () => {
  await sql`create schema ${sql.id(schema)}`.execute(root);
  await sql`create table ${sql.id(schema, 'scheduled_tasks')} (like public.scheduled_tasks including all)`.execute(
    root,
  );
  db = root.withSchema(schema);
});
beforeEach(async () => {
  await db.deleteFrom('scheduledTasks').execute();
});
afterAll(async () => {
  await sql`drop schema ${sql.id(schema)} cascade`.execute(root);
  await root.destroy();
});

const POLL_MS = 250;
const bounded = <T>(promise: Promise<T>, ms = 20_000) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => (timer = setTimeout(() => reject(Error('barrier timeout')), ms))),
  ]).finally(() => clearTimeout(timer));
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
const add = (type: string) =>
  db
    .insertInto('scheduledTasks')
    .values({
      worldId: randomUUID(),
      taskType: type,
      subjectId: randomUUID(),
      payload: {},
      dueAt: new Date(0),
      availableAt: new Date(0),
      attempts: 0,
      lastError: null,
      completedAt: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
const completedAt = async (id: string) =>
  (await db.selectFrom('scheduledTasks').select('completedAt').where('id', '=', id).executeTakeFirstOrThrow())
    .completedAt;

it('lets a free pass take a task due while another pass is held by a long task', async () => {
  const long = await add('long');
  const entered = gate(),
    barrier = gate(),
    quickDone = gate();
  let longReturned = false;
  const events: ScheduledWorkerObservation[] = [];
  let stop: (() => Promise<void>) | undefined;
  try {
    stop = startScheduledTaskWorker(
      db,
      {
        long: async () => {
          entered.release();
          await bounded(barrier.promise);
          longReturned = true;
        },
        quick: async () => undefined,
      },
      POLL_MS,
      () => undefined,
      (event) => {
        events.push(event);
        // The long task is held: the first completion is the quick one.
        if (event.kind === 'processed' && event.outcome === 'completed') quickDone.release();
      },
      { passes: 3 },
    );
    await bounded(entered.promise);
    // The other passes have looked once and found nothing due.
    await pause(POLL_MS + 50);
    const quick = await add('quick');
    const inserted = Date.now();
    await bounded(quickDone.promise, 500);
    const elapsed = Date.now() - inserted;
    expect(elapsed).toBeLessThan(500);
    expect(await completedAt(quick.id)).not.toBeNull();
    // ...while the first pass is still in its handler, its task not finalised.
    expect(longReturned).toBe(false);
    expect(await completedAt(long.id)).toBeNull();
    barrier.release();
    await bounded(stop());
    stop = undefined;
    expect(await completedAt(long.id)).not.toBeNull();
    expect(events.filter((e) => e.kind === 'processed')).toEqual([
      { kind: 'processed', outcome: 'completed' },
      { kind: 'processed', outcome: 'completed' },
    ]);
  } finally {
    barrier.release();
    await Promise.allSettled([stop?.()]);
  }
}, 30_000);

it('stops after the task in progress and starts nothing more', async () => {
  const long = await add('long');
  const entered = gate(),
    barrier = gate();
  let lateCalls = 0,
    stoppedAt = 0;
  let stopping: Promise<void> | undefined;
  try {
    const stop = startScheduledTaskWorker(
      db,
      {
        long: async () => {
          entered.release();
          await bounded(barrier.promise);
        },
        late: async () => {
          lateCalls++;
        },
      },
      POLL_MS,
      () => undefined,
      undefined,
      { passes: 2 },
    );
    await bounded(entered.promise);
    stopping = stop().then(() => {
      stoppedAt = Date.now();
    });
    // Stop waits for the pass in its handler...
    await pause(POLL_MS + 50);
    expect(stoppedAt).toBe(0);
    // ...and a task due meanwhile is left to the next process.
    const late = await add('late');
    barrier.release();
    await bounded(stopping);
    expect(stoppedAt).toBeGreaterThan(0);
    expect(await completedAt(long.id)).not.toBeNull();
    await pause(POLL_MS * 3);
    expect(lateCalls).toBe(0);
    expect(await completedAt(late.id)).toBeNull();
  } finally {
    barrier.release();
    await Promise.allSettled([stopping]);
  }
}, 30_000);

it('writes one phase line for a task slower than 1 s, none for a fast one', async () => {
  const slow = await add('slow'),
    fast = await add('fast');
  const lines: SlowTaskLine[] = [];
  let completed = 0;
  const done = gate();
  const stop = startScheduledTaskWorker(
    db,
    {
      slow: async (tx) => {
        await sql`select pg_sleep(1.1)`.execute(tx);
      },
      fast: async (tx) => {
        await sql`select 1`.execute(tx);
      },
    },
    POLL_MS,
    () => undefined,
    (event) => {
      if (event.kind === 'processed' && event.outcome === 'completed' && ++completed === 2) done.release();
    },
    { passes: 2, onSlowTask: (line) => lines.push(line) },
  );
  try {
    await bounded(done.promise);
  } finally {
    await stop();
  }
  expect(lines).toHaveLength(1);
  const [line] = lines;
  expect(line).toMatchObject({
    event: 'scheduler.slow-task',
    taskType: 'slow',
    taskId: slow.id,
    worldId: slow.worldId,
    subjectId: slow.subjectId,
    outcome: 'completed',
    attempts: 0,
  });
  expect(line!.durationMs).toBeGreaterThan(1_000);
  expect(line!.sqlMs).toBeGreaterThan(1_000);
  // Selection, lock delay, savepoints, the handler's statement, finalisation.
  expect(line!.sqlCalls).toBeGreaterThanOrEqual(5);
  expect(line!.slowestSql[0]).toMatchObject({ label: 'pg_sleep():select' });
  expect(line!.lateMs).toBeGreaterThan(0);
  expect(lines.some((l) => l.taskId === fast.id)).toBe(false);
}, 30_000);
