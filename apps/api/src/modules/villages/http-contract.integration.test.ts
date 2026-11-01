import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import { readWorksites } from '../deposits/worksites.js';
import { readExtraction, readExtractions } from '../deposits/stone-extractions.js';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { hashSessionToken } from '../../security/sessions.js';
import { buildApp } from '../../app.js';
import { operationsFor } from '../operations/telemetry.js';
import { HttpError } from '../../errors.js';
import { constructBuildingArea } from './legacy-commands.fixture.js';

// What survives of the former synchronization suite (V1 reads, the SSE stream and
// COUNT revisions left in lot I): the receipts read, the classification of HTTP
// errors, the bounded worksite projections and the rollback of a placement.

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected synchronization fixture DB');
const db = createDatabase(url),
  accountId = randomUUID(),
  token = randomUUID();
let worldId = randomUUID(),
  villageId = randomUUID(),
  hallId = randomUUID(),
  houseId = randomUUID(),
  slug = 'sync-' + worldId;
let app: FastifyInstance;

it('reads grouped command receipts over HTTP without replaying commands or returning private request payloads', async () => {
  const commandId = randomUUID(),
    orderId = randomUUID();
  const commandTime = new Date('2026-10-21T12:00:00Z');
  await db
    .insertInto('processingCommandReceipts')
    .values({
      worldId,
      villageId,
      commandId,
      orderId,
      commandTime,
      request: JSON.stringify({ action: 'pause', commandId, orderId }),
    })
    .execute();
  const send = (payload: Record<string, unknown>, target = villageId) =>
    app.inject({
      method: 'POST',
      url: `/api/worlds/${slug}/villages/${target}/commands/receipts/read`,
      cookies: { arbestra_session: token },
      payload,
    });
  const response = await send({
    commands: [
      { family: 'processing', commandId },
      { family: 'processing', commandId: randomUUID() },
    ],
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    worldId,
    villageId,
    receipts: [
      {
        family: 'processing',
        commandId,
        status: 'applied',
        commandTime: commandTime.toISOString(),
        result: { orderId },
      },
    ],
  });
  expect(
    (await db.selectFrom('buildings').select('status').where('id', '=', houseId).executeTakeFirstOrThrow()).status,
  ).toBe('under-construction');
  expect(
    (await send({ commands: Array.from({ length: 33 }, () => ({ family: 'processing', commandId })) })).statusCode,
  ).toBe(400);
  expect((await send({ commands: [{ family: 'processing', commandId, injected: true }] })).statusCode).toBe(400);
  expect((await send({ commands: [{ family: 'processing', commandId }] }, randomUUID())).statusCode).toBe(404);
});

beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@sync.test', passwordHash: 'fixture' })
    .execute();
  await db
    .insertInto('sessions')
    .values({ accountId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
    .execute();
  app = await buildApp(
    {
      databaseUrl: url,
      host: '127.0.0.1',
      port: 0,
      isProduction: false,
      cookieName: 'arbestra_session',
      sessionTtlDays: 30,
      constructionDurationOverrideMs: 600000,
      scheduledTaskPollIntervalMs: 250,
    },
    db,
  );
  app.get('/noc-v11-fixture/:kind', async (request, reply) => {
    const { kind } = request.params as { kind: string };
    if (kind === 'busy') throw new HttpError(503, 'ADMIN_BUSY', 'Capacité occupée.');
    if (kind === 'unavailable') throw new HttpError(503, 'ADMIN_DATA_UNAVAILABLE', 'Lecture indisponible.');
    if (kind === 'direct') return reply.status(503).send({ code: 'must-not-inspect-payload' });
    throw new Error('secret-exception\npostgres://secret-noc:password@private', {
      cause: new Error('nested-secret-noc'),
    });
  });
  app.get(
    '/noc-v11-serialization',
    {
      schema: {
        response: {
          200: { type: 'object', required: ['requiredNumber'], properties: { requiredNumber: { type: 'integer' } } },
        },
      },
    },
    async () => ({}),
  );
  app.get(
    '/noc-v11-validation',
    {
      schema: {
        querystring: { type: 'object', required: ['count'], properties: { count: { type: 'integer', minimum: 1 } } },
      },
    },
    async () => ({ ok: true }),
  );
}, 120000);
beforeEach(async () => {
  // Every case owns fresh geometry and cursors; earlier construction tests cannot obstruct later roads.
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  worldId = randomUUID();
  villageId = randomUUID();
  hallId = randomUUID();
  houseId = randomUUID();
  slug = 'sync-' + worldId;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('worlds')
      .values({
        id: worldId,
        slug,
        name: 'Sync test',
        topology: 'torus',
        widthCells: 512,
        heightCells: 256,
        chunkSize: 32,
        seed: 4109,
        generationVersion: 1,
        generationStatus: 'ready',
        isOpen: true,
        generatedAt: new Date(),
      })
      .execute();
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Sync' }).execute();
    await tx
      .insertInto('villages')
      .values({
        id: villageId,
        worldId,
        ownerAccountId: accountId,
        name: 'Initial',
        anchorCellX: 64,
        anchorCellY: 64,
        economyActivatedAt: new Date(),
      })
      .execute();
    for (const chunkX of [1, 2])
      for (const chunkY of [1, 2])
        await tx
          .insertInto('worldChunks')
          .values({
            worldId,
            chunkX,
            chunkY,
            generationVersion: 1,
            terrainCodes: Array(1024).fill(1),
            elevations: Array(1024).fill(0),
          })
          .execute();
    for (const code of ['wood', 'carrot', 'stone'])
      await tx
        .insertInto('villageResources')
        .values({ worldId, villageId, resourceCode: code, amount: 2000 })
        .execute();
    await tx
      .insertInto('villageResourceFlows')
      .values({
        worldId,
        villageId,
        resourceCode: 'wood',
        baseRatePerHour: 0,
        remainder: 0,
        productionUpdatedAt: new Date(),
      })
      .execute();
    await tx
      .insertInto('playerScience')
      .values({ worldId, accountId, observationsSince: null, solarReport: null })
      .execute();
    await tx
      .insertInto('buildings')
      .values([
        {
          id: hallId,
          worldId,
          villageId,
          buildingType: 'town-hall',
          level: 1,
          targetLevel: null,
          status: 'completed',
          constructionStartedAt: null,
          constructionCompletesAt: null,
          completedAt: new Date(),
        },
        {
          id: houseId,
          worldId,
          villageId,
          buildingType: 'dwelling',
          level: 1,
          targetLevel: null,
          status: 'under-construction',
          constructionStartedAt: new Date(Date.now() - 2000),
          constructionCompletesAt: new Date(Date.now() - 1000),
          completedAt: null,
        },
      ])
      .execute();
    for (const [buildingId, cellX] of [
      [hallId, 64],
      [houseId, 65],
    ] as const)
      await tx
        .insertInto('worldCellOccupancies')
        .values({ worldId, buildingId, featureId: null, cellX, cellY: 64, role: 'anchor' })
        .execute();
  });
});
afterAll(async () => {
  if (app) await app.close();
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
}, 60000);

