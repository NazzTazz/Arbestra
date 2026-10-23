import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AdminRuntimeSnapshot } from '@arbestra/contracts';
import { instrumentHttp, operationsFor, OperationsTelemetry } from './telemetry.js';
import { observeScheduler } from './scheduler-observer.js';

const database: AdminRuntimeSnapshot['database'] = {
  status: 'available',
  latencyMs: 2,
  observedAt: new Date(0).toISOString(),
  connections: 1,
  activeQueries: 0,
  note: 'Test observation',
};

describe('operations observations', () => {
  it('shares incident reporting with encapsulated routes and keeps routine reads out of incidents', async () => {
    const app = Fastify(),
      metrics = new OperationsTelemetry(Date.now, false);
    instrumentHttp(app, metrics);
    await app.register(async (scoped) => {
      scoped.get('/admin-observation', async (request) => {
        operationsFor(request.server)?.event('ADMIN_DENIED', 'Accès refusé.');
        for (let i = 0; i < 200; i++)
          operationsFor(request.server)?.event('ADMIN_ACCESS', 'Lecture autorisée.', 'info');
        return { ok: true };
      });
    });
    try {
      await app.inject('/admin-observation');
      expect(metrics.snapshot(database).events).toEqual([expect.objectContaining({ code: 'ADMIN_DENIED' })]);
    } finally {
      await app.close();
    }
  });
  it('measures real HTTP outcomes without exposing request secrets or raw exceptions', async () => {
    const app = Fastify(),
      metrics = new OperationsTelemetry(Date.now, false);
    instrumentHttp(app, metrics);
    app.get('/ok', async () => ({ ok: true }));
    app.get('/broken', async () => {
      throw new Error('postgres://secret:password@private');
    });
    try {
      await app.inject('/ok?token=very-secret');
      await app.inject('/broken');
      const result = metrics.snapshot(database);
      expect(result.http).toMatchObject({ requests: 2, errors5xx: 1, activeRequests: 0 });
      expect(result.http.p95Ms).toBeGreaterThanOrEqual(0);
      expect(result.events).toHaveLength(1);
      expect(JSON.stringify(result)).not.toMatch(/very-secret|password|postgres:\/\//);
      expect(result.status).toBe('degraded');
    } finally {
      await app.close();
    }
  });

  it('expires old traffic, bounds samples and labels a truncated percentile population', () => {
    let time = 1000;
    const metrics = new OperationsTelemetry(() => time, false);
    try {
      for (let i = 0; i < 5000; i++) metrics.recordRequest(i, i < 5 ? 500 : 200);
      expect(metrics.snapshot(database).http).toMatchObject({
        requests: 5000,
        errors5xx: 5,
        sampledRequests: 4096,
        truncated: true,
      });
      metrics.sample();
      expect(metrics.snapshot(database).series[0]).toMatchObject({ requests: 5000, errors5xx: 5 });
      for (let i = 0; i < 150; i++) {
        time += 5000;
        metrics.sample();
      }
      const result = metrics.snapshot(database);
      expect(result.series).toHaveLength(120);
      expect(result.http).toMatchObject({
        requests: 0,
        errors5xx: 0,
        sampledRequests: 0,
        p95Ms: null,
        truncated: false,
      });
      expect(result.status).toBe('unknown'); // External generator has no heartbeat.
    } finally {
      metrics.close();
    }
  });

  it('distinguishes connections from distinct accounts and cleans up per-world presence', () => {
    const metrics = new OperationsTelemetry(Date.now, false);
    try {
      const close1 = metrics.openStream({}, 'account-a', 'world-a');
      const close2 = metrics.openStream({}, 'account-a', 'world-a');
      const close3 = metrics.openStream({}, 'account-b', 'world-b');
      expect(metrics.snapshot(database).sse).toMatchObject({
        connections: 3,
        accounts: 2,
        worlds: [
          { worldId: 'world-a', connections: 2, accounts: 1 },
          { worldId: 'world-b', connections: 1, accounts: 1 },
        ],
      });
      close1();
      close1();
      close2();
      close3();
      expect(metrics.snapshot(database).sse).toMatchObject({ connections: 0, accounts: 0, worlds: [] });
    } finally {
      metrics.close();
    }
  });

  it('never reports a healthy dependency or worker when observation is absent, stale, or failed', () => {
    let time = 1000;
    const metrics = new OperationsTelemetry(() => time, false),
      observe = observeScheduler(metrics, () => time);
    try {
      expect(metrics.snapshot(database).workers.find((w) => w.id === 'scheduler')?.status).toBe('unknown');
      observe({ kind: 'poll' });
      observe({ kind: 'idle' });
      expect(metrics.snapshot(database).workers.find((w) => w.id === 'scheduler')?.status).toBe('available');
      observe({ kind: 'processed', outcome: 'retry-scheduled' });
      observe({ kind: 'idle' });
      expect(metrics.snapshot(database).workers.find((w) => w.id === 'scheduler')?.status).toBe('degraded');
      time += 90_000;
      expect(metrics.snapshot(database).workers.find((w) => w.id === 'scheduler')?.status).toBe('degraded');
      expect(metrics.snapshot({ ...database, status: 'unavailable', latencyMs: null }).status).toBe('unavailable');
      for (let i = 0; i < 150; i++) metrics.event('FIXED_CODE', 'Fixed safe message');
      expect(metrics.snapshot(database).events).toHaveLength(100);
    } finally {
      metrics.close();
    }
  });
});
