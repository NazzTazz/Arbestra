import { Type } from '@sinclair/typebox';
import { TerrainResponseSchema, TerrainUpdatesResponseSchema, TerrainOverviewSchema, TerrainVegetationOverviewSchema, TerrainVillageOverviewSchema } from '@arbestra/contracts';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';
import type { AppConfig } from '../../config.js';
import { authenticate } from '../auth/service.js';
import { getTerrain, getTerrainUpdates } from './terrain.js';
import { authorizedOverviewWorld, getTerrainOverview, getTerrainVegetationOverview, overviewEtag } from './terrain-overview.js';
import { getTerrainVillages } from './terrain-villages.js';

export async function registerTerrainRoutes(app: FastifyInstance, db: Kysely<Database>, config: AppConfig): Promise<void> {
  const params = Type.Object({ worldSlug: Type.String({ minLength: 1, maxLength: 64 }) });
  const querystring = Type.Object({ chunks: Type.String({ minLength: 3, maxLength: 1024 }) }, { additionalProperties: false });
  app.get('/api/worlds/:worldSlug/terrain/overview/villages', { schema: {
    params, querystring: Type.Object({ x: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), y: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) }, { additionalProperties: false }),
    response: { 200: TerrainVillageOverviewSchema },
  } }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const world = await authorizedOverviewWorld(db, account.id, (request.params as { worldSlug: string }).worldSlug);
    const query = request.query as { x: number; y: number };
    reply.header('Cache-Control', 'private, no-store');
    return getTerrainVillages(db, world, query.x, query.y);
  });
  app.get('/api/worlds/:worldSlug/terrain', { schema: {
    params, querystring,
    response: { 200: TerrainResponseSchema },
  } }, async (request) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    return getTerrain(db, account.id, (request.params as { worldSlug: string }).worldSlug, (request.query as { chunks: string }).chunks);
  });
  app.get('/api/worlds/:worldSlug/terrain/updates', { schema: { params, querystring, response: { 200: TerrainUpdatesResponseSchema } } }, async (request) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    return getTerrainUpdates(db, account.id, (request.params as { worldSlug: string }).worldSlug, (request.query as { chunks: string }).chunks);
  });
  app.get('/api/worlds/:worldSlug/terrain/overview', { schema: { params, response: { 200: TerrainOverviewSchema, 304: Type.Null() } } }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const world = await authorizedOverviewWorld(db, account.id, (request.params as { worldSlug: string }).worldSlug);
    reply.header('Cache-Control', 'private, no-cache');
    const etag = overviewEtag(world);
    if (request.headers['if-none-match'] === etag) return reply.header('ETag', etag).code(304).send();
    const result = await getTerrainOverview(db, world);
    return reply.header('ETag', etag).send(result);
  });
  app.get('/api/worlds/:worldSlug/terrain/overview/vegetation', { schema: { params, response: { 200: TerrainVegetationOverviewSchema } } }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const world = await authorizedOverviewWorld(db, account.id, (request.params as { worldSlug: string }).worldSlug);
    reply.header('Cache-Control', 'private, no-store');
    return getTerrainVegetationOverview(db, world);
  });
}