it('classifies HTTP outcomes through the real application error handler', async () => {
  const telemetry = operationsFor(app)!;
  for (const [url, status, code] of [
    ['/noc-v11-fixture/busy', 503, 'ADMIN_BUSY'],
    ['/noc-v11-fixture/unavailable', 503, 'ADMIN_DATA_UNAVAILABLE'],
    ['/noc-v11-fixture/direct', 503, 'HTTP_SERVER_RESPONSE'],
    ['/noc-v11-fixture/exception', 500, 'INTERNAL_ERROR'],
    ['/noc-v11-serialization', 500, 'INTERNAL_ERROR'],
  ] as const) {
    const response = await app.inject({
      url: url + '?secret=query-secret-noc',
      headers: { 'x-request-id': randomUUID() },
    });
    expect(response.statusCode, response.body).toBe(status);
    const requestId = response.headers['x-request-id'] as string;
    const detail = telemetry.httpRequestDetail(requestId, telemetry.instanceId);
    expect(detail.observation).toMatchObject({
      requestId,
      statusCode: status,
      safeCode: code,
      outcome: 'response',
      reasons: expect.arrayContaining(['server_error']),
    });
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.httpRequest).toEqual({ instanceId: telemetry.instanceId, requestId });
    expect(JSON.stringify(detail)).not.toMatch(/secret-noc|password|private|must-not-inspect-payload/);
  }
  const validation = await app.inject('/noc-v11-validation?count=invalid');
  expect(validation.statusCode).toBe(400);
  expect(validation.json().code).toBe('VALIDATION_ERROR');
  expect(validation.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
});

it('rolls back observed commit-mode construction writes on an exact injected failure', async () => {
  const tables = [
    'villages',
    'villageResources',
    'villageResourceFlows',
    'buildings',
    'worldCellOccupancies',
    'scheduledTasks',
    'buildingCommandReceipts',
    'populationCohorts',
    'gardenPlots',
    'buildingExpansions',
    'villageAccomplishments',
    'buildingResourceBuffers',
    'scienceActivities',
    'playerScience',
    'buildingHiddenSupplies',
  ] as const;
  async function stored(source: Kysely<Database>) {
    const result: Record<string, unknown> = {};
    for (const table of tables)
      result[table] = await source.selectFrom(table).selectAll().where('worldId', '=', worldId).execute();
    return result;
  }
  const before = await stored(db),
    commandId = randomUUID(),
    injected = Error('construction commit-mode after observed finalization');
  let observed = false;
  await expect(
    db.transaction().execute(async (tx) => {
      const inside = {
        transaction: () => ({ execute: <T>(f: (t: Transaction<Database>) => Promise<T>) => f(tx) }),
        getExecutor: () => tx.getExecutor(),
      } as unknown as Kysely<Database>;
      await constructBuildingArea(
        inside,
        accountId,
        slug,
        villageId,
        'dwelling',
        { cellX: 62, cellY: 65 },
        [{ cellX: 62, cellY: 65 }],
        0,
        commandId,
        undefined,
        0,
        'logs',
        'commit',
      );
      expect(
        await tx
          .selectFrom('buildingCommandReceipts')
          .selectAll()
          .where('worldId', '=', worldId)
          .where('commandId', '=', commandId)
          .execute(),
      ).toHaveLength(1);
      expect(
        await tx
          .selectFrom('worldCellOccupancies')
          .selectAll()
          .where('worldId', '=', worldId)
          .where('cellX', '=', 62)
          .where('cellY', '=', 65)
          .execute(),
      ).toHaveLength(1);
      const created = await tx
        .selectFrom('buildingCommandReceipts')
        .innerJoin('buildings', 'buildings.id', 'buildingCommandReceipts.buildingId')
        .select('buildings.status')
        .where('buildingCommandReceipts.commandId', '=', commandId)
        .executeTakeFirstOrThrow();
      expect(created.status).toBe('under-construction'); // Even zero-duration jobs are completed by their handler.
      observed = true;
      throw injected;
    }),
  ).rejects.toBe(injected);
  expect(observed).toBe(true);
  expect(await stored(db)).toEqual(before);
});

