import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  applySyncV2Batch,
  hudWorkforceConfirmationIsValid,
  hudWorkforceConfirmationV2IsValid,
  visibleSyncV2Scope,
  type HudWorkforceConfirmationV2,
  type PopulationGesture,
  type SyncV2State,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { buildApp } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';
import * as syncRevision from './sync-revision.js';
import * as extractionPools from '../deposits/extraction-pools.js';
import { captureSyncV2 } from './sync-v2-capture.js';
import { commandHudWorkforceV2 } from './hud-workforce.js';

// The workforce HUD on the V2 contract (lot I.1): the result and the private
// effects of the commit, never the world's COUNT revision.
const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected HUD V2 test database');
const db = createDatabase(url),
  token = randomUUID(),
  root = `/api/worlds/aube/villages/${ids.village}`,
  headers = { 'x-arbestra-protocol': '2', 'x-arbestra-generation': '4' };
let app: FastifyInstance;

beforeAll(async () => {
  await migrateToLatest(url);
  app = await buildApp(
    {
      databaseUrl: url,
      host: '127.0.0.1',
      port: 0,
      isProduction: false,
      cookieName: 'session',
      sessionTtlDays: 30,
      scheduledTaskPollIntervalMs: 60000,
      expeditionWorkerEnabled: false,
      constructionDurationOverrideMs: null,
    },
    db,
  );
}, 180000);
beforeEach(async () => {
  await resetE2eState(url);
  await db
    .insertInto('sessions')
    .values({
      accountId: ids.account,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .execute();
  // 25 idle inhabitants and 50 carrots (the seed's stock).
  await db.transaction().execute(async (tx) => {
    const through = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow()).at;
    await tx.deleteFrom('populationCohorts').where('worldId', '=', ids.world).execute();
    await tx
      .insertInto('populationCohorts')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        originVillageId: ids.village,
        memberCount: 25,
        activity: 'idle',
        energy: 8,
        energyProgress: 0,
        energyUpdatedAt: through,
        restingSince: null,
        foodUsedSinceRest: 0,
        harvestId: null,
        extractionId: null,
      })
      .execute();
    await tx
      .updateTable('villageResources')
      .set({ amount: 50 })
      .where('worldId', '=', ids.world)
      .where('villageId', '=', ids.village)
      .where('resourceCode', '=', 'carrot')
      .execute();
  });
}, 120000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await resetE2eState(url);
  await app?.close();
  await db.destroy();
}, 60000);

const post = (path: string, payload: object, extra: Record<string, string> | null = headers) =>
  app.inject({ method: 'POST', url: root + path, cookies: { session: token }, headers: extra ?? {}, payload });
const rest = (): PopulationGesture => ({ commandId: randomUUID(), action: 'rest' });
const sitesUp = () => ({ commandId: randomUUID(), resource: 'wood', action: 'sites-up' });
async function base(): Promise<SyncV2State> {
  const initial = await captureSyncV2(db, ids.account, 'aube', ids.village, {
    protocol: 2,
    generation: 4,
    scopes: [],
    cursors: [],
  });
  const applied = applySyncV2Batch(
    {
      worldId: ids.world,
      villageId: ids.village,
      generation: 4,
      scopes: new Map(),
      subscribedScopes: new Set(initial.groups.map((g) => `${g.stream.kind}:${g.stream.key}`)),
    },
    initial,
  );
  if (applied.kind !== 'applied') throw Error('Expected an applied bootstrap');
  return applied.state;
}
const stream = async () =>
  (
    await sql<{ revision: string }>`select revision::text from game_sync_streams
      where world_id=${ids.world} and stream_kind='village' and scope_key=${ids.village}`.execute(db)
  ).rows[0]!.revision;
const receipts = () =>
  db.selectFrom('hudWorkforceReceipts').select('commandId').where('worldId', '=', ids.world).execute();
const carrots = async () =>
  Number(
    (
      await db
        .selectFrom('villageResources')
        .select('amount')
        .where('worldId', '=', ids.world)
        .where('villageId', '=', ids.village)
        .where('resourceCode', '=', 'carrot')
        .executeTakeFirstOrThrow()
    ).amount,
  );

