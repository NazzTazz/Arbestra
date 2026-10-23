import { Type } from '@sinclair/typebox';
import {
  ObservationPublicationSchema,
  ObservationLeaseSchema,
  ObservationStatusSchema,
  ObservationLaunchSchema,
  villageFrame,
  type ObservationPublication,
  type VillageState,
} from '@arbestra/contracts';
import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';
import type { AppConfig } from '../../config.js';
import { createDatabase } from '../../database/connection.js';
import { HttpError } from '../../errors.js';
import { hashSessionToken } from '../../security/sessions.js';
import { requireAdmin, hashAdminSessionToken, ADMIN_COOKIE_NAME } from './auth.js';
import { ObservationAccess, OBSERVER_COOKIE } from './observation-access.js';
import { authenticate } from '../auth/service.js';
import { ownedVillage } from '../villages/service.js';
import { getTerrain, getTerrainUpdates } from '../worlds/terrain.js';
import {
  authorizedOverviewWorld,
  getTerrainOverview,
  getTerrainVegetationOverview,
} from '../worlds/terrain-overview.js';
import { getTerrainVillages } from '../worlds/terrain-villages.js';
import { ObservationReads } from './observation-reads.js';
import { ObservationHub } from './observation-hub.js';
import type { VillageSyncProjections } from '../villages/sync-projections.js';
import { markHttpStream } from '../operations/telemetry.js';

const uuid = Type.String({ format: 'uuid' }),
  params = Type.Object({ id: uuid }, { additionalProperties: false });