it('batches worksite projections in three reads with identical active missions and ordered targets', async () => {
  const abort = Error('isolated batch projection cleanup');
  let checked = false;
  await expect(
    db.transaction().execute(async (tx) => {
      const features = [randomUUID(), randomUUID()],
        at = new Date(),
        siteIds: string[] = [];
      for (const [i, featureId] of features.entries()) {
        await tx
          .insertInto('worldFeatures')
          .values({ id: featureId, worldId, featureTypeCode: 'stone_outcrop', state: 'available', variantSeed: 2 })
          .execute();
        await tx
          .insertInto('stoneDeposits')
          .values({
            worldId,
            featureId,
            cellX: 80 + i,
            cellY: 80,
            initialAmount: 2000,
            remainingAmount: 2000,
            reservedAmount: 100,
            revision: 1,
            updatedAt: at,
          })
          .execute();
      }
      for (let i = 0; i < 6; i++) {
        const site = await tx
          .insertInto('extractionWorksites')
          .values({
            worldId,
            villageId,
            commandId: randomUUID(),
            requestedFeatureIds: features,
            requestedWorkerCap: 2,
            workerCap: 2,
            resourceCode: 'stone',
            mode: 'extract',
            status: 'paused',
            waitReason: null,
            nextWakeAt: null,
            lastDepartureAt: null,
            updatedAt: at,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        siteIds.push(site.id);
        for (const [ordinal, featureId] of [...features].reverse().entries())
          await tx
            .insertInto('extractionWorksiteTargets')
            .values({
              worksiteId: site.id,
              worldId,
              villageId,
              featureId,
              ordinal,
              status: i === 0 ? 'pending' : 'completed',
              admittedAt: null,
              thresholdReachedAt: null,
              completedAt: i === 0 ? null : at,
              reason: null,
            })
            .execute();
      }
      const mission = await tx
        .insertInto('depositExtractions')
        .values({
          worldId,
          villageId,
          featureId: features[0]!,
          worksiteId: siteIds[0]!,
          commandId: randomUUID(),
          status: 'in-progress',
          workerCount: 2,
          reservedAmount: 100,
          startedAt: at,
          completesAt: new Date(at.getTime() + 600000),
          completedAt: null,
          pathCells: sql`${JSON.stringify([
            { cellX: 64, cellY: 64 },
            { cellX: 80, cellY: 80 },
          ])}::jsonb`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const expectedMission = await readExtraction(tx, worldId, villageId, mission.id);
      let reads = 0;
      const source = tx.withPlugin({
        transformQuery(a) {
          if (a.node.kind === 'SelectQueryNode') reads++;
          return a.node;
        },
        async transformResult(a) {
          return a.result;
        },
      }) as Transaction<Database>;
      const projected = await readWorksites(source, worldId, villageId);
      expect(reads).toBe(3);
      expect(projected).toHaveLength(6);
      expect(projected.find((s) => s.id === siteIds[0])!.activeExtraction).toEqual(expectedMission);
      for (const site of projected) {
        expect(site.targets.map((t) => t.featureId)).toEqual([...features].reverse());
        expect(site.targets.map((t) => [t.cellX, t.cellY])).toEqual([
          [81, 80],
          [80, 80],
        ]);
        if (site.id !== siteIds[0]) expect(site.activeExtraction).toBeNull();
      }
      expect((await readExtractions(tx, worldId, villageId)).map((r) => r.extraction)).toEqual([expectedMission]);
      expect(await readWorksites(tx, worldId, randomUUID())).toEqual([]);
      expect(await readExtractions(tx, worldId, randomUUID())).toEqual([]);
      checked = true;
      throw abort;
    }),
  ).rejects.toBe(abort);
  expect(checked).toBe(true);
  expect(await db.selectFrom('extractionWorksites').select('id').where('worldId', '=', worldId).execute()).toEqual([]);
});
