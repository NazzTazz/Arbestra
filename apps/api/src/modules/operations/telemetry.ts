import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  AdminRuntimeSnapshot,
  HttpCaptureSite,
  HttpRequestDetail,
  HttpRequestReference,
  OperationalEvent,
  OperationalSample,
  OperationalStatusReason,
  OperationalWorker,
} from '@arbestra/contracts';
import {
  HttpDiagnostics,
  safeHttpAnnotation,
  type HttpAnnotation,
  type HttpDiagnosticLogger,
} from './http-diagnostics.js';

const WINDOW_MS = 300_000;
const MAX_LATENCIES = 4096;
type Bucket = {
  second: number;
  requests: number;
  responses: number;
  aborted: number;
  errors4xx: number;
  errors5xx: number;
};
type Stream = { accountId: string; worldId: string };

export function percentile(values: readonly number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
}

/** Bounded, process-local observations. No SQL and no awaited work on command paths. */
export class OperationsTelemetry {
  readonly instanceId = randomUUID();
  readonly startedAt: string;
  readonly httpDiagnostics: HttpDiagnostics;
  private buckets: Bucket[] = [];
  private latencies: Array<{ at: number; ms: number }> = [];
  private samples: OperationalSample[] = [];
  private incidents: OperationalEvent[] = [];
  private streams = new Map<object, Stream>();
  private readers = new Map<string, () => OperationalWorker>();
  private inFlight = 0;
  private failures = 0;
  private lastSseEvent: string | null = null;
  private cpu: number | null = null;
  private previousCpu = process.cpuUsage();
  private previousClock = performance.now();
  private lastPrunedSecond = -1;
  private intervalRequests = 0;
  private intervalResponses = 0;
  private intervalAborted = 0;
  private intervalStartedAt: number;
  private intervalErrors = 0;
  private intervalLatencies: number[] = [];
  private histogram = monitorEventLoopDelay({ resolution: 20 });
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(
    private readonly now: () => number = Date.now,
    automatic = true,
    options: { slowThresholdMs?: number; httpLogger?: HttpDiagnosticLogger } = {},
  ) {
    this.startedAt = new Date(now()).toISOString();
    this.intervalStartedAt = now();
    this.httpDiagnostics = new HttpDiagnostics(
      this.instanceId,
      this.startedAt,
      now,
      options.slowThresholdMs,
      options.httpLogger,
    );
    if (automatic) {
      this.histogram.enable();
      this.timer = setInterval(() => this.sample(), 5000);
      this.timer.unref();
    }
  }

  beginRequest(): () => void {
    this.inFlight++;
    let ended = false;
    return () => {
      if (!ended) {
        ended = true;
        this.inFlight = Math.max(0, this.inFlight - 1);
      }
    };
  }

  recordRequest(ms: number, status: number): void {
    const at = this.now();
    const bucket = this.bucket(at);
    bucket.requests++;
    bucket.responses++;
    this.intervalRequests++;
    this.intervalResponses++;
    if (status >= 400 && status < 500) bucket.errors4xx++;
    if (status >= 500) {
      bucket.errors5xx++;
      this.intervalErrors++;
    }
    this.intervalLatencies.push(Math.max(0, ms));
    if (this.intervalLatencies.length > MAX_LATENCIES) this.intervalLatencies.shift();
    this.latencies.push({ at, ms: Math.max(0, ms) });
    if (this.latencies.length > MAX_LATENCIES) this.latencies.splice(0, this.latencies.length - MAX_LATENCIES);
  }

  recordAborted(): void {
    const bucket = this.bucket(this.now());
    bucket.requests++;
    bucket.aborted++;
    this.intervalRequests++;
    this.intervalAborted++;
  }

  /** Call only with fixed application codes/messages, never a raw Error or user payload. */
  event(
    code: string,
    message: string,
    severity: OperationalEvent['severity'] = 'warning',
    context?: { worldId: string; villageId?: string },
    httpRequest?: HttpRequestReference | null,
  ): void {
    // Every successful access is logged by auth; repeated polling must not bury incidents.
    if (code === 'ADMIN_ACCESS') return;
    this.incidents.unshift({
      id: randomUUID(),
      at: new Date(this.now()).toISOString(),
      code,
      message,
      severity,
      worldId: context?.worldId ?? null,
      villageId: context?.villageId ?? null,
      httpRequest: httpRequest ? { ...httpRequest } : null,
    });
    this.incidents.length = Math.min(this.incidents.length, 100);
  }

