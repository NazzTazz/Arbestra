import {NavigationCompute} from './modules/navigation/compute.js';
import { randomUUID } from 'node:crypto';
import {ExpeditionCoordinator} from './modules/science/expeditions.js';
import {ExpeditionWakeups} from './modules/science/expedition-wakeups.js';
import { registerWorldGeneratorRoutes } from './modules/world-generator/routes.js';
import { registerOnboardingRoutes } from './modules/onboarding/routes.js';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import buildSerializer from 'fast-json-stringify';
import { devTimeSync, instrumentDevTimings } from './modules/operations/dev-timing.js';
import type { Kysely } from 'kysely';

import type { AppConfig } from './config.js';
import type { Database } from './database/schema.js';
import { HttpError } from './errors.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerVillageRoutes } from './modules/villages/routes.js';
import { registerTerrainRoutes } from './modules/worlds/terrain-routes.js';
import {registerFactorySettings} from './modules/villages/factory-settings.js';
import {registerVillageSync} from './modules/villages/sync.js';
import { registerAdminAuthRoutes } from './modules/admin/auth.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { OperationsTelemetry, instrumentHttp, annotateHttpRequest } from './modules/operations/telemetry.js';
import { DatabaseProbe } from './modules/operations/database-probe.js';
import { createHttpLogging } from './modules/operations/http-logging.js';

export async function buildApp(config: AppConfig, db: Kysely<Database>): Promise<FastifyInstance> {
  const httpLogging = createHttpLogging(config.nocHttpLogMode);
  const app = Fastify({ logger: httpLogging.loggerOptions, disableRequestLogging: true,
    requestIdHeader: false, genReqId: () => randomUUID(),
    trustProxy: config.trustedProxyCidrs?.length ? [...config.trustedProxyCidrs] : false, schemaController: { compilersFactory: {
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
          const compiled = buildSerializer(shape, { ...options, schema: references });
          serialize = value => devTimeSync('serialize', () => compiled(value));
          serializers.set(key, serialize);
        }
        return serialize;
      };
    },
  } } });
  await app.register(cookie);
  instrumentDevTimings(app, config.isProduction);
  const operations = new OperationsTelemetry(Date.now, true, {
    slowThresholdMs: config.nocHttpSlowMs ?? 2000, httpLogger: httpLogging.diagnostics(app.log),
  });
  instrumentHttp(app, operations);
  app.addHook('onClose', async () => httpLogging.close());
  operations.observeWorker('scheduler', () => ({ id: 'scheduler', label: 'Échéances économiques',
    status: 'unknown', active: null, lastObservedAt: null, lastSuccessAt: null, lastErrorAt: null,
    note: 'Aucune boucle scheduler observée dans ce point d’entrée API.' }));
  const databaseProbe = new DatabaseProbe(config.databaseUrl, operations);
  app.addHook('onClose', () => databaseProbe.close());

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      annotateHttpRequest(request, error.code);
      if(error.statusCode===429)reply.header('Retry-After','2');
      return reply.status(error.statusCode).send({ code: error.code, message: error.message });
    }
    if (typeof error === 'object' && error !== null && 'validation' in error && error.validation) {
      annotateHttpRequest(request, 'VALIDATION_ERROR');
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Requête invalide.' });
    }
    annotateHttpRequest(request, 'INTERNAL_ERROR');
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erreur interne.' });
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  const wakeups=new ExpeditionWakeups(config.databaseUrl,()=>{operations.event('EXPEDITION_LISTENER_INTERRUPTED','Le canal de réveil des expéditions est interrompu.','warning');app.log.warn({code:'EXPEDITION_LISTENER_INTERRUPTED'},'Expedition listener interrupted');});
  await wakeups.start();
  app.addHook('preClose',()=>wakeups.close());
  const navigation=new NavigationCompute(config.expeditionWorkerCount);
  try{await navigation.start();}catch(error){await navigation.close();await wakeups.close();throw error;}
  let expeditionErrorAt: string | null = null;
  const coordinator=new ExpeditionCoordinator(db,navigation,()=>{expeditionErrorAt=new Date().toISOString();operations.event('EXPEDITION_PREPARATION_INTERRUPTED','Une préparation d’expédition a été interrompue.','error');app.log.warn({code:'EXPEDITION_PREPARATION_INTERRUPTED'},'Expedition preparation interrupted');});
  const stopExpeditions=config.expeditionWorkerEnabled===false?()=>coordinator.close():coordinator.start();
  operations.observeWorker('navigation', () => {
    const state = navigation.observation;
    return { id: 'navigation', label: 'Calcul de navigation', active: state.active,
      status: state.closed ? 'unavailable' : state.ready !== state.total || (state.lastErrorAt !== null && Date.now() - Date.parse(state.lastErrorAt) < 60_000) ? 'degraded' : 'available',
      lastObservedAt: new Date().toISOString(), lastSuccessAt: state.lastSuccessAt, lastErrorAt: state.lastErrorAt,
      note: `${state.ready}/${state.total} workers démarrés ; ${state.waiting} projections en attente ; capacité partagée avec les expéditions.` };
  });
  operations.observeWorker('expeditions', () => {
    const state = coordinator.observation;
    return { id: 'expeditions', label: 'Préparation des expéditions', active: state.active,
      status: config.expeditionWorkerEnabled === false ? 'unknown' : state.stopped ? 'unavailable'
        : !state.lastTickAt ? 'unknown' : Date.now() - Date.parse(state.lastTickAt) > 30_000 || (expeditionErrorAt !== null && Date.now() - Date.parse(expeditionErrorAt) < 60_000) ? 'degraded' : 'available',
      lastObservedAt: state.lastTickAt, lastSuccessAt: state.lastTickAt, lastErrorAt: expeditionErrorAt ?? state.lastErrorAt,
      note: 'Cycle local de préparation ; les refus métier sont distincts des échecs de calcul.' };
  });
  operations.observeWorker('expedition-listener', () => {
    const state = wakeups.observation;
    return { id: 'expedition-listener', label: 'Réveil PostgreSQL / SSE', active: state.connected ? 1 : 0,
      status: state.closed ? 'unavailable' : state.connected ? 'available' : 'degraded',
      lastObservedAt: new Date().toISOString(), lastSuccessAt: state.lastSuccessAt, lastErrorAt: state.lastErrorAt,
      note: 'Connexion LISTEN locale observée ; ne prouve pas la livraison réseau au navigateur.' };
  });
  const villageProjections = await registerVillageSync(app, db, config,navigation,wakeups);
  // Close SSE owners before rejecting their outstanding CPU work at shutdown.
  app.addHook('preClose',stopExpeditions);
  await registerAuthRoutes(app, db, config);
  await registerAdminAuthRoutes(app, db, config);
  await registerAdminRoutes(app, db, config, async () => operations.snapshot(await databaseProbe.read()));
  await registerOnboardingRoutes(app, db, config);
  await registerWorldGeneratorRoutes(app, db, config);
  await registerVillageRoutes(app, db, config, villageProjections,navigation);
  await registerTerrainRoutes(app, db, config);
  await registerFactorySettings(app,db,config);
  return app;
}
