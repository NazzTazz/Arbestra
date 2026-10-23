import { scrypt as callbackScrypt } from 'node:crypto';
import { promisify } from 'node:util';

import { AdminSessionSchema, LoginRequestSchema, type LoginRequest } from '@arbestra/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { AttemptLimiter } from '../../security/attempt-limiter.js';
import { verifyPassword } from '../../security/passwords.js';
import { createSessionToken, hashSessionToken } from '../../security/sessions.js';
import { operationsFor } from '../operations/telemetry.js';

export const ADMIN_COOKIE_NAME = 'arbestra_admin_session';
const SESSION_SECONDS = 60 * 60;
const scrypt = promisify(callbackScrypt);
const permissions = ['noc:read'] as const;

export interface AdminPrincipal {
  readonly id: string;
  readonly permissions: typeof permissions;
}

export interface AdminAuditEvent {
  readonly event: 'admin.access' | 'admin.denied' | 'admin.session_created' | 'admin.session_deleted';
  readonly action: string;
  readonly actorId?: string;
  readonly reason?: string;
}

/** A player token copied into the admin cookie cannot authenticate, or vice versa. */
export function hashAdminSessionToken(token: string): string {
  return hashSessionToken(`admin:${token}`);
}

function audit(request: FastifyRequest, event: AdminAuditEvent): void {
  // Never serialize the request, submitted email/password, cookie or raw DB error.
  request.log.info(
    { ...event, action: /^[a-z0-9_.:-]{1,64}$/i.test(event.action) ? event.action : 'read' },
    'Administrator access',
  );
  const events = {
    'admin.access': ['ADMIN_ACCESS', 'Lecture administrateur autorisée.'],
    'admin.denied': ['ADMIN_DENIED', 'Accès administrateur refusé.'],
    'admin.session_created': ['ADMIN_LOGIN', 'Session administrateur ouverte.'],
    'admin.session_deleted': ['ADMIN_LOGOUT', 'Session administrateur fermée.'],
  } as const;
  const [code, message] = events[event.event];
  operationsFor(request.server)?.event(code, message, event.event === 'admin.denied' ? 'warning' : 'info');
}

function refusal(error: unknown): string {
  return error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
}

function assertAdminRequest(request: FastifyRequest, config: AppConfig): void {
  if (config.isProduction && request.protocol !== 'https') {
    throw new HttpError(403, 'ADMIN_HTTPS_REQUIRED', 'HTTPS requis pour l’administration.');
  }
  if (!config.adminOrigin) throw new HttpError(403, 'ADMIN_DISABLED', 'Administration indisponible.');
  let actualOrigin: string;
  try {
    const actual = new URL(`${request.protocol}://${request.host}`);
    if (actual.username || actual.password || actual.pathname !== '/' || actual.search || actual.hash)
      throw new Error('Invalid host');
    actualOrigin = actual.origin;
  } catch {
    throw new HttpError(403, 'INVALID_ORIGIN', 'Origine non autorisée.');
  }
  const origin = request.headers.origin;
  if (
    actualOrigin !== config.adminOrigin ||
    (origin !== undefined && origin !== config.adminOrigin) ||
    request.headers['sec-fetch-site'] === 'cross-site'
  ) {
    throw new HttpError(403, 'INVALID_ORIGIN', 'Origine non autorisée.');
  }
  if (!['GET', 'HEAD'].includes(request.method) && origin !== config.adminOrigin) {
    throw new HttpError(403, 'ADMIN_ORIGIN_REQUIRED', 'Origine requise pour cette opération.');
  }
}

function allowed(config: AppConfig, accountId: string): boolean {
  return config.adminAccountIds?.includes(accountId) === true;
}

