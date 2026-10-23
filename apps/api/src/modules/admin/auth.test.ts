import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { hashSessionToken } from '../../security/sessions.js';
import { ADMIN_COOKIE_NAME, hashAdminSessionToken, requireAdmin } from './auth.js';

const id = 'c12da950-b066-4dd0-8bda-eb576f77c92a';
const config: AppConfig = {
  databaseUrl: 'postgres://unused/unused_test',
  host: '127.0.0.1',
  port: 3000,
  isProduction: true,
  cookieName: 'player_session',
  sessionTtlDays: 30,
  constructionDurationOverrideMs: null,
  scheduledTaskPollIntervalMs: 250,
  adminAccountIds: [id],
  adminOrigin: 'https://admin.example.test',
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    protocol: 'https',
    host: 'admin.example.test',
    method: 'GET',
    headers: {},
    server: { server: {} },
    cookies: { [ADMIN_COOKIE_NAME]: 'a'.repeat(43) },
    log: { info: vi.fn() },
    ...overrides,
  } as unknown as FastifyRequest;
}
function database(accountId: string | undefined) {
  const query = {
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    executeTakeFirst: vi.fn().mockResolvedValue(accountId ? { id: accountId } : undefined),
  };
  query.innerJoin.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return { db: { selectFrom: vi.fn().mockReturnValue(query) } as unknown as Kysely<Database>, query };
}

describe('administrator authorization boundary', () => {
  it('uses a separate hash namespace so a player token cannot be reused as an admin session', () => {
    expect(hashAdminSessionToken('opaque-token')).not.toBe(hashSessionToken('opaque-token'));
    expect(hashAdminSessionToken('opaque-token')).toBe(hashAdminSessionToken('opaque-token'));
  });

  it('ignores the game cookie and refuses an anonymous request before accessing the database', async () => {
    const { db } = database(id);
    await expect(
      requireAdmin(request({ cookies: { player_session: 'a'.repeat(43) } }), db, config),
    ).rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  it('rechecks the allowlist for each request including an already valid session', async () => {
    const { db } = database(id);
    expect(await requireAdmin(request(), db, config)).toEqual({ id, permissions: ['noc:read'] });
    await expect(requireAdmin(request(), db, { ...config, adminAccountIds: [] })).rejects.toMatchObject({
      code: 'ADMIN_REQUIRED',
    });
    await expect(
      requireAdmin(request(), database('f7ee56c6-ee86-48fb-a3a8-52355ac0f71c').db, config),
    ).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
  });

  it('rejects absent or expired server sessions', async () => {
    const { db, query } = database(undefined);
    await expect(requireAdmin(request(), db, config)).rejects.toMatchObject({ statusCode: 401 });
    expect(query.where).toHaveBeenCalledWith('sessions.expiresAt', '>', expect.any(Date));
    expect(query.where).toHaveBeenCalledWith('sessions.tokenHash', '=', hashAdminSessionToken('a'.repeat(43)));
  });

  it('requires TLS, the configured host and exact Origin for mutations', async () => {
    const { db } = database(id);
    for (const overrides of [
      { protocol: 'http' },
      { host: 'play.example.test' },
      { host: 'foreign@admin.example.test' },
      { headers: { origin: 'https://foreign.example.test' } },
      { headers: { 'sec-fetch-site': 'cross-site' } },
      { method: 'DELETE' },
      { method: 'DELETE', headers: { origin: 'null' } },
    ]) {
      await expect(requireAdmin(request(overrides), db, config)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(db.selectFrom).not.toHaveBeenCalled();
    await expect(
      requireAdmin(request({ method: 'DELETE', headers: { origin: config.adminOrigin } }), db, config),
    ).resolves.toMatchObject({ id });
  });

  it('logs access and refusals without request details or credentials', async () => {
    const req = request({ headers: { cookie: 'SECRET', authorization: 'SECRET' }, url: '/api/admin?token=SECRET' });
    await requireAdmin(req, database(id).db, config, 'worlds');
    expect(req.log.info).toHaveBeenCalledWith(
      { event: 'admin.access', action: 'worlds', actorId: id },
      'Administrator access',
    );
    await expect(requireAdmin(req, database(id).db, { ...config, adminAccountIds: [] }, 'worlds')).rejects.toThrow();
    expect(req.log.info).toHaveBeenLastCalledWith(
      { event: 'admin.denied', action: 'worlds', actorId: id, reason: 'ADMIN_REQUIRED' },
      'Administrator access',
    );
    expect(JSON.stringify(vi.mocked(req.log.info).mock.calls)).not.toContain('SECRET');
  });
});
