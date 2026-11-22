import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';

import type { Database, ScheduledTasksTable } from '../database/schema.js';
import { isLockTimeout } from '../errors.js';
import { spatialSavepoint, withSpatialRetry } from '../modules/worlds/spatial-locks.js';
import { DevTimingTrace, withDevTiming } from '../modules/operations/dev-timing.js';
import { slowTaskLine, type SlowTaskOutcome, type SlowTaskSink } from '../modules/operations/scheduler-timing.js';

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
  onSlowTask?: SlowTaskSink,
): Promise<ProcessScheduledTaskResult | null> {
  if (onSlowTask) return processTimed(db, handlers, retryDelayMs, onSlowTask);
  let taken: string | undefined;
  try {
    return await processInTransaction(db, handlers, retryDelayMs, (task) => (taken = task.id));
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

/** The same, timed with the request diagnostics' phases (dev-timing): a task
 * slower than SLOW_TASK_THRESHOLD_MS reports one line. Observation only: the
 * trace never reruns a read (`profiling` off) and nothing is written below
 * the threshold. */
async function processTimed(
  db: Kysely<Database>,
  handlers: ScheduledTaskHandlers,
  retryDelayMs: number,
  onSlowTask: SlowTaskSink,
): Promise<ProcessScheduledTaskResult | null> {
  const trace = new DevTimingTrace();
  trace.profiling = false;
  const started = trace.now();
  let taken: ScheduledTask | undefined,
    takenAt = 0,
    takenAtMs = 0;
  const report = (outcome: SlowTaskOutcome) => {
    const ended = trace.now();
    trace.closed = true;
    if (!taken) return;
    try {
      const line = slowTaskLine(taken, outcome, trace, { started, taken: takenAt, ended, takenAtMs });
      if (line) onSlowTask(line);
    } catch {
      /* Monitoring must never change task handling. */
    }
  };
  try {
    const result = await withDevTiming(trace, () =>
      processInTransaction(db, handlers, retryDelayMs, (task) => {
        taken = task;
        takenAt = trace.now();
        takenAtMs = Date.now();
      }),
    );
    if (result) report(result.outcome);
    return result;
  } catch (error) {
    // As above: a lock wait timed out at COMMIT gives way.
    if (!taken || !isLockTimeout(error)) {
      report('failed');
      throw error;
    }
    report('busy-rescheduled');
    await rescheduleBusy(db, taken.id);
    return { taskId: taken.id, outcome: 'busy-rescheduled' };
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
  took: (task: ScheduledTask) => void,
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
    took(task);
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

/**
 * Runs `passes` independent passes. Each takes its own task (`SKIP LOCKED`)
 * and finalises only that one; two tasks of one village meet on the village
 * row as two commands would. A pass that handled a task looks for the next one
 * at once; a pass that found nothing (or failed) sleeps `pollIntervalMs`,
 * whatever the others are doing: a task due while a pass is held by a long
 * one is taken by a free pass within one interval. Never more than `passes`
 * scheduler transactions at once; `db` should own at least `passes`
 * connections. The returned stop wakes sleeping passes, waits for the tasks in
 * progress and starts nothing more.
 */
export function startScheduledTaskWorker(
  db: Kysely<Database>,
  handlers: ScheduledTaskHandlers,
  pollIntervalMs: number,
  onError: (error: unknown) => void,
  observer?: Observer,
  { passes = SCHEDULER_PASSES, onSlowTask }: { passes?: number; onSlowTask?: SlowTaskSink } = {},
): () => Promise<void> {
  let stopped = false,
    working = 0;
  const sleepers = new Set<() => void>();
  const sleep = () =>
    new Promise<void>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        sleepers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, pollIntervalMs);
      timer.unref();
      sleepers.add(wake);
    });

  const pass = async () => {
    while (!stopped) {
      observe(observer, { kind: 'poll' });
      let failed = false;
      working++;
      try {
        while (!stopped) {
          const result = await processNextScheduledTask(db, handlers, undefined, onSlowTask);
          if (!result) break;
          // The transaction has committed before its outcome is observed.
          observe(observer, { kind: 'processed', outcome: result.outcome });
        }
      } catch (error) {
        // A failed pass sleeps and resumes: it never stops itself or another.
        failed = true;
        observe(observer, { kind: 'error' });
        try {
          onError(error);
        } catch {
          /* Reporting must never stop a pass. */
        }
      } finally {
        working--;
      }
      if (stopped) break;
      if (!failed && working === 0) observe(observer, { kind: 'idle' });
      await sleep();
    }
  };
  const running = Array.from({ length: passes }, pass);

  return async () => {
    stopped = true;
    for (const wake of [...sleepers]) wake();
    await Promise.allSettled(running);
    observe(observer, { kind: 'stopped' });
  };
}
