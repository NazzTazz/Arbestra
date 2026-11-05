import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql, type Kysely, type Transaction } from 'kysely';
import { createDatabase } from '../database/connection.js';
import { testDatabaseUrl } from '../database/test-environment.js';
import type { Database } from '../database/schema.js';
import {
  processNextScheduledTask,
  startScheduledTaskWorker,
  type ScheduledTask,
  type ScheduledWorkerObservation,
} from './scheduled-tasks.js';

// R1 (docs/VERROUS-2026-11-04.md §11): a task waiting for a held village gives
// way after its lock delay, without an error backoff, and never holds back the
// other passes. The village row is a row of a fixture `villages` table in a
// private schema, locked like beginVillageEconomy locks its village.

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected scheduler test database');
const root = createDatabase(url),
  schema = 'scheduler_busy_' + randomUUID().replaceAll('-', '');
let db: Kysely<Database>;
const village = randomUUID();
beforeAll(async () => {
  await sql`create schema ${sql.id(schema)}`.execute(root);
  await sql`create table ${sql.id(schema, 'scheduled_tasks')} (like public.scheduled_tasks including all)`.execute(
    root,
  );
  await sql`create table ${sql.id(schema, 'villages')} (world_id uuid not null, id uuid primary key)`.execute(root);
  db = root.withSchema(schema);
  await sql`insert into ${sql.id(schema, 'villages')} values (${randomUUID()}, ${village})`.execute(root);
});
beforeEach(async () => {
  await db.deleteFrom('scheduledTasks').execute();
});
afterAll(async () => {
  await sql`drop schema ${sql.id(schema)} cascade`.execute(root);
  await root.destroy();
});

