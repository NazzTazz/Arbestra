import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { hashSessionToken } from '../../security/sessions.js';
import { HttpError } from '../../errors.js';
import { registerSyncV2Routes } from './sync-v2-routes.js';
import { readServerEvents } from '@arbestra/contracts';
import type { TravelNetworkExecutor } from '../navigation/network-job.js';

const unusedNavigation: TravelNetworkExecutor = {
  network: async () => {
    throw Error('Presentation is not exercised here');
  },
};

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected V2 route test database');
const db = createDatabase(url),
  app = Fastify(),
  token = randomUUID();
const prefix = `/api/worlds/aube/villages/${ids.village}`;
beforeAll(async () => {
  await db
    .insertInto('sessions')
    .values({ accountId: ids.account, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
    .execute();
  await app.register(cookie);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) return reply.status(error.statusCode).send({ code: error.code });
    return reply.status(400).send({ code: 'VALIDATION_ERROR' });
  });
  await registerSyncV2Routes(app, db, { cookieName: 'session' }, unusedNavigation);
  await app.ready();
}, 30000);
afterAll(async () => {
  await app.close();
  await db.deleteFrom('sessions').where('tokenHash', '=', hashSessionToken(token)).execute();
  await db.destroy();
});
it('requires protocol negotiation and authentication and rejects unknown request fields before coercion', async () => {
  const payload = { protocol: 2, generation: 0, scopes: [], cursors: [] };
  for (const operation of ['read', 'stream']) {
    const request = { method: 'POST' as const, url: `${prefix}/sync/${operation}`, payload };
    expect((await app.inject(request)).statusCode).toBe(400);
    expect((await app.inject({ ...request, headers: { 'x-arbestra-protocol': '2' } })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          ...request,
          headers: { 'x-arbestra-protocol': '2' },
          cookies: { session: token },
          payload: { ...payload, injected: true },
        })
      ).json(),
    ).toMatchObject({ code: 'INVALID_SYNC_REQUEST' });
    expect(
      (
        await app.inject({
          ...request,
          headers: { 'x-arbestra-protocol': '2' },
          cookies: { session: token },
          payload: { ...payload, generation: '0' },
        })
      ).statusCode,
    ).toBe(400);
  }
});
it('bootstraps and streams as pure reads: a due construction and a due wake wait for the worker', async () => {
  const revision = async () =>
    (
      await sql<{ revision: string }>`select revision::text from game_sync_streams
        where world_id=${ids.world} and stream_kind='village' and scope_key=${ids.village}`.execute(db)
    ).rows[0]?.revision;
  const since = new Date(Date.now() - 6 * 3_600_000);
  const sleeper = () =>
    db
      .insertInto('populationCohorts')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        originVillageId: ids.village,
        memberCount: 1,
        activity: 'resting',
        energy: 0,
        energyProgress: 0,
        energyUpdatedAt: since,
        restingSince: since,
        foodUsedSinceRest: 0,
        harvestId: null,
        extractionId: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  const house = await db
    .insertInto('buildings')
    .values({
      worldId: ids.world,
      villageId: ids.village,
      buildingType: 'dwelling',
      level: 1,
      targetLevel: null,
      status: 'under-construction',
      constructionStartedAt: new Date(Date.now() - 60_000),
      constructionCompletesAt: new Date(Date.now() - 1_000),
      completedAt: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const asleep = [await sleeper()];
  const unchanged = async () => {
    expect(await db.selectFrom('buildings').selectAll().where('id', '=', house.id).executeTakeFirstOrThrow()).toEqual(
      house,
    );
    for (const cohort of asleep)
      expect(
        await db.selectFrom('populationCohorts').selectAll().where('id', '=', cohort.id).executeTakeFirstOrThrow(),
      ).toEqual(cohort);
  };
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController(),
    deadline = setTimeout(() => controller.abort(), 15_000);
  try {
    const before = await revision();
    const response = await app.inject({
      method: 'GET',
      url: `${prefix}/bootstrap?generation=1`,
      headers: { 'x-arbestra-protocol': '2' },
      cookies: { session: token },
    });
    expect(response.statusCode, response.body).toBe(200);
    // The capture shows the due work as it stands; nothing was written.
    await unchanged();
    expect(await revision()).toBe(before);
    // A rest falling due while the stream is open is not woken by its ticks either.
    asleep.push(await sleeper());
    const opened = await revision();
    const batch = response.json<{ groups: Array<{ stream: Record<string, string>; toRevision: string }> }>();
    const events: string[] = [];
    const stream = await fetch(address + prefix + '/sync/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-arbestra-protocol': '2', cookie: `session=${token}` },
      signal: controller.signal,
      body: JSON.stringify({
        protocol: 2,
        generation: 1,
        scopes: batch.groups.map((group) => ({ kind: group.stream.kind, key: group.stream.key })),
        cursors: batch.groups.map((group) => ({ ...group.stream, revision: group.toRevision })),
      }),
    });
    expect(stream.status).toBe(200);
    await readServerEvents(stream.body!, {
      signal: controller.signal,
      current: () => true,
      onEvent: (event) => {
        events.push(event.event);
        // The opening capture and two ticks.
        if (events.length === 3) controller.abort();
      },
    }).catch((error) => {
      if (!controller.signal.aborted) throw error;
    });
    // The new sleeper's own insertion is the only change the stream may carry.
    expect(events.filter((event) => event === 'heartbeat').length).toBeGreaterThanOrEqual(2);
    expect(events.every((event) => event === 'heartbeat' || event === 'batch')).toBe(true);
    await unchanged();
    expect(await revision()).toBe(opened);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    await db
      .deleteFrom('populationCohorts')
      .where(
        'id',
        'in',
        asleep.map((cohort) => cohort.id),
      )
      .execute();
    await db.deleteFrom('buildings').where('id', '=', house.id).execute();
  }
}, 60000);
