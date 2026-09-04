import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';

import type { AppConfig } from './config.js';
import type { Database } from './database/schema.js';
import { HttpError } from './errors.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerVillageRoutes } from './modules/villages/routes.js';

export async function buildApp(config: AppConfig, db: Kysely<Database>): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.isProduction });
  await app.register(cookie);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ code: error.code, message: error.message });
    }
    if (typeof error === 'object' && error !== null && 'validation' in error && error.validation) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Requête invalide.' });
    }
    app.log.error(error);
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur interne.' });
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  await registerAuthRoutes(app, db, config);
  await registerVillageRoutes(app, db, config);
  return app;
}