  openStream(key: object, accountId: string, worldId: string): () => void {
    this.streams.set(key, { accountId, worldId });
    return () => {
      this.streams.delete(key);
    };
  }
  sseEvent(): void {
    this.lastSseEvent = new Date(this.now()).toISOString();
  }
  sseFailure(worldId: string, villageId: string, httpRequest?: HttpRequestReference | null): void {
    this.failures++;
    this.event(
      'SSE_INTERRUPTED',
      'Un flux village a été interrompu côté serveur.',
      'warning',
      { worldId, villageId },
      httpRequest,
    );
  }
  observeWorker(id: string, read: () => OperationalWorker): void {
    this.readers.set(id, read);
  }

  sample(): void {
    const at = this.now(),
      clock = performance.now(),
      usage = process.cpuUsage();
    const elapsed = clock - this.previousClock;
    this.cpu =
      elapsed > 0
        ? Math.round(
            ((usage.user - this.previousCpu.user + usage.system - this.previousCpu.system) / (elapsed * 1000)) * 10_000,
          ) / 100
        : null;
    this.previousClock = clock;
    this.previousCpu = usage;
    this.prune(at);
    this.samples.push({
      at: new Date(at).toISOString(),
      from: new Date(this.intervalStartedAt).toISOString(),
      to: new Date(at).toISOString(),
      requests: this.intervalRequests,
      responses: this.intervalResponses,
      aborted: this.intervalAborted,
      sampledResponses: this.intervalLatencies.length,
      truncated: this.intervalResponses > this.intervalLatencies.length,
      errors5xx: this.intervalErrors,
      p95Ms: percentile(this.intervalLatencies, 0.95),
      rssBytes: process.memoryUsage().rss,
      cpuPercent: this.cpu,
    });
    if (this.samples.length > 120) this.samples.shift();
    this.intervalStartedAt = at;
    this.intervalRequests = 0;
    this.intervalResponses = 0;
    this.intervalAborted = 0;
    this.intervalErrors = 0;
    this.intervalLatencies = [];
  }

