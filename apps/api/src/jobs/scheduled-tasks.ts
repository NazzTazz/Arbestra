import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';

import type { Database, ScheduledTasksTable } from '../database/schema.js';

export type ScheduledTask = Selectable<ScheduledTasksTable>;
export type ScheduledTaskHandler = (transaction: Transaction<Database>, task: ScheduledTask) => Promise<void>;
export type ScheduledTaskHandlers = Readonly<Record<string, ScheduledTaskHandler>>;

export interface ProcessScheduledTaskResult {
  taskId: string;
  outcome: 'completed' | 'retry-scheduled';
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
  return db.transaction().execute(async (transaction) => {
    const task = await transaction.selectFrom('scheduledTasks')
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

    const handler = handlers[task.taskType];
    await sql`savepoint scheduled_task_handler`.execute(transaction);
    try {
      if (!handler) throw new Error(`No handler registered for scheduled task type: ${task.taskType}`);
      await handler(transaction, task);
      await sql`release savepoint scheduled_task_handler`.execute(transaction);
    } catch (error) {
      await sql`rollback to savepoint scheduled_task_handler`.execute(transaction);
      await sql`release savepoint scheduled_task_handler`.execute(transaction);
      await transaction.updateTable('scheduledTasks')
        .set({
          attempts: sql`attempts + 1`,
          lastError: errorMessage(error),
          availableAt: sql`transaction_timestamp() + (${retryDelayMs} * interval '1 millisecond')`,
        })
        .where('id', '=', task.id)
        .executeTakeFirstOrThrow();
      return { taskId: task.id, outcome: 'retry-scheduled' };
    }

    await transaction.updateTable('scheduledTasks')
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
): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    const result = await processNextScheduledTask(db, handlers);
    if (!result) break;
    processed += 1;
  }
  return processed;
}

export function startScheduledTaskWorker(
  db: Kysely<Database>,
  handlers: ScheduledTaskHandlers,
  pollIntervalMs: number,
  onError: (error: unknown) => void,
): () => Promise<void> {
  let stopped = false;
  let currentRun: Promise<void> | null = null;

  const poll = () => {
    if (stopped || currentRun) return;
    currentRun = drainScheduledTasks(db, handlers)
      .then(() => undefined)
      .catch(onError)
      .finally(() => { currentRun = null; });
  };

  const timer = setInterval(() => void poll(), pollIntervalMs);
  timer.unref();
  void poll();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await currentRun;
  };
}