const bounded = <T>(promise: Promise<T>, ms = 20_000) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(Error('barrier timeout')), ms))]);
const add = async (type: string, availableAt = new Date(0)) =>
  db
    .insertInto('scheduledTasks')
    .values({
      worldId: randomUUID(),
      taskType: type,
      subjectId: randomUUID(),
      payload: {},
      dueAt: new Date(0),
      availableAt,
      attempts: 0,
      lastError: null,
      completedAt: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
const lockVillage = (tx: Transaction<Database>) =>
  sql`select id from ${sql.id(schema, 'villages')} where id = ${village} for update`.execute(tx);
const pid = async (tx: Kysely<Database>) =>
  (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid;

/** The backend blocked by `holder`, observed in pg_stat_activity. */
async function waitingOn(holder: number, deadlineMs = 4_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const row = await sql<{ pid: number; waitType: string }>`
      select pid, wait_event_type as "waitType" from pg_stat_activity
      where ${holder} = any(pg_blocking_pids(pid))`.execute(root);
    if (row.rows[0]) return row.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

/** A command holding the village until `release()`. */
function holdVillage() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let ready!: (pid: number) => void;
  const holding = new Promise<number>((resolve) => (ready = resolve));
  const done = root.transaction().execute(async (tx) => {
    const holder = await pid(tx);
    await lockVillage(tx);
    ready(holder);
    await bounded(released);
  });
  void done.catch(() => undefined);
  return { holding, release, done };
}

it('lets a second pass complete a task while the first waits for a held village, then reschedules the first without an error backoff', async () => {
  const blocked = await add('village', new Date(0)),
    healthy = await add('healthy', new Date(1));
  const command = holdVillage();
  const events: ScheduledWorkerObservation[] = [];
  let healthyDone!: () => void;
  const healthyCompleted = new Promise<void>((resolve) => (healthyDone = resolve));
  let waiterPid = 0;
  const handlers = {
    village: async (tx: Transaction<Database>) => {
      waiterPid = await pid(tx);
      await lockVillage(tx);
    },
    healthy: async () => {},
  };
  let stop: (() => Promise<void>) | undefined;
  try {
    const holder = await bounded(command.holding);
    stop = startScheduledTaskWorker(
      db,
      handlers,
      60_000,
      () => undefined,
      (event) => {
        events.push(event);
        if (event.kind === 'processed' && event.outcome === 'completed') healthyDone();
      },
      { passes: 2 },
    );
    // The first pass waits for the village (observed), the second completes
    // the healthy task meanwhile: the village is still held.
    const waiting = await waitingOn(holder);
    expect(waiting?.waitType).toBe('Lock');
    await bounded(healthyCompleted, 1_400);
    expect(
      (
        await db
          .selectFrom('scheduledTasks')
          .select('completedAt')
          .where('id', '=', healthy.id)
          .executeTakeFirstOrThrow()
      ).completedAt,
    ).not.toBeNull();
    expect((await waitingOn(holder, 100))?.pid).toBe(waiterPid);
    // Then the first gives way after its lock delay, the village still held.
    await bounded(stop());
    stop = undefined;
    expect(events).toContainEqual({ kind: 'processed', outcome: 'busy-rescheduled' });
    expect(events).not.toContainEqual({ kind: 'processed', outcome: 'retry-scheduled' });
    const saved = await db
      .selectFrom('scheduledTasks')
      .selectAll()
      .where('id', '=', blocked.id)
      .executeTakeFirstOrThrow();
    const now = (await sql<{ at: Date }>`select clock_timestamp() as at`.execute(root)).rows[0]!.at;
    expect(saved.completedAt).toBeNull();
    expect(saved.attempts).toBe(0);
    expect(saved.lastError).toBeNull();
    expect(saved.dueAt).toEqual(blocked.dueAt);
    // A short, fixed retry, not the error backoff (1 s × 2^attempts).
    expect(saved.availableAt.getTime() - now.getTime()).toBeLessThanOrEqual(1_000);
    command.release();
    await bounded(command.done);
    // Not before its short delay; then it completes once the village is free.
    expect(await processNextScheduledTask(db, handlers)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, saved.availableAt.getTime() - Date.now() + 50)));
    expect(await processNextScheduledTask(db, handlers)).toEqual({ taskId: blocked.id, outcome: 'completed' });
  } finally {
    command.release();
    await Promise.allSettled([command.done, stop?.()]);
  }
}, 60_000);

it('counts a real failure as before, even after a busy retry', async () => {
  const task = await add('village');
  const command = holdVillage();
  try {
    await bounded(command.holding);
    expect(
      await processNextScheduledTask(db, {
        village: async (tx) => {
          await lockVillage(tx);
        },
      }),
    ).toEqual({
      taskId: task.id,
      outcome: 'busy-rescheduled',
    });
  } finally {
    command.release();
    await Promise.allSettled([command.done]);
  }
  await db
    .updateTable('scheduledTasks')
    .set({ availableAt: new Date(0) })
    .where('id', '=', task.id)
    .execute();
  const failure = Error('identified handler failure');
  expect(
    await processNextScheduledTask(
      db,
      {
        village: async () => {
          throw failure;
        },
      },
      1_000,
    ),
  ).toEqual({ taskId: task.id, outcome: 'retry-scheduled' });
  const saved = await db.selectFrom('scheduledTasks').selectAll().where('id', '=', task.id).executeTakeFirstOrThrow();
  expect(saved.attempts).toBe(1);
  expect(saved.lastError).toBe(failure.message);
}, 30_000);

it('never lets two passes handle the same task', async () => {
  const tasks = await Promise.all(Array.from({ length: 24 }, () => add('slow')));
  const seen: string[] = [];
  let inFlight = 0,
    maxInFlight = 0,
    completed = 0;
  let all!: () => void;
  const finished = new Promise<void>((resolve) => (all = resolve));
  const stop = startScheduledTaskWorker(
    db,
    {
      slow: async (tx: Transaction<Database>, task: ScheduledTask) => {
        seen.push(task.id);
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await sql`select pg_sleep(0.05)`.execute(tx);
        inFlight--;
      },
    },
    60_000,
    () => undefined,
    (event) => {
      if (event.kind === 'processed' && event.outcome === 'completed' && ++completed === tasks.length) all();
    },
    { passes: 3 },
  );
  try {
    await bounded(finished);
  } finally {
    await stop();
  }
  expect(seen).toHaveLength(tasks.length);
  expect(new Set(seen).size).toBe(tasks.length);
  expect(maxInFlight).toBeGreaterThan(1);
  expect(maxInFlight).toBeLessThanOrEqual(3);
  expect(await db.selectFrom('scheduledTasks').select('id').where('completedAt', 'is', null).execute()).toEqual([]);
}, 60_000);