/** Called on every NOC endpoint; no privilege is cached in the browser or session. */
export async function requireAdmin(
  request: FastifyRequest,
  db: Kysely<Database>,
  config: AppConfig,
  action = 'read',
): Promise<AdminPrincipal> {
  let actorId: string | undefined;
  try {
    assertAdminRequest(request, config);
    const token = request.cookies[ADMIN_COOKIE_NAME];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Connexion administrateur requise.');
    }
    const session = await db
      .selectFrom('sessions')
      .innerJoin('accounts', 'accounts.id', 'sessions.accountId')
      .select('accounts.id')
      .where('sessions.tokenHash', '=', hashAdminSessionToken(token))
      .where('sessions.expiresAt', '>', new Date())
      .executeTakeFirst();
    if (!session) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Session administrateur invalide ou expirée.');
    actorId = session.id;
    if (!allowed(config, actorId)) throw new HttpError(403, 'ADMIN_REQUIRED', 'Accès administrateur requis.');
    audit(request, { event: 'admin.access', action, actorId });
    return { id: actorId, permissions };
  } catch (error) {
    audit(request, { event: 'admin.denied', action, ...(actorId ? { actorId } : {}), reason: refusal(error) });
    throw error;
  }
}

function cookieOptions(config: AppConfig) {
  // No Domain, even when the game deliberately shares its own session cookie.
  return { path: '/api/admin', httpOnly: true, secure: config.isProduction, sameSite: 'strict' as const };
}

export async function registerAdminAuthRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  config: AppConfig,
): Promise<void> {
  const attempts = new AttemptLimiter();
  app.post(
    '/api/admin/session',
    {
      schema: { body: LoginRequestSchema, response: { 200: AdminSessionSchema } },
    },
    async (request, reply) => {
      let actorId: string | undefined;
      try {
        assertAdminRequest(request, config);
        if (!config.adminAccountIds?.length) throw new HttpError(403, 'ADMIN_DISABLED', 'Administration indisponible.');
        const body = request.body as LoginRequest;
        attempts.login(request.ip, body.email, { ip: 20, identity: 5 });
        const account = await db
          .selectFrom('accounts')
          .select(['id', 'passwordHash'])
          .where('email', '=', body.email.trim().toLowerCase())
          .executeTakeFirst();
        const matches = account
          ? await verifyPassword(body.password, account.passwordHash)
          : (await scrypt(body.password, Buffer.alloc(16), 64), false);
        if (!account || !matches) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Identifiants incorrects.');
        actorId = account.id;
        if (!allowed(config, actorId)) throw new HttpError(403, 'ADMIN_REQUIRED', 'Accès administrateur requis.');
        const token = createSessionToken();
        // Re-authentication replaces this browser's previous admin session atomically.
        await db.transaction().execute(async (transaction) => {
          const previous = request.cookies[ADMIN_COOKIE_NAME];
          if (previous)
            await transaction.deleteFrom('sessions').where('tokenHash', '=', hashAdminSessionToken(previous)).execute();
          await transaction
            .insertInto('sessions')
            .values({
              tokenHash: hashAdminSessionToken(token),
              accountId: actorId!,
              expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
            })
            .execute();
        });
        reply.header('Cache-Control', 'private, no-store');
        reply.setCookie(ADMIN_COOKIE_NAME, token, { ...cookieOptions(config), maxAge: SESSION_SECONDS });
        audit(request, { event: 'admin.session_created', action: 'login', actorId });
        return { account: { id: actorId }, permissions };
      } catch (error) {
        audit(request, {
          event: 'admin.denied',
          action: 'login',
          ...(actorId ? { actorId } : {}),
          reason: refusal(error),
        });
        throw error;
      }
    },
  );
  app.get('/api/admin/session', { schema: { response: { 200: AdminSessionSchema } } }, async (request, reply) => {
    const account = await requireAdmin(request, db, config, 'session');
    reply.header('Cache-Control', 'private, no-store');
    return { account: { id: account.id }, permissions: account.permissions };
  });
  app.delete('/api/admin/session', async (request, reply) => {
    const account = await requireAdmin(request, db, config, 'logout');
    await db
      .deleteFrom('sessions')
      .where('tokenHash', '=', hashAdminSessionToken(request.cookies[ADMIN_COOKIE_NAME]!))
      .execute();
    reply.clearCookie(ADMIN_COOKIE_NAME, cookieOptions(config));
    reply.header('Cache-Control', 'private, no-store');
    audit(request, { event: 'admin.session_deleted', action: 'logout', actorId: account.id });
    return reply.status(204).send();
  });
}
