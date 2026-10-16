import { randomUUID } from 'node:crypto';

import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../config.js';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { HttpError } from '../../errors.js';
import { hashPassword } from '../../security/passwords.js';
import { createSessionToken } from '../../security/sessions.js';
import { registerAuthRoutes } from '../auth/routes.js';
import { ADMIN_COOKIE_NAME, hashAdminSessionToken, registerAdminAuthRoutes, requireAdmin } from './auth.js';
import { registerAdminRoutes } from './routes.js';
import { instrumentHttp, OperationsTelemetry } from '../operations/telemetry.js';
import type { HttpRequestsPage } from '@arbestra/contracts';

const databaseUrl = testDatabaseUrl();
const target = new URL(databaseUrl);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected administrator fixture DB');
const db = createDatabase(databaseUrl);
const adminId = randomUUID(), ordinaryId = randomUUID();
const adminEmail = `${adminId}@admin-auth.test`, ordinaryEmail = `${ordinaryId}@admin-auth.test`;
const password = 'isolated-admin-auth-password';
const origin = 'https://admin.example.test';
const headers = { host: 'admin.example.test', origin, 'x-forwarded-proto': 'https' };
let app: FastifyInstance;
let adminIds: string[];
let telemetry: OperationsTelemetry;

describe('isolated administrator sessions', () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    await db.insertInto('accounts').values([
      { id: adminId, email: adminEmail, passwordHash }, { id: ordinaryId, email: ordinaryEmail, passwordHash },
    ]).execute();
  });
  beforeEach(async () => {
    adminIds = [adminId];
    const config = { ...loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: 'production',
      ADMIN_ACCOUNT_IDS: adminId, ADMIN_ORIGIN: origin, COOKIE_DOMAIN: '.example.test' }), adminAccountIds: adminIds };
    app = Fastify({ logger: false, trustProxy: ['127.0.0.1'] });
    await app.register(cookie);
    telemetry = new OperationsTelemetry(Date.now, false);
    instrumentHttp(app, telemetry);
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof HttpError) return reply.status(error.statusCode).send({ code: error.code, message: error.message });
      if (typeof error === 'object' && error !== null && 'validation' in error) return reply.status(400).send({ code: 'VALIDATION_ERROR' });
      return reply.status(500).send({ code: 'INTERNAL_ERROR' });
    });
    await registerAdminAuthRoutes(app, db, config);
    await registerAuthRoutes(app, db, config);
    await registerAdminRoutes(app, db, config, () => telemetry.snapshot({ status: 'unknown', latencyMs: null,
      observedAt: null, connections: null, activeQueries: null, note: 'No DB probe in this authorization test.' }));
    app.get('/diagnostic-failure', async (_request, reply) => reply.status(503).send({ code: 'fixture' }));
    app.get('/api/admin/probe', async request => requireAdmin(request, db, config, 'probe'));
    await app.ready();
  });
  afterEach(async () => { await app?.close(); });
  afterAll(async () => {
    await db.deleteFrom('sessions').where('accountId', 'in', [adminId, ordinaryId]).execute();
    await db.deleteFrom('accounts').where('id', 'in', [adminId, ordinaryId]).execute();
    await db.destroy();
  });

  async function adminLogin() {
    const response = await app.inject({ method: 'POST', url: '/api/admin/session', headers,
      payload: { email: adminEmail, password } });
    expect(response.statusCode).toBe(200);
    const sessionCookie = response.cookies.find(value => value.name === ADMIN_COOKIE_NAME)!;
    expect(sessionCookie).toBeDefined();
    return { response, sessionCookie, cookie: `${sessionCookie.name}=${sessionCookie.value}` };
  }

  it('refuses anonymous requests and ordinary accounts without creating an admin session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/probe', headers })).statusCode).toBe(401);
    const response = await app.inject({ method: 'POST', url: '/api/admin/session', headers,
      payload: { email: ordinaryEmail, password } });
    expect(response.statusCode).toBe(403); expect(response.json().code).toBe('ADMIN_REQUIRED');
    expect(response.cookies).toHaveLength(0);
    expect(await db.selectFrom('sessions').select('tokenHash').where('accountId', '=', ordinaryId).execute()).toEqual([]);
  });

  it('issues a host-only short-lived cookie and prevents session reuse across player/admin boundaries', async () => {
    const { response, sessionCookie, cookie: adminCookie } = await adminLogin();
    expect(response.json()).toEqual({ account: { id: adminId }, permissions: ['noc:read'] });
    expect(sessionCookie).toMatchObject({ path: '/api/admin', httpOnly: true, secure: true, sameSite: 'Strict', maxAge: 3600 });
    expect(sessionCookie.domain).toBeUndefined();
    const session = await db.selectFrom('sessions').select(['tokenHash', 'expiresAt'])
      .where('tokenHash', '=', hashAdminSessionToken(sessionCookie.value)).executeTakeFirstOrThrow();
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(session.tokenHash).not.toBe(sessionCookie.value);
    expect((await app.inject({ method: 'GET', url: '/api/admin/session', headers: { ...headers, cookie: adminCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { ...headers, cookie: adminCookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { ...headers,
      cookie: `arbestra_session=${sessionCookie.value}` } })).statusCode).toBe(401);

    const game = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email: adminEmail, password } });
    expect(game.statusCode).toBe(200);
    const gameToken = game.cookies.find(value => value.name === 'arbestra_session')!.value;
    expect((await app.inject({ method: 'GET', url: '/api/admin/session', headers: { ...headers,
      cookie: `${ADMIN_COOKIE_NAME}=${gameToken}` } })).statusCode).toBe(401);
  });

  it('revokes permission immediately for an existing session, then checks server expiry and logout', async () => {
    const { cookie: adminCookie, sessionCookie } = await adminLogin();
    const authenticated = { ...headers, cookie: adminCookie };
    adminIds.splice(0);
    expect((await app.inject({ method: 'GET', url: '/api/admin/probe', headers: authenticated })).statusCode).toBe(403);
    adminIds.push(adminId);
    await db.updateTable('sessions').set({ expiresAt: new Date(Date.now() - 1000) })
      .where('tokenHash', '=', hashAdminSessionToken(sessionCookie.value)).execute();
    expect((await app.inject({ method: 'GET', url: '/api/admin/probe', headers: authenticated })).statusCode).toBe(401);

    const fresh = await adminLogin();
    const logout = await app.inject({ method: 'DELETE', url: '/api/admin/session', headers: { ...headers, cookie: fresh.cookie } });
    expect(logout.statusCode).toBe(204);
    expect(await db.selectFrom('sessions').select('tokenHash')
      .where('tokenHash', '=', hashAdminSessionToken(fresh.sessionCookie.value)).executeTakeFirst()).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/api/admin/probe', headers: { ...headers, cookie: fresh.cookie } })).statusCode).toBe(401);
  });

  it('refuses cross-origin or insecure requests and untrusted forwarded HTTPS', async () => {
    for (const testHeaders of [{ ...headers, origin: 'https://foreign.example.test' },
      { host: headers.host, 'x-forwarded-proto': 'https' }, { ...headers, 'x-forwarded-proto': 'http' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/admin/session', headers: testHeaders,
        payload: { email: adminEmail, password } })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'POST', url: '/api/admin/session', headers,
      remoteAddress: '192.0.2.42', payload: { email: adminEmail, password } })).statusCode).toBe(403);
    const fresh = await adminLogin();
    const forbidden = await app.inject({ method: 'DELETE', url: '/api/admin/session', headers: {
      ...headers, origin: 'https://foreign.example.test', cookie: fresh.cookie } });
    expect(forbidden.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/probe', headers: { ...headers, cookie: fresh.cookie } })).statusCode).toBe(200);
  });

  it('limits admin attempts across IPs and also limits the existing player login', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await app.inject({ method: 'POST', url: '/api/admin/session',
        headers: { ...headers, 'x-forwarded-for': `192.0.2.${attempt + 1}` },
        payload: { email: adminEmail, password: 'incorrect' } })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/admin/session',
      headers: { ...headers, 'x-forwarded-for': '192.0.2.100' }, payload: { email: adminEmail, password } })).statusCode).toBe(429);
    for (let attempt = 0; attempt < 15; attempt++) {
      expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers,
        payload: { email: ordinaryEmail, password: 'incorrect' } })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers,
      payload: { email: ordinaryEmail, password } })).statusCode).toBe(429);
  });

  it('protects both HTTP diagnostic endpoints before exposing retained references and rechecks revocation', async () => {
    const failed = await app.inject('/diagnostic-failure');
    const requestId = failed.headers['x-request-id'] as string;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const listPath = '/api/admin/http-requests';
    const detailPath = `${listPath}/${requestId}?instanceId=${telemetry.instanceId}`;
    const ordinaryToken = createSessionToken();
    await db.insertInto('sessions').values({ accountId: ordinaryId, tokenHash: hashAdminSessionToken(ordinaryToken),
      expiresAt: new Date(Date.now() + 60_000) }).execute();
    for (const url of [listPath, detailPath]) {
      const anonymous = await app.inject({ url, headers });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.body).not.toContain(telemetry.instanceId);
      const ordinary = await app.inject({ url, headers: { ...headers, cookie: `${ADMIN_COOKIE_NAME}=${ordinaryToken}` } });
      expect(ordinary.statusCode).toBe(403);
      expect(ordinary.body).not.toContain(requestId);
    }
    const login = await adminLogin(), authenticated = { ...headers, cookie: login.cookie };
    const page = await app.inject({ url: listPath, headers: authenticated });
    expect(page.statusCode, page.body).toBe(200);
    expect(page.headers['cache-control']).toBe('private, no-store');
    expect(page.json<HttpRequestsPage>().items.some(item => item.requestId === requestId)).toBe(true);
    const detail = await app.inject({ url: detailPath, headers: authenticated });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().observation.requestId).toBe(requestId);
    expect(detail.headers['cache-control']).toBe('private, no-store');
    const missing = await app.inject({ url: `${listPath}/${randomUUID()}?instanceId=${telemetry.instanceId}`, headers: authenticated });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('HTTP_OBSERVATION_NOT_RETAINED');
    for (const url of [`${listPath}?instanceId=${randomUUID()}`, `${listPath}/${requestId}?instanceId=${randomUUID()}`]) {
      const mismatch = await app.inject({ url, headers: authenticated });
      expect(mismatch.statusCode).toBe(409);
      expect(mismatch.json()).toMatchObject({ code: 'INSTANCE_MISMATCH', instanceId: telemetry.instanceId });
    }
    for (const query of ['extra=secret', 'limit=101', 'from=not-a-date', 'minDurationMs=-1',
      'from=2026-10-15T10:00:00Z&to=2026-10-15T10:11:00Z', 'snapshotSequence=9007199254740992']) {
      expect((await app.inject({ url: `${listPath}?${query}`, headers: authenticated })).statusCode, query).toBe(400);
    }
    adminIds.splice(0);
    for (const url of [listPath, detailPath, `${listPath}?instanceId=${randomUUID()}`]) {
      const denied = await app.inject({ url, headers: authenticated });
      expect(denied.statusCode).toBe(403);
      expect(denied.body).not.toContain(telemetry.instanceId);
    }
  });
});