it('answers a population gesture with its result and private effects, and no COUNT revision', async () => {
  const before = await base();
  const command = rest();
  const response = await post('/population/gestures', command);
  expect(response.statusCode, response.body).toBe(200);
  const confirmation = response.json<HudWorkforceConfirmationV2>();
  expect(hudWorkforceConfirmationV2IsValid(confirmation)).toBe(true);
  expect(confirmation).toMatchObject({
    protocol: 2,
    worldId: ids.world,
    villageId: ids.village,
    commandId: command.commandId,
    status: 'applied',
    result: { affected: 10, carrots: 0 },
  });
  // Neither the scoped state nor the revision fence of the historical answer.
  expect(Object.keys(confirmation)).not.toContain('hud');
  expect(response.body).not.toContain('minimumRevision');
  // The effects, as the client applies them, carry what the gesture changed.
  const applied = applySyncV2Batch(before, confirmation.effects);
  expect(applied.kind).toBe('applied');
  const visible = visibleSyncV2Scope(applied.state.scopes.get(`village:${ids.village}`)!);
  expect(visible.get('populationSummary:*')).toMatchObject({ available: 15, resting: 10, working: 0 });
  const cohorts = [...visible].filter(([key]) => key.startsWith('cohorts:')).map(([, cohort]) => cohort);
  expect(
    cohorts.map((c) => [(c as { activity: string }).activity, (c as { memberCount: number }).memberCount]),
  ).toEqual(
    expect.arrayContaining([
      ['resting', 10],
      ['idle', 15],
    ]),
  );
  // They end at the village stream's committed revision.
  expect(confirmation.effects?.groups).toHaveLength(1);
  expect(confirmation.effects?.groups[0]).toMatchObject({
    stream: { kind: 'village', key: ids.village },
    toRevision: await stream(),
  });
  expect(await receipts()).toHaveLength(1);
});

it('feeds the village and publishes the debited carrots', async () => {
  const before = await base();
  const response = await post('/population/gestures', { commandId: randomUUID(), action: 'feed', group: 'idle' });
  expect(response.statusCode, response.body).toBe(200);
  const confirmation = response.json<HudWorkforceConfirmationV2>();
  expect(confirmation.result).toEqual({ affected: 25, carrots: 25 });
  expect(await carrots()).toBe(25);
  const applied = applySyncV2Batch(before, confirmation.effects);
  const visible = visibleSyncV2Scope(applied.state.scopes.get(`village:${ids.village}`)!);
  expect(visible.get('resources:carrot')).toMatchObject({ amount: 25 });
});

it('changes an extraction pool on the same contract and publishes the pool', async () => {
  const before = await base();
  const command = sitesUp();
  const response = await post('/extraction-pools', command);
  expect(response.statusCode, response.body).toBe(200);
  const confirmation = response.json<HudWorkforceConfirmationV2>();
  expect(confirmation).toMatchObject({ commandId: command.commandId, result: { affected: 0, carrots: 0 } });
  expect(response.body).not.toContain('minimumRevision');
  const applied = applySyncV2Batch(before, confirmation.effects);
  const visible = visibleSyncV2Scope(applied.state.scopes.get(`village:${ids.village}`)!);
  expect(visible.get('extractionPools:wood')).toMatchObject({ resource: 'wood', siteCount: 2 });
});

it('never reads the COUNT revision on the V2 path, while the historical path still does', async () => {
  const revision = vi.spyOn(syncRevision, 'villageSyncRevision').mockRejectedValue(new Error('COUNT read on V2'));
  for (const [path, payload] of [
    ['/population/gestures', rest()],
    ['/extraction-pools', sitesUp()],
    ['/population/gestures', { commandId: randomUUID(), action: 'feed', group: 'idle' }],
  ] as const) {
    const response = await post(path, payload);
    expect(response.statusCode, response.body).toBe(200);
  }
  // A replay does not read it either.
  const again = rest();
  expect((await post('/population/gestures', again)).statusCode).toBe(200);
  expect((await post('/population/gestures', again)).statusCode).toBe(200);
  expect(revision).not.toHaveBeenCalled();
  // Control: the historical contract (no protocol header) does, so the spy observes the call.
  const historical = await post('/extraction-pools', sitesUp(), null);
  expect(historical.statusCode).toBe(500);
  expect(revision).toHaveBeenCalled();
});

it('keeps the historical answer for a client without the protocol header', async () => {
  const command = rest();
  const response = await post('/population/gestures', command, null);
  expect(response.statusCode, response.body).toBe(200);
  const confirmation = response.json();
  expect(hudWorkforceConfirmationIsValid(confirmation)).toBe(true);
  expect(confirmation).toMatchObject({
    commandId: command.commandId,
    affected: 10,
    hud: { population: { resting: 10, available: 15 } },
  });
  expect(typeof confirmation.hud.minimumRevision).toBe('number');
  expect(confirmation).not.toHaveProperty('effects');
});

