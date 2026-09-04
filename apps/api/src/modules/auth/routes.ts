import type { FastifyInstance } from 'fastify';

import { LoginRequestSchema, SessionResponseSchema } from '@arbestra/contracts';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import type { Kysely } from 'kysely';
import { authenticate, getSessionForAccount, login, logout } from './service.js';

function cookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: config.sessionTtlDays * 86_400,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  config: AppConfig,
): Promise<void> {
  app.post('/api/auth/login', {
    schema: { body: LoginRequestSchema, response: { 200: SessionResponseSchema } },
  }, async (request, reply) => {
    const body = request.body as { email: string; password: string };
    const result = await login(db, config, body.email, body.password);
    reply.setCookie(config.cookieName, result.token, cookieOptions(config));
    return result.session;
  });

  app.get('/api/auth/session', {
    schema: { response: { 200: SessionResponseSchema } },
  }, async (request) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    return getSessionForAccount(db, account);
  });

  app.delete('/api/auth/session', async (request, reply) => {
    await logout(db, request.cookies[config.cookieName]);
    reply.clearCookie(config.cookieName, { path: '/', ...(config.cookieDomain ? { domain: config.cookieDomain } : {}) });
    return reply.status(204).send();
  });
}
