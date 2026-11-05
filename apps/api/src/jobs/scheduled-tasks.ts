import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';

import type { Database, ScheduledTasksTable } from '../database/schema.js';
import { isLockTimeout } from '../errors.js';
import { spatialSavepoint, withSpatialRetry } from '../modules/worlds/spatial-locks.js';

export type ScheduledTask = Selectable<ScheduledTasksTable>;
export type ScheduledTaskHandler = (transaction: Transaction<Database>, task: ScheduledTask) => Promise<void>;
export type ScheduledTaskHandlers = Readonly<Record<string, ScheduledTaskHandler>>;

/**
 * Lock wait bound of a task (R1, docs/VERROUS-2026-11-04.md §11.2): a task
 * that meets a village or a zone held by a command gives way instead of
 * holding its pass and its connection. A handler may set its own afterwards.
 */
export const TASK_LOCK_TIMEOUT_MS = 1_500;
/** Retry of a task that gave way: fixed and short, neither an attempt nor an
 * error. Its state decides what is due, and the command holding the village
 * reconciles that village meanwhile. */
export const TASK_BUSY_RETRY_MS = 1_000;
/** Concurrent passes of the worker; `SKIP LOCKED` gives each its own task. */
export const SCHEDULER_PASSES = 3;

export interface ProcessScheduledTaskResult {
  taskId: string;
  outcome: 'completed' | 'retry-scheduled' | 'busy-rescheduled';
}

export type ScheduledWorkerObservation =
  | { kind: 'poll' | 'idle' | 'error' | 'stopped' }
  | { kind: 'processed'; outcome: ProcessScheduledTaskResult['outcome'] };
type Observer = (event: ScheduledWorkerObservation) => void;
function observe(observer: Observer | undefined, event: ScheduledWorkerObservation): void {
  try {
    observer?.(event);
  } catch {
    /* Monitoring must never change task handling. */
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}

export async function processNextScheduledTask(
  db: Kysely<Database>,
  handlers: ScheduledTaskHandlers,
  retryDelayMs = 1_000,
): Promise<ProcessScheduledTaskResult | null> {
  let taken: string | undefined;
  try {
    return await processInTransaction(db, handlers, retryDelayMs, (id) => (taken = id));
  } catch (error) {
    // A lock wait can also time out at COMMIT: the deferred V2 publication
    // (game_sync_assert_published, 053) updates the stream rows there, after
    // the handler's savepoint. The whole transaction rolled back; a task was
    // taken, so it gives way like a handler that met a held village.
    if (!taken || !isLockTimeout(error)) throw error;
    await rescheduleBusy(db, taken);
    return { taskId: taken, outcome: 'busy-rescheduled' };
  }
}

/** Short and separate: the task row only, skipped if another pass took it
 * meanwhile or it was completed. Never an attempt nor an error. */
async function rescheduleBusy(db: Kysely<Database>, taskId: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await sql`select set_config('lock_timeout', ${`${TASK_LOCK_TIMEOUT_MS}ms`}, true)`.execute(tx);
    await tx
      .updateTable('scheduledTasks')
      .set({ availableAt: sql`statement_timestamp() + (${TASK_BUSY_RETRY_MS} * interval '1 millisecond')` })
      .where('id', '=', (eb) =>
        eb
          .selectFrom('scheduledTasks')
          .select('id')
          .where('id', '=', taskId)
          .where('completedAt', 'is', null)
          .forUpdate()
          .skipLocked(),
      )
      .execute();
  });
}

