import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  AdminRuntimeSnapshot,
  HttpDiagnosticsMetadata,
  HttpRequestDetail,
  OperationalEvent,
} from '@arbestra/contracts';
import { HttpEvents, HttpLatencyChart, HttpRequestDetailView, StatusReasons } from './http-diagnostics';
import { useDiagnostics } from './http-data';
import { DataState } from './components';
import { absoluteTime } from './format';

vi.mock('./http-data', () => ({ useDiagnostics: vi.fn() }));
const metadata: HttpDiagnosticsMetadata = {
  observedAt: '2026-10-15T10:00:10Z',
  instanceId: '00000000-0000-4000-8000-000000000001',
  startedAt: '2026-10-15T09:00:00Z',
  slowThresholdMs: 2000,
  retentionMs: 600000,
  capacity: 512,
  retained: 1,
  oldestRetainedAt: '2026-10-15T10:00:08Z',
  evicted: 0,
  expired: 0,
  collectionFailures: 0,
  logs: {
    mode: 'anomalies',
    emitted: 1,
    dropped: 0,
    droppedRateLimit: 0,
    droppedCapacity: 0,
    droppedTransport: 0,
    queuedLines: 0,
    queuedBytes: 0,
  },
};
const detail: HttpRequestDetail = {
  metadata,
  events: [],
  observation: {
    instanceId: metadata.instanceId,
    requestId: '00000000-0000-4000-8000-000000000002',
    sequence: 1,
    startedAt: '2026-10-15T10:00:00Z',
    endedAt: '2026-10-15T10:00:08Z',
    durationMs: 8123.5,
    method: 'GET',
    route: '/api/admin/overview',
    scope: 'console',
    outcome: 'aborted',
    statusCode: null,
    reasons: ['aborted', 'slow'],
    slowThresholdMs: 2000,
    safeCode: 'CONNECTION_INTERRUPTED',
    errorCategory: 'transport',
    captureSite: 'http.finalize',
  },
};
const runtime: AdminRuntimeSnapshot = {
  observedAt: metadata.observedAt,
  instanceId: metadata.instanceId,
  startedAt: metadata.startedAt,
  scope: 'api-process',
  status: 'degraded',
  statusReasons: [
    {
      code: 'HTTP_ERRORS',
      source: 'http',
      status: 'degraded',
      message: 'Une réponse serveur en erreur.',
      observedAt: metadata.observedAt,
      from: '2026-10-15T09:55:10Z',
      to: metadata.observedAt,
      count: 1,
      workerId: null,
    },
    {
      code: 'EXTERNAL_UNKNOWN',
      source: 'coverage',
      status: 'unknown',
      message: 'Générateur non instrumenté.',
      observedAt: null,
      from: null,
      to: null,
      count: null,
      workerId: 'world-generator',
    },
  ],
  httpDiagnostics: metadata,
  process: { uptimeSeconds: 3610, rssBytes: 1024, heapUsedBytes: 512, cpuPercent: null, eventLoopDelayP95Ms: null },
  http: {
    windowSeconds: 300,
    requests: 2,
    responses: 1,
    aborted: 1,
    errors4xx: 0,
    errors5xx: 1,
    activeRequests: 0,
    p50Ms: 8,
    p95Ms: 8,
    p99Ms: 8,
    sampledRequests: 1,
    truncated: false,
  },
  series: [
    {
      at: '2026-10-15T10:00:10Z',
      from: '2026-10-15T10:00:00Z',
      to: '2026-10-15T10:00:10Z',
      requests: 1,
      responses: 0,
      aborted: 1,
      sampledResponses: 0,
      truncated: false,
      errors5xx: 0,
      p95Ms: null,
      rssBytes: 1024,
      cpuPercent: 0,
    },
  ],
  database: {
    status: 'available',
    latencyMs: 3,
    observedAt: metadata.observedAt,
    connections: 1,
    activeQueries: 0,
    note: 'Sonde.',
  },
  workers: [],
  sse: { connections: 0, accounts: 0, worlds: [], failures: 0, lastEventAt: null, note: 'Instance.' },
  events: [],
};

describe('HTTP diagnostic facts shown to operators', () => {
  it('distinguishes intentional history from failed refresh while keeping the last receipt time visible', () => {
    const props = { receivedAt: Date.now() - 120_000, error: null, loading: false, frozen: true, refresh: vi.fn() };
    expect(renderToStaticMarkup(createElement(DataState, props))).not.toContain('Anciennes données');
    const failed = renderToStaticMarkup(createElement(DataState, { ...props, error: 'Lecture indisponible.' }));
    expect(failed).toContain('Anciennes données');
    expect(failed).toContain(absoluteTime(props.receivedAt));
    expect(failed).toContain('Lecture indisponible.');
  });
  it('never presents a closed connection as an HTTP 499 response', () => {
    vi.mocked(useDiagnostics).mockReturnValue({
      data: detail,
      receivedAt: Date.now(),
      error: null,
      loading: false,
      refresh: vi.fn(),
    });
    const html = renderToStaticMarkup(
      createElement(HttpRequestDetailView, {
        requestId: detail.observation.requestId,
        instanceId: metadata.instanceId,
        returnTo: null,
      }),
    );
    expect(html).toContain('Interrompue');
    expect(html).toContain('Statut final non observé');
    expect(html).not.toContain('499');
    expect(html).not.toContain('HTTP null');
    expect(html).toContain('8123.5');
    expect(html).toContain('Aucun événement corrélé encore conservé');
  });
  it('keeps unknown coverage visible beside an active error reason', () => {
    const html = renderToStaticMarkup(createElement(StatusReasons, { runtime }));
    expect(html).toContain('EXTERNAL_UNKNOWN');
    expect(html).toContain('HTTP_ERRORS');
    expect(html).toContain('reason=server_error');
    expect(html).toContain('instanceId=');
  });
  it('retains keyboard-accessible periods when all percentiles are absent', () => {
    const html = renderToStaticMarkup(createElement(HttpLatencyChart, { runtime }));
    expect(html).toContain('0 réponses');
    expect(html).toContain('1 interruptions');
    expect(html).toContain('Voir les requêtes retenues de cette période');
    expect(html).toContain('from=2026-10-15T10%3A00%3A00Z');
    expect(html).not.toContain('<circle');
  });
  it('only links events carrying an explicit HTTP reference', () => {
    const unrelated: OperationalEvent = {
      id: 'one',
      at: metadata.observedAt,
      severity: 'error',
      code: 'DATABASE_UNAVAILABLE',
      message: 'Sonde indisponible.',
      worldId: null,
      villageId: null,
      httpRequest: null,
    };
    expect(renderToStaticMarkup(createElement(HttpEvents, { events: [unrelated] }))).not.toContain(
      '/infrastructure/http/',
    );
    const linked = {
      ...unrelated,
      id: 'two',
      code: 'HTTP_SERVER_ERROR',
      httpRequest: { instanceId: metadata.instanceId, requestId: detail.observation.requestId },
    };
    expect(renderToStaticMarkup(createElement(HttpEvents, { events: [linked] }))).toContain(
      `/infrastructure/http/${detail.observation.requestId}`,
    );
  });
});
