import type { HttpDiagnosticsMetadata, OperationalEvent, OperationalStatusReason } from './http-diagnostics.js';
export type { OperationalEvent } from './http-diagnostics.js';
/** Observations of the responding API process; never a fleet-wide promise. */
export type OperationalStatus = 'available' | 'degraded' | 'unavailable' | 'unknown';

export interface OperationalWorker {
  id: string;
  label: string;
  status: OperationalStatus;
  active: number | null;
  lastObservedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  note: string;
}

export interface OperationalSample {
  at: string;
  from: string;
  to: string;
  requests: number;
  responses: number;
  aborted: number;
  sampledResponses: number;
  truncated: boolean;
  errors5xx: number;
  p95Ms: number | null;
  rssBytes: number;
  cpuPercent: number | null;
}

export interface AdminRuntimeSnapshot {
  observedAt: string;
  instanceId: string;
  startedAt: string;
  scope: 'api-process';
  status: OperationalStatus;
  statusReasons: OperationalStatusReason[];
  httpDiagnostics: HttpDiagnosticsMetadata;
  process: {
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    cpuPercent: number | null;
    eventLoopDelayP95Ms: number | null;
  };
  http: {
    windowSeconds: number;
    requests: number;
    responses: number;
    aborted: number;
    errors4xx: number;
    errors5xx: number;
    activeRequests: number;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    sampledRequests: number;
    truncated: boolean;
  };
  series: OperationalSample[];
  database: {
    status: OperationalStatus;
    latencyMs: number | null;
    observedAt: string | null;
    connections: number | null;
    activeQueries: number | null;
    note: string;
  };
  workers: OperationalWorker[];
  sse: {
    connections: number;
    accounts: number;
    worlds: Array<{ worldId: string; connections: number; accounts: number }>;
    failures: number;
    lastEventAt: string | null;
    note: string;
  };
  events: OperationalEvent[];
}
