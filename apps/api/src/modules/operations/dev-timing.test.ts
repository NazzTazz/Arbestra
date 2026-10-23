import Fastify from 'fastify';
import buildSerializer from 'fast-json-stringify';
import { CompiledQuery, type DatabaseConnection, type Driver } from 'kysely';
import { describe, expect, it } from 'vitest';
import { DEV_TIMING_PHASES, parseDevServerTiming } from '@arbestra/contracts';
import {
  DevTimingTrace,
  devTime,
  devTimeSync,
  instrumentDevDriver,
  instrumentDevTimings,
  statementLabel,
  withDevTiming,
} from './dev-timing.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('Barrier timeout')), 4000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('development timing', () => {
  it('measures inclusive and self time, preserving values and exact errors', () => {
    let now = 0;
    const trace = new DevTimingTrace(() => now),
      value = {},
      sentinel = Error('SQL_SECRET');
    const actual = withDevTiming(trace, () =>
      devTimeSync('snapshot', () => {
        now = 2;
        devTimeSync('navigation', () => {
          now = 8;
        });
        now = 10;
        return value;
      }),
    );
    expect(actual).toBe(value);
    expect(() =>
      withDevTiming(trace, () =>
        devTimeSync('auth', () => {
          now = 12;
          throw sentinel;
        }),
      ),
    ).toThrow(sentinel);
    const rows = parseDevServerTiming(trace.header());
    expect(rows.find((r) => r.phase === 'snapshot')).toEqual({
      phase: 'snapshot',
      durationMs: 10,
      selfMs: 4,
      count: 1,
    });
    expect(rows.find((r) => r.phase === 'navigation')?.durationMs).toBe(6);
    expect(rows.find((r) => r.phase === 'request')?.durationMs).toBe(12);
    expect(trace.header()).not.toContain('SQL_SECRET');
  });

  it('subtracts the union of parallel child intervals, not their sum', async () => {
    let now = 0;
    const trace = new DevTimingTrace(() => now),
      a = gate(),
      b = gate();
    await withDevTiming(trace, () =>
      devTime('snapshot', async () => {
        now = 1;
        const left = devTime('sql', async () => {
          await a.promise;
        });
        now = 2;
        const right = devTime('sql', async () => {
          await b.promise;
        });
        now = 5;
        a.release();
        await left;
        now = 8;
        b.release();
        await right;
        now = 10;
      }),
    );
    const rows = parseDevServerTiming(trace.header());
    expect(rows.find((r) => r.phase === 'snapshot')).toEqual({
      phase: 'snapshot',
      durationMs: 10,
      selfMs: 3,
      count: 1,
    });
    expect(rows.find((r) => r.phase === 'sql')).toEqual({ phase: 'sql', durationMs: 10, selfMs: 10, count: 2 });
  });

  it('isolates overlapping HTTP requests and includes actual serialization', async () => {
    const app = Fastify();
    instrumentDevTimings(app);
    app.setSerializerCompiler(({ schema }) => {
      const compiled = buildSerializer(schema as buildSerializer.Schema);
      return (value) => devTimeSync('serialize', () => compiled(value));
    });
    const left = gate(),
      right = gate(),
      leftEntered = gate(),
      rightEntered = gate();
    app.get(
      '/api/worlds/:worldSlug/village',
      { schema: { response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } } } },
      async (request) => {
        const isLeft = (request.params as { worldSlug: string }).worldSlug === 'left';
        return devTime('village', async () => {
          (isLeft ? leftEntered : rightEntered).release();
          await (isLeft ? left : right).promise;
          devTimeSync(isLeft ? 'navigation' : 'rc1_parse', () => 42);
          return { ok: true, privateField: 'not serialized' };
        });
      },
    );
    const a = app.inject({ url: '/api/worlds/left/village', headers: { 'x-arbestra-dev-timing': '1' } });
    const b = app.inject({ url: '/api/worlds/right/village', headers: { 'x-arbestra-dev-timing': '1' } });
    try {
      await bounded(Promise.all([leftEntered.promise, rightEntered.promise]));
      right.release();
      const br = await bounded(b.then((r) => r));
      left.release();
      const ar = await bounded(a.then((r) => r));
      for (const [response, own, other] of [
        [ar, 'navigation', 'rc1_parse'],
        [br, 'rc1_parse', 'navigation'],
      ] as const) {
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true });
        const rows = parseDevServerTiming(String(response.headers['server-timing']));
        expect(rows.some((r) => r.phase === own)).toBe(true);
        expect(rows.some((r) => r.phase === other)).toBe(false);
        expect(rows.some((r) => r.phase === 'serialize')).toBe(true);
        expect(response.headers['cache-control']).toBe('private, no-store');
      }
    } finally {
      left.release();
      right.release();
      await Promise.allSettled([a, b]);
      await app.close();
    }
  });

  it('requires opt-in and excludes unrelated routes, in production too', async () => {
    {
      const app = Fastify();
      instrumentDevTimings(app);
      for (const method of ['GET', 'POST'] as const)
        app.route({
          method,
          url: '/api/worlds/:worldSlug/village',
          handler: () => devTimeSync('auth', () => ({ ok: true })),
        });
      app.get('/other', () => ({ ok: true }));
      try {
        for (const [method, url, optIn] of [
          ['GET', '/api/worlds/test/village', false],
          ['POST', '/api/worlds/test/village', true],
          ['GET', '/other', true],
          ['GET', '/api/worlds/test/village', true],
        ] as const) {
          const response = await app.inject({ method, url, headers: optIn ? { 'x-arbestra-dev-timing': '1' } : {} });
          expect(response.statusCode).toBe(200);
          expect(Boolean(response.headers['server-timing'])).toBe(optIn && method === 'GET' && url !== '/other');
        }
      } finally {
        await app.close();
      }
    }
  });

  it('measures opted-in village commands and previews while excluding streams', async () => {
    {
      const app = Fastify();
      instrumentDevTimings(app);
      for (const action of ['processing', 'market/preview', 'population/gestures'])
        app.post('/api/worlds/:worldSlug/villages/:villageId/' + action, () =>
          devTimeSync('auth', () => ({ ok: true })),
        );
      app.get('/api/worlds/:worldSlug/villages/:villageId/events', () => ({ ok: true }));
      try {
        for (const action of ['processing', 'market/preview', 'population/gestures', 'events'])
          for (const optIn of [false, true]) {
            const response = await app.inject({
              method: action === 'events' ? 'GET' : 'POST',
              url: '/api/worlds/test/villages/village/' + action,
              headers: optIn ? { 'x-arbestra-dev-timing': '1' } : {},
            });
            expect(response.statusCode).toBe(200);
            expect(Boolean(response.headers['server-timing'])).toBe(optIn && action !== 'events');
            if (response.headers['server-timing'])
              expect(
                parseDevServerTiming(String(response.headers['server-timing'])).some((m) => m.phase === 'auth'),
              ).toBe(true);
          }
      } finally {
        await app.close();
      }
    }
  });

  it('preserves connection identity, SQL arguments, rollback and thrown errors', async () => {
    const sentinel = Error('PRIVATE_DB_ERROR'),
      query = CompiledQuery.raw('PRIVATE_SQL', ['PRIVATE_VALUE']);
    const executed: CompiledQuery[] = [],
      calls: string[] = [];
    const connection: DatabaseConnection = {
      async executeQuery<R>(q: CompiledQuery) {
        executed.push(q);
        if (q === query) throw sentinel;
        return { rows: [] as R[] };
      },
      async *streamQuery<R>() {
        yield { rows: [] as R[] };
      },
    };
    const driver: Driver = instrumentDevDriver({
      async init() {},
      async acquireConnection() {
        return connection;
      },
      async beginTransaction(c) {
        expect(c).toBe(connection);
        calls.push('begin');
        await c.executeQuery(CompiledQuery.raw('begin'));
      },
      async commitTransaction() {
        calls.push('commit');
      },
      async rollbackTransaction(c) {
        calls.push('rollback');
        await c.executeQuery(CompiledQuery.raw('rollback'));
      },
      async releaseConnection(c) {
        expect(c).toBe(connection);
        calls.push('release');
      },
      async destroy() {},
    });
    const trace = new DevTimingTrace();
    await withDevTiming(trace, async () => {
      const c = await driver.acquireConnection();
      expect(c).toBe(connection);
      await driver.beginTransaction(c, {});
      try {
        await c.executeQuery(query);
        throw Error('Expected failure');
      } catch (error) {
        expect(error).toBe(sentinel);
        await driver.rollbackTransaction(c);
      } finally {
        await driver.releaseConnection(c);
      }
    });
    expect(executed[1]).toBe(query);
    expect(calls).toEqual(['begin', 'rollback', 'release']);
    const header = trace.header();
    expect(header).not.toMatch(/PRIVATE/);
    expect(parseDevServerTiming(header).find((m) => m.phase === 'sql')?.count).toBe(3);
    const other = new DevTimingTrace();
    await withDevTiming(other, async () => {
      const c = await driver.acquireConnection();
      await c.executeQuery(CompiledQuery.raw('select 1'));
      await driver.releaseConnection(c);
    });
    expect(parseDevServerTiming(other.header()).find((m) => m.phase === 'sql')?.count).toBe(1);
  });

  it('keeps a fixed metric set and stops collecting after response headers', () => {
    const trace = new DevTimingTrace();
    withDevTiming(trace, () => {
      for (let i = 0; i < 500; i++)
        for (const phase of Object.keys(DEV_TIMING_PHASES))
          devTimeSync(phase as keyof typeof DEV_TIMING_PHASES, () => 1);
    });
    const header = trace.header();
    expect(header.length).toBeLessThan(8192);
    expect(parseDevServerTiming(header)).toHaveLength(Object.keys(DEV_TIMING_PHASES).length);
    withDevTiming(trace, () => devTimeSync('navigation', () => 1));
    expect(trace.header()).toBe(header);
  });
});

it('labels statements by operation and first table only', () => {
  expect(statementLabel('insert into "world_cell_occupancies" ("a") values ($1)')).toBe(
    'insert world_cell_occupancies',
  );
  expect(statementLabel('select "id" from "villages" where "id" = $1 for update')).toBe('select villages');
  expect(statementLabel('select game_sync_publish() as published')).toBe('select fn game_sync_publish');
  expect(statementLabel('commit')).toBe('commit');
});
