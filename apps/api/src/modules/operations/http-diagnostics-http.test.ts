import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import Fastify, { type FastifyError } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AdminRuntimeSnapshot } from '@arbestra/contracts';
import { annotateHttpRequest, instrumentHttp, OperationsTelemetry } from './telemetry.js';

const database: AdminRuntimeSnapshot['database'] = { status: 'available', latencyMs: 1, observedAt: null,
  connections: 1, activeQueries: 0, note: 'Test' };

function signal() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('Barrier timed out: ' + label)), 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

describe('HTTP diagnostic finalization', () => {
  it('keeps IDs, errors and durations independent across two requests forced to overlap', async () => {
    let monotonic = 0;
    const at = Date.parse('2026-10-15T12:00:00Z');
    const app = Fastify({ genReqId: () => randomUUID(), requestIdHeader: false });
    const metrics = new OperationsTelemetry(() => at, false, { slowThresholdMs: 250 });
    instrumentHttp(app, metrics, { now: () => at, monotonicNow: () => monotonic });
    const enteredError = signal(), enteredSuccess = signal(), releaseError = signal(), releaseSuccess = signal();
    let errorCompleted = false, successCompleted = false;
    app.setErrorHandler<FastifyError>((error, request, reply) => {
      annotateHttpRequest(request, error.code);
      return reply.code(503).send({ code: 'ADMIN_BUSY' });
    });
    app.get<{ Params: { kind: string } }>('/overlap/:kind', async request => {
      if (request.params.kind === 'error') {
        enteredError.release(); await within(releaseError.promise, 'release error route');
        const error = new Error('Private failure'); Object.assign(error, { code: 'ADMIN_BUSY' }); throw error;
      }
      enteredSuccess.release(); await within(releaseSuccess.promise, 'release success route');
      return { ok: true };
    });
    const pending: Promise<unknown>[] = [];
    try {
      const errorResponse = app.inject('/overlap/error').then(response => { errorCompleted = true; return response; });
      pending.push(errorResponse);
      await within(enteredError.promise, 'error entered');
      monotonic = 100;
      const successResponse = app.inject('/overlap/success').then(response => { successCompleted = true; return response; });
      pending.push(successResponse);
      await within(enteredSuccess.promise, 'success entered while error is held');
      expect([errorCompleted, successCompleted]).toEqual([false, false]);
      expect(metrics.snapshot(database).http).toMatchObject({ activeRequests: 2, requests: 0 });

      monotonic = 450; releaseError.release();
      const failed = await within(errorResponse, 'error completed while success is held');
      expect(successCompleted).toBe(false);
      expect(metrics.snapshot(database).http).toMatchObject({ activeRequests: 1, requests: 1, errors5xx: 1 });
      monotonic = 900; releaseSuccess.release();
      const succeeded = await within(successResponse, 'success completed');
      const errorId = failed.headers['x-request-id'] as string, successId = succeeded.headers['x-request-id'] as string;
      expect(errorId).not.toBe(successId);
      expect(failed.statusCode).toBe(503); expect(succeeded.statusCode).toBe(200);
      const failedDetail = metrics.httpRequestDetail(errorId, metrics.instanceId);
      const successDetail = metrics.httpRequestDetail(successId, metrics.instanceId);
      expect(failedDetail.observation).toMatchObject({ requestId: errorId, route: '/overlap/:kind', durationMs: 450,
        safeCode: 'ADMIN_BUSY', errorCategory: 'application', reasons: ['server_error', 'slow'], statusCode: 503 });
      expect(successDetail.observation).toMatchObject({ requestId: successId, route: '/overlap/:kind', durationMs: 800,
        safeCode: null, errorCategory: null, reasons: ['slow'], statusCode: 200 });
      expect(failedDetail.events.map(event => event.httpRequest?.requestId)).toEqual([errorId]);
      expect(successDetail.events.map(event => event.httpRequest?.requestId)).toEqual([successId]);
      expect(metrics.snapshot(database).http).toMatchObject({ activeRequests: 0, requests: 2, responses: 2 });
    } finally {
      releaseError.release(); releaseSuccess.release();
      try { await within(Promise.allSettled(pending), 'all request cleanup'); } finally { await app.close(); }
    }
  });

  it('links only explicit event references, and returns no events after their separate bounded history evicts them', async () => {
    const at = Date.parse('2026-10-15T12:00:00Z');
    const app = Fastify(), metrics = new OperationsTelemetry(() => at, false);
    instrumentHttp(app, metrics, { now: () => at });
    app.get('/failure', async (_request, reply) => reply.code(503).send({ code: 'SAFE_FAILURE' }));
    try {
      const response = await app.inject('/failure'), requestId = response.headers['x-request-id'] as string;
      metrics.event('POSTGRES_PROBE_FAILED', 'La sonde PostgreSQL a échoué.', 'error');
      const samePeriod = metrics.snapshot(database).events;
      expect(new Set(samePeriod.map(event => event.at)).size).toBe(1);
      expect(samePeriod).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'POSTGRES_PROBE_FAILED', httpRequest: null })]));
      const detail = metrics.httpRequestDetail(requestId, metrics.instanceId);
      expect(detail.events.map(event => event.code)).toEqual(['HTTP_SERVER_ERROR']);
      for (let i = 0; i < 100; i++) metrics.event('UNRELATED_SIGNAL', 'Un signal indépendant est arrivé.');
      expect(metrics.snapshot(database).events).toHaveLength(100);
      const retained = metrics.httpRequestDetail(requestId, metrics.instanceId);
      expect(retained.observation).toEqual(detail.observation);
      expect(retained.metadata.retained).toBe(1);
      expect(retained.events).toEqual([]); // Empty retained events makes no claim about the historical absence of events.
    } finally { await app.close(); }
  });

  it('keeps actual HTTP bodies and aggregate counters when the diagnostic collector throws at runtime', async () => {
    let monotonic = 0;
    const app = Fastify(), metrics = new OperationsTelemetry(Date.now, false, { slowThresholdMs: 250 });
    instrumentHttp(app, metrics, { monotonicNow: () => monotonic });
    app.get('/success', async () => { monotonic += 400; return { ok: true, version: 7 }; });
    app.get('/unavailable', async (_request, reply) => { monotonic += 400; return reply.code(503).send({ code: 'FIXED_UNAVAILABLE' }); });
    const failure = new Error('Injected collector failure with private content');
    const collect = vi.spyOn(metrics.httpDiagnostics, 'record')
      .mockImplementationOnce(() => { throw failure; }).mockImplementationOnce(() => { throw failure; });
    try {
      const first = await app.inject('/success'), second = await app.inject('/unavailable');
      expect(collect).toHaveBeenCalledTimes(2);
      expect(first.statusCode).toBe(200); expect(first.body).toBe('{"ok":true,"version":7}');
      expect(second.statusCode).toBe(503); expect(second.body).toBe('{"code":"FIXED_UNAVAILABLE"}');
      expect(metrics.snapshot(database)).toMatchObject({
        http: { requests: 2, responses: 2, errors5xx: 1, sampledRequests: 2, activeRequests: 0 },
        httpDiagnostics: { retained: 0, collectionFailures: 2 },
      });
      const recovered = await app.inject('/success');
      expect(recovered.body).toBe(first.body);
      expect(metrics.httpRequestDetail(recovered.headers['x-request-id'] as string, metrics.instanceId).observation)
        .toMatchObject({ statusCode: 200, reasons: ['slow'], durationMs: 400 });
      const result = metrics.snapshot(database);
      expect(result.http).toMatchObject({ requests: 3, responses: 3, errors5xx: 1, sampledRequests: 3, activeRequests: 0 });
      expect(result.httpDiagnostics).toMatchObject({ retained: 1, collectionFailures: 2 });
      expect(JSON.stringify(result)).not.toMatch(/private content|Injected collector/);
    } finally { collect.mockRestore(); await app.close(); }
  });

  it('uses final outcomes once, normalized routes, monotonic durations and server IDs even for handled errors', async () => {
    let at = Date.parse('2026-10-15T10:00:00Z'), monotonic = 0;
    const app = Fastify({ genReqId: () => randomUUID(), requestIdHeader: false });
    const metrics = new OperationsTelemetry(() => at, false, { slowThresholdMs: 250 });
    instrumentHttp(app, metrics, { now: () => at, monotonicNow: () => monotonic });
    app.setErrorHandler<FastifyError>((error, request, reply) => {
      if (error.message === 'recovered') { monotonic += 300; return reply.code(200).send({ recovered: true }); }
      annotateHttpRequest(request, error.code === 'ADMIN_BUSY' ? 'ADMIN_BUSY' : 'INTERNAL_ERROR');
      return reply.code(error.code === 'ADMIN_BUSY' ? 503 : 500).send({ code: 'SAFE_ERROR' });
    });
    app.get('/api/admin/worlds/:id', async () => {
      monotonic += 400; at -= 1_000; // Wall-clock correction must not make duration negative.
      const error = new Error('SQL private query password'); Object.assign(error, { code: 'ADMIN_BUSY' }); throw error;
    });
    app.get('/direct', async (_request, reply) => reply.code(503).send({ code: 'private-body-code' }));
    app.get('/recovered', async () => { throw new Error('recovered'); });
    app.get('/serialization', { schema: { response: { 200: { type: 'object', required: ['required'], properties: { required: { type: 'string' } } } } } }, async () => ({}));
    try {
      const forged = randomUUID();
      const response = await app.inject({ url: '/api/admin/worlds/private-world?token=private-token',
        headers: { 'x-request-id': forged, traceparent: 'private-trace', cookie: 'private-cookie', authorization: 'private-auth' } });
      const id = response.headers['x-request-id'] as string;
      expect(id).toMatch(/^[0-9a-f-]{36}$/); expect(id).not.toBe(forged);
      const detail = metrics.httpRequestDetail(id, metrics.instanceId);
      expect(detail.observation).toMatchObject({ route: '/api/admin/worlds/:id', scope: 'console', durationMs: 400,
        statusCode: 503, reasons: ['server_error', 'slow'], safeCode: 'ADMIN_BUSY', errorCategory: 'application' });
      expect(Date.parse(detail.observation.endedAt)).toBeLessThan(Date.parse(detail.observation.startedAt));
      expect(detail.events).toHaveLength(1);
      expect(detail.events[0]?.httpRequest).toEqual({ instanceId: metrics.instanceId, requestId: id });
      const direct = await app.inject('/direct');
      expect(metrics.httpRequestDetail(direct.headers['x-request-id'] as string, metrics.instanceId).observation)
        .toMatchObject({ safeCode: 'HTTP_SERVER_RESPONSE', statusCode: 503 });
      const recovered = await app.inject('/recovered');
      expect(metrics.httpRequestDetail(recovered.headers['x-request-id'] as string, metrics.instanceId).observation)
        .toMatchObject({ safeCode: null, errorCategory: null, statusCode: 200, reasons: ['slow'] });
      const serialization = await app.inject('/serialization');
      expect(serialization.statusCode).toBe(500);
      expect(metrics.httpRequestDetail(serialization.headers['x-request-id'] as string, metrics.instanceId).observation)
        .toMatchObject({ statusCode: 500, reasons: ['server_error'] });
      const result = metrics.snapshot(database);
      expect(result.http).toMatchObject({ requests: 4, responses: 4, aborted: 0, errors5xx: 3, activeRequests: 0 });
      expect(result.httpDiagnostics.retained).toBe(4);
      expect(JSON.stringify(result)).not.toMatch(/private-|SQL|password/);
    } finally { await app.close(); }
  });

  it('counts a real interrupted connection once, outside response percentiles and 4xx, without retaining raw URL', async () => {
    const app = Fastify({ genReqId: () => randomUUID(), requestIdHeader: false }), metrics = new OperationsTelemetry(Date.now, false);
    instrumentHttp(app, metrics);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    app.get('/pending/:id', async () => { enter(); await released; return { ok: true }; });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw Error('Expected local server port');
    const request = httpRequest(`http://127.0.0.1:${address.port}/pending/private-id?token=private-token`);
    request.on('error', () => undefined); request.end();
    try {
      await Promise.race([entered, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(Error('Request did not enter')), 3000); timer.unref(); })]);
      request.destroy();
      const deadline = Date.now() + 3000;
      while (metrics.snapshot(database).http.activeRequests && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
      const result = metrics.snapshot(database);
      expect(result.http).toMatchObject({ requests: 1, responses: 0, aborted: 1, errors4xx: 0, errors5xx: 0,
        sampledRequests: 0, p95Ms: null, truncated: false, activeRequests: 0 });
      const reference = result.events[0]!.httpRequest!;
      expect(metrics.httpRequestDetail(reference.requestId, reference.instanceId).observation)
        .toMatchObject({ route: '/pending/:id', outcome: 'aborted', statusCode: null, reasons: expect.arrayContaining(['aborted']) });
      release();
      await new Promise(resolve => setImmediate(resolve));
      expect(metrics.snapshot(database).http.requests).toBe(1);
      expect(JSON.stringify(result)).not.toMatch(/private-/);
    } finally { release(); request.destroy(); await app.close(); }
  });

  it('explains status from the same window, preserves unknown coverage, and reports actual series periods', () => {
    let at = 10_000;
    const metrics = new OperationsTelemetry(() => at, false);
    try {
      metrics.recordRequest(10, 200); metrics.recordRequest(100, 500); metrics.recordAborted();
      at += 9_000; metrics.sample();
      let snapshot = metrics.snapshot(database);
      expect(snapshot.series[0]).toMatchObject({ from: new Date(10_000).toISOString(), to: new Date(19_000).toISOString(),
        requests: 3, responses: 2, aborted: 1, sampledResponses: 2, truncated: false, p95Ms: 100 });
      expect(snapshot.status).toBe('degraded');
      expect(snapshot.statusReasons).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'HTTP_5XX_WINDOW', count: 1, source: 'http' }),
        expect.objectContaining({ source: 'coverage', workerId: 'world-generator', status: 'unknown' }),
      ]));
      at += 300_001; snapshot = metrics.snapshot(database);
      expect(snapshot.status).toBe('unknown');
      expect(snapshot.statusReasons.some(reason => reason.code === 'HTTP_5XX_WINDOW')).toBe(false);
      expect(metrics.snapshot({ ...database, status: 'unavailable' }).statusReasons)
        .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DATABASE_UNAVAILABLE', source: 'database' })]));
    } finally { metrics.close(); }
  });
});
