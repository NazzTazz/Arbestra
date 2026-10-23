import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  SyncV2BatchSchema,
  SyncV2ReadRequestSchema,
  VillagePresentationSchema,
  type SyncV2ReadRequest,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { AppConfig } from '../../config.js';
import { HttpError } from '../../errors.js';
import { authenticate } from '../auth/service.js';
import { reconcileVillageForRead } from './service.js';
import { captureSyncV2, type SyncV2SharedInclude } from './sync-v2-capture.js';
import { serveSyncV2Stream } from './sync-v2-stream.js';
import { readVillagePresentation } from './presentation.js';
import type { TravelNetworkExecutor } from '../navigation/network-job.js';

const params = Type.Object({
  worldSlug: Type.String({ minLength: 1, maxLength: 64 }),
  villageId: Type.String({ format: 'uuid' }),
});
const headers = Type.Object({ 'x-arbestra-protocol': Type.Literal('2') }, { additionalProperties: true });
const prefix = '/api/worlds/:worldSlug/villages/:villageId';

/** Registration is not activation: until the complete writer/backfill rollout
 * is installed, these endpoints fail closed rather than expose partial streams.
 * Checked in the catalog, readable by the runtime role: deployment revokes
 * every right on kysely_migration from it. The 057 traffic collector is the
 * last piece of that rollout (053–057 are applied in order). */
export async function assertSyncV2Available(db: Kysely<Database>): Promise<void> {
  const { ready } = (
    await sql<{ ready: boolean }>`select to_regclass('game_sync_streams') is not null
      and to_regprocedure('game_sync_collect_traffic()') is not null as ready`.execute(db)
  ).rows[0]!;
  if (!ready) throw new HttpError(503, 'SYNC_V2_UNAVAILABLE', 'Synchronisation V2 indisponible.');
}

export async function registerSyncV2Routes(
  app: FastifyInstance,
  db: Kysely<Database>,
  config: Pick<AppConfig, 'cookieName'>,
  navigation: TravelNetworkExecutor,
) {
  const streams = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const close of streams) close();
  });
  // Independent of the change journal: a pure read-only projection, refreshed
  // by the client on invalidation. The ETag spares the transfer, not the work.
  app.get(
    `${prefix}/presentation`,
    {
      schema: {
        params,
        headers,
        querystring: Type.Object({ knownRegion: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })) }),
        response: { 200: VillagePresentationSchema, 304: Type.Null() },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const presentation = await readVillagePresentation(db, account.id, worldSlug, villageId, navigation);
      const etag = `"${presentation.version}"`;
      reply.header('Cache-Control', 'private, no-cache').header('ETag', etag);
      if (request.headers['if-none-match'] === etag) return reply.status(304).send();
      // The client's copy of an unchanged terrain window is reused, not resent.
      const { knownRegion } = request.query as { knownRegion?: string };
      return reply
        .serializer(JSON.stringify)
        .send(knownRegion === presentation.regionVersion ? { ...presentation, region: null } : presentation);
    },
  );
  const bootstrapQuery = Type.Object({
    generation: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    // Optional shared scopes; the private stream is always included.
    include: Type.Optional(
      Type.String({ pattern: '^(knowledge|manifest|traffic)(,(knowledge|manifest|traffic)){0,2}$' }),
    ),
    villageId: Type.Optional(Type.String({ format: 'uuid' })),
  });
  const bootstrap = async (request: FastifyRequest, reply: FastifyReply, villageId: string | undefined) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    await assertSyncV2Available(db);
    const { worldSlug } = request.params as { worldSlug: string };
    // Explicit pre-H compatibility adapter. It commits before the single MVCC
    // capture of values and cursors, and never constructs a legacy snapshot.
    // It also resolves the default village exactly as the historical read.
    const economy = await reconcileVillageForRead(db, account.id, worldSlug, villageId);
    reply.header('Cache-Control', 'no-store');
    // Same encoding as the stream. Schema serializers compile component
    // unions lazily, costing seconds on the first bootstrap of a process.
    reply.serializer(JSON.stringify);
    const query = request.query as { generation: number; include?: string };
    const include = [...new Set(query.include?.split(',') as SyncV2SharedInclude[] | undefined)];
    return captureSyncV2(
      db,
      account.id,
      worldSlug,
      economy.villageId,
      { protocol: 2, generation: query.generation, scopes: [], cursors: [] },
      { include },
    );
  };
  app.get(
    `${prefix}/bootstrap`,
    {
      schema: {
        params,
        headers,
        querystring: Type.Omit(bootstrapQuery, ['villageId']),
        response: { 200: SyncV2BatchSchema },
      },
    },
    (request, reply) => bootstrap(request, reply, (request.params as { villageId: string }).villageId),
  );
  // First load without the historical village read: the client does not know
  // its village id yet, like GET /village (optional villageId selects one).
  app.get(
    '/api/worlds/:worldSlug/village/bootstrap',
    {
      schema: {
        params: Type.Object({ worldSlug: params.properties.worldSlug }),
        headers,
        querystring: bootstrapQuery,
        response: { 200: SyncV2BatchSchema },
      },
    },
    (request, reply) => bootstrap(request, reply, (request.query as { villageId?: string }).villageId),
  );
  for (const operation of ['read', 'stream'] as const)
    app.post(
      `${prefix}/sync/${operation}`,
      {
        bodyLimit: 32768,
        schema: {
          params,
          headers,
          body: SyncV2ReadRequestSchema,
          ...(operation === 'read' ? { response: { 200: SyncV2BatchSchema } } : {}),
        },
        // Reject unknown fields before Fastify's AJV removes them.
        preValidation: async (request) => {
          if (!Value.Check(SyncV2ReadRequestSchema, request.body))
            throw new HttpError(400, 'INVALID_SYNC_REQUEST', 'Requête de synchronisation invalide.');
        },
      },
      async (request, reply) => {
        const token = request.cookies[config.cookieName];
        const account = await authenticate(db, token);
        await assertSyncV2Available(db);
        const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
        const body = request.body as SyncV2ReadRequest;
        reply.header('Cache-Control', 'no-store');
        if (operation === 'read') {
          reply.serializer(JSON.stringify);
          return captureSyncV2(db, account.id, worldSlug, villageId, body);
        }
        const close = () => reply.raw.destroy();
        streams.add(close);
        try {
          await serveSyncV2Stream(
            reply,
            body,
            async (next) => {
              const current = await authenticate(db, token);
              return captureSyncV2(db, current.id, worldSlug, villageId, next);
            },
            {
              onError: () => app.log.warn({ code: 'SYNC_V2_STREAM_INTERRUPTED' }, 'Synchronization stream interrupted'),
            },
          );
        } finally {
          streams.delete(close);
        }
      },
    );
}
