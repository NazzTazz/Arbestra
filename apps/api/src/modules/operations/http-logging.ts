import { performance } from 'node:perf_hooks';
import type { FastifyBaseLogger, FastifyServerOptions } from 'fastify';
import type { HttpDiagnosticLogState, HttpRequestObservation } from '@arbestra/contracts';
import type { HttpDiagnosticLogger } from './http-diagnostics.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE']);
const CODES = new Set(['INTERNAL_ERROR', 'ADMIN_BUSY', 'ADMIN_DATA_UNAVAILABLE', 'VALIDATION_ERROR',
  'TRADE_PREPARATION_BUSY',
  'OBSERVATION_BUSY','OBSERVATION_RATE','OBSERVATION_LIMIT','OBSERVATION_DB_INTERRUPTED',
  'HTTP_SERVER_RESPONSE', 'CONNECTION_INTERRUPTED', 'AUTHENTICATION_REQUIRED', 'INVALID_CREDENTIALS',
  'ADMIN_DISABLED', 'ADMIN_REQUIRED', 'ADMIN_HTTPS_REQUIRED', 'INVALID_ORIGIN', 'ADMIN_ORIGIN_REQUIRED',
  'TOO_MANY_ATTEMPTS', 'EXPEDITION_LISTENER_INTERRUPTED', 'EXPEDITION_PREPARATION_INTERRUPTED',
  'SCHEDULER_FAILED', 'SERVER_LISTEN_FAILED', 'POSTGRES_CONNECTION_INTERRUPTED',
  'SSE_INTERRUPTED', 'SSE_RECEIPTS_INTERRUPTED']);
const DIAGNOSTIC_CODES = new Set(['INTERNAL_ERROR', 'ADMIN_BUSY', 'ADMIN_DATA_UNAVAILABLE',
  'TRADE_PREPARATION_BUSY',
  'OBSERVATION_BUSY','OBSERVATION_RATE','OBSERVATION_LIMIT',
  'VALIDATION_ERROR', 'HTTP_SERVER_RESPONSE', 'CONNECTION_INTERRUPTED']);
