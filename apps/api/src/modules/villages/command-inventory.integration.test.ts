import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { RouteOptions, FastifyServerOptions } from 'fastify';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { buildApp } from '../../app.js';

const routes = vi.hoisted(() => [] as Array<{ method: string; url: string; actions: string[] }>);
vi.mock('fastify', async (importOriginal) => {
  const original = await importOriginal<typeof import('fastify')>();
  return {
    ...original,
    default: (options: FastifyServerOptions) => {
      const app = original.default(options);
      app.addHook('onRoute', (route: RouteOptions) => {
        const actions = new Set<string>();
        function inspect(value: unknown, action = false) {
          if (!value || typeof value !== 'object') return;
          for (const [key, child] of Object.entries(value)) {
            if (action && key === 'const' && typeof child === 'string') actions.add(child);
            inspect(child, action || key === 'action');
          }
        }
        inspect(route.schema?.body);
        for (const method of [route.method].flat())
          if (method !== 'HEAD') routes.push({ method, url: route.url, actions: [...actions].sort() });
      });
      return app;
    },
  };
});

it('classifies every registered route and action, including loops and plugin prefixes', async () => {
  const url = testDatabaseUrl(),
    target = new URL(url);
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test')
    throw Error('Unexpected inventory database');
  const db = createDatabase(url);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    app = await buildApp(
      {
        databaseUrl: url,
        host: '127.0.0.1',
        port: 0,
        isProduction: false,
        cookieName: 'arbestra_session',
        sessionTtlDays: 30,
        constructionDurationOverrideMs: 600000,
        scheduledTaskPollIntervalMs: 250,
        expeditionWorkerEnabled: false,
      },
      db,
    );
    await app.ready();
    const actual = routes.sort((a, b) => `${a.url}:${a.method}`.localeCompare(`${b.url}:${b.method}`));
    mkdirSync('test-results/command-sync', { recursive: true });
    writeFileSync('test-results/command-sync/routes.json', JSON.stringify(actual, null, 2));
    const inventory = JSON.parse(readFileSync('tests/fixtures/command-inventory.json', 'utf8')) as Array<{
      method: string;
      url: string;
      actions: string[];
      lot: string;
      role: string;
    }>;
    expect(inventory.map(({ method, url, actions }) => ({ method, url, actions }))).toEqual(actual);
    expect(inventory.every((row) => /^(?:[B-I]|outside)$/.test(row.lot) && !!row.role)).toBe(true);
    expect(inventory.filter((row) => row.url.startsWith('/api/worlds/') && row.lot === 'outside')).toEqual([]);
  } finally {
    await app?.close();
    await db.destroy();
  }
}, 120_000);
