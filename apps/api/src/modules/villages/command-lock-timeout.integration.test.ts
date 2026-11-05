import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { Database } from '../../database/schema.js';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { hashSessionToken } from '../../security/sessions.js';
import { buildApp } from '../../app.js';
import { operationsFor } from '../operations/telemetry.js';

// R3 (docs/VERROUS-2026-11-04.md §11): an HTTP command that waits for a
// village or a zone held beyond its lock delay answers 503 ECONOMY_BUSY with
// Retry-After, writes nothing, and the holding transaction ends normally.

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected command lock fixture DB');
const db = createDatabase(url),
  accountId = randomUUID(),
  token = randomUUID();
let worldId = randomUUID(),
  villageId = randomUUID(),
  slug = 'busy-' + worldId;
let app: FastifyInstance;

const bounded = <T>(promise: Promise<T>, ms = 20_000) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(Error('barrier timeout')), ms))]);

/** Rows a command of this village could write (the holder's own change aside). */
async function stored() {
  const result: Record<string, unknown> = {};
  for (const table of [
    'villages',
    'villageResources',
    'villageResourceFlows',
    'buildings',
    'worldCellOccupancies',
    'scheduledTasks',
    'populationCohorts',
    'harvestIntentCancellations',
    'harvestSubmissions',
    'playerScience',
  ] as const)
    result[table] = (await db.selectFrom(table).selectAll().where('worldId', '=', worldId).execute())
      .map((row) => JSON.stringify(row))
      .sort();
  return result;
}

/** The backend blocked by `holder`, observed in pg_stat_activity. */
async function waitingOn(holder: number) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    // Aliases survive the camel-case plugin unchanged.
    const row = await sql<{ pid: number; waitType: string; waitEvent: string }>`
      select pid, wait_event_type as "waitType", wait_event as "waitEvent" from pg_stat_activity
      where ${holder} = any(pg_blocking_pids(pid))`.execute(db);
    if (row.rows[0]) return row.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error('the command never waited on the holder');
}

const post = (path: string, payload?: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/worlds/${slug}/villages/${villageId}/${path}`,
    cookies: { arbestra_session: token },
    headers: { 'x-request-id': randomUUID() },
    ...(payload ? { payload } : {}),
  });
type Send = () => ReturnType<typeof post>;

/** Holds a lock beyond the delay, sends the command once, then returns the
 * replay of the same command (same UUID) once the lock is free. */
async function busyCase(hold: (tx: Transaction<Database>) => Promise<void>, expectedWait: RegExp, send: Send) {
  const before = await stored();
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let holderPid!: number;
  let held!: () => void;
  const holding = new Promise<void>((resolve) => (held = resolve));
  const holder = db.transaction().execute(async (tx) => {
    holderPid = (await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
    await hold(tx);
    // The holder's own write, committed at its normal end.
    await tx.updateTable('worlds').set({ name: 'Tenu' }).where('id', '=', worldId).execute();
    held();
    await bounded(released);
  });
  void holder.catch(() => undefined);
  try {
    await bounded(holding);
    const started = Date.now();
    const command = send();
    const waiting = await waitingOn(holderPid);
    expect(waiting.waitType).toBe('Lock');
    expect(waiting.waitEvent).toMatch(expectedWait);
    const response = await bounded(command);
    const elapsed = Date.now() - started;
    // Answered while the holder still holds its lock: the delay, not the release.
    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({ code: 'ECONOMY_BUSY' });
    expect(response.headers['retry-after']).toBe('2');
    expect(elapsed).toBeGreaterThanOrEqual(3_500);
    expect(elapsed).toBeLessThan(15_000);
    // The NOC sees an application refusal, not an internal error.
    const telemetry = operationsFor(app)!,
      requestId = response.headers['x-request-id'] as string;
    expect(telemetry.httpRequestDetail(requestId, telemetry.instanceId).observation).toMatchObject({
      statusCode: 503,
      safeCode: 'ECONOMY_BUSY',
      errorCategory: 'application',
    });
    release();
    await bounded(holder);
  } finally {
    release();
    await Promise.allSettled([holder]);
  }
  expect((await db.selectFrom('worlds').select('name').where('id', '=', worldId).executeTakeFirstOrThrow()).name).toBe(
    'Tenu',
  );
  expect(await stored()).toEqual(before);
  // The client replays the same UUID once the lock is free.
  return send();
}

// Gesture cancellation: the replay of the same UUID passes its locks and
// reaches its business answer (an unknown gesture), nothing applied twice.
async function cancelCase(hold: (tx: Transaction<Database>) => Promise<void>, expectedWait: RegExp) {
  const commandId = randomUUID();
  const after = await busyCase(hold, expectedWait, () => post(`harvest-intents/${commandId}/cancel`));
  expect(after.statusCode, after.body).toBe(404);
  expect(after.json()).toMatchObject({ code: 'HARVEST_INTENT_NOT_FOUND' });
}

it('answers 503 ECONOMY_BUSY when the village row stays held beyond the lock delay', async () => {
  await cancelCase(async (tx) => {
    await tx.selectFrom('villages').select('id').where('id', '=', villageId).forUpdate().execute();
  }, /^(transactionid|tuple)$/);
}, 60_000);

it('answers 503 ECONOMY_BUSY when a zone of the village region stays held beyond the lock delay', async () => {
  // Anchor (64, 64), chunks of 32 cells: zone (2, 2), shared by the region.
  await cancelCase(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`infrastructure:${worldId}:2:2`}, 0))`.execute(tx);
  }, /^advisory$/);
}, 60_000);

