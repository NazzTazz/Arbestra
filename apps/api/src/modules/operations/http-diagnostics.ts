import type {
  HttpCaptureSite, HttpDiagnosticCode, HttpDiagnosticLogState, HttpDiagnosticsMetadata,
  HttpRequestObservation, HttpRequestsPage, HttpRequestsQuery,
} from '@arbestra/contracts';

export interface HttpDiagnosticLogger {
  write(observation: HttpRequestObservation): void;
  snapshot(): HttpDiagnosticLogState;
}
export const HTTP_RETENTION_MS = 600_000;
export const HTTP_CAPACITY = 512;
export const HTTP_MAX_OBSERVATION_BYTES = 2_048;
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE']);
const sites = new Set(['http.error-handler', 'http.on-error', 'http.finalize', 'admin.read']);
const categories: Record<string, HttpRequestObservation['errorCategory']> = {
  INTERNAL_ERROR: 'internal', ADMIN_BUSY: 'application', ADMIN_DATA_UNAVAILABLE: 'application',
  OBSERVATION_BUSY:'application',OBSERVATION_RATE:'application',OBSERVATION_LIMIT:'application',
  VALIDATION_ERROR: 'application', HTTP_SERVER_RESPONSE: 'unknown', CONNECTION_INTERRUPTED: 'transport',
};
const consoleRoutes = new Set(['session', 'overview', 'infrastructure', 'worlds', 'worlds/:id', 'accounts', 'accounts/:id',
  'villages/:id', 'activities', 'activities/:id', 'http-requests', 'http-requests/:requestId',
  'observations','observations/','observations/launch','observations/:id','observations/:id/heartbeat','observations/:id/follow','observations/:id/snapshot','observations/:id/events','observations/:id/terrain'].map(path => '/api/admin/' + path));
for(const path of ['exchange',':id',':id/heartbeat',':id/follow',':id/snapshot',':id/events',':id/terrain'])consoleRoutes.add('/api/observation/'+path);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeHttpAnnotation(code: unknown, captureSite: unknown = 'http.error-handler') {
  if (typeof code !== 'string' || !Object.hasOwn(categories, code)) return undefined;
  return { safeCode: code as HttpDiagnosticCode, errorCategory: categories[code]!,
    captureSite: (typeof captureSite === 'string' && sites.has(captureSite) ? captureSite : 'http.error-handler') as HttpCaptureSite };
}
export type HttpAnnotation = NonNullable<ReturnType<typeof safeHttpAnnotation>>;
export type HttpCompletion = {
  requestId: string; startedAt: string; endedAt: string; durationMs: number; method: string; route: string | undefined;
  outcome: 'response' | 'aborted'; statusCode: number | null; annotation?: HttpAnnotation;
};
export class HttpDiagnosticReadError extends Error {
  constructor(readonly statusCode: 400 | 404 | 409, readonly code: string, message: string) { super(message); }
}
const emptyLogs = (): HttpDiagnosticLogState => ({ mode: 'off', emitted: 0, dropped: 0, droppedRateLimit: 0,
  droppedCapacity: 0, droppedTransport: 0, queuedLines: 0, queuedBytes: 0 });

/** Completed request DTOs only. No request/reply/error references and no I/O await. */
export class HttpDiagnostics {
  private records: Array<{ value: HttpRequestObservation; endedAtMs: number }> = [];
  private nextExpirationAt = Infinity;
  private sequence = 0;
  private evicted = 0;
  private expired = 0;
  private failures = 0;
  private loggerFailures = 0;
  readonly slowThresholdMs: number;
  constructor(readonly instanceId: string, readonly startedAt: string,
    private readonly now = Date.now, threshold = 2_000, private readonly logger?: HttpDiagnosticLogger) {
    if (!Number.isInteger(threshold) || threshold < 250 || threshold > 60_000) throw Error('Invalid HTTP diagnostic threshold');
    this.slowThresholdMs = threshold;
  }

