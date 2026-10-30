import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { sql } from 'kysely';
import { buildApp, journeyJournalFor } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';
import { pruneJourneyEvents } from './journey-journal.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected journey test database');
const db = createDatabase(url);
const accountId = randomUUID(),
  token = randomUUID(),
  worldId = randomUUID(),
  villageId = randomUUID(),
  slug = 'journey-' + worldId;
const apps: FastifyInstance[] = [];
// The opt-in latency measure runs alone: the functional cases end by deleting the account.
const bench = process.env.ARBESTRA_JOURNEY_BENCH === '1',
  check = bench ? it.skip : it;

async function seedCohort(memberCount: number) {
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).where('villageId', '=', villageId).execute();
  await db
    .insertInto('populationCohorts')
    .values({
      worldId,
      villageId,
      originVillageId: villageId,
      memberCount,
      activity: 'idle',
      energy: 8,
      energyProgress: 0,
      energyUpdatedAt: new Date(),
      restingSince: null,
      foodUsedSinceRest: 0,
    })
    .execute();
}
async function app(journeyEnabled: boolean) {
  const instance = await buildApp(
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
      journeyEnabled,
    } as Parameters<typeof buildApp>[0],
    db,
  );
  await instance.ready();
  apps.push(instance);
  return instance;
}
const gesture = (instance: FastifyInstance, payload: object) =>
  instance.inject({
    method: 'POST',
    url: `/api/worlds/${slug}/villages/${villageId}/population/gestures`,
    cookies: { arbestra_session: token },
    payload,
  });