  snapshot(database: AdminRuntimeSnapshot['database']): AdminRuntimeSnapshot {
    const at = this.now();
    this.prune(at);
    const memory = process.memoryUsage(),
      durations = this.latencies.map((v) => v.ms);
    const counts = this.buckets.reduce(
      (total, b) => ({
        requests: total.requests + b.requests,
        responses: total.responses + b.responses,
        aborted: total.aborted + b.aborted,
        errors4xx: total.errors4xx + b.errors4xx,
        errors5xx: total.errors5xx + b.errors5xx,
      }),
      { requests: 0, responses: 0, aborted: 0, errors4xx: 0, errors5xx: 0 },
    );
    const worlds = new Map<string, { connections: number; accounts: Set<string> }>();
    for (const stream of this.streams.values()) {
      const value = worlds.get(stream.worldId) ?? { connections: 0, accounts: new Set<string>() };
      value.connections++;
      value.accounts.add(stream.accountId);
      worlds.set(stream.worldId, value);
    }
    const workers = [...this.readers.entries()].map(([id, read]): OperationalWorker => {
      try {
        return read();
      } catch {
        return {
          id,
          label: id,
          status: 'unknown',
          active: null,
          lastObservedAt: null,
          lastSuccessAt: null,
          lastErrorAt: null,
          note: 'Observation indisponible.',
        };
      }
    });
    workers.push({
      id: 'world-generator',
      label: 'Générateur de mondes',
      status: 'unknown',
      active: null,
      lastObservedAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      note: 'Processus externe non instrumenté ; ses travaux persistés restent consultables.',
    });
    const degraded = counts.errors5xx > 0 || workers.some((w) => w.status === 'degraded' || w.status === 'unavailable');
    const status =
      database.status === 'unavailable'
        ? 'unavailable'
        : degraded || database.status === 'degraded'
          ? 'degraded'
          : database.status === 'unknown' || workers.some((w) => w.status === 'unknown')
            ? 'unknown'
            : 'available';
    const observedAt = new Date(at).toISOString();
    const statusReasons: OperationalStatusReason[] = [];
    if (counts.errors5xx)
      statusReasons.push({
        code: 'HTTP_5XX_WINDOW',
        source: 'http',
        status: 'degraded',
        message: 'Des réponses 5xx sont présentes dans la fenêtre HTTP de cinq minutes.',
        observedAt,
        from: new Date(at - WINDOW_MS).toISOString(),
        to: observedAt,
        count: counts.errors5xx,
        workerId: null,
      });
    if (database.status !== 'available')
      statusReasons.push({
        code: 'DATABASE_' + database.status.toUpperCase(),
        source: database.status === 'unknown' ? 'coverage' : 'database',
        status: database.status,
        message:
          database.status === 'unknown'
            ? 'La sonde PostgreSQL ne dispose pas d’une observation actuelle.'
            : database.status === 'unavailable'
              ? 'La sonde PostgreSQL est indisponible.'
              : 'La latence de la sonde PostgreSQL dépasse son seuil.',
        observedAt: database.observedAt,
        from: null,
        to: null,
        count: null,
        workerId: null,
      });
    for (const worker of workers)
      if (worker.status !== 'available')
        statusReasons.push({
          code: 'WORKER_' + worker.status.toUpperCase(),
          source: worker.status === 'unknown' ? 'coverage' : 'worker',
          status: worker.status,
          message:
            worker.status === 'unknown'
              ? 'Ce composant ne dispose pas d’une observation actuelle.'
              : 'Le dernier signal de ce worker demande une vérification.',
          observedAt: worker.lastObservedAt,
          from: null,
          to: null,
          count: null,
          workerId: worker.id,
        });
    return {
      observedAt: new Date(at).toISOString(),
      instanceId: this.instanceId,
      startedAt: this.startedAt,
      scope: 'api-process',
      status,
      statusReasons,
      httpDiagnostics: this.httpDiagnostics.metadata(),
      process: {
        uptimeSeconds: Math.max(0, (at - Date.parse(this.startedAt)) / 1000),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        cpuPercent: this.cpu,
        eventLoopDelayP95Ms: this.histogram.count ? this.histogram.percentile(95) / 1e6 : null,
      },
      http: {
        windowSeconds: WINDOW_MS / 1000,
        ...counts,
        activeRequests: this.inFlight,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        p99Ms: percentile(durations, 0.99),
        sampledRequests: durations.length,
        truncated: counts.responses > durations.length,
      },
      series: this.samples.map((s) => ({ ...s })),
      database,
      workers,
      sse: {
        connections: this.streams.size,
        accounts: new Set([...this.streams.values()].map((s) => s.accountId)).size,
        worlds: [...worlds].map(([worldId, v]) => ({ worldId, connections: v.connections, accounts: v.accounts.size })),
        failures: this.failures,
        lastEventAt: this.lastSseEvent,
        note: 'Connexions et comptes distincts de cette instance ; ne mesure ni les joueurs actifs ni les autres instances.',
      },
      events: this.incidents.map((e) => ({ ...e, httpRequest: e.httpRequest ? { ...e.httpRequest } : null })),
    };
  }

