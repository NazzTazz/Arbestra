import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CompiledQuery, DatabaseConnection, Driver } from 'kysely';
import { DEV_TIMING_HEADER, type DevTimingMetric, type DevTimingPhase } from '@arbestra/contracts';

type Span = { start: number; children: number; childStart: number; childMs: number; ended: boolean };
type Context = { trace: DevTimingTrace; span: Span };
const context = new AsyncLocalStorage<Context>();

export class DevTimingTrace {
  readonly metrics = new Map<DevTimingPhase, DevTimingMetric>();
  /** Slowest statements, as operation and first table only (no SQL text). */
  readonly slowest: Array<{ label: string; ms: number }> = [];
  /** Opt-in breakdown of a composite statement, part by part. */
  readonly profile: Array<{ label: string; ms: number }> = [];
  readonly root: Span;
  closed = false;
  constructor(readonly now = () => performance.now()) {
    this.root = this.start();
  }
  start(): Span {
    return { start: this.now(), children: 0, childStart: 0, childMs: 0, ended: false };
  }
  finish(phase: DevTimingPhase, span: Span) {
    if (span.ended || this.closed) return;
    const end = this.now(),
      durationMs = Math.max(0, end - span.start);
    const covered = span.childMs + (span.children ? end - span.childStart : 0);
    span.ended = true;
    const prior = this.metrics.get(phase) ?? { phase, durationMs: 0, selfMs: 0, count: 0 };
    prior.durationMs += durationMs;
    prior.selfMs += Math.max(0, durationMs - covered);
    prior.count++;
    this.metrics.set(phase, prior);
  }
  header(): string {
    this.finish('request', this.root);
    this.closed = true;
    return [...this.metrics.values()]
      .flatMap((m) => [
        `arb_${m.phase};dur=${m.durationMs.toFixed(3)};desc="${m.count}"`,
        `arb_${m.phase}_self;dur=${m.selfMs.toFixed(3)};desc="${m.count}"`,
      ])
      .concat(this.slowest.map((q, i) => `arbsql_${i + 1};dur=${q.ms.toFixed(3)};desc="${q.label}"`))
      .concat(this.profile.map((q, i) => `arbpart_${i + 1};dur=${q.ms.toFixed(3)};desc="${q.label}"`))
      .join(', ');
  }
  recordStatement(sql: string, ms: number) {
    if (this.closed) return;
    this.slowest.push({ label: statementLabel(sql), ms });
    this.slowest.sort((a, b) => b.ms - a.ms);
    this.slowest.length = Math.min(this.slowest.length, 3);
  }
}

/** "world_cell_occupancies:insert", "villages:select", "game_sync_publish():select". */
export function statementLabel(sql: string): string {
  const text = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const op = /^(\w+)/.exec(text)?.[1] ?? '?';
  const table = /\b(?:from|into|update|join)\s+"?([a-z_][a-z0-9_]*)"?/.exec(text)?.[1];
  const fn = /^select\s+([a-z_][a-z0-9_]*)\(/.exec(text)?.[1];
  // Object first, never "select …": the header must not resemble SQL text.
  const object = table ?? (fn ? fn + '()' : '');
  return (object ? object + ':' + op : op).slice(0, 60);
}

/** Times each part of a composite read separately, only for an opted-in
 * request (diagnostics; the parts are rerun read-only in the same transaction). */
export async function profileParts(parts: ReadonlyArray<readonly [string, () => Promise<unknown>]>): Promise<void> {
  const trace = context.getStore()?.trace;
  if (!trace || trace.closed) return;
  for (const [label, run] of parts) {
    const started = performance.now();
    await run();
    trace.profile.push({ label: label.slice(0, 60), ms: performance.now() - started });
  }
}

export function withDevTiming<T>(trace: DevTimingTrace, run: () => T): T {
  return context.run({ trace, span: trace.root }, run);
}

function begin(phase: DevTimingPhase) {
  const current = context.getStore();
  if (!current || current.trace.closed) return;
  const { trace, span: parent } = current,
    span = trace.start();
  if (parent.children++ === 0) parent.childStart = span.start;
  return {
    trace,
    span,
    end: () => {
      trace.finish(phase, span);
      if (--parent.children === 0 && !parent.ended) parent.childMs += Math.max(0, trace.now() - parent.childStart);
    },
  };
}
export function devTimeSync<T>(phase: DevTimingPhase, run: () => T): T {
  const timing = begin(phase);
  if (!timing) return run();
  try {
    return context.run(timing, run);
  } finally {
    timing.end();
  }
}
export function devTime<T>(phase: DevTimingPhase, run: () => Promise<T>): Promise<T> {
  const timing = begin(phase);
  if (!timing) return run();
  return context.run(timing, async () => {
    try {
      return await run();
    } finally {
      timing.end();
    }
  });
}

/** Retains the original connection object (including driver-owned release symbols). */
export function instrumentDevDriver(driver: Driver): Driver {
  const acquire = driver.acquireConnection.bind(driver),
    wrapped = new WeakSet<DatabaseConnection>();
  driver.acquireConnection = async () => {
    const connection = await devTime('pool', acquire);
    if (!wrapped.has(connection)) {
      const execute = connection.executeQuery.bind(connection);
      connection.executeQuery = <R>(query: CompiledQuery) => {
        const trace = context.getStore()?.trace;
        if (!trace) return execute<R>(query);
        const started = performance.now();
        return devTime('sql', () => execute<R>(query)).finally(() =>
          trace.recordStatement(query.sql, performance.now() - started),
        );
      };
      wrapped.add(connection);
    }
    return connection;
  };
  return driver;
}

const routes = new Set([
  '/api/worlds/:worldSlug/village',
  '/api/worlds/:worldSlug/starter',
  '/api/worlds/:worldSlug/starter/terrain',
  '/api/worlds/:worldSlug/terrain',
  '/api/worlds/:worldSlug/terrain/updates',
  '/api/worlds/:worldSlug/terrain/overview',
  '/api/worlds/:worldSlug/terrain/overview/vegetation',
  '/api/worlds/:worldSlug/terrain/overview/villages',
]);

/** Opt-in per request (header), production included: a player diagnosing a
 * slow gesture reads its phases in the browser. Durations only, no data. */
export function instrumentDevTimings(app: FastifyInstance) {
  const traces = new WeakMap<FastifyRequest, DevTimingTrace>();
  app.addHook('onRequest', (request, _reply, done) => {
    const route = request.routeOptions.url ?? '';
    const villageAction =
      route.startsWith('/api/worlds/:worldSlug/villages/:villageId/') &&
      !route.endsWith('/events') &&
      (request.method === 'GET' || request.method === 'POST');
    if (
      request.headers[DEV_TIMING_HEADER] !== '1' ||
      !(villageAction || (request.method === 'GET' && routes.has(route)))
    )
      return done();
    const trace = new DevTimingTrace();
    traces.set(request, trace);
    withDevTiming(trace, done);
  });
  app.addHook('onSend', (request, reply, payload, done) => {
    const trace = traces.get(request);
    if (trace) {
      const previous = reply.getHeader('Server-Timing');
      reply.header('Server-Timing', [previous, trace.header()].filter(Boolean).join(', '));
      reply.header('Cache-Control', 'private, no-store');
    }
    done(null, payload);
  });
  app.addHook('onResponse', (request, _reply, done) => {
    const trace = traces.get(request);
    if (trace) trace.closed = true;
    done();
  });
}
