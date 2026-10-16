import type { FastifyInstance } from 'fastify';

import { LoginRequestSchema, RegisterRequestSchema, SessionResponseSchema, type RegisterRequest } from '@arbestra/contracts';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import type { Kysely } from 'kysely';
import { authenticate, getSessionForAccount, login, logout, register } from './service.js';

import { AttemptLimiter } from '../../security/attempt-limiter.js';

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
  const attempts = new AttemptLimiter();
  app.post('/api/auth/register', {
    schema: { body: RegisterRequestSchema, response: { 201: SessionResponseSchema } },
  }, async (request, reply) => {
    attempts.consume([{ key: `register:ip:${request.ip}`, maximum: 5 }]);
    const body = request.body as RegisterRequest, result = await register(db, config, body.email, body.password);
    reply.setCookie(config.cookieName, result.token, cookieOptions(config));
    return reply.status(201).send(result.session);
  });
  app.post('/api/auth/login', {
    schema: { body: LoginRequestSchema, response: { 200: SessionResponseSchema } },
  }, async (request, reply) => {
    const body = request.body as { email: string; password: string };
    attempts.login(request.ip, body.email);
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