export async function registerObservationRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  config: AppConfig,
  hub: ObservationHub,
  projections: VillageSyncProjections,
) {
  const readsDb = createDatabase(
    config.databaseUrl,
    () => app.log.warn({ code: 'OBSERVATION_DB_INTERRUPTED' }, 'Observation DB interrupted'),
    { observation: true },
  );
  const reads = new ObservationReads(readsDb, hub, projections),
    access = new ObservationAccess(hub);
  const buffers = new Map<string, { bytes: () => number; close: () => void }>();
  const terrain = new Map<string, { active: number; tokens: number; at: number }>();
  let terrainActive = 0;
  const sweep = setInterval(() => hub.sweep(), 1000);
  sweep.unref();
  hub.onClose((l, reason, actorId) => {
    terrain.delete(l.id);
    app.log.info(
      {
        event: 'admin.observation_closed',
        actorId,
        worldId: l.worldId,
        villageId: l.villageId,
        observationId: l.id,
        reason,
      },
      'Observation closed',
    );
  });
  app.addHook('preClose', async () => {
    clearInterval(sweep);
    hub.closeAll();
    await readsDb.destroy();
  });
  const audit = (request: FastifyRequest, actorId: string, id: string, action: string) => {
    const l = hub.get(id, actorId);
    request.log.info(
      { event: action, actorId, worldId: l.worldId, villageId: l.villageId, observationId: id },
      'Administrator observation',
    );
  };
  const register = async (admin: FastifyInstance, viewer: boolean) => {
    const authorize = (request: FastifyRequest, action = 'observe') =>
      viewer
        ? access.authorize(request, db, config, action !== 'observe_stream')
        : requireAdmin(request, db, config, action);
    admin.setErrorHandler((error, _request, reply) => {
      if (error instanceof Error) {
        const failure = error as FastifyError;
        if (
          error instanceof HttpError ||
          failure.validation ||
          (failure.statusCode !== undefined && failure.statusCode < 500)
        )
          throw error;
      }
      reply.header('Retry-After', '2');
      throw new HttpError(503, 'ADMIN_DATA_UNAVAILABLE', 'Lecture d’observation momentanément indisponible.');
    });
    admin.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      await authorize(request, 'observe');
    });
    if (!viewer) {
      admin.post(
        '/',
        {
          schema: {
            body: Type.Object({ worldId: uuid, villageId: uuid }, { additionalProperties: false }),
            response: { 200: ObservationLeaseSchema },
          },
        },
        async (request) => {
          const actor = await authorize(request, 'observation_open');
          const body = request.body as { worldId: string; villageId: string };
          const target = await reads.target(body.worldId, body.villageId);
          const l = hub.create(actor.id, target);
          audit(request, actor.id, l.id, 'admin.observation_opened');
          return l;
        },
      );
      admin.post(
        '/launch',
        {
          schema: {
            body: Type.Object({ worldId: uuid, villageId: uuid }, { additionalProperties: false }),
            response: { 200: ObservationLaunchSchema },
          },
        },
        async (request) => {
          const actor = await authorize(request, 'observation_open');
          access.worldOrigin(config);
          const body = request.body as { worldId: string; villageId: string };
          const l = hub.create(actor.id, await reads.target(body.worldId, body.villageId));
          try {
            const launch = access.launch(
              config,
              l,
              actor.id,
              hashAdminSessionToken(request.cookies[ADMIN_COOKIE_NAME]!),
            );
            audit(request, actor.id, l.id, 'admin.observation_opened');
            return launch;
          } catch (error) {
            hub.close(l.id);
            throw error;
          }
        },
      );
    }
    admin.get('/:id', { schema: { params, response: { 200: ObservationStatusSchema } } }, async (request) => {
      const actor = await authorize(request, 'observe');
      const l = hub.get((request.params as { id: string }).id, actor.id);
      await reads.validate(l);
      return hub.status(l.id, actor.id);
    });
    admin.post('/:id/heartbeat', { schema: { params } }, async (request) => {
      const actor = await authorize(request, 'observe');
      hub.heartbeat((request.params as { id: string }).id, actor.id);
      return { ok: true };
    });
    admin.post(
      '/:id/follow',
      {
        schema: {
          params,
          body: Type.Object({ sourceId: Type.Union([uuid, Type.Null()]) }, { additionalProperties: false }),
        },
      },
      async (request) => {
        const actor = await authorize(request, 'observe_follow'),
          id = (request.params as { id: string }).id,
          l = hub.get(id, actor.id),
          { sourceId } = request.body as { sourceId: string | null };
        if (sourceId && !hub.cameras(l).some((s) => s.id === sourceId))
          throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source indisponible.');
        app.log.info(
          {
            event: 'admin.observation_follow',
            actorId: actor.id,
            worldId: l.worldId,
            villageId: l.villageId,
            observationId: id,
            sourceId,
          },
          'Observation source changed',
        );
        return { ok: true };
      },
    );
    admin.delete('/:id', { schema: { params } }, async (request, reply) => {
      const actor = await authorize(request, 'observe');
      const id = (request.params as { id: string }).id;
      hub.get(id, actor.id);
      audit(request, actor.id, id, 'admin.observation_stopped');
      hub.close(id);
      return reply.status(204).send();
    });
    admin.get('/:id/snapshot', { schema: { params } }, async (request, reply) => {
      const actor = await authorize(request, 'observe');
      try {
        const l = hub.get((request.params as { id: string }).id, actor.id);
        await reads.validate(l);
        return await reads.snapshot(l);
      } catch (error) {
        reply.header('Retry-After', '2');
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, 'ADMIN_DATA_UNAVAILABLE', 'Lecture d’observation momentanément indisponible.');
      }
    });
    admin.get('/:id/events', { schema: { params } }, async (request, reply) => {
      const actor = await authorize(request, 'observe'),
        id = (request.params as { id: string }).id;
      const l = hub.get(id, actor.id),
        slot = hub.open(id, actor.id);
      let closed = false,
        started = false,
        authorizedUntil = Date.now() + 10000;
      let previous: VillageState | undefined;
      let authFlight = false,
        flight = false;
      const gone = () => closed || reply.raw.destroyed || reply.raw.writableEnded || !slot.current();
      let timer: ReturnType<typeof setInterval> | undefined,
        authTimer: ReturnType<typeof setInterval> | undefined,
        cameraTimer: ReturnType<typeof setInterval> | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        if (authTimer) clearInterval(authTimer);
        if (cameraTimer) clearInterval(cameraTimer);
        buffers.delete(id);
        slot.release();
        if (started) reply.raw.end();
      };
      try {
        await reads.validate(l);
        if (gone()) {
          close();
          return;
        }
        markHttpStream(request);
        reply.hijack();
        started = true;
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'private, no-store, no-transform',
          'X-Accel-Buffering': 'no',
          Connection: 'keep-alive',
        });
        reply.raw.write('retry: 2000\n\n');
        if (!slot.attach(close)) return;
        buffers.set(id, { bytes: () => reply.raw.writableLength, close });
        reply.raw.once('close', close);
        const send = (event: string, data: unknown) => {
          if (gone()) return;
          if (Date.now() >= authorizedUntil) {
            hub.close(id, 'authorization_timeout');
            return;
          }
          const wire = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n',
            size = Buffer.byteLength(wire);
          if (reply.raw.writableLength + size > 1048576) {
            close();
            return;
          }
          while ([...buffers.values()].reduce((n, f) => n + f.bytes(), 0) + size > 8 * 1048576) {
            const largest = [...buffers.values()].sort((a, b) => b.bytes() - a.bytes())[0];
            if (!largest) {
              close();
              return;
            }
            largest.close();
            if (gone()) return;
          }
          reply.raw.write(wire);
        };
        const auth = async () => {
          if (gone() || authFlight) return;
          authFlight = true;
          try {
            await authorize(request, 'observe_stream');
            hub.get(id, actor.id);
            authorizedUntil = Date.now() + 10000;
          } catch {
            send('expired', {});
            hub.close(id, 'authorization_revoked');
            close();
          } finally {
            authFlight = false;
          }
        };
        const tick = async () => {
          if (gone()) return;
          try {
            send('status', hub.status(id, actor.id));
          } catch {
            close();
            return;
          }
          if (flight) return;
          flight = true;
          // Receipt delivery remains independent of a slow terrain/navigation projection.
          void reads.receipts(l, actor.id).catch(() => {});
          try {
            const state = await reads.snapshot(l);
            if (gone()) return;
            if (!previous) {
              send('snapshot', state);
              previous = state;
            } else if (state !== previous) {
              if (state.syncRevision! > previous.syncRevision!) send('frame', villageFrame(previous, state));
              else send('snapshot', state);
              previous = state;
            }
          } catch {
            hub.degrade(l, true);
            send('degraded', { message: 'Observation retardée.' });
          } finally {
            flight = false;
            if (!gone()) send('status', hub.status(id, actor.id));
          }
        };
        let lastCameras = '';
        cameraTimer = setInterval(() => {
          if (gone()) return;
          const sources = hub.cameras(l),
            encoded = JSON.stringify(sources);
          if (encoded !== lastCameras) {
            lastCameras = encoded;
            send('cameras', sources);
          }
        }, 200);
        authTimer = setInterval(() => void auth(), 5000);
        timer = setInterval(() => void tick(), 2000);
        void tick();
      } catch (error) {
        close();
        throw error;
      }
    });
    admin.get(
      '/:id/terrain',
      {
        schema: {
          params,
          querystring: Type.Object(
            {
              kind: Type.Union(['chunks', 'updates', 'overview', 'vegetation', 'villages'].map((x) => Type.Literal(x))),
              chunks: Type.Optional(Type.String({ maxLength: 1024 })),
              x: Type.Optional(Type.Integer({ minimum: 0 })),
              y: Type.Optional(Type.Integer({ minimum: 0 })),
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) => {
        const actor = await authorize(request, 'observe_terrain'),
          l = hub.get((request.params as { id: string }).id, actor.id),
          q = request.query as { kind: string; chunks?: string; x?: number; y?: number };
        const at = Date.now(),
          limit = terrain.get(l.id) ?? { active: 0, tokens: 5, at };
        limit.tokens = Math.min(5, limit.tokens + (at - limit.at) / 200);
        limit.at = at;
        terrain.set(l.id, limit);
        if (limit.active >= 2 || terrainActive >= 4 || limit.tokens < 1) {
          reply.header('Retry-After', '1');
          throw new HttpError(429, 'OBSERVATION_RATE', 'Lecture terrain occupée.');
        }
        limit.tokens--;
        limit.active++;
        terrainActive++;
        try {
          await reads.validate(l);
          if (q.kind === 'chunks' || q.kind === 'updates') {
            if (!q.chunks) throw new HttpError(400, 'CHUNKS_REQUIRED', 'Chunks requis.');
            return q.kind === 'chunks'
              ? await getTerrain(readsDb, l.accountId, l.worldSlug, q.chunks)
              : await getTerrainUpdates(readsDb, l.accountId, l.worldSlug, q.chunks, false, true);
          }
          const world = await authorizedOverviewWorld(readsDb, l.accountId, l.worldSlug);
          if (q.kind === 'overview') return await getTerrainOverview(readsDb, world);
          if (q.kind === 'vegetation') return await getTerrainVegetationOverview(readsDb, world);
          if (q.x === undefined || q.y === undefined) throw new HttpError(400, 'TARGET_REQUIRED', 'Centre requis.');
          return await getTerrainVillages(readsDb, world, q.x, q.y, l.accountId, false);
        } finally {
          limit.active--;
          terrainActive--;
        }
      },
    );
  };
  await app.register((plugin) => register(plugin, false), { prefix: '/api/admin/observations' });
  await app.register((plugin) => register(plugin, true), { prefix: '/api/observation' });
  app.post(
    '/api/observation/exchange',
    {
      bodyLimit: 1024,
      schema: {
        body: Type.Object({ token: Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' }) }, { additionalProperties: false }),
        response: { 200: ObservationLeaseSchema },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const { lease, cookie } = await access.exchange(request, db, config, (request.body as { token: string }).token);
      // Exchange only the launch capability. Data routes revalidate ownership before
      // delivery; a cold observation pool must not consume the grant without a cookie.
      reply.setCookie(OBSERVER_COOKIE, cookie, {
        path: '/api/observation/' + lease.id,
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'strict',
        maxAge: Math.max(0, Math.floor((Date.parse(lease.expiresAt) - Date.now()) / 1000)),
      });
      return lease;
    },
  );
  const playerParams = Type.Object(
    { worldSlug: Type.String({ minLength: 1, maxLength: 64 }), villageId: uuid },
    { additionalProperties: false },
  );
  const player = async (request: FastifyRequest) => {
    const origin = `${request.protocol}://${request.host}`;
    if (
      request.headers.origin !== origin ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      origin === config.adminOrigin
    )
      throw new HttpError(403, 'INVALID_ORIGIN', 'Origine non autorisée.');
    const a = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    const v = await ownedVillage(db, a.id, worldSlug, villageId);
    return {
      accountId: a.id,
      worldId: v.worldId,
      villageId,
      session: hashSessionToken(request.cookies[config.cookieName]!),
    };
  };
  const path = '/api/worlds/:worldSlug/villages/:villageId/observation';
  app.post(path + '/status', { schema: { params: playerParams } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const p = await player(request);
    return { active: hub.active(p.worldId, p.villageId, p.accountId) };
  });
  app.post(path + '/sources', { schema: { params: playerParams } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const p = await player(request);
    return { sourceId: hub.source(p.session, p.accountId, p.worldId, p.villageId) };
  });
  app.post(
    path + '/camera',
    { bodyLimit: 2048, schema: { params: playerParams, body: ObservationPublicationSchema } },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const p = await player(request),
        body = request.body as ObservationPublication;
      if (body.pose && (body.pose.mode === 'village' || body.pose.mode === 'region')) {
        const w = await db
          .selectFrom('worlds')
          .select(['widthCells', 'heightCells'])
          .where('id', '=', p.worldId)
          .executeTakeFirstOrThrow();
        if (body.pose.cellX >= w.widthCells || body.pose.cellY >= w.heightCells)
          throw new HttpError(400, 'INVALID_CAMERA', 'Position caméra invalide.');
      }
      if (body.pose?.mode === 'world') {
        const { eye, target, up } = body.pose;
        if (Math.hypot(...up) < 0.5 || Math.hypot(...eye.map((x, i) => x - target[i]!)) < 0.0001)
          throw new HttpError(400, 'INVALID_CAMERA', 'Pose caméra invalide.');
      }
      return hub.publish(p.session, p.accountId, p.worldId, p.villageId, body);
    },
  );
}
