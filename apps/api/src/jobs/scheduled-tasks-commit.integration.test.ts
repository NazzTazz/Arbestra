import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql, type Transaction } from 'kysely';
import { createDatabase } from '../database/connection.js';
import { migrateToLatest } from '../database/migrate.js';
import { testDatabaseUrl } from '../database/test-environment.js';
import type { Database } from '../database/schema.js';
import { processNextScheduledTask, TASK_BUSY_RETRY_MS } from './scheduled-tasks.js';

// Counter-review of R1 (docs/VERROUS-2026-11-04.md §11.6, point 1): a task's
// V2 publication runs at COMMIT (deferred trigger of 053), after the handler's
// savepoint. A stream row held elsewhere makes the COMMIT time out: the task
// gives way (busy-rescheduled) instead of failing its pass with a raw 55P03.

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected scheduler commit test database');
const db = createDatabase(url),
  accountId = randomUUID(),
  worldId = randomUUID(),
  villageId = randomUUID(),
  taskType = 'commit-fixture-' + randomUUID();

const bounded = <T>(promise: Promise<T>, ms = 20_000) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(Error('barrier timeout')), ms))]);
const wood = async () =>
  Number(
    (
      await db
        .selectFrom('villageResources')
        .select('amount')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('resourceCode', '=', 'wood')
        .executeTakeFirstOrThrow()
    ).amount,
  );

beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@commit.test', passwordHash: 'fixture' })
    .execute();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('worlds')
      .values({
        id: worldId,
        slug: 'commit-' + worldId,
        name: 'Commit test',
        topology: 'torus',
        widthCells: 512,
        heightCells: 256,
        chunkSize: 32,
        seed: 4111,
        generationVersion: 1,
        generationStatus: 'ready',
        isOpen: true,
        generatedAt: new Date(),
      })
      .execute();
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Commit' }).execute();
    await tx
      .insertInto('villages')
      .values({
        id: villageId,
        worldId,
        ownerAccountId: accountId,
        name: 'Commit',
        anchorCellX: 64,
        anchorCellY: 64,
        economyActivatedAt: new Date(),
      })
      .execute();
    await tx.insertInto('villageResources').values({ worldId, villageId, resourceCode: 'wood', amount: 100 }).execute();
  });
}, 120_000);
afterAll(async () => {
  await db.deleteFrom('scheduledTasks').where('taskType', '=', taskType).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
}, 60_000);

it('reschedules a task whose COMMIT waits beyond its lock delay for a held V2 stream, then completes it', async () => {
  // The fixture's own publication created the village streams.
  expect(
    (await sql<{ n: number }>`select count(*)::int as n from game_sync_streams where world_id = ${worldId}`.execute(db))
      .rows[0]!.n,
  ).toBeGreaterThan(0);
  const task = await db
    .insertInto('scheduledTasks')
    .values({
      worldId,
      taskType,
      subjectId: randomUUID(),
      payload: {},
      // First in the queue order (available_at, id).
      dueAt: new Date(0),
      availableAt: new Date(0),
      attempts: 0,
      lastError: null,
      completedAt: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  let handled = 0;
  let handlerDone!: () => void;
  const handlerFinished = new Promise<void>((resolve) => (handlerDone = resolve));
  const handlers = {
    [taskType]: async (tx: Transaction<Database>) => {
      // A synchronized write: published at COMMIT.
      await tx
        .updateTable('villageResources')
        .set({ amount: sql`amount + 7` })
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('resourceCode', '=', 'wood')
        .execute();
      handled++;
      handlerDone();
    },
  };
  // A: holds the world's stream rows (as the journal retention may).
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let ready!: (pid: number) => void;
  const holding = new Promise<number>((resolve) => (ready = resolve));
  const holder = db.transaction().execute(async (tx) => {
    const pid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid;
    await sql`select 1 from game_sync_streams where world_id = ${worldId} for update`.execute(tx);
    ready(pid);
    await bounded(released);
  });
  void holder.catch(() => undefined);
  let worker: ReturnType<typeof processNextScheduledTask> | undefined;
  try {
    const holderPid = await bounded(holding);
    // B: its handler finishes, then its COMMIT waits for A (observed).
    worker = processNextScheduledTask(db, handlers, 60_000);
    void worker.catch(() => undefined);
    await bounded(handlerFinished);
    let waiting: { waitType: string } | undefined;
    for (const deadline = Date.now() + 1_400; !waiting && Date.now() < deadline; ) {
      waiting = (
        await sql<{ waitType: string; query: string }>`
          select wait_event_type as "waitType", query from pg_stat_activity
          where ${holderPid} = any(pg_blocking_pids(pid))`.execute(db)
      ).rows[0];
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting?.waitType).toBe('Lock');
    // B gives way while A still holds the streams.
    const result = await bounded(worker);
    expect(result).toEqual({ taskId: task.id, outcome: 'busy-rescheduled' });
    const saved = await db.selectFrom('scheduledTasks').selectAll().where('id', '=', task.id).executeTakeFirstOrThrow();
    const now = (await sql<{ at: Date }>`select clock_timestamp() as at`.execute(db)).rows[0]!.at;
    expect(saved.completedAt).toBeNull();
    expect(saved.attempts).toBe(0);
    expect(saved.lastError).toBeNull();
    expect(saved.dueAt).toEqual(task.dueAt);
    expect(saved.availableAt.getTime()).toBeGreaterThan(new Date(0).getTime());
    expect(saved.availableAt.getTime() - now.getTime()).toBeLessThanOrEqual(TASK_BUSY_RETRY_MS);
    // Nothing of the handler was kept.
    expect(await wood()).toBe(100);
    release();
    await bounded(holder);
    // Once the streams are free it completes. The shared test queue may hold
    // other due tasks: put this one first again, its short delay checked above.
    await db
      .updateTable('scheduledTasks')
      .set({ availableAt: new Date(0) })
      .where('id', '=', task.id)
      .execute();
    expect(await processNextScheduledTask(db, handlers, 60_000)).toEqual({ taskId: task.id, outcome: 'completed' });
    expect(await wood()).toBe(107);
    expect(handled).toBe(2);
  } finally {
    release();
    await Promise.allSettled([holder, worker]);
  }
}, 60_000);
