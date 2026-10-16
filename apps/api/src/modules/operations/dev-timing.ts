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
  readonly root: Span;
  closed = false;
  constructor(readonly now = () => performance.now()) { this.root = this.start(); }
  start(): Span { return { start: this.now(), children: 0, childStart: 0, childMs: 0, ended: false }; }
  finish(phase: DevTimingPhase, span: Span) {
    if (span.ended || this.closed) return;
    const end = this.now(), durationMs = Math.max(0, end - span.start);
    const covered = span.childMs + (span.children ? end - span.childStart : 0);
    span.ended = true;
    const prior = this.metrics.get(phase) ?? { phase, durationMs: 0, selfMs: 0, count: 0 };
    prior.durationMs += durationMs; prior.selfMs += Math.max(0, durationMs - covered); prior.count++;
    this.metrics.set(phase, prior);
  }
  header(): string {
    this.finish('request', this.root); this.closed = true;
    return [...this.metrics.values()].flatMap(m => [
      `arb_${m.phase};dur=${m.durationMs.toFixed(3)};desc="${m.count}"`,
      `arb_${m.phase}_self;dur=${m.selfMs.toFixed(3)};desc="${m.count}"`,
    ]).join(', ');
  }
}

export function withDevTiming<T>(trace: DevTimingTrace, run: () => T): T {
  return context.run({ trace, span: trace.root }, run);
}

function begin(phase: DevTimingPhase) {
  const current = context.getStore();
  if (!current || current.trace.closed) return;
  const { trace, span: parent } = current, span = trace.start();
  if (parent.children++ === 0) parent.childStart = span.start;
  return { trace, span, end: () => {
    trace.finish(phase, span);
    if (--parent.children === 0 && !parent.ended) parent.childMs += Math.max(0, trace.now() - parent.childStart);
  } };
}
export function devTimeSync<T>(phase: DevTimingPhase, run: () => T): T {
  const timing = begin(phase); if (!timing) return run();
  try { return context.run(timing, run); } finally { timing.end(); }
}
export function devTime<T>(phase: DevTimingPhase, run: () => Promise<T>): Promise<T> {
  const timing = begin(phase); if (!timing) return run();
  return context.run(timing, async () => { try { return await run(); } finally { timing.end(); } });
}

/** Retains the original connection object (including driver-owned release symbols). */
export function instrumentDevDriver(driver: Driver): Driver {
  const acquire = driver.acquireConnection.bind(driver), wrapped = new WeakSet<DatabaseConnection>();
  driver.acquireConnection = async () => {
    const connection = await devTime('pool', acquire);
    if (!wrapped.has(connection)) {
      const execute = connection.executeQuery.bind(connection);
      connection.executeQuery = <R>(query: CompiledQuery) => devTime('sql', () => execute<R>(query));
      wrapped.add(connection);
    }
    return connection;
  };
  return driver;
}

const routes = new Set(['/api/worlds/:worldSlug/village', '/api/worlds/:worldSlug/starter', '/api/worlds/:worldSlug/starter/terrain',
  '/api/worlds/:worldSlug/terrain', '/api/worlds/:worldSlug/terrain/updates',
  '/api/worlds/:worldSlug/terrain/overview', '/api/worlds/:worldSlug/terrain/overview/vegetation',
  '/api/worlds/:worldSlug/terrain/overview/villages']);

export function instrumentDevTimings(app: FastifyInstance, isProduction: boolean) {
  if (isProduction) return;
  const traces = new WeakMap<FastifyRequest, DevTimingTrace>();
  app.addHook('onRequest', (request, _reply, done) => {
    if (request.method !== 'GET' || request.headers[DEV_TIMING_HEADER] !== '1' || !routes.has(request.routeOptions.url ?? '')) return done();
    const trace = new DevTimingTrace(); traces.set(request, trace);
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
  app.addHook('onResponse', (request, _reply, done) => { const trace = traces.get(request); if (trace) trace.closed = true; done(); });
}
