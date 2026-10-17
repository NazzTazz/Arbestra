import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { HttpRequestObservation } from '@arbestra/contracts';
import { loadConfig } from '../../config.js';
import { annotateHttpRequest, instrumentHttp, OperationsTelemetry } from './telemetry.js';
import { createHttpLogging, type DiagnosticLogSink, safeErrorLog, safeRequestLog } from './http-logging.js';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const sample = (): HttpRequestObservation => ({
  instanceId: randomUUID(), requestId: randomUUID(), sequence: 1,
  startedAt: '2026-10-15T10:00:00.000Z', endedAt: '2026-10-15T10:00:02.000Z', durationMs: 2000,
  method: 'GET', route: '/api/example/:id', scope: 'api', outcome: 'response', statusCode: 503,
  reasons: ['server_error', 'slow'], slowThresholdMs: 2000, safeCode: 'ADMIN_BUSY',
  errorCategory: 'application', captureSite: 'http.on-error',
});

async function harness(sink: DiagnosticLogSink, mode: 'anomalies' | 'off' = 'anomalies', now = () => 0) {
  const logging = createHttpLogging(mode, sink, now);
  const app = Fastify({ logger: logging.loggerOptions, disableRequestLogging: true,
    requestIdHeader: false, genReqId: () => randomUUID() });
  const diagnostics = logging.diagnostics(app.log);
  return { app, logging, diagnostics, close: async () => { logging.close(); await app.close(); } };
}

async function drain(diagnostics: { snapshot(): { queuedLines: number } }) {
  for (let attempt = 0; diagnostics.snapshot().queuedLines && attempt < 600; attempt++) await turn();
  expect(diagnostics.snapshot().queuedLines).toBe(0);
}

