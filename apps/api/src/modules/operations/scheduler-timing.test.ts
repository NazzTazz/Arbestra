import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { DevTimingTrace, devTime, devTimeSync, profileParts, withDevTiming } from './dev-timing.js';
import { createHttpLogging } from './http-logging.js';
import { SLOW_TASK_THRESHOLD_MS, projectSlowTask, slowTaskLine } from './scheduler-timing.js';

const task = () => ({
  id: randomUUID(),
  taskType: 'harvest.intent',
  worldId: randomUUID(),
  subjectId: randomUUID(),
  attempts: 2,
  dueAt: new Date(10_000),
  availableAt: new Date(10_500),
});

/** A traced task on a manual clock: lock 40 ms, ground 300 ms (with 120 ms of
 * SQL), two trip computations (one with a 200 ms queue). */
function tracedTask() {
  let now = 0;
  const trace = new DevTimingTrace(() => now);
  trace.profiling = false;
  withDevTiming(trace, () => {
    now = 10;
    devTimeSync('village_lock', () => (now += 40));
    devTimeSync('rc1_ground', () => {
      now += 180;
      devTimeSync('sql', () => (now += 120));
      trace.recordStatement('select "id" from "world_rc1_resources" where "world_id" = $1', 120);
    });
    devTimeSync('navigation', () => {
      devTimeSync('navigation_queue', () => (now += 200));
      // Its callee times the same computation: counted once.
      devTimeSync('navigation', () => (now += 300));
    });
    devTimeSync('navigation', () => (now += 100));
  });
  return { trace, end: now };
}

describe('scheduler slow task line', () => {
  it('writes nothing at or under the threshold', () => {
    const { trace } = tracedTask();
    const times = { started: 0, taken: 10, takenAtMs: 11_000 };
    expect(slowTaskLine(task(), 'completed', trace, { ...times, ended: SLOW_TASK_THRESHOLD_MS })).toBeNull();
    expect(slowTaskLine(task(), 'completed', trace, { ...times, ended: 1_000.5 })).not.toBeNull();
  });

  it('reports the phases of a slow task with technical identifiers only', () => {
    const { trace, end } = tracedTask();
    expect(end).toBe(950);
    const t = task();
    const line = slowTaskLine(t, 'completed', trace, { started: 0, taken: 10, ended: 1_250, takenAtMs: 11_000 });
    expect(line).toEqual({
      event: 'scheduler.slow-task',
      taskType: 'harvest.intent',
      taskId: t.id,
      worldId: t.worldId,
      subjectId: t.subjectId,
      outcome: 'completed',
      attempts: 2,
      durationMs: 1_250,
      lateMs: 1_000,
      pickupMs: 500,
      takeMs: 10,
      villageLockMs: 40,
      groundMs: 300,
      navigationQueueMs: 200,
      navigationCalls: 2,
      navigationMs: 400,
      sqlCalls: 1,
      sqlMs: 120,
      phases: {
        village_lock: [40, 40, 1],
        rc1_ground: [300, 180, 1],
        sql: [120, 120, 1],
        navigation: [600, 400, 2],
        navigation_queue: [200, 200, 1],
      },
      slowestSql: [{ label: 'world_rc1_resources:select', ms: 120 }],
    });
  });

  it('projects fixed fields only, whatever the caller passes', () => {
    const t = task();
    const projected = projectSlowTask({
      event: 'scheduler.slow-task',
      taskType: 'Harvest intent; drop table',
      taskId: t.id,
      worldId: 'not-a-uuid',
      subjectId: t.subjectId,
      outcome: 'exploded',
      attempts: 1,
      durationMs: -4,
      payload: { player: 'Tristan' },
      lastError: 'secret',
      phases: { sql: [1, 1, 1], password: [1, 1, 1], toString: [1, 1, 1], navigation: 'x' },
      slowestSql: [
        { label: 'select * from players', ms: 3 },
        { label: 'villages:update', ms: 2 },
      ],
    });
    expect(projected).toMatchObject({
      taskType: 'unknown',
      taskId: t.id,
      worldId: null,
      outcome: 'failed',
      attempts: 1,
      durationMs: 0,
      phases: { sql: [1, 1, 1] },
      slowestSql: [{ label: 'villages:update', ms: 2 }],
    });
    expect(Object.keys(projected.phases as object)).toEqual(['sql']);
    expect(JSON.stringify(projected)).not.toMatch(/Tristan|secret|password|players/);
  });

  it('reaches the log stream as one structured line', async () => {
    const lines: string[] = [];
    const logging = createHttpLogging('anomalies', (line, done) => {
      lines.push(line);
      done();
    });
    const app = Fastify({ logger: logging.loggerOptions, disableRequestLogging: true });
    try {
      const { trace } = tracedTask();
      const t = task();
      app.log.info(
        slowTaskLine(t, 'busy-rescheduled', trace, { started: 0, taken: 10, ended: 2_000, takenAtMs: 11_000 }),
        'Slow scheduled task',
      );
      for (let i = 0; !lines.length && i < 100; i++) await new Promise((resolve) => setImmediate(resolve));
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!);
      expect(parsed).toMatchObject({
        event: 'scheduler.slow-task',
        taskType: 'harvest.intent',
        taskId: t.id,
        worldId: t.worldId,
        outcome: 'busy-rescheduled',
        durationMs: 2_000,
        navigationCalls: 2,
        msg: 'Application event',
      });
      expect(parsed.phases.navigation_queue).toEqual([200, 200, 1]);
    } finally {
      logging.close();
      await app.close();
    }
  });
});

describe('observation-only traces', () => {
  it('never rerun profiled parts', async () => {
    let runs = 0;
    const trace = new DevTimingTrace();
    trace.profiling = false;
    await withDevTiming(trace, () => devTime('snapshot', () => profileParts([['part', async () => void runs++]])));
    expect(runs).toBe(0);
    expect(trace.profile).toEqual([]);
    const opted = new DevTimingTrace();
    await withDevTiming(opted, () => profileParts([['part', async () => void runs++]]));
    expect(runs).toBe(1);
  });
});
