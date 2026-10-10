import {registerInstallationRoutes} from './installation-routes.js';
import { AvailableWorldsSchema, JoinWorldRequestSchema, JoinWorldResponseSchema, type JoinWorldRequest } from '@arbestra/contracts';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { authenticate } from '../auth/service.js';
import { availableWorlds, joinWorld } from './service.js';
import { SpawnInspectionRequestSchema, SpawnMapSchema, SpawnAtlasSchema, SpawnTerrainResultSchema, SpawnResourcePreflightSchema, type SpawnInspectionRequest } from '@arbestra/contracts';
import { getSpawnMap, getSpawnAtlas, inspectSpawnTerrain } from './spawn-map.js';
import { SpawnCompute } from './spawn-compute.js';
import { inspectSpawnResources } from './spawn-resources.js';
import { registerAtlasRoutes } from './atlas-routes.js';

export async function registerOnboardingRoutes(app: FastifyInstance, db: Kysely<Database>, config: AppConfig) {
  await registerAtlasRoutes(app, db, config);
  const compute = new SpawnCompute();
  await registerInstallationRoutes(app,db,config,compute);
  app.get('/api/worlds/:worldSlug/spawn-atlas', {schema:{params:Type.Object({worldSlug:Type.String({minLength:1,maxLength:64})}),response:{200:SpawnAtlasSchema}}},async(request,reply)=>{
    await authenticate(db,request.cookies[config.cookieName]);reply.header('cache-control','no-store');
    return getSpawnAtlas(db,(request.params as {worldSlug:string}).worldSlug);
  });
  app.addHook('onClose', () => compute.close());
  app.post('/api/worlds/:worldSlug/spawn-map/resource-check', { schema: { params: Type.Object({ worldSlug: Type.String({ minLength: 1, maxLength: 64 }) }), body: SpawnInspectionRequestSchema, response: { 200: SpawnResourcePreflightSchema } } }, async (request, reply) => {
    await authenticate(db, request.cookies[config.cookieName]);
    reply.header('cache-control', 'no-store');
    return inspectSpawnResources(db, (request.params as { worldSlug: string }).worldSlug, request.body as SpawnInspectionRequest, compute);
  });
  app.get('/api/worlds/:worldSlug/spawn-map', { schema: { params: Type.Object({ worldSlug: Type.String({ minLength: 1, maxLength: 64 }) }), response: { 200: SpawnMapSchema } } }, async (request, reply) => {
    await authenticate(db, request.cookies[config.cookieName]);
    reply.header('cache-control', 'no-store');
    return getSpawnMap(db, (request.params as { worldSlug: string }).worldSlug, compute);
  });
  app.post('/api/worlds/:worldSlug/spawn-map/terrain-check', { schema: { params: Type.Object({ worldSlug: Type.String({ minLength: 1, maxLength: 64 }) }), body: SpawnInspectionRequestSchema, response: { 200: SpawnTerrainResultSchema } } }, async (request, reply) => {
    await authenticate(db, request.cookies[config.cookieName]);
    reply.header('cache-control', 'no-store');
    return inspectSpawnTerrain(db, (request.params as { worldSlug: string }).worldSlug, request.body as SpawnInspectionRequest, compute);
  });
  app.get('/api/worlds', {schema:{response:{200:AvailableWorldsSchema}}}, async request => {
    const account=await authenticate(db,request.cookies[config.cookieName]);
    return availableWorlds(db,account.id);
  });
  app.post('/api/worlds/:worldSlug/join', {schema:{params:Type.Object({worldSlug:Type.String({minLength:1,maxLength:64})}),
    body:JoinWorldRequestSchema,response:{200:JoinWorldResponseSchema}}}, async request => {
    const account=await authenticate(db,request.cookies[config.cookieName]);
    return joinWorld(db,account.id,(request.params as {worldSlug:string}).worldSlug,request.body as JoinWorldRequest);
  });
}
