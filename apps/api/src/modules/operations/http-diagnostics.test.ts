import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { HttpDiagnostics, HTTP_CAPACITY, HTTP_RETENTION_MS, HTTP_MAX_OBSERVATION_BYTES, safeHttpAnnotation, type HttpCompletion } from './http-diagnostics.js';

const origin = Date.parse('2026-10-15T10:00:00Z');
const completion = (at = origin, fields: Partial<HttpCompletion> = {}): HttpCompletion => ({
  requestId: randomUUID(), startedAt: new Date(at - 30).toISOString(), endedAt: new Date(at).toISOString(),
  durationMs: 30, method: 'GET', route: '/api/villages/:id', outcome: 'response', statusCode: 503, ...fields,
});

describe('bounded HTTP diagnostics', () => {
  it('selects one observation with all applicable reasons and only safe annotations', () => {
    const store = new HttpDiagnostics(randomUUID(), new Date(origin).toISOString(), () => origin + 1);
    for (const statusCode of [200, 302, 401, 404]) expect(store.record(completion(origin, { statusCode }))).toBeNull();
    const result = store.record(completion(origin, { durationMs: 8_000, annotation: safeHttpAnnotation('ADMIN_DATA_UNAVAILABLE', 'admin.read')! }));
    expect(result).toMatchObject({ reasons: ['server_error', 'slow'], safeCode: 'ADMIN_DATA_UNAVAILABLE', errorCategory: 'application', captureSite: 'admin.read' });
    expect(store.list().items).toHaveLength(1);
    expect(safeHttpAnnotation('postgres://password@private')).toBeUndefined();
    expect(safeHttpAnnotation('__proto__')).toBeUndefined();
    expect(store.record(completion(origin, { durationMs: 2_000, statusCode: 200, annotation: safeHttpAnnotation('INTERNAL_ERROR')! })))
      .toMatchObject({ reasons: ['slow'], safeCode: null, errorCategory: null });
    expect(store.record(completion(origin, { durationMs: 2_000, statusCode: 401 })))
      .toMatchObject({ reasons: ['slow'], safeCode: null, errorCategory: 'unknown' });
    expect(store.record(completion(origin, { outcome: 'aborted', statusCode: 503, durationMs: 2_001 })))
      .toMatchObject({ reasons: ['slow', 'aborted'], statusCode: null, safeCode: 'CONNECTION_INTERRUPTED', errorCategory: 'transport' });
  });

  it('keeps normalized routes and methods only, and distinguishes registered console from the historic generator', () => {
    const store = new HttpDiagnostics(randomUUID(), new Date(origin).toISOString(), () => origin + 1);
    expect(store.record(completion(origin, { method: 'private-method', route: '/token?password=private' })))
      .toMatchObject({ method: 'OTHER', route: 'unmatched', scope: 'api' });
    expect(store.record(completion(origin, { route: '/api/admin/http-requests/:requestId' }))?.scope).toBe('console');
    expect(store.record(completion(origin, { route: '/api/admin/observations/:id/snapshot', annotation: safeHttpAnnotation('OBSERVATION_BUSY')! })))
      .toMatchObject({scope:'console',safeCode:'OBSERVATION_BUSY',errorCategory:'application'});
    expect(store.record(completion(origin,{route:'/api/admin/observations'}))?.scope).toBe('console');
    expect(store.record(completion(origin, { route: '/api/admin/world-jobs/:id' }))?.scope).toBe('api');
    expect(JSON.stringify(store.list())).not.toMatch(/password|private-method|token/);
  });

  it('bounds retention and reports capacity evictions independently from expiration', () => {
    let at = origin;
    const store = new HttpDiagnostics(randomUUID(), new Date(origin).toISOString(), () => at);
    for (let i = 0; i < HTTP_CAPACITY + 8; i++) store.record(completion(at));
    expect(store.metadata()).toMatchObject({ retained: HTTP_CAPACITY, evicted: 8, expired: 0, collectionFailures: 0 });
    at += HTTP_RETENTION_MS;
    expect(store.metadata()).toMatchObject({ retained: 0, evicted: 8, expired: HTTP_CAPACITY, oldestRetainedAt: null });
    expect(store.record(completion(at, { requestId: 'not-an-id' }))).toBeNull();
    expect(store.metadata().collectionFailures).toBe(1);
  });

  it('expires at the exact millisecond even when newer sequences have older wall timestamps', () => {
    let at = origin;
    const store = new HttpDiagnostics(randomUUID(), new Date(origin).toISOString(), () => at);
    const first = store.record(completion(at))!;
    at -= 100; // Server wall-clock correction: the next sequence is older in wall time.
    const second = store.record(completion(at))!;
    expect(second.sequence).toBeGreaterThan(first.sequence);
    expect(store.metadata().oldestRetainedAt).toBe(second.endedAt);
    at = origin + HTTP_RETENTION_MS - 101;
    expect(store.metadata()).toMatchObject({ retained: 2, expired: 0 });
    at++; // Same second, exact expiration deadline for the second sequence.
    expect(store.metadata()).toMatchObject({ retained: 1, expired: 1, oldestRetainedAt: first.endedAt });
    expect(() => store.get(second.requestId, store.instanceId)).toThrow('n’est pas conservée');
    at -= 50;
    const third = store.record(completion(at))!;
    expect(store.metadata()).toMatchObject({ retained: 2, expired: 1 });
    at = origin + HTTP_RETENTION_MS;
    expect(store.metadata()).toMatchObject({ retained: 1, expired: 2, oldestRetainedAt: third.endedAt });
    expect(store.get(third.requestId, store.instanceId).requestId).toBe(third.requestId);
  });

  it('paginates by a stable sequence snapshot while new completions arrive, with AND filters and [from,to)', () => {
    let at = origin;
    const instanceId = randomUUID(), store = new HttpDiagnostics(instanceId, new Date(origin).toISOString(), () => at);
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) { ids.push(store.record(completion(at, { durationMs: 2_000 + i }))!.requestId); at++; }
    const first = store.list({ limit: 3, reason: 'slow', route: '/api/villages/:id', scope: 'api', minDurationMs: 2_000 });
    expect(first.items.map(row => row.requestId)).toEqual(ids.slice(4).reverse());
    const fresh = store.record(completion(at, { durationMs: 5_000 }))!; at++;
    const next = store.list({ instanceId, from: first.from, to: first.to, snapshotSequence: first.snapshotSequence,
      beforeSequence: first.nextBeforeSequence!, limit: 100 });
    expect(next.items.map(row => row.requestId)).toEqual(ids.slice(0, 4).reverse());
    expect(next.items.some(row => row.requestId === fresh.requestId)).toBe(false);
    expect(next.nextBeforeSequence).toBeNull();
    expect(store.list({ from: new Date(origin).toISOString(), to: new Date(origin + 1).toISOString() }).items.map(row => row.requestId)).toEqual([ids[0]]);
    expect(store.list({ reason: 'slow', method: 'POST' }).items).toEqual([]);
    expect(() => store.list({ beforeSequence: 3 })).toThrow('Curseur invalide');
    expect(() => store.list({ from: new Date(origin - HTTP_RETENTION_MS).toISOString() })).toThrow('dix minutes');
    expect(() => store.list({ snapshotSequence: 900 })).toThrow('Curseur invalide');
    expect(() => store.list({ instanceId: randomUUID() })).toThrow('autre instance');
    expect(() => store.get(randomUUID(), instanceId)).toThrow('n’est pas conservée');
  });

  it('does not leak mutable records, and collection/log failures do not block later observations', () => {
    const write = vi.fn(() => { throw new Error('secret logging failure'); });
    const snapshot = vi.fn(() => ({ mode: 'anomalies' as const, emitted: 0, dropped: 0, droppedRateLimit: 0,
      droppedCapacity: 0, droppedTransport: 0, queuedLines: 0, queuedBytes: 0 }));
    const store = new HttpDiagnostics(randomUUID(), new Date(origin).toISOString(), () => origin + 1, 2_000, { write, snapshot });
    const saved = store.record(completion())!;
    saved.reasons.length = 0; saved.route = 'tampered';
    const page = store.list(); page.items[0]!.reasons.length = 0;
    expect(store.get(saved.requestId, store.instanceId)).toMatchObject({ reasons: ['server_error'], route: '/api/villages/:id' });
    expect(store.metadata()).toMatchObject({ retained: 1, collectionFailures: 0, logs: { dropped: 1, droppedTransport: 1 } });
    expect(JSON.stringify(store.metadata())).not.toContain('secret');
    expect(store.record(completion())).not.toBeNull();
    expect(() => new HttpDiagnostics(randomUUID(), '', Date.now, 249)).toThrow('threshold');
  });

  it('keeps pagination stable and explicit when concurrent completions evict part then all of its snapshot', async () => {
    let at = origin;
    const instanceId = randomUUID(), store = new HttpDiagnostics(instanceId, new Date(origin).toISOString(), () => at);
    const write = () => {
      const row = store.record(completion(at++, { route: '/' + 'é'.repeat(255), durationMs: 99_999,
        annotation: safeHttpAnnotation('ADMIN_DATA_UNAVAILABLE', 'admin.read')! }))!;
      expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThanOrEqual(HTTP_MAX_OBSERVATION_BYTES);
      return row;
    };
    for (let i = 0; i < HTTP_CAPACITY; i++) write();
    const first = store.list({ limit: 100 });
    expect(first.snapshotSequence).toBe(HTTP_CAPACITY);
    expect(first.items.map(row => row.sequence)).toEqual(Array.from({ length: 100 }, (_, index) => HTTP_CAPACITY - index));

    let releaseWriter!: () => void, releaseRemainder!: () => void, reportPartial!: () => void;
    const beginWriting = new Promise<void>(resolve => { releaseWriter = resolve; });
    const finishWriting = new Promise<void>(resolve => { releaseRemainder = resolve; });
    const partialWritten = new Promise<void>(resolve => { reportPartial = resolve; });
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const bounded = async <T>(promise: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('Pagination writer barrier timed out')), 5000); timers.add(timer);
      })]); } finally { if (timer) { clearTimeout(timer); timers.delete(timer); } }
    };
    const writer = (async () => {
      await bounded(beginWriting);
      for (let i = 0; i < 150; i++) write();
      reportPartial();
      await bounded(finishWriting);
      for (let i = 0; i < HTTP_CAPACITY + 1; i++) write();
    })();
    // Attach failure handling immediately, while assertions still control the writer barriers.
    const writerSettled = Promise.allSettled([writer]);
    try {
      releaseWriter(); await bounded(partialWritten);
      const second = store.list({ instanceId, from: first.from, to: first.to, snapshotSequence: first.snapshotSequence,
        beforeSequence: first.nextBeforeSequence!, limit: 100 });
      expect(second.metadata).toMatchObject({ retained: HTTP_CAPACITY, evicted: 150, expired: 0 });
      expect(second.items.map(row => row.sequence)).toEqual(Array.from({ length: 100 }, (_, index) => 412 - index));
      expect(new Set([...first.items, ...second.items].map(row => row.requestId)).size).toBe(200);
      expect(second.items.every(row => row.sequence <= first.snapshotSequence)).toBe(true);

      releaseRemainder(); await bounded(writer);
      const third = store.list({ instanceId, from: first.from, to: first.to, snapshotSequence: first.snapshotSequence,
        beforeSequence: second.nextBeforeSequence!, limit: 100 });
      expect(third.items).toEqual([]); expect(third.nextBeforeSequence).toBeNull();
      expect(third.snapshotSequence).toBe(first.snapshotSequence);
      expect(third.metadata).toMatchObject({ retained: HTTP_CAPACITY, evicted: 150 + HTTP_CAPACITY + 1, expired: 0 });
      expect(() => store.get(first.items[0]!.requestId, instanceId)).toThrow('n’est pas conservée');
      expect(store.list().items.every(row => row.sequence > first.snapshotSequence)).toBe(true);
      const escapedRoute = store.record(completion(at, { route: '/' + '\u0000'.repeat(255) }))!;
      expect(Buffer.byteLength(JSON.stringify(escapedRoute))).toBeLessThanOrEqual(HTTP_MAX_OBSERVATION_BYTES);
      // Date parsing permits long fractional precision; total serialized size is still bounded.
      const oversizedDate = '2026-10-15T10:00:00.' + '0'.repeat(3000) + 'Z';
      expect(Number.isFinite(Date.parse(oversizedDate))).toBe(true);
      expect(store.record(completion(at, { startedAt: oversizedDate }))).toBeNull();
      expect(store.metadata().collectionFailures).toBe(1);
    } finally {
      releaseWriter(); releaseRemainder();
      try { await bounded(writerSettled); } finally { for (const timer of timers) clearTimeout(timer); }
    }
  });
});