  shouldRetain(durationMs: number, outcome: HttpCompletion['outcome'], statusCode: number | null): boolean {
    return outcome === 'aborted' || durationMs >= this.slowThresholdMs || (statusCode !== null && statusCode >= 500);
  }

  record(input: HttpCompletion): HttpRequestObservation | null {
    try {
      if (!this.shouldRetain(input.durationMs, input.outcome, input.statusCode)) return null;
      const reasons: HttpRequestObservation['reasons'] = [];
      if (input.outcome === 'response' && input.statusCode !== null && input.statusCode >= 500) reasons.push('server_error');
      if (input.durationMs >= this.slowThresholdMs) reasons.push('slow');
      if (input.outcome === 'aborted') reasons.push('aborted');
      if (!reasons.length) return null;
      const endedAtMs = Date.parse(input.endedAt);
      if (!uuid.test(input.requestId) || !Number.isFinite(input.durationMs) || input.durationMs < 0 ||
        !Number.isFinite(Date.parse(input.startedAt)) || !Number.isFinite(endedAtMs) ||
        (input.outcome === 'response' && (!Number.isInteger(input.statusCode) || input.statusCode! < 100 || input.statusCode! > 599)) ||
        this.sequence >= Number.MAX_SAFE_INTEGER) throw Error('Invalid diagnostic observation');
      const route = typeof input.route === 'string' && input.route.length <= 256 && input.route.startsWith('/') &&
        !/[?#\r\n]/.test(input.route) ? input.route : 'unmatched';
      const annotation = input.outcome === 'aborted' ? safeHttpAnnotation('CONNECTION_INTERRUPTED', 'http.finalize')
        : input.statusCode !== null && input.statusCode >= 400 && input.annotation
          ? safeHttpAnnotation(input.annotation.safeCode, input.annotation.captureSite) : undefined;
      const finalAnnotation = annotation ?? (reasons.includes('server_error') ? safeHttpAnnotation('HTTP_SERVER_RESPONSE', 'http.finalize') : undefined);
      const value: HttpRequestObservation = {
        instanceId: this.instanceId, requestId: input.requestId, sequence: this.sequence + 1,
        startedAt: input.startedAt, endedAt: input.endedAt, durationMs: input.durationMs,
        method: (methods.has(input.method) ? input.method : 'OTHER') as HttpRequestObservation['method'], route, scope: consoleRoutes.has(route) ? 'console' : 'api',
        outcome: input.outcome, statusCode: input.outcome === 'aborted' ? null : input.statusCode,
        reasons, slowThresholdMs: this.slowThresholdMs, safeCode: finalAnnotation?.safeCode ?? null,
        errorCategory: finalAnnotation?.errorCategory ?? (input.statusCode !== null && input.statusCode >= 400 ? 'unknown' : null),
        captureSite: finalAnnotation?.captureSite ?? 'http.finalize',
      };
      if (Buffer.byteLength(JSON.stringify(value)) > HTTP_MAX_OBSERVATION_BYTES) throw Error('Oversized diagnostic observation');
      this.prune(); this.sequence++;
      this.records.push({ value, endedAtMs });
      this.nextExpirationAt = Math.min(this.nextExpirationAt, endedAtMs + HTTP_RETENTION_MS);
      if (this.records.length > HTTP_CAPACITY) { this.records.shift(); this.evicted++; }
      try { this.logger?.write({ ...value, reasons: [...value.reasons] }); } catch { this.loggerFailures++; }
      return { ...value, reasons: [...value.reasons] };
    } catch { this.failures++; return null; }
  }