it('answers 503 ECONOMY_BUSY when a harvest intent waits at COMMIT for a held V2 stream, then records its replay once', async () => {
  // The submission's V2 publication (deferred trigger, 053) updates the
  // village's stream rows at COMMIT: held here, as the retention may.
  const commandId = randomUUID(),
    intent = { commandId, gardens: [{ cellX: 64, cellY: 66 }], wood: [], stone: [] };
  const after = await busyCase(
    async (tx) => {
      await sql`select 1 from game_sync_streams where world_id = ${worldId} for update`.execute(tx);
    },
    /^(transactionid|tuple)$/,
    () => post('harvest-intents', intent),
  );
  expect(after.statusCode, after.body).toBe(200);
  expect(after.json()).toMatchObject({ commandId, pending: true });
  const again = await post('harvest-intents', intent);
  expect(again.statusCode, again.body).toBe(200);
  expect(again.json()).toEqual(after.json());
  expect(
    await db.selectFrom('harvestSubmissions').select('commandId').where('worldId', '=', worldId).execute(),
  ).toEqual([{ commandId }]);
  expect(
    await db
      .selectFrom('scheduledTasks')
      .select('id')
      .where('worldId', '=', worldId)
      .where('taskType', '=', 'harvest.intent')
      .execute(),
  ).toHaveLength(1);
}, 60_000);

beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@busy.test', passwordHash: 'fixture' })
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
      expeditionWorkerEnabled: false,
    },
    db,
  );
}, 120000);
beforeEach(async () => {
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  worldId = randomUUID();
  villageId = randomUUID();
  slug = 'busy-' + worldId;
  const hallId = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('worlds')
      .values({
        id: worldId,
        slug,
        name: 'Busy test',
        topology: 'torus',
        widthCells: 512,
        heightCells: 256,
        chunkSize: 32,
        seed: 4110,
        generationVersion: 1,
        generationStatus: 'ready',
        isOpen: true,
        generatedAt: new Date(),
      })
      .execute();
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Busy' }).execute();
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
      .insertInto('playerScience')
      .values({ worldId, accountId, observationsSince: null, solarReport: null })
      .execute();
    await tx
      .insertInto('buildings')
      .values({
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
      })
      .execute();
    await tx
      .insertInto('worldCellOccupancies')
      .values({ worldId, buildingId: hallId, featureId: null, cellX: 64, cellY: 64, role: 'anchor' })
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