const ERROR_CATEGORIES = new Set(['application', 'internal', 'transport', 'unknown']);
const OBSERVATION_AUDIT_EVENTS=new Set(['admin.observation_opened','admin.observation_closed','admin.observation_stopped','admin.observation_follow']);
const OBSERVATION_REASONS=new Set(['closed','expired','shutdown','owner_changed','authorization_timeout','authorization_revoked']);
const AUDIT_EVENTS = new Set(['admin.access', 'admin.denied', 'admin.session_created', 'admin.session_deleted',...OBSERVATION_AUDIT_EVENTS]);
const ACTIONS = new Set(['read', 'login', 'logout', 'session', 'probe', 'worlds','observe','observation_open','observe_stream','observe_terrain','observe_follow']);
const CAPTURE_SITES = new Set(['http.error-handler', 'http.on-error', 'http.finalize', 'admin.read']);
const MAX_LINES = 256;
const MAX_BYTES = 512 * 1024;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function uuid(value: unknown): string | undefined { return typeof value === 'string' && UUID.test(value) ? value : undefined; }
function known(value: unknown, choices: ReadonlySet<string>, fallback: string): string {
  return typeof value === 'string' && choices.has(value) ? value : fallback;
}
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0; }
function date(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ? value : null;
}
function route(value: unknown): string {
  return typeof value === 'string' && value.length <= 256 && value.startsWith('/') && !/[?#\r\n]/.test(value) ? value : 'unmatched';
}

/** Copy only fixed fields; never retain the supplied object or traverse Error causes. */
function observation(value: unknown): Record<string, unknown> {
  const source = object(value);
  return { instanceId: uuid(source.instanceId) ?? null, requestId: uuid(source.requestId) ?? null,
    sequence: number(source.sequence), startedAt: date(source.startedAt), endedAt: date(source.endedAt),
    durationMs: number(source.durationMs), method: known(source.method, METHODS, 'OTHER'), route: route(source.route),
    scope: source.scope === 'console' ? 'console' : 'api', outcome: source.outcome === 'aborted' ? 'aborted' : 'response',
    statusCode: typeof source.statusCode === 'number' && Number.isInteger(source.statusCode) && source.statusCode >= 100 && source.statusCode <= 599 ? source.statusCode : null,
    reasons: ['server_error', 'slow', 'aborted'].filter(reason => Array.isArray(source.reasons) && source.reasons.includes(reason)),
    slowThresholdMs: number(source.slowThresholdMs), safeCode: source.safeCode === null ? null : known(source.safeCode, DIAGNOSTIC_CODES, 'INTERNAL_ERROR'),
    errorCategory: source.errorCategory === null ? null : known(source.errorCategory, ERROR_CATEGORIES, 'unknown'),
    captureSite: known(source.captureSite, CAPTURE_SITES, 'http.finalize') };
}

export function safeRequestLog(value: unknown): Record<string, unknown> {
  const source = object(value), options = object(source.routeOptions);
  return { requestId: uuid(source.id) ?? null, method: known(source.method, METHODS, 'OTHER'), route: route(options.url) };
}
export function safeErrorLog(): { type: string; message: string; stack: string } {
  return { type: 'Error', message: 'Internal error details omitted', stack: '' };
}
function safeResponseLog(value: unknown): { statusCode?: number } {
  const status = object(value).statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? { statusCode: status } : {};
}
function safeLog(value: unknown): Record<string, unknown> {
  const source = object(value);
  if (source.event === 'http.diagnostic') return { event: 'http.diagnostic', ...observation(source.observation) };
  const event = known(source.event, AUDIT_EVENTS, 'application.log');
  const result: Record<string, unknown> = { event };
  if (source instanceof Error || source.err || source.error) result.code = 'INTERNAL_ERROR';
  if (source.code !== undefined) result.code = known(source.code, CODES, 'INTERNAL_ERROR');
  if (source.reason !== undefined) result.reason = known(source.reason,OBSERVATION_AUDIT_EVENTS.has(event)?OBSERVATION_REASONS:CODES,'INTERNAL_ERROR');
  if (source.action !== undefined) result.action = known(source.action, ACTIONS, 'read');
  if (uuid(source.actorId)) result.actorId = source.actorId;
  if (uuid(source.requestId)) result.requestId = source.requestId;
  if(OBSERVATION_AUDIT_EVENTS.has(event))for(const field of ['worldId','villageId','observationId','sourceId'])if(uuid(source[field]))result[field]=source[field];
  // Pino applies the configured serializer synchronously before queuing the string.
  if (source.req) result.req = source.req;
  if (source.res) result.res = safeResponseLog(source.res);
  return result;
}

// Pino descendants may append bindings without applying the root binding formatter.
// Project the serialized line again before it can reach the queue or stdout.
function safeLine(line: string): string {
  const source = object(JSON.parse(line));
  const fields = source.event === 'http.diagnostic'
    ? { event: 'http.diagnostic', ...observation(source) } : safeLog(source);
  if (fields.req) {
    const req = object(fields.req);
    fields.req = { requestId: uuid(req.requestId) ?? null, method: known(req.method, METHODS, 'OTHER'), route: route(req.route) };
  }
  return JSON.stringify({ level: number(source.level), time: number(source.time),
    ...(uuid(source.reqId) ? { reqId: source.reqId } : {}), ...fields, msg: 'Application event' }) + '\n';
}

export type DiagnosticLogSink = (line: string, done: (error?: Error | null) => void) => void;
type Entry = { line: string; bytes: number; diagnostic: boolean; settled: boolean };
let stdoutGuardInstalled = false;
function stdoutSink(line: string, done: (error?: Error | null) => void): void {
  if (!stdoutGuardInstalled) {
    // Write callbacks account for failures. A stream error must not terminate the API.
    process.stdout.on('error', () => undefined);
    stdoutGuardInstalled = true;
  }
  process.stdout.write(line, done);
}

/** One asynchronous stdout queue shared with audit logs, including the in-flight line. */
export function createHttpLogging(
  mode: 'anomalies' | 'off' = 'anomalies',
  sink: DiagnosticLogSink = stdoutSink,
  now: () => number = () => performance.now(),
) {
  const queue: Entry[] = [];
  let inFlight: Entry | undefined, queuedBytes = 0, scheduled: NodeJS.Immediate | undefined, closed = false;
  let emitted = 0, droppedRateLimit = 0, droppedCapacity = 0, droppedTransport = 0;
  let tokens = 40, lastRefill = now();
  const pendingLines = () => queue.length + (inFlight ? 1 : 0);
  const schedule = () => {
    if (closed || scheduled || inFlight || !queue.length) return;
    scheduled = setImmediate(() => { scheduled = undefined; pump(); });
    scheduled.unref();
  };
  const finish = (entry: Entry, error?: Error | null) => {
    if (entry.settled) return;
    entry.settled = true;
    queuedBytes -= entry.bytes;
    if (entry.diagnostic) { if (error) droppedTransport++; else emitted++; }
    if (inFlight === entry) inFlight = undefined;
    schedule();
  };
  const pump = () => {
    if (closed || inFlight) return;
    const entry = queue.shift();
    if (!entry) return;
    inFlight = entry;
    try { sink(entry.line, error => finish(entry, error)); }
    catch { finish(entry, new Error('Log transport failed')); }
  };
  const stream = { write(line: string): void {
    const diagnostic = line.includes('"event":"http.diagnostic"');
    if (closed) { if (diagnostic) droppedTransport++; return; }
    if (Buffer.byteLength(line) > MAX_BYTES) { if (diagnostic) droppedCapacity++; return; }
    try { line = safeLine(line); }
    catch { if (diagnostic) droppedTransport++; return; }
    const bytes = Buffer.byteLength(line);
    if (pendingLines() >= MAX_LINES || queuedBytes + bytes > MAX_BYTES) {
      if (diagnostic) droppedCapacity++;
      return;
    }
    queue.push({ line, bytes, diagnostic, settled: false }); queuedBytes += bytes; schedule();
  } };
  const loggerOptions: Exclude<NonNullable<FastifyServerOptions['logger']>, boolean> & { stream: typeof stream } = {
    level: 'info', base: null, stream,
    serializers: { req: safeRequestLog, res: safeResponseLog, err: safeErrorLog, error: safeErrorLog },
    formatters: { bindings: bindings => uuid(bindings.reqId) ? { reqId: bindings.reqId } : {} },
    hooks: { logMethod(args, method) {
      let diagnostic = false;
      try {
        diagnostic = object(args[0]).event === 'http.diagnostic';
        method.call(this, safeLog(args[0]), 'Application event');
      } catch {
        // Serialization failures remain fail-open and never log recursively.
        if (diagnostic) droppedTransport++;
      }
    } },
  };
  const diagnostics = (logger: FastifyBaseLogger): HttpDiagnosticLogger => ({
    write(value: HttpRequestObservation): void {
      if (mode === 'off') return;
      if (closed) { droppedTransport++; return; }
      const at = now();
      tokens = Math.min(40, tokens + Math.max(0, at - lastRefill) * .02); lastRefill = at;
      if (tokens < 1) { droppedRateLimit++; return; }
      tokens--;
      try { logger.info({ event: 'http.diagnostic', observation: value }, 'HTTP diagnostic'); }
      catch { droppedTransport++; }
    },
    snapshot(): HttpDiagnosticLogState {
      return { mode, emitted, dropped: droppedRateLimit + droppedCapacity + droppedTransport,
        droppedRateLimit, droppedCapacity, droppedTransport, queuedLines: pendingLines(), queuedBytes };
    },
  });
  const close = (): void => {
    closed = true;
    if (scheduled) { clearImmediate(scheduled); scheduled = undefined; }
    const pending = [...queue]; queue.length = 0;
    if (inFlight) pending.push(inFlight);
    for (const entry of pending) finish(entry, new Error('Log transport closed'));
  };
  return { loggerOptions, diagnostics, close };
}