describe('safe HTTP logging', () => {
  it('retains controlled observation audit identities while stripping secrets',async()=>{
    const lines:string[]=[],h=await harness((line,done)=>{lines.push(line);done();});const actorId=randomUUID(),worldId=randomUUID(),villageId=randomUUID(),observationId=randomUUID();
    try{h.app.log.info({event:'admin.observation_closed',actorId,worldId,villageId,observationId,reason:'authorization_revoked',password:'secret-observation-password',cookie:'secret-observation-cookie'},'unsafe secret-observation-message');await drain(h.diagnostics);
      expect(JSON.parse(lines[0]!)).toMatchObject({event:'admin.observation_closed',actorId,worldId,villageId,observationId,reason:'authorization_revoked'});expect(lines.join('')).not.toContain('secret-observation');
    }finally{await h.close();}
  });
  for (const nodeEnv of ['development', 'production']) {
    it(`keeps secrets out of real Fastify/Pino output and correlates server UUIDs in ${nodeEnv}`, async () => {
      const lines: string[] = [];
      const config = loadConfig({ DATABASE_URL: 'postgres://unused/unused_test', NODE_ENV: nodeEnv });
      const h = await harness((line, done) => { lines.push(line); done(); }, config.nocHttpLogMode);
      const operations = new OperationsTelemetry(Date.now, false, { httpLogger: h.diagnostics });
      instrumentHttp(h.app, operations);
      h.app.setErrorHandler((_error, request, reply) => {
        annotateHttpRequest(request, 'INTERNAL_ERROR');
        return reply.code(500).send({ code: 'INTERNAL_ERROR' });
      });
      const witnesses = ['secret_path_alpha', 'secret_path_beta', 'secret_unknown_path', 'secret_query',
        'secret_body', 'secret_cookie', 'secret_authorization', 'secret_email@example.test',
        'secret_error_line\nsecret_error_next_line', 'secret_nested_cause', 'secret_user_agent', 'secret_child_binding'];
      h.app.post('/api/example/:id', async request => {
        const error = new Error(witnesses[8], { cause: new Error(witnesses[9]) });
        request.log.info({ req: request, err: error, email: witnesses[7], sql: witnesses[5] }, witnesses[8]);
        request.log.warn(error, witnesses[8]);
        request.log.child({ email: witnesses[7], unsafe: witnesses[11] }).error({ error }, witnesses[9]);
        throw error;
      });
      h.app.setNotFoundHandler((_request, reply) => reply.code(503).send({ code: 'FIXED_ERROR' }));
      try {
        const responses = [];
        for (const path of witnesses.slice(0, 2)) responses.push(await h.app.inject({
          method: 'POST', url: `/api/example/${path}?private=${witnesses[3]}`,
          headers: { 'x-request-id': 'attacker-chosen', cookie: `session=${witnesses[5]}`,
            authorization: witnesses[6], 'user-agent': witnesses[10] }, payload: { password: witnesses[4] },
        }));
        responses.push(await h.app.inject({ url: `/${witnesses[2]}?private=${witnesses[3]}`,
          headers: { 'x-request-id': randomUUID() } }));
        await drain(h.diagnostics);
        const output = lines.join('');
        for (const witness of witnesses.flatMap(value => value.split('\n'))) expect(output).not.toContain(witness);
        expect(output).not.toContain('attacker-chosen');
        expect(output).not.toContain('incoming request');
        expect(output).not.toContain('request completed');
        const diagnosticLines = lines.map(line => JSON.parse(line) as Record<string, unknown>)
          .filter(line => line.event === 'http.diagnostic');
        expect(diagnosticLines).toHaveLength(3);
        const rows = operations.httpDiagnostics.list({ from: new Date(Date.now() - 60_000).toISOString(),
          to: new Date(Date.now() + 1000).toISOString() }).items;
        expect(rows).toHaveLength(3);
        expect(new Set(responses.map(response => response.headers['x-request-id'])).size).toBe(3);
        for (const response of responses) {
          const requestId = response.headers['x-request-id'];
          expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
          const row = rows.find(value => value.requestId === requestId)!;
          expect(row).toBeDefined();
          expect(diagnosticLines.find(line => line.requestId === requestId)).toMatchObject(row);
        }
        expect(rows.filter(row => row.route === '/api/example/:id')).toHaveLength(2);
        expect(rows.filter(row => row.route === 'unmatched')).toHaveLength(1);
        const requestLog = lines.map(line => JSON.parse(line) as Record<string, unknown>).find(line => line.req);
        expect(requestLog?.req).toMatchObject({ method: 'POST', route: '/api/example/:id',
          requestId: responses[0]!.headers['x-request-id'] });
        expect(h.diagnostics.snapshot()).toMatchObject({ emitted: 3, dropped: 0 });
      } finally { operations.close(); await h.close(); }
    });
  }

  it('copies the complete safe observation once and emits asynchronously', async () => {
    const lines: string[] = [];
    const h = await harness((line, done) => { lines.push(line); done(); });
    try {
      const row = sample();
      h.diagnostics.write(row);
      expect(lines).toHaveLength(0);
      row.reasons.push('aborted');
      await drain(h.diagnostics);
      expect(lines).toHaveLength(1);
      const log = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(log).toMatchObject({ ...row, reasons: ['server_error', 'slow'], event: 'http.diagnostic' });
      expect(h.diagnostics.snapshot()).toMatchObject({ emitted: 1, dropped: 0, queuedBytes: 0 });
    } finally { await h.close(); }
  });

  it('keeps administrator auditing active when diagnostic stdout is off', async () => {
    const lines: string[] = [];
    const h = await harness((line, done) => { lines.push(line); done(); }, 'off');
    try {
      h.diagnostics.write(sample());
      const actorId = randomUUID();
      h.app.log.info({ event: 'admin.access', actorId, action: 'read', email: 'secret@example.test' }, 'private message');
      h.app.log.warn({ event: 'admin.denied', reason: 'ADMIN_REQUIRED', action: 'read' }, 'private message');
      await drain(h.diagnostics);
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'admin.access', actorId, action: 'read' });
      expect(JSON.parse(lines[1]!)).toMatchObject({ event: 'admin.denied', reason: 'ADMIN_REQUIRED' });
      expect(lines.join('')).not.toContain('secret@example.test');
      expect(lines.join('')).not.toContain('private message');
      expect(h.diagnostics.snapshot()).toMatchObject({ mode: 'off', emitted: 0, dropped: 0 });
    } finally { await h.close(); }
  });

  it('limits diagnostic output to a burst of forty then twenty per second', async () => {
    let now = 0;
    const h = await harness((_line, done) => done(), 'anomalies', () => now);
    try {
      for (let count = 0; count < 100; count++) h.diagnostics.write(sample());
      expect(h.diagnostics.snapshot()).toMatchObject({ queuedLines: 40, droppedRateLimit: 60 });
      await drain(h.diagnostics);
      now = 1000;
      for (let count = 0; count < 21; count++) h.diagnostics.write(sample());
      await drain(h.diagnostics);
      expect(h.diagnostics.snapshot()).toMatchObject({ emitted: 60, dropped: 61, droppedRateLimit: 61 });
    } finally { await h.close(); }
  });

  it('bounds a blocked transport including its in-flight line and drops on close once', async () => {
    let now = 0, calls = 0;
    let done: ((error?: Error | null) => void) | undefined;
    const h = await harness((_line, callback) => { calls++; done = callback; }, 'anomalies', () => now);
    try {
      h.diagnostics.write(sample()); await turn();
      for (let count = 0; count < 300; count++) { now += 50; h.diagnostics.write(sample()); }
      expect(calls).toBe(1);
      expect(h.diagnostics.snapshot()).toMatchObject({ queuedLines: 256, droppedCapacity: 45, emitted: 0 });
      expect(h.diagnostics.snapshot().queuedBytes).toBeLessThanOrEqual(512 * 1024);
      h.logging.close();
      done?.();
      expect(h.diagnostics.snapshot()).toMatchObject({ queuedLines: 0, queuedBytes: 0, droppedTransport: 256, dropped: 301 });
    } finally { await h.close(); }
  });

  it('enforces the byte limit independently of line count', async () => {
    const h = await harness(() => undefined);
    try {
      const oversized = '{"event":"http.diagnostic","padding":"' + 'a'.repeat(512 * 1024) + '"}\n';
      h.logging.loggerOptions.stream.write(oversized);
      expect(h.diagnostics.snapshot()).toMatchObject({ queuedLines: 0, queuedBytes: 0, droppedCapacity: 1 });
    } finally { await h.close(); }
  });

  it('counts throwing, callback and serialization failures without recursive output or stopping later writes', async () => {
    let calls = 0;
    const h = await harness((_line, done) => {
      calls++;
      if (calls === 1) throw new Error('secret transport failure');
      done(calls === 2 ? new Error('secret callback failure') : undefined);
    });
    try {
      for (let count = 0; count < 3; count++) h.diagnostics.write(sample());
      const hostile = Object.defineProperty(sample(), 'route', { get() { throw Error('secret getter failure'); } });
      expect(() => h.diagnostics.write(hostile)).not.toThrow();
      await drain(h.diagnostics);
      expect(calls).toBe(3);
      expect(h.diagnostics.snapshot()).toMatchObject({ emitted: 1, droppedTransport: 3, dropped: 3 });
    } finally { await h.close(); }
  });

  it('never serializes raw requests, errors or noncatalogue codes', async () => {
    expect(safeRequestLog({ id: 'forged', method: 'secret method', url: '/secret', headers: { cookie: 'secret' } }))
      .toEqual({ requestId: null, method: 'OTHER', route: 'unmatched' });
    expect(JSON.stringify(safeErrorLog())).not.toContain('secret');
    const lines: string[] = [];
    const h = await harness((line, done) => { lines.push(line); done(); });
    try {
      const row = { ...sample(), safeCode: 'SECRET_CODE', captureSite: 'secret_file_path' } as unknown as HttpRequestObservation;
      h.diagnostics.write(row);
      await drain(h.diagnostics);
      expect(JSON.parse(lines[0]!)).toMatchObject({ safeCode: 'INTERNAL_ERROR', captureSite: 'http.finalize' });
      expect(lines.join('')).not.toContain('SECRET_CODE');
      expect(lines.join('')).not.toContain('secret_file_path');
    } finally { await h.close(); }
  });
});