  httpRequestDetail(requestId: string, instanceId: string): HttpRequestDetail {
    const observation = this.httpDiagnostics.get(requestId, instanceId);
    return {
      observation,
      metadata: this.httpDiagnostics.metadata(),
      events: this.incidents
        .filter((e) => e.httpRequest?.instanceId === instanceId && e.httpRequest.requestId === requestId)
        .map((e) => ({ ...e, httpRequest: e.httpRequest ? { ...e.httpRequest } : null })),
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.histogram.disable();
    this.streams.clear();
  }
  private prune(at: number): void {
    const second = Math.floor(at / 1000);
    if (second === this.lastPrunedSecond) return;
    this.lastPrunedSecond = second;
    this.buckets = this.buckets.filter((b) => b.second * 1000 > at - WINDOW_MS);
    this.latencies = this.latencies.filter((v) => v.at > at - WINDOW_MS);
  }
  private bucket(at: number): Bucket {
    this.prune(at);
    const second = Math.floor(at / 1000);
    let bucket = this.buckets.at(-1);
    if (bucket?.second !== second) bucket = this.buckets.find((b) => b.second === second);
    if (!bucket) {
      bucket = { second, requests: 0, responses: 0, aborted: 0, errors4xx: 0, errors5xx: 0 };
      this.buckets.push(bucket);
      if (this.buckets.length > WINDOW_MS / 1000 + 1) this.buckets.shift();
    }
    return bucket;
  }
}

// Encapsulated Fastify plugins have distinct instances but share the HTTP server.
const instruments = new WeakMap<object, OperationsTelemetry>();
type RequestObservation = {
  end: () => void;
  stream: boolean;
  annotation?: HttpAnnotation;
  reference: HttpRequestReference;
};
const requests = new WeakMap<FastifyRequest, RequestObservation>();
export const operationsFor = (app: FastifyInstance): OperationsTelemetry | undefined => instruments.get(app.server);
export const markHttpStream = (request: FastifyRequest): void => {
  const state = requests.get(request);
  if (state) {
    state.stream = true;
    state.end();
  }
};
export const httpRequestReference = (request: FastifyRequest): HttpRequestReference | null => {
  const reference = requests.get(request)?.reference;
  return reference ? { ...reference } : null;
};
export const annotateHttpRequest = (request: FastifyRequest, code: unknown, captureSite?: HttpCaptureSite): void => {
  const state = requests.get(request),
    annotation = safeHttpAnnotation(code, captureSite);
  if (state && annotation) state.annotation = annotation;
};

export function instrumentHttp(
  app: FastifyInstance,
  telemetry: OperationsTelemetry,
  clock: { now?: () => number; monotonicNow?: () => number } = {},
): void {
  const now = clock.now ?? Date.now,
    monotonicNow = clock.monotonicNow ?? (() => performance.now());
  instruments.set(app.server, telemetry);
  app.addHook('onRequest', async (request, reply) => {
    // The production app configures genReqId + requestIdHeader:false before logger creation.
    // Also support isolated Fastify instances using the default non-UUID generator.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.id))
      request.id = randomUUID();
    const start = monotonicNow(),
      startedAtMs = now(),
      end = telemetry.beginRequest();
    const state: RequestObservation = {
      end,
      stream: false,
      reference: { instanceId: telemetry.instanceId, requestId: request.id },
    };
    requests.set(request, state);
    reply.raw.setHeader('X-Request-Id', request.id);
    let completed = false;
    const finish = (responded: boolean) => {
      if (completed) return;
      completed = true;
      end();
      requests.delete(request);
      // Established streams have their own counters; refusals before hijack remain HTTP.
      if (state.stream) return;
      try {
        const durationMs = Math.max(0, monotonicNow() - start);
        if (responded) telemetry.recordRequest(durationMs, reply.raw.statusCode);
        else telemetry.recordAborted();
        const outcome = responded ? 'response' : 'aborted',
          statusCode = responded ? reply.raw.statusCode : null;
        if (!telemetry.httpDiagnostics.shouldRetain(durationMs, outcome, statusCode)) return;
        // Fast responses need aggregates only; build ISO dates and the DTO only for retained observations.
        const observation = telemetry.httpDiagnostics.record({
          requestId: state.reference.requestId,
          startedAt: new Date(startedAtMs).toISOString(),
          endedAt: new Date(now()).toISOString(),
          durationMs,
          method: request.method,
          route: request.routeOptions.url,
          outcome,
          statusCode,
          ...(state.annotation ? { annotation: state.annotation } : {}),
        });
        if (observation) {
          const error = observation.reasons.includes('server_error'),
            aborted = observation.outcome === 'aborted';
          telemetry.event(
            error ? 'HTTP_SERVER_ERROR' : aborted ? 'HTTP_CONNECTION_INTERRUPTED' : 'HTTP_SLOW_RESPONSE',
            error
              ? 'Une requête HTTP a échoué côté serveur.'
              : aborted
                ? 'Une requête HTTP s’est terminée sans réponse complète.'
                : 'Une requête HTTP a dépassé le seuil de lenteur.',
            error ? 'error' : 'warning',
            undefined,
            state.reference,
          );
        }
      } catch {
        telemetry.httpDiagnostics.collectionFailure();
      }
    };
    reply.raw.once('finish', () => finish(true));
    reply.raw.once('close', () => finish(reply.raw.writableFinished));
  });
  app.addHook('onError', async (request, _reply, error) => {
    // Only a controlled code is copied; never retain/log the exception, cause or message.
    if (safeHttpAnnotation(error.code)) annotateHttpRequest(request, error.code, 'http.on-error');
    else if (error.validation) annotateHttpRequest(request, 'VALIDATION_ERROR', 'http.on-error');
    else if (!error.statusCode || error.statusCode >= 500)
      annotateHttpRequest(request, 'INTERNAL_ERROR', 'http.on-error');
  });
  app.addHook('onClose', async () => telemetry.close());
}
