/** Read-only sampler of the server during a load test (docs/TEST-DE-CHARGE.md §5).
 * Every interval it records, as one JSON line:
 * - API health (GET /api/health, latency or failure);
 * - scheduler backlog: due notifications and the age of the oldest one (the
 *   worker's lag), harvest and expedition intents still pending;
 * - PostgreSQL: connections by state, lock waits, longest transaction and
 *   query, wait events, commits/rollbacks/deadlocks since the last sample;
 * - the API process CPU and memory: from the local probe file (local-api.ts)
 *   or /proc/<pid> on Linux (--api-pid);
 * - the host load average and free memory (a VPS shared with the alpha).
 * Its database session is read-only (default_transaction_read_only, statement
 * and lock timeouts of the NOC's observation pool) and never takes a lock a
 * game transaction waits for.
 *
 *   tsx src/sampler.ts --target local --base-url http://127.0.0.1:3300 --out out/run/samples.jsonl
 *     [--api-probe-file out/api-probe-3300.json | --api-pid 1234] [--interval 2] */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'kysely';
import { createDatabase } from '../../api/src/database/connection.js';
import { databaseUrl, guard, main } from './cli.js';
import { LoadTargetRefused } from './target.js';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    'database-url': { type: 'string' },
    'base-url': { type: 'string' },
    world: { type: 'string' },
    out: { type: 'string' },
    interval: { type: 'string', default: '2' },
    'api-probe-file': { type: 'string' },
    'api-pid': { type: 'string' },
    'clock-ticks': { type: 'string', default: '100' },
    'confirm-staging': { type: 'boolean', default: false },
  },
});

export interface Sample {
  at: number;
  health: { ok: boolean; ms: number | null; status: number };
  db?: {
    connections: number;
    active: number;
    idleInTransaction: number;
    lockWaiting: number;
    longestTransactionS: number;
    longestQueryS: number;
    waits: Array<{ type: string; event: string; count: number }>;
    locksWaiting: number;
    advisoryWaiting: number;
    advisoryHeld: number;
    tasksDue: number;
    tasksRetrying: number;
    oldestDueS: number;
    harvestPending: number;
    oldestHarvestPendingS: number;
    expeditionsPending: number;
    commitsPerS: number;
    rollbacksPerS: number;
    deadlocks: number;
  };
  dbError?: string;
  api?: { cpuPercent: number | null; rssMb: number; heapMb?: number; eventLoopP99Ms?: number; eventLoopMaxMs?: number };
  host: { load1: number; cpus: number; freeMemMb: number; totalMemMb: number };
}