beforeAll(async () => {
  await migrateToLatest(url);
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('accounts')
      .values({ id: accountId, email: accountId + '@journey.test', passwordHash: 'fixture' })
      .execute();
    await tx
      .insertInto('sessions')
      .values({ accountId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
      .execute();
    await tx
      .insertInto('worlds')
      .values({
        id: worldId,
        slug,
        name: 'Journey',
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
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Journey' }).execute();
    await tx
      .insertInto('villages')
      .values({
        id: villageId,
        worldId,
        ownerAccountId: accountId,
        name: 'Journey',
        anchorCellX: 64,
        anchorCellY: 64,
        economyActivatedAt: new Date(),
      })
      .execute();
    for (const resourceCode of ['wood', 'carrot', 'stone']) {
      await tx.insertInto('villageResources').values({ worldId, villageId, resourceCode, amount: 0 }).execute();
      await tx
        .insertInto('villageResourceFlows')
        .values({ worldId, villageId, resourceCode, baseRatePerHour: 0, remainder: 0, productionUpdatedAt: new Date() })
        .execute();
    }
    await tx
      .insertInto('villagePopulations')
      .values({ worldId, villageId, growthStartedAt: new Date(), nextArrivalAt: null })
      .execute();
  });
}, 120000);
afterAll(async () => {
  for (const instance of apps) await instance.close();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
}, 60000);

const journal = (instance: FastifyInstance) => journeyJournalFor(instance)!;
const rows = (commandId: string) =>
  db
    .selectFrom('playerJourneyEvents')
    .selectAll()
    .where('villageId', '=', villageId)
    .where('commandId', '=', commandId)
    .execute();
const cohorts = () =>
  db
    .selectFrom('populationCohorts')
    .select(['activity', 'memberCount', 'restingSince'])
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .orderBy('activity')
    .orderBy('memberCount')
    .execute();
/** Bounded wait for a condition (no fixed sleep as proof). */
async function until(condition: () => Promise<boolean> | boolean, label: string, ms = 15000) {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw Error('Timed out waiting for ' + label);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

check('journals an accepted command after the response, outside the business transaction', async () => {
  const instance = await app(true),
    commandId = randomUUID();
  await seedCohort(10);
  const response = await gesture(instance, { commandId, action: 'rest' });
  expect(response.statusCode, response.body).toBe(200);
  // Answered and committed, but nothing written yet: only the buffer holds it.
  expect(await rows(commandId)).toEqual([]);
  expect(journal(instance).status().buffered).toBe(1);
  await journal(instance).flush();
  const [row, ...others] = await rows(commandId);
  expect(others).toEqual([]);
  expect(row).toMatchObject({
    source: 'command',
    type: 'population.gestures',
    subject: 'rest',
    outcome: 'accepted',
    statusCode: 200,
    code: null,
    attempts: 1,
    accountId,
    worldId,
  });
  expect(journal(instance).status()).toMatchObject({ enabled: true, buffered: 0, dropped: 0, lost: 0 });
});

check('journals a refusal with its business code while the refused transaction changes nothing', async () => {
  const instance = await app(true);
  await seedCohort(10);
  expect((await gesture(instance, { commandId: randomUUID(), action: 'rest' })).statusCode).toBe(200);
  const before = await cohorts(),
    refused = randomUUID(),
    response = await gesture(instance, { commandId: refused, action: 'rest' });
  expect(response.statusCode).toBe(409);
  expect(response.json().code).toBe('POPULATION_GESTURE_UNAVAILABLE');
  expect(await cohorts()).toEqual(before);
  await journal(instance).flush();
  expect(await rows(refused)).toEqual([
    expect.objectContaining({
      outcome: 'rejected',
      code: 'POPULATION_GESTURE_UNAVAILABLE',
      statusCode: 409,
      attempts: 1,
    }),
  ]);
});

check('counts a replayed commandId once, with its attempts, within and across flushes', async () => {
  const instance = await app(true),
    commandId = randomUUID();
  await seedCohort(10);
  for (let i = 0; i < 2; i++) expect((await gesture(instance, { commandId, action: 'rest' })).statusCode).toBe(200);
  await journal(instance).flush();
  expect(await rows(commandId)).toEqual([expect.objectContaining({ outcome: 'accepted', attempts: 2 })]);
  expect((await gesture(instance, { commandId, action: 'rest' })).statusCode).toBe(200);
  await journal(instance).flush();
  expect(await rows(commandId)).toEqual([expect.objectContaining({ outcome: 'accepted', attempts: 3 })]);
});

check('keeps one accepted action when the first attempt is cut by the client, then retried', async () => {
  const instance = await app(true);
  await instance.listen({ host: '127.0.0.1', port: 0 });
  const address = instance.server.address();
  if (!address || typeof address === 'string') throw Error('Missing port');
  const commandId = randomUUID();
  await seedCohort(10);
  // Barrier: hold the village row so the command waits in beginVillageEconomy.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let holding = false;
  const holder = db.transaction().execute(async (tx) => {
    await sql`select id from villages where id=${villageId}::uuid for update`.execute(tx);
    holding = true;
    await released;
  });
  const controller = new AbortController();
  try {
    await until(() => holding, 'village lock');
    const cut = fetch(`http://127.0.0.1:${address.port}/api/worlds/${slug}/villages/${villageId}/population/gestures`, {
      method: 'POST',
      headers: { cookie: `arbestra_session=${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ commandId, action: 'rest' }),
      signal: controller.signal,
    }).catch((error: unknown) => error);
    await until(
      async () =>
        (
          await sql<{ n: number }>`select count(*)::int as n from pg_stat_activity
            where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid()`.execute(db)
        ).rows[0]!.n > 0,
      'command waiting on the village lock',
    );
    controller.abort();
    expect(await cut).toBeInstanceOf(Error);
  } finally {
    release();
    await holder;
  }
  // The handler still commits; the response never reaches the client.
  await until(() => journal(instance).status().buffered === 1, 'journal entry of the cut request');
  await journal(instance).flush();
  expect(await rows(commandId)).toEqual([
    expect.objectContaining({ outcome: 'accepted', statusCode: null, attempts: 1 }),
  ]);
  const retry = await gesture(instance, { commandId, action: 'rest' });
  expect(retry.statusCode, retry.body).toBe(200);
  await journal(instance).flush();
  expect(await rows(commandId)).toEqual([
    expect.objectContaining({ outcome: 'accepted', statusCode: 200, attempts: 2 }),
  ]);
  expect((await cohorts()).filter((c) => c.activity === 'resting')).toHaveLength(1);
});

check('replaces a provisional outcome (interrupted, error) by the next attempt, never a final one', async () => {
  const instance = await app(true),
    j = journal(instance),
    base = { worldId, villageId, accountId, type: 'population.gestures', occurredAt: new Date().toISOString() };
  const cut = randomUUID(),
    failed = randomUUID();
  j.record({ ...base, id: randomUUID(), commandId: cut, outcome: 'interrupted', attempts: 1 });
  j.record({ ...base, id: randomUUID(), commandId: failed, outcome: 'error', statusCode: 500, attempts: 1 });
  await j.flush();
  j.record({ ...base, id: randomUUID(), commandId: cut, outcome: 'accepted', statusCode: 200, attempts: 1 });
  j.record({
    ...base,
    id: randomUUID(),
    commandId: failed,
    outcome: 'rejected',
    code: 'X',
    statusCode: 409,
    attempts: 1,
  });
  await j.flush();
  // A final outcome is kept when a later attempt reports something else.
  j.record({ ...base, id: randomUUID(), commandId: cut, outcome: 'error', statusCode: 500, attempts: 1 });
  await j.flush();
  expect(await rows(cut)).toEqual([expect.objectContaining({ outcome: 'accepted', statusCode: 200, attempts: 3 })]);
  expect(await rows(failed)).toEqual([
    expect.objectContaining({ outcome: 'rejected', code: 'X', statusCode: 409, attempts: 2 }),
  ]);
});

check('bounds the buffer and counts what it drops', async () => {
  const instance = await app(true),
    j = journal(instance),
    commandIds: string[] = [];
  const base = { worldId, villageId, accountId, type: 'population.gestures', occurredAt: new Date().toISOString() };
  for (let i = 0; i < 2005; i++) {
    commandIds.push(randomUUID());
    j.record({ ...base, id: randomUUID(), commandId: commandIds[i]!, outcome: 'accepted', attempts: 1 });
  }
  expect(j.status()).toMatchObject({ buffered: 2000, dropped: 5 });
  const started = performance.now();
  await j.flush();
  console.info(JSON.stringify({ flushRows: 2000, flushMs: Math.round(performance.now() - started) }));
  const written = await db
    .selectFrom('playerJourneyEvents')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('commandId', 'in', commandIds)
    .executeTakeFirstOrThrow();
  expect(Number(written.n)).toBe(2000);
  await db.deleteFrom('playerJourneyEvents').where('commandId', 'in', commandIds).execute();
});

check('writes nothing when the journal is disabled', async () => {
  const instance = await app(false),
    commandId = randomUUID(),
    refused = randomUUID();
  await seedCohort(10);
  expect((await gesture(instance, { commandId, action: 'rest' })).statusCode).toBe(200);
  expect((await gesture(instance, { commandId: refused, action: 'rest' })).statusCode).toBe(409);
  expect(journal(instance).status()).toMatchObject({ enabled: false, buffered: 0 });
  await journal(instance).flush();
  expect(await rows(commandId)).toEqual([]);
  expect(await rows(refused)).toEqual([]);
});

check('purges only rows older than 90 days, oldest first, in bounded passes', async () => {
  const day = 24 * 3600000,
    now = Date.now();
  const old = [91, 92, 120].map((days) => ({ id: randomUUID(), at: new Date(now - days * day) })),
    kept = { id: randomUUID(), at: new Date(now - 89 * day) };
  await db
    .insertInto('playerJourneyEvents')
    .values(
      [...old, kept].map(({ id, at }) => ({
        id,
        worldId,
        villageId,
        accountId,
        source: 'command' as const,
        type: 'population.gestures',
        occurredAt: at,
        clientAt: null,
        commandId: null,
        intentId: null,
        outcome: 'accepted' as const,
        code: null,
        statusCode: 200,
        subject: null,
        tool: null,
      })),
    )
    .execute();
  const left = async () =>
    (
      await db
        .selectFrom('playerJourneyEvents')
        .select('id')
        .where('id', 'in', [...old.map((o) => o.id), kept.id])
        .execute()
    ).map((r) => r.id);
  expect(await pruneJourneyEvents(db, { maxAgeMs: 90 * day, rowBudget: 2 })).toEqual({ rows: 2 });
  // Oldest first: the 120- and 92-day rows go in the first pass.
  expect((await left()).sort()).toEqual([old[0]!.id, kept.id].sort());
  expect(await pruneJourneyEvents(db, { maxAgeMs: 90 * day, rowBudget: 2 })).toEqual({ rows: 1 });
  expect(await left()).toEqual([kept.id]);
});

check('removes the journey of an account with the account', async () => {
  const count = async () =>
    Number(
      (
        await db
          .selectFrom('playerJourneyEvents')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('accountId', '=', accountId)
          .executeTakeFirstOrThrow()
      ).n,
    );
  expect(await count()).toBeGreaterThan(0);
  for (const instance of apps.splice(0)) await instance.close();
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  expect(await count()).toBe(0);
});

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};
// Opt-in latency measure of a light command (population rest): two apps, the
// journal disabled and enabled, alternated request by request so machine drift
// hits both; 5 warm-ups each, then 50 timed runs each. The cohort is reset
// outside the timed span.
it.runIf(bench)(
  'measures a light command with the journal disabled and enabled',
  async () => {
    const instances = [await app(false), await app(true)],
      samples: number[][] = [[], []];
    for (let i = 0; i < 110; i++) {
      const which = i % 2;
      await seedCohort(10);
      const started = performance.now(),
        response = await gesture(instances[which]!, { commandId: randomUUID(), action: 'rest' });
      if (i >= 10) samples[which]!.push(performance.now() - started);
      expect(response.statusCode, response.body).toBe(200);
    }
    for (const which of [0, 1])
      console.info(
        JSON.stringify({
          journeyEnabled: which === 1,
          runs: samples[which]!.length,
          p50: +percentile(samples[which]!, 50).toFixed(1),
          p95: +percentile(samples[which]!, 95).toFixed(1),
        }),
      );
  },
  180000,
);
