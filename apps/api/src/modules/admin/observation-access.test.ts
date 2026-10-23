import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { ObservationHub } from './observation-hub.js';
import { ObservationAccess } from './observation-access.js';
const actor = randomUUID(),
  target = {
    worldId: randomUUID(),
    villageId: randomUUID(),
    accountId: randomUUID(),
    worldSlug: 'test',
    villageName: 'Village',
  };
const config: AppConfig = {
  worldOrigin: 'http://game.localhost',
  adminOrigin: 'http://noc.localhost',
  adminAccountIds: [actor],
  isProduction: false,
  databaseUrl: 'postgres://unused/access_test',
  host: '127.0.0.1',
  port: 0,
  cookieName: 'player',
  sessionTtlDays: 1,
  constructionDurationOverrideMs: null,
  scheduledTaskPollIntervalMs: 1000,
};
const request = {
  protocol: 'http',
  host: 'game.localhost',
  method: 'POST',
  headers: { origin: 'http://game.localhost' },
} as unknown as FastifyRequest;
const db = {
  selectFrom() {
    const chain = {
      select() {
        return chain;
      },
      where() {
        return chain;
      },
      async executeTakeFirst() {
        return { accountId: actor };
      },
    };
    return chain;
  },
} as unknown as Kysely<Database>;
it('consumes a launch grant atomically, rejects replay and expires after thirty seconds', async () => {
  let now = 100000;
  const hub = new ObservationHub(() => now),
    access = new ObservationAccess(hub, () => now),
    lease = hub.create(actor, target);
  const launch = access.launch(config, lease, actor, 'private-master-hash'),
    url = new URL(launch.url),
    token = new URLSearchParams(url.hash.slice(1)).get('observationToken')!;
  expect(url.origin).toBe(config.worldOrigin);
  expect(url.pathname).toBe('/village');
  expect(url.searchParams.get('observe')).toBe(lease.id);
  expect(url.search).not.toContain(token);
  expect(launch.url).not.toContain('private-master-hash');
  const outcomes = await Promise.allSettled([
    access.exchange(request, db, config, token),
    access.exchange(request, db, config, token),
  ]);
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const later = access.launch(config, lease, actor, 'hash');
  now += 30000;
  await expect(
    access.exchange(
      request,
      db,
      config,
      new URLSearchParams(new URL(later.url).hash.slice(1)).get('observationToken')!,
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  hub.closeAll();
});
it('does not consume a grant from another origin, and never grants it to an ordinary account', async () => {
  const hub = new ObservationHub(),
    access = new ObservationAccess(hub),
    lease = hub.create(actor, target),
    launch = access.launch(config, lease, actor, 'hash'),
    token = new URLSearchParams(new URL(launch.url).hash.slice(1)).get('observationToken')!;
  await expect(
    access.exchange({ ...request, host: 'evil.localhost' } as FastifyRequest, db, config, token),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(access.exchange(request, db, { ...config, adminAccountIds: [] }, token)).rejects.toMatchObject({
    statusCode: 401,
  });
  hub.closeAll();
});
