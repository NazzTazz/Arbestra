import { registerWorldGeneratorRoutes } from './modules/world-generator/routes.js';
import { registerOnboardingRoutes } from './modules/onboarding/routes.js';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import buildSerializer from 'fast-json-stringify';
import type { Kysely } from 'kysely';

import type { AppConfig } from './config.js';
import type { Database } from './database/schema.js';
import { HttpError } from './errors.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerVillageRoutes } from './modules/villages/routes.js';
import { registerTerrainRoutes } from './modules/worlds/terrain-routes.js';
import {registerFactorySettings} from './modules/villages/factory-settings.js';
import {registerVillageSync} from './modules/villages/sync.js';

export async function buildApp(config: AppConfig, db: Kysely<Database>): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.isProduction, schemaController: { compilersFactory: {
    buildSerializer: (externalSchemas, options) => {
      // GET and commands return the same village schema. Share its compiled
      // serializer instead of recompiling lazy union validators on each endpoint.
      // The cache belongs to this schema scope and contains only registered shapes.
      const serializers = new Map<string, ReturnType<typeof buildSerializer>>();
      return ({ schema }) => {
        const shape = schema as buildSerializer.Schema, key = JSON.stringify(shape);
        let serialize = serializers.get(key);
        if (!serialize) {
          const references = { ...(externalSchemas as Record<string, buildSerializer.Schema>) };
          if ('$id' in shape && shape.$id) delete references[shape.$id];
          serialize = buildSerializer(shape, { ...options, schema: references });
          serializers.set(key, serialize);
        }
        return serialize;
      };
    },
  } } });
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
  const villageProjections = await registerVillageSync(app, db, config);
  await registerAuthRoutes(app, db, config);
  await registerOnboardingRoutes(app, db, config);
  await registerWorldGeneratorRoutes(app, db, config);
  await registerVillageRoutes(app, db, config, villageProjections);
  await registerTerrainRoutes(app, db, config);
  await registerFactorySettings(app,db,config);
  return app;
}