  collectionFailure(): void { this.failures++; }
  metadata(): HttpDiagnosticsMetadata {
    this.prune();
    let logs = emptyLogs();
    try { logs = this.logger?.snapshot() ?? logs; } catch { this.loggerFailures++; }
    return { observedAt: new Date(this.now()).toISOString(), instanceId: this.instanceId, startedAt: this.startedAt,
      slowThresholdMs: this.slowThresholdMs, retentionMs: HTTP_RETENTION_MS, capacity: HTTP_CAPACITY,
      retained: this.records.length, oldestRetainedAt: this.records.reduce<(typeof this.records)[number] | null>((oldest, row) =>
        oldest === null || row.endedAtMs < oldest.endedAtMs ? row : oldest, null)?.value.endedAt ?? null,
      evicted: this.evicted, expired: this.expired, collectionFailures: this.failures,
      logs: { ...logs, dropped: logs.dropped + this.loggerFailures, droppedTransport: logs.droppedTransport + this.loggerFailures } };
  }
  list(query: HttpRequestsQuery = {}): HttpRequestsPage {
    this.assertInstance(query.instanceId);
    const now = this.now(), to = query.to === undefined ? now : Date.parse(query.to);
    const from = query.from === undefined ? to - HTTP_RETENTION_MS : Date.parse(query.from);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > HTTP_RETENTION_MS) {
      throw new HttpDiagnosticReadError(400, 'INVALID_HTTP_WINDOW', 'La fenêtre doit être ordonnée et limitée à dix minutes.');
    }
    const snapshot = query.snapshotSequence ?? this.sequence;
    if (!Number.isSafeInteger(snapshot) || snapshot < 0 || snapshot > this.sequence ||
      (query.beforeSequence !== undefined && (query.snapshotSequence === undefined || !query.instanceId || !query.from || !query.to ||
        query.beforeSequence < 0 || query.beforeSequence > snapshot || !Number.isSafeInteger(query.beforeSequence)))) {
      throw new HttpDiagnosticReadError(400, 'INVALID_HTTP_CURSOR', 'Curseur invalide ou fenêtre de pagination manquante.');
    }
    this.prune();
    const matching = this.records.filter(({ value: row, endedAtMs }) => row.sequence <= snapshot &&
      (query.beforeSequence === undefined || row.sequence < query.beforeSequence) &&
      endedAtMs >= from && endedAtMs < to &&
      (!query.reason || row.reasons.includes(query.reason)) && (!query.method || row.method === query.method) &&
      (!query.route || row.route === query.route) && (!query.scope || row.scope === query.scope) &&
      (!query.requestId || row.requestId === query.requestId) && row.durationMs >= (query.minDurationMs ?? 0)).reverse();
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpDiagnosticReadError(400, 'INVALID_HTTP_LIMIT', 'Page limitée à cent observations.');
    const items = matching.slice(0, limit).map(({ value: row }) => ({ ...row, reasons: [...row.reasons] }));
    return { metadata: this.metadata(), from: new Date(from).toISOString(), to: new Date(to).toISOString(), snapshotSequence: snapshot,
      nextBeforeSequence: matching.length > items.length ? items.at(-1)!.sequence : null, items };
  }
  get(requestId: string, instanceId: string): HttpRequestObservation {
    this.assertInstance(instanceId); this.prune();
    const row = this.records.find(record => record.value.requestId === requestId)?.value;
    if (!row) throw new HttpDiagnosticReadError(404, 'HTTP_OBSERVATION_NOT_RETAINED', 'Cette observation n’est pas conservée dans cette instance.');
    return { ...row, reasons: [...row.reasons] };
  }
  private assertInstance(instanceId: string | undefined) {
    if (instanceId !== undefined && instanceId !== this.instanceId) throw new HttpDiagnosticReadError(409, 'INSTANCE_MISMATCH', 'La référence appartient à une autre instance.');
  }
  private prune() {
    const now = this.now();
    // Exact deadline, not a rounded time bucket: reads never expose expired rows.
    if (now < this.nextExpirationAt) return;
    const cut = now - HTTP_RETENTION_MS;
    this.nextExpirationAt = Infinity;
    // Wall time may move: expiry does not assume timestamps follow sequence order.
    this.records = this.records.filter(row => {
      if (row.endedAtMs <= cut) { this.expired++; return false; }
      this.nextExpirationAt = Math.min(this.nextExpirationAt, row.endedAtMs + HTTP_RETENTION_MS);
      return true;
    });
  }
}