await main(async () => {
  const base = values['base-url'];
  if (!base || !values.out) throw new LoadTargetRefused('--base-url et --out sont obligatoires.');
  const url = databaseUrl(values);
  guard({
    target: values.target,
    databaseUrl: url,
    baseUrl: base,
    ...(values.world ? { worldSlug: values.world } : {}),
  });
  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  const db = createDatabase(url, () => undefined, { observation: true });
  const interval = Math.max(0.5, Number(values.interval)) * 1000;
  const ticks = Number(values['clock-ticks']);
  let previousDb: { at: number; commits: number; rollbacks: number; deadlocks: number } | null = null;
  let previousCpu: { at: number; us: number } | null = null;
  let stopped = false;
  const stop = () => (stopped = true);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // The parent (run.ts) closes our stdin to stop us, the portable signal on Windows.
  process.stdin.on('end', stop);
  process.stdin.on('close', stop);
  process.stdin.resume();

  const health = async (): Promise<Sample['health']> => {
    const started = performance.now();
    try {
      const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(5000) });
      await response.arrayBuffer();
      return { ok: response.ok, ms: Math.round(performance.now() - started), status: response.status };
    } catch {
      return { ok: false, ms: null, status: 0 };
    }
  };
  const database = async (): Promise<NonNullable<Sample['db']>> =>
    db.transaction().execute(async (tx) => {
      await sql`select set_config('application_name', 'arbestra-load-sampler', true)`.execute(tx);
      const activity = (
        await sql<{
          total: number;
          active: number;
          idleTx: number;
          lockWaiting: number;
          longestXact: number;
          longestQuery: number;
        }>`select count(*)::int as total,
            count(*) filter (where state = 'active')::int as active,
            count(*) filter (where state like 'idle in transaction%')::int as idle_tx,
            count(*) filter (where wait_event_type = 'Lock')::int as lock_waiting,
            coalesce(max(extract(epoch from (now() - xact_start))) filter (where xact_start is not null), 0)::float as longest_xact,
            coalesce(max(extract(epoch from (now() - query_start))) filter (where state = 'active'), 0)::float as longest_query
          from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'
            and application_name is distinct from 'arbestra-load-sampler'`.execute(tx)
      ).rows[0]!;
      const waits = (
        await sql<{ type: string; event: string; count: number }>`select wait_event_type as type, wait_event as event,
            count(*)::int as count from pg_stat_activity
          where datname = current_database() and state = 'active' and wait_event is not null and pid <> pg_backend_pid()
          group by 1, 2 order by 3 desc limit 5`.execute(tx)
      ).rows;
      const locks = (
        await sql<{ waiting: number; advisoryWaiting: number; advisoryHeld: number }>`select
            count(*) filter (where not l.granted)::int as waiting,
            count(*) filter (where not l.granted and l.locktype = 'advisory')::int as advisory_waiting,
            count(*) filter (where l.granted and l.locktype = 'advisory')::int as advisory_held
          from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.datname = current_database()`.execute(tx)
      ).rows[0]!;
      const tasks = (
        await sql<{ due: number; retrying: number; oldestDue: number }>`select
            count(*) filter (where due_at <= now() and available_at <= now())::int as due,
            count(*) filter (where last_error is not null)::int as retrying,
            coalesce(extract(epoch from now() - min(due_at) filter (where due_at <= now() and available_at <= now())), 0)::float as oldest_due
          from scheduled_tasks where completed_at is null`.execute(tx)
      ).rows[0]!;
      const harvest = (
        await sql<{ pending: number; oldest: number }>`select count(*)::int as pending,
            coalesce(extract(epoch from now() - min(created_at)), 0)::float as oldest
          from harvest_submissions where receipt is null or receipt->>'status' = 'pending'`.execute(tx)
      ).rows[0]!;
      const expeditions = (
        await sql<{ pending: number }>`select count(*)::int as pending from expedition_submissions
          where receipt->>'status' = 'pending'`.execute(tx)
      ).rows[0]!;
      const totals = (
        await sql<{ commits: string; rollbacks: string; deadlocks: string }>`select xact_commit as commits,
            xact_rollback as rollbacks, deadlocks from pg_stat_database where datname = current_database()`.execute(tx)
      ).rows[0]!;
      const now = Date.now(),
        current = {
          at: now,
          commits: Number(totals.commits),
          rollbacks: Number(totals.rollbacks),
          deadlocks: Number(totals.deadlocks),
        };
      const seconds = previousDb ? Math.max(0.001, (now - previousDb.at) / 1000) : 1;
      const rates = previousDb
        ? {
            commitsPerS: Math.round(((current.commits - previousDb.commits) / seconds) * 10) / 10,
            rollbacksPerS: Math.round(((current.rollbacks - previousDb.rollbacks) / seconds) * 10) / 10,
            deadlocks: current.deadlocks - previousDb.deadlocks,
          }
        : { commitsPerS: 0, rollbacksPerS: 0, deadlocks: 0 };
      previousDb = current;
      return {
        connections: activity.total,
        active: activity.active,
        idleInTransaction: activity.idleTx,
        lockWaiting: activity.lockWaiting,
        longestTransactionS: Math.round(activity.longestXact * 100) / 100,
        longestQueryS: Math.round(activity.longestQuery * 100) / 100,
        waits,
        locksWaiting: locks.waiting,
        advisoryWaiting: locks.advisoryWaiting,
        advisoryHeld: locks.advisoryHeld,
        tasksDue: tasks.due,
        tasksRetrying: tasks.retrying,
        oldestDueS: Math.round(tasks.oldestDue * 100) / 100,
        harvestPending: harvest.pending,
        oldestHarvestPendingS: Math.round(harvest.oldest * 100) / 100,
        expeditionsPending: expeditions.pending,
        ...rates,
      };
    });
  const api = (): Sample['api'] => {
    const now = Date.now();
    const cpuPercent = (us: number) => {
      const percent = previousCpu ? ((us - previousCpu.us) / 1000 / Math.max(1, now - previousCpu.at)) * 100 : null;
      previousCpu = { at: now, us };
      return percent === null ? null : Math.round(percent * 10) / 10;
    };
    const file = values['api-probe-file'];
    if (file && existsSync(file)) {
      try {
        const probe = JSON.parse(readFileSync(file, 'utf8')) as {
          at: number;
          cpuUserUs: number;
          cpuSystemUs: number;
          rssBytes: number;
          heapUsedBytes: number;
          eventLoopDelayMs: { p99: number; max: number };
        };
        if (now - probe.at > 10_000) return undefined;
        return {
          cpuPercent: cpuPercent(probe.cpuUserUs + probe.cpuSystemUs),
          rssMb: Math.round(probe.rssBytes / 1048576),
          heapMb: Math.round(probe.heapUsedBytes / 1048576),
          eventLoopP99Ms: Math.round(probe.eventLoopDelayMs.p99 * 10) / 10,
          eventLoopMaxMs: Math.round(probe.eventLoopDelayMs.max * 10) / 10,
        };
      } catch {
        return undefined;
      }
    }
    const pid = values['api-pid'];
    if (pid && existsSync(`/proc/${pid}/stat`)) {
      // utime and stime are fields 14 and 15, after the parenthesized command name.
      const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
      const us = ((Number(fields[11]) + Number(fields[12])) / ticks) * 1e6;
      const rss = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1];
      return { cpuPercent: cpuPercent(us), rssMb: Math.round(Number(rss ?? 0) / 1024) };
    }
    return undefined;
  };

  try {
    while (!stopped) {
      const started = Date.now();
      const sample: Sample = {
        at: started,
        health: await health(),
        host: {
          load1: Math.round(loadavg()[0]! * 100) / 100,
          cpus: cpus().length,
          freeMemMb: Math.round(freemem() / 1048576),
          totalMemMb: Math.round(totalmem() / 1048576),
        },
      };
      try {
        sample.db = await database();
      } catch (error) {
        sample.dbError = (error as Error).message.slice(0, 200);
      }
      const apiSample = api();
      if (apiSample) sample.api = apiSample;
      appendFileSync(out, JSON.stringify(sample) + '\n');
      await new Promise((done) => setTimeout(done, Math.max(0, interval - (Date.now() - started))));
    }
  } finally {
    await db.destroy();
  }
});
