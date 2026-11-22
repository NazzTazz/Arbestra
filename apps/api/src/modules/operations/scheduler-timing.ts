import { DEV_TIMING_PHASES, type DevTimingPhase } from '@arbestra/contracts';
import type { DevTimingTrace } from './dev-timing.js';

/** A scheduler task slower than this writes one `scheduler.slow-task` line. */
export const SLOW_TASK_THRESHOLD_MS = 1_000;
export const SLOW_TASK_EVENT = 'scheduler.slow-task';

export type SlowTaskOutcome = 'completed' | 'retry-scheduled' | 'busy-rescheduled' | 'failed';
/** Phase totals: inclusive ms, self ms (children excluded), calls. */
export type SlowTaskPhase = [ms: number, selfMs: number, count: number];
export interface SlowTaskLine {
  event: typeof SLOW_TASK_EVENT;
  taskType: string;
  taskId: string;
  worldId: string;
  subjectId: string;
  outcome: SlowTaskOutcome;
  attempts: number;
  /** Transaction start (connection included) to commit or failure. */
  durationMs: number;
  /** Due date to take, and the later of due and available dates to take (the
   * scheduler's own pickup delay, retries and busy reschedules excluded). */
  lateMs: number;
  pickupMs: number;
  /** Transaction start to the task row taken (connection and selection). */
  takeMs: number;
  villageLockMs: number;
  groundMs: number;
  navigationQueueMs: number;
  /** Trip computations: calls, and their time without queue, SQL and ground. */
  navigationCalls: number;
  navigationMs: number;
  /** Every driver call, including those of the village lock and the ground. */
  sqlCalls: number;
  sqlMs: number;
  phases: Partial<Record<DevTimingPhase, SlowTaskPhase>>;
  /** Slowest statements as `table:operation` labels (no SQL text). */
  slowestSql: Array<{ label: string; ms: number }>;
}
export type SlowTaskSink = (line: SlowTaskLine) => void;

export interface SlowTaskTimes {
  /** performance.now() at transaction start, at task taken, at the end. */
  started: number;
  taken: number;
  ended: number;
  /** Date.now() when the task row was taken. */
  takenAtMs: number;
}
interface TakenTask {
  id: string;
  taskType: string;
  worldId: string;
  subjectId: string;
  attempts: number;
  dueAt: Date;
  availableAt: Date;
}

const round = (ms: number) => Math.round(Math.max(0, ms) * 10) / 10;

/** The line of a task slower than the threshold, or null (nothing allocated
 * beyond the check for a fast task). Reads the trace, never closes it. */
export function slowTaskLine(
  task: TakenTask,
  outcome: SlowTaskOutcome,
  trace: DevTimingTrace,
  times: SlowTaskTimes,
): SlowTaskLine | null {
  const durationMs = times.ended - times.started;
  if (!(durationMs > SLOW_TASK_THRESHOLD_MS)) return null;
  const metric = (phase: DevTimingPhase) => trace.metrics.get(phase);
  const phases: SlowTaskLine['phases'] = {};
  for (const m of trace.metrics.values())
    if (m.phase !== 'request') phases[m.phase] = [round(m.durationMs), round(m.selfMs), m.count];
  return {
    event: SLOW_TASK_EVENT,
    taskType: task.taskType,
    taskId: task.id,
    worldId: task.worldId,
    subjectId: task.subjectId,
    outcome,
    attempts: task.attempts,
    durationMs: round(durationMs),
    lateMs: round(times.takenAtMs - task.dueAt.getTime()),
    pickupMs: round(times.takenAtMs - Math.max(task.dueAt.getTime(), task.availableAt.getTime())),
    takeMs: round(times.taken - times.started),
    villageLockMs: round(metric('village_lock')?.durationMs ?? 0),
    groundMs: round(metric('rc1_ground')?.durationMs ?? 0),
    navigationQueueMs: round(metric('navigation_queue')?.durationMs ?? 0),
    navigationCalls: metric('navigation')?.count ?? 0,
    navigationMs: round(metric('navigation')?.selfMs ?? 0),
    sqlCalls: metric('sql')?.count ?? 0,
    sqlMs: round(metric('sql')?.durationMs ?? 0),
    phases,
    slowestSql: trace.slowest.map((q) => ({ label: q.label, ms: round(q.ms) })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_TYPE = /^[a-z][a-z0-9_.-]{0,63}$/;
const SQL_LABEL = /^[a-z0-9_():?]{1,60}$/;
const OUTCOMES = new Set<string>(['completed', 'retry-scheduled', 'busy-rescheduled', 'failed']);
const NUMBERS = [
  'attempts',
  'durationMs',
  'lateMs',
  'pickupMs',
  'takeMs',
  'villageLockMs',
  'groundMs',
  'navigationQueueMs',
  'navigationCalls',
  'navigationMs',
  'sqlCalls',
  'sqlMs',
] as const;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/** Fixed fields only, as the log stream projects every line: technical
 * identifiers and durations, never a payload, an error text or SQL. */
export function projectSlowTask(value: unknown): Record<string, unknown> {
  const source = object(value);
  const phases: Record<string, SlowTaskPhase> = {};
  for (const [phase, entry] of Object.entries(object(source.phases)))
    if (Object.hasOwn(DEV_TIMING_PHASES, phase) && Array.isArray(entry))
      phases[phase] = [number(entry[0]), number(entry[1]), number(entry[2])];
  const result: Record<string, unknown> = {
    event: SLOW_TASK_EVENT,
    taskType: typeof source.taskType === 'string' && TASK_TYPE.test(source.taskType) ? source.taskType : 'unknown',
    taskId: uuid(source.taskId),
    worldId: uuid(source.worldId),
    subjectId: uuid(source.subjectId),
    outcome: typeof source.outcome === 'string' && OUTCOMES.has(source.outcome) ? source.outcome : 'failed',
  };
  for (const field of NUMBERS) result[field] = number(source[field]);
  result.phases = phases;
  result.slowestSql = (Array.isArray(source.slowestSql) ? source.slowestSql : []).slice(0, 3).flatMap((entry) => {
    const q = object(entry);
    return typeof q.label === 'string' && SQL_LABEL.test(q.label) ? [{ label: q.label, ms: number(q.ms) }] : [];
  });
  return result;
}