it('replays an exact V2 gesture from its receipt once, without effects, and refuses another use of the identifier', async () => {
  const command = rest();
  const first = await post('/population/gestures', command);
  expect(first.statusCode, first.body).toBe(200);
  const original = first.json<HudWorkforceConfirmationV2>();
  expect(original.effects).toBeDefined();
  const revision = await stream();
  const cohorts = await db.selectFrom('populationCohorts').selectAll().where('worldId', '=', ids.world).execute();

  const replay = await post('/population/gestures', command);
  expect(replay.statusCode, replay.body).toBe(200);
  const answer = replay.json<HudWorkforceConfirmationV2>();
  expect(hudWorkforceConfirmationV2IsValid(answer)).toBe(true);
  expect(answer).toMatchObject({ commandId: command.commandId, status: 'applied', result: original.result });
  expect(answer.effects).toBeUndefined();
  // Nothing was applied or published a second time.
  expect(await stream()).toBe(revision);
  expect(await receipts()).toHaveLength(1);
  expect(await db.selectFrom('populationCohorts').selectAll().where('worldId', '=', ids.world).execute()).toEqual(
    cohorts,
  );

  // The same identifier for another gesture is refused, and so is another owner.
  const changed = await post('/population/gestures', { ...command, action: 'feed', group: 'idle' });
  expect(changed.statusCode).toBe(409);
  expect(changed.json()).toMatchObject({ code: 'COMMAND_ID_CONFLICT' });
  await expect(
    commandHudWorkforceV2(db, randomUUID(), 'aube', ids.village, { kind: 'population', command }, 4),
  ).rejects.toMatchObject({ code: 'VILLAGE_NOT_FOUND' });
  expect(await stream()).toBe(revision);
});

it('rolls back a refused V2 gesture without receipt, carrots, effects or journal entry', async () => {
  await db
    .updateTable('villageResources')
    .set({ amount: 24 })
    .where('worldId', '=', ids.world)
    .where('villageId', '=', ids.village)
    .where('resourceCode', '=', 'carrot')
    .execute();
  const snapshot = async () => ({
    stream: await stream(),
    journal: (await sql`select count(*)::int as n from game_sync_changes where world_id=${ids.world}`.execute(db)).rows,
    cohorts: await db.selectFrom('populationCohorts').selectAll().where('worldId', '=', ids.world).execute(),
    carrots: await carrots(),
    receipts: await receipts(),
  });
  const before = await snapshot();
  const response = await post('/population/gestures', { commandId: randomUUID(), action: 'feed', group: 'idle' });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ code: 'CARROTS_INSUFFICIENT' });
  expect(await snapshot()).toEqual(before);
});

it('rolls back everything an injected failure follows, publishing nothing', async () => {
  // The last step of a meal for the idle group: the receipt, the carrots and the
  // cohorts are all written when the pools are woken, then this failure strikes.
  let seen: { receipts: number; carrots: number; fed: number } | undefined;
  vi.spyOn(extractionPools, 'wakeExtractionPool').mockImplementation(async (tx) => {
    seen = {
      receipts: (
        await tx.selectFrom('hudWorkforceReceipts').select('commandId').where('worldId', '=', ids.world).execute()
      ).length,
      carrots: Number(
        (
          await tx
            .selectFrom('villageResources')
            .select('amount')
            .where('worldId', '=', ids.world)
            .where('villageId', '=', ids.village)
            .where('resourceCode', '=', 'carrot')
            .executeTakeFirstOrThrow()
        ).amount,
      ),
      fed: (
        await tx
          .selectFrom('populationCohorts')
          .select('foodUsedSinceRest')
          .where('worldId', '=', ids.world)
          .where('foodUsedSinceRest', '>', 0)
          .execute()
      ).length,
    };
    throw new Error('Injected failure after the meal');
  });
  const before = {
    stream: await stream(),
    cohorts: await db.selectFrom('populationCohorts').selectAll().where('worldId', '=', ids.world).execute(),
    carrots: await carrots(),
  };
  await expect(
    commandHudWorkforceV2(
      db,
      ids.account,
      'aube',
      ids.village,
      { kind: 'population', command: { commandId: randomUUID(), action: 'feed', group: 'idle' } },
      4,
    ),
  ).rejects.toThrow('Injected failure after the meal');
  // The writes did happen inside the transaction before the failure...
  expect(seen).toMatchObject({ receipts: 1, carrots: 25 });
  expect(seen!.fed).toBeGreaterThan(0);
  // ...and none of them, nor a publication, survived it.
  expect(await receipts()).toEqual([]);
  expect(await carrots()).toBe(before.carrots);
  expect(await stream()).toBe(before.stream);
  expect(await db.selectFrom('populationCohorts').selectAll().where('worldId', '=', ids.world).execute()).toEqual(
    before.cohorts,
  );
});