function processInTransaction(
  db: Kysely<Database>,
  handlers: ScheduledTaskHandlers,
  retryDelayMs: number,
  took: (taskId: string) => void,
): Promise<ProcessScheduledTaskResult | null> {
  return db.transaction().execute(async (transaction) => {
    const task = await transaction
      .selectFrom('scheduledTasks')
      .selectAll()
      .where('completedAt', 'is', null)
      .where('dueAt', '<=', sql<Date>`transaction_timestamp()`)
      .where('availableAt', '<=', sql<Date>`transaction_timestamp()`)
      .orderBy('availableAt')
      .orderBy('id')
      .limit(1)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();

    if (!task) return null;
    took(task.id);
    await sql`select set_config('lock_timeout', ${`${TASK_LOCK_TIMEOUT_MS}ms`}, true)`.execute(transaction);

    const handler = handlers[task.taskType];
    // A handler that finds a trip outside its zones is rolled back to the
    // savepoint and replayed once with them, still under the task row; a
    // second miss is an ordinary failure, rescheduled below.
    const restoreSpatial = spatialSavepoint(transaction);
    try {
      await withSpatialRetry(async () => {
        await sql`savepoint scheduled_task_handler`.execute(transaction);
        try {
          if (!handler) throw new Error(`No handler registered for scheduled task type: ${task.taskType}`);
          await handler(transaction, task);
          await sql`release savepoint scheduled_task_handler`.execute(transaction);
        } catch (error) {
          await sql`rollback to savepoint scheduled_task_handler`.execute(transaction);
          // PostgreSQL released the zones taken by the handler: so does the cache.
          restoreSpatial();
          await sql`release savepoint scheduled_task_handler`.execute(transaction);
          throw error;
        }
      });
    } catch (error) {
      // A held lock is not a failure: no attempt, no error, no backoff (the
      // savepoint released whatever the handler had taken).
      if (isLockTimeout(error)) {
        await transaction
          .updateTable('scheduledTasks')
          .set({ availableAt: sql`statement_timestamp() + (${TASK_BUSY_RETRY_MS} * interval '1 millisecond')` })
          .where('id', '=', task.id)
          .executeTakeFirstOrThrow();
        return { taskId: task.id, outcome: 'busy-rescheduled' };
      }
      // An expensive failure must leave a real cooldown after it finishes.
      // Persistent failures back off up to five minutes; their intentions and
      // original deadlines stay intact, and healthy tasks remain eligible.
      const delayMs = Math.min(300_000, retryDelayMs * 2 ** Math.min(task.attempts, 20));
      await transaction
        .updateTable('scheduledTasks')
        .set({
          attempts: sql`attempts + 1`,
          lastError: errorMessage(error),
          availableAt: sql`statement_timestamp() + (${delayMs} * interval '1 millisecond')`,
        })
        .where('id', '=', task.id)
        .executeTakeFirstOrThrow();
      return { taskId: task.id, outcome: 'retry-scheduled' };
    }

    await transaction
      .updateTable('scheduledTasks')
      .set({ completedAt: sql`transaction_timestamp()`, lastError: null })
      .where('id', '=', task.id)
      .where('completedAt', 'is', null)
      .executeTakeFirstOrThrow();

    return { taskId: task.id, outcome: 'completed' };
  });
}

export async function drainScheduledTasks(
  db: Kysely<Database>,
  handlers: ScheduledTaskHandlers,
  limit = 50,
  observer?: Observer,
): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    const result = await processNextScheduledTask(db, handlers);
    if (!result) break;
    // The transaction has committed before its outcome is observed.
    observe(observer, { kind: 'processed', outcome: result.outcome });
    processed += 1;
  }
  return processed;
}

/**
 * Polls with `passes` concurrent drains. Each takes its own task (`SKIP
 * LOCKED`) and finalises only that one; two tasks of one village meet on the
 * village row as two commands would. A round ends when every pass is idle.
 * `db` should own at least `passes` connections.
 */
export function startScheduledTaskWorker(
  db: Kysely<Database>,
  handlers: ScheduledTaskHandlers,
  pollIntervalMs: number,
  onError: (error: unknown) => void,
  observer?: Observer,
  { passes = SCHEDULER_PASSES }: { passes?: number } = {},
): () => Promise<void> {
  let stopped = false;
  let currentRun: Promise<void> | null = null;

  const poll = () => {
    if (stopped || currentRun) return;
    observe(observer, { kind: 'poll' });
    // allSettled: a failed pass never ends the round while others still run.
    currentRun = Promise.allSettled(
      Array.from({ length: passes }, () => drainScheduledTasks(db, handlers, 50, observer)),
    )
      .then((results) => {
        const failed = results.find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;
        observe(observer, { kind: 'idle' });
      })
      .catch((error) => {
        observe(observer, { kind: 'error' });
        onError(error);
      })
      .finally(() => {
        currentRun = null;
      });
  };

  const timer = setInterval(() => void poll(), pollIntervalMs);
  timer.unref();
  void poll();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await currentRun;
    observe(observer, { kind: 'stopped' });
  };
}
