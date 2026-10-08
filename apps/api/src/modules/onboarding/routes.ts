import { AvailableWorldsSchema, JoinWorldRequestSchema, JoinWorldResponseSchema, type JoinWorldRequest } from '@arbestra/contracts';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { authenticate } from '../auth/service.js';
import { availableWorlds, joinWorld } from './service.js';

export async function registerOnboardingRoutes(app: FastifyInstance, db: Kysely<Database>, config: AppConfig) {
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
