import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { hashSessionToken } from '../../security/sessions.js';
import { HttpError } from '../../errors.js';
import { registerSyncV2Routes, SYNC_SCOPE_TOO_LARGE_RETRY_AFTER_SECONDS } from './sync-v2-routes.js';
import type { TravelNetworkExecutor } from '../navigation/network-job.js';

// A scope beyond the reader bounds is reproduced by the reader's own error.
vi.mock('./sync-v2-capture.js', () => ({
  captureSyncV2: async () => {
    throw new RangeError('Private scope snapshot requires pagination');
  },
}));

const navigation: TravelNetworkExecutor = {
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
beforeAll(async () => {
  await db
    .insertInto('sessions')
    .values({ accountId: ids.account, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
    .execute();
  await app.register(cookie);
  app.setErrorHandler((error, _request, reply) =>
    error instanceof HttpError
      ? reply.status(error.statusCode).send({ code: error.code })
      : reply.status(500).send({ code: 'UNEXPECTED' }),
  );
  await registerSyncV2Routes(app, db, { cookieName: 'session' }, navigation);
  await app.ready();
}, 30000);
afterAll(async () => {
  await app.close();
  await db.deleteFrom('sessions').where('tokenHash', '=', hashSessionToken(token)).execute();
  await db.destroy();
});
it('answers a too large private snapshot with a typed 503 and a Retry-After header', async () => {
  const response = await app.inject({
    method: 'POST',
    url: `/api/worlds/aube/villages/${ids.village}/sync/read`,
    headers: { 'x-arbestra-protocol': '2' },
    cookies: { session: token },
    payload: { protocol: 2, generation: 0, scopes: [], cursors: [] },
  });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({ code: 'SYNC_SCOPE_TOO_LARGE' });
  expect(response.headers['retry-after']).toBe(String(SYNC_SCOPE_TOO_LARGE_RETRY_AFTER_SECONDS));
});

it('answers the same 503 and Retry-After when a stream cannot open', async () => {
  // The first capture of a stream runs before its headers: the client opening
  // its stream on a too large village must not reconnect every 2 s either.
  const response = await app.inject({
    method: 'POST',
    url: `/api/worlds/aube/villages/${ids.village}/sync/stream`,
    headers: { 'x-arbestra-protocol': '2' },
    cookies: { session: token },
    payload: { protocol: 2, generation: 0, scopes: [], cursors: [] },
  });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({ code: 'SYNC_SCOPE_TOO_LARGE' });
  expect(response.headers['retry-after']).toBe(String(SYNC_SCOPE_TOO_LARGE_RETRY_AFTER_SECONDS));
});
