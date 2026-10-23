import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import {
  AdminOverviewSchema,
  AdminWorldsSchema,
  AdminWorldDetailSchema,
  AdminAccountsSchema,
  AdminAccountDetailSchema,
  AdminVillageDetailSchema,
  AdminActivitiesSchema,
  AdminActivityDetailSchema,
  AdminActivityKindSchema,
  type AdminActivity,
  type AdminRuntimeSnapshot,
  HttpRequestsQuerySchema,
  HttpRequestsPageSchema,
  HttpRequestDetailSchema,
  HttpInstanceMismatchSchema,
  type HttpRequestsQuery,
} from '@arbestra/contracts';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { operationsFor } from '../operations/telemetry.js';
import { HttpDiagnosticReadError } from '../operations/http-diagnostics.js';
import { requireAdmin } from './auth.js';
import { AdminReadService, type ActivityFilter } from './service.js';

export type AdminRuntimeProvider = () => AdminRuntimeSnapshot | Promise<AdminRuntimeSnapshot>;

export async function registerAdminRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  config: AppConfig,
  runtime: AdminRuntimeProvider,
): Promise<void> {
  const reads = new AdminReadService(db);
  const id = Type.String({ format: 'uuid' });
  const params = Type.Object({ id }, { additionalProperties: false });
  await app.register(
    async (admin) => {
      admin.addHook('onRequest', async (request, reply) => {
        reply.header('Cache-Control', 'private, no-store');
        await requireAdmin(request, db, config, 'read');
      });
      admin.get('/overview', { schema: { response: { 200: AdminOverviewSchema } } }, () => reads.overview());
      admin.get('/infrastructure', async () => runtime());
      // Fastify's default Ajv removes unknown keys. Reject them before validation instead.
      const allowedQuery = new Set(Object.keys(HttpRequestsQuerySchema.properties));
      admin.get(
        '/http-requests',
        {
          preValidation: async (request) => {
            if (Object.keys(request.query as object).some((key) => !allowedQuery.has(key))) {
              throw new HttpError(400, 'INVALID_HTTP_QUERY', 'Paramètre de diagnostic inconnu.');
            }
          },
          schema: {
            querystring: HttpRequestsQuerySchema,
            response: { 200: HttpRequestsPageSchema, 409: HttpInstanceMismatchSchema },
          },
        },
        (request, reply) => {
          const telemetry = operationsFor(request.server);
          if (!telemetry) throw new HttpError(503, 'ADMIN_DATA_UNAVAILABLE', 'Le diagnostic HTTP est indisponible.');
          try {
            return telemetry.httpDiagnostics.list(request.query as HttpRequestsQuery);
          } catch (error) {
            if (!(error instanceof HttpDiagnosticReadError)) throw error;
            if (error.statusCode === 409)
              return reply.code(409).send({
                code: error.code,
                message: error.message,
                instanceId: telemetry.instanceId,
                startedAt: telemetry.startedAt,
              });
            throw new HttpError(error.statusCode, error.code, error.message);
          }
        },
      );
      admin.get(
        '/http-requests/:requestId',
        {
          preValidation: async (request) => {
            if (Object.keys(request.query as object).some((key) => key !== 'instanceId')) {
              throw new HttpError(400, 'INVALID_HTTP_QUERY', 'Paramètre de diagnostic inconnu.');
            }
          },
          schema: {
            params: Type.Object({ requestId: id }, { additionalProperties: false }),
            querystring: Type.Object({ instanceId: id }, { additionalProperties: false }),
            response: { 200: HttpRequestDetailSchema, 409: HttpInstanceMismatchSchema },
          },
        },
        (request, reply) => {
          const telemetry = operationsFor(request.server);
          if (!telemetry) throw new HttpError(503, 'ADMIN_DATA_UNAVAILABLE', 'Le diagnostic HTTP est indisponible.');
          try {
            return telemetry.httpRequestDetail(
              (request.params as { requestId: string }).requestId,
              (request.query as { instanceId: string }).instanceId,
            );
          } catch (error) {
            if (!(error instanceof HttpDiagnosticReadError)) throw error;
            if (error.statusCode === 409)
              return reply.code(409).send({
                code: error.code,
                message: error.message,
                instanceId: telemetry.instanceId,
                startedAt: telemetry.startedAt,
              });
            throw new HttpError(error.statusCode, error.code, error.message);
          }
        },
      );
      admin.get('/worlds', { schema: { response: { 200: AdminWorldsSchema } } }, () => reads.worlds());
      admin.get('/worlds/:id', { schema: { params, response: { 200: AdminWorldDetailSchema } } }, (request) =>
        reads.world((request.params as { id: string }).id),
      );
      admin.get(
        '/accounts',
        {
          schema: {
            querystring: Type.Object(
              { query: Type.Optional(Type.String({ maxLength: 160 })), worldId: Type.Optional(id) },
              { additionalProperties: false },
            ),
            response: { 200: AdminAccountsSchema },
          },
        },
        (request) => {
          const query = request.query as { query?: string; worldId?: string };
          return reads.accounts(query.query?.trim() ?? '', query.worldId);
        },
      );
      admin.get('/accounts/:id', { schema: { params, response: { 200: AdminAccountDetailSchema } } }, (request) =>
        reads.account((request.params as { id: string }).id),
      );
      admin.get(
        '/villages/:id',
        {
          schema: {
            params,
            querystring: Type.Object({ worldId: id }, { additionalProperties: false }),
            response: { 200: AdminVillageDetailSchema },
          },
        },
        (request) =>
          reads.village((request.query as { worldId: string }).worldId, (request.params as { id: string }).id),
      );
      admin.get(
        '/activities',
        {
          schema: {
            querystring: Type.Object(
              {
                worldId: Type.Optional(id),
                villageId: Type.Optional(id),
                accountId: Type.Optional(id),
                kind: Type.Optional(AdminActivityKindSchema),
              },
              { additionalProperties: false },
            ),
            response: { 200: AdminActivitiesSchema },
          },
        },
        (request) => {
          const filter = request.query as ActivityFilter;
          if (filter.villageId && !filter.worldId)
            throw new HttpError(400, 'WORLD_REQUIRED', 'Le monde est requis pour un village.');
          return reads.activities(filter);
        },
      );
      admin.get(
        '/activities/:id',
        {
          schema: {
            params,
            querystring: Type.Object(
              { worldId: id, kind: AdminActivityKindSchema, villageId: Type.Optional(id) },
              { additionalProperties: false },
            ),
            response: { 200: AdminActivityDetailSchema },
          },
        },
        (request) => {
          const query = request.query as { worldId: string; kind: AdminActivity['kind']; villageId?: string };
          return reads.activity(query.worldId, query.kind, (request.params as { id: string }).id, query.villageId);
        },
      );
    },
    { prefix: '/api/admin' },
  );
}
