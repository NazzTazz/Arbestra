import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AdminJourney } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import type { AppConfig } from '../../config.js';
import { HttpError } from '../../errors.js';
import { createSessionToken } from '../../security/sessions.js';
import { ADMIN_COOKIE_NAME, hashAdminSessionToken } from './auth.js';
import { registerAdminRoutes } from './routes.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected journey read database');
const db = createDatabase(url),
  admin = randomUUID(),
  player = randomUUID(),
  other = randomUUID(),
  worldId = randomUUID(),
  villageId = randomUUID(),
  secondVillage = randomUUID(),
  otherVillage = randomUUID(),
  buildingId = randomUUID(),
  token = createSessionToken();
const config: AppConfig = {
  databaseUrl: url,
  host: '127.0.0.1',
  port: 0,
  isProduction: false,
  cookieName: 'arbestra_session',
  sessionTtlDays: 30,
  constructionDurationOverrideMs: null,
  scheduledTaskPollIntervalMs: 250,
  adminAccountIds: [admin],
  adminOrigin: 'http://localhost',
};
const now = Date.now(),
  minutes = (n: number) => new Date(now - n * 60_000),
  // Two commands inside one calendar minute, whatever the current second.
  sameMinute = (offsetMs: number) => new Date(Math.floor(now / 60_000) * 60_000 - 130 * 60_000 + offsetMs);
const ids = {
  first: randomUUID(),
  refused: randomUUID(),
  replayed: randomUUID(),
  build: randomUUID(),
  later: randomUUID(),
  sameMinute: randomUUID(),
  ongoing: randomUUID(),
  second: randomUUID(),
  old: randomUUID(),
  foreign: randomUUID(),
};
let app: FastifyInstance;

type Row = { id: string; at: Date; type: string; outcome?: 'accepted' | 'rejected' | 'pending' };
const event = (
  account: string,
  village: string,
  { id, at, type, outcome = 'accepted' }: Row,
  extra: { code?: string; attempts?: number; subject?: string } = {},
) => ({
  id: randomUUID(),
  worldId,
  villageId: village,
  accountId: account,
  source: 'command' as const,
  type,
  occurredAt: at,
  clientAt: null,
  commandId: id,
  intentId: null,
  outcome,
  code: extra.code ?? null,
  statusCode: outcome === 'rejected' ? 409 : 200,
  subject: extra.subject ?? null,
  tool: null,
  attempts: extra.attempts ?? 1,
});

beforeAll(async () => {
  await migrateToLatest(url);
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('accounts')
      .values([admin, player, other].map((id) => ({ id, email: id + '@journey-read.test', passwordHash: 'fixture' })))
      .execute();
    await tx
      .insertInto('sessions')
      .values({ accountId: admin, tokenHash: hashAdminSessionToken(token), expiresAt: new Date(now + 3600000) })
      .execute();
    await tx
      .insertInto('worlds')
      .values({
        id: worldId,
        slug: 'journey-read-' + worldId,
        name: 'Journey read',
        topology: 'torus',
        widthCells: 512,
        heightCells: 256,
        chunkSize: 32,
        seed: 4111,
        generationVersion: 1,
        generationStatus: 'ready',
        isOpen: true,
        generatedAt: new Date(),
      })
      .execute();
    await tx
      .insertInto('worldMemberships')
      .values([
        { worldId, accountId: player, playerName: 'Marie' },
        { worldId, accountId: other, playerName: 'Number' },
      ])
      .execute();
    await tx
      .insertInto('villages')
      .values([
        { id: villageId, worldId, ownerAccountId: player, name: 'Bourg', anchorCellX: 64, anchorCellY: 64 },
        { id: secondVillage, worldId, ownerAccountId: player, name: 'Hameau', anchorCellX: 200, anchorCellY: 64 },
        { id: otherVillage, worldId, ownerAccountId: other, name: 'Ailleurs', anchorCellX: 300, anchorCellY: 64 },
      ])
      .execute();
    // Session 1: 180 → 170 min ago (a refusal, a replayed command).
    // Session 2: 140 → 130 min ago, two commands in the same minute.
    // Session 3: 5 min ago, still ongoing. A 30-minute gap separates 1 and 2.
    await tx
      .insertInto('playerJourneyEvents')
      .values([
        event(player, villageId, { id: ids.first, at: minutes(180), type: 'population.gestures' }, { subject: 'rest' }),
        event(
          player,
          villageId,
          { id: ids.refused, at: minutes(178), type: 'population.gestures', outcome: 'rejected' },
          { code: 'POPULATION_GESTURE_UNAVAILABLE', subject: 'rest' },
        ),
        event(player, villageId, { id: ids.replayed, at: minutes(170), type: 'processing' }, { attempts: 2 }),
        event(player, villageId, { id: ids.build, at: minutes(140), type: 'buildings' }, { subject: 'dwelling' }),
        event(player, villageId, { id: ids.later, at: sameMinute(10_000), type: 'processing' }),
        event(player, villageId, { id: ids.sameMinute, at: sameMinute(20_000), type: 'processing' }),
        event(player, villageId, { id: ids.ongoing, at: minutes(5), type: 'harvest-intents', outcome: 'pending' }),
        event(player, secondVillage, { id: ids.second, at: minutes(4), type: 'buildings' }, { subject: 'dwelling' }),
        event(player, villageId, { id: ids.old, at: minutes(8 * 24 * 60), type: 'buildings' }),
        event(other, otherVillage, { id: ids.foreign, at: minutes(100), type: 'buildings' }),
      ])
      .execute();
    // Deferred: the building ordered 140 min ago completes 60 min ago, when
    // the player is gone (outside any session).
    await tx
      .insertInto('buildings')
      .values({
        id: buildingId,
        worldId,
        villageId,
        buildingType: 'dwelling',
        level: 1,
        targetLevel: null,
        status: 'completed',
        constructionStartedAt: minutes(140),
        constructionCompletesAt: minutes(60),
        completedAt: minutes(60),
      })
      .execute();
    await tx
      .insertInto('buildingCommandReceipts')
      .values({
        worldId,
        villageId,
        commandId: ids.build,
        commandType: 'construct',
        request: JSON.stringify({ buildingType: 'dwelling' }),
        buildingId,
        createdAt: minutes(140) as never, // Generated column: the insert type hides Date
      })
      .execute();
    // Automatic: an accomplishment inside session 1, and an energy
    // notification of the economy, which is not a player action.
    await tx
      .insertInto('villageAccomplishments')
      .values({ worldId, villageId, code: 'first-harvest', completedAt: minutes(179) })
      .execute();
    await tx
      .insertInto('scheduledTasks')
      .values({
        worldId,
        taskType: 'population.energy',
        subjectId: villageId,
        payload: { villageId },
        dueAt: minutes(120),
        availableAt: minutes(120),
        completedAt: minutes(120),
      })
      .execute();
  });
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });
  await app.register(cookie);
  await registerAdminRoutes(app, db, config, () => {
    throw Error('Runtime was not expected in this fixture');
  });
}, 120000);
afterAll(async () => {
  await app?.close();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', 'in', [admin, player, other]).execute();
  await db.destroy();
}, 60000);

const read = async (query: string, status = 200) => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/admin/journeys/' + query,
    headers: { host: 'localhost', cookie: `${ADMIN_COOKIE_NAME}=${token}` },
  });
  expect(response.statusCode, response.body).toBe(status);
  expect(response.headers['cache-control']).toContain('no-store');
  return response.json() as AdminJourney;
};

it('refuses the journey to anyone but an administrator', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/admin/journeys/' + player,
    headers: { host: 'localhost' },
  });
  expect(response.statusCode).toBe(401);
});

it('derives sessions from the player commands, split by 15 minutes of inactivity', async () => {
  const journey = await read(`${player}?worldId=${worldId}&villageId=${villageId}`);
  expect(journey.account).toEqual({ id: player, email: player + '@journey-read.test', admin: false });
  expect(journey.collection).toMatchObject({ enabled: false, retentionDays: 90, inactivityMinutes: 15 });
  expect(journey.sessions.map((s) => [s.index, s.actions, s.refused, s.activeMinutes, s.ongoing])).toEqual([
    [3, 1, 0, 1, true],
    [2, 3, 0, 2, false],
    [1, 3, 1, 3, false],
  ]);
  const first = journey.sessions.at(-1)!;
  expect(first.startedAt).toBe(minutes(180).toISOString());
  expect(first.lastActivityAt).toBe(minutes(170).toISOString());
  expect(first.endedAt).toBe(minutes(169).toISOString());
});

it('merges actions, deferred completions and accomplishments, without automatic transitions', async () => {
  const journey = await read(`${player}?worldId=${worldId}&villageId=${villageId}`);
  const summary = journey.events.map((e) => [e.source, e.type, e.subject, e.outcome, e.code, e.attempts, e.session]);
  expect(summary).toEqual([
    ['action', 'harvest-intents', null, 'pending', null, 1, 3],
    ['deferred', 'building.complete', 'dwelling', 'completed', null, 1, null],
    ['action', 'processing', null, 'accepted', null, 1, 2],
    ['action', 'processing', null, 'accepted', null, 1, 2],
    ['action', 'buildings', 'dwelling', 'accepted', null, 1, 2],
    ['action', 'processing', null, 'accepted', null, 2, 1],
    ['action', 'population.gestures', 'rest', 'rejected', 'POPULATION_GESTURE_UNAVAILABLE', 1, 1],
    ['automatic', 'accomplishment', 'first-harvest', 'completed', null, 1, 1],
    ['action', 'population.gestures', 'rest', 'accepted', null, 1, 1],
  ]);
  // The deferred completion names the command that ordered it.
  expect(journey.events.find((e) => e.source === 'deferred')!.commandId).toBe(ids.build);
  expect(journey.events.some((e) => e.type.includes('energy'))).toBe(false);
  expect(journey.summary.byType).toEqual([
    { type: 'processing', actions: 3, refused: 0, sessions: 2, firstAt: minutes(170).toISOString() },
    { type: 'population.gestures', actions: 2, refused: 1, sessions: 1, firstAt: minutes(180).toISOString() },
    { type: 'buildings', actions: 1, refused: 0, sessions: 1, firstAt: minutes(140).toISOString() },
    { type: 'harvest-intents', actions: 1, refused: 0, sessions: 1, firstAt: minutes(5).toISOString() },
  ]);
  expect(journey.summary.refusals).toEqual([
    { type: 'population.gestures', code: 'POPULATION_GESTURE_UNAVAILABLE', count: 1 },
  ]);
});

it('scopes to the account (all its villages) or to one village, never another account or an old row', async () => {
  const all = await read(player);
  // Both villages share one creation time (one transaction): compare as a set.
  expect(all.villages.map((v) => v.name).sort()).toEqual(['Bourg', 'Hameau']);
  const commands = all.events.filter((e) => e.source === 'action').map((e) => e.commandId);
  expect(commands).toContain(ids.second);
  expect(commands).not.toContain(ids.foreign);
  expect(commands).not.toContain(ids.old);
  // The second village's command joins the ongoing session at account scope.
  expect(all.sessions[0]).toMatchObject({ index: 3, actions: 2, ongoing: true });
  const wider = await read(`${player}?days=9`);
  expect(wider.events.map((e) => e.commandId)).toContain(ids.old);
  expect(wider.sessions).toHaveLength(4);
  const village = await read(`${player}?worldId=${worldId}&villageId=${secondVillage}`);
  expect(village.events.map((e) => e.commandId)).toEqual([ids.second]);
  await read(`${player}?villageId=${villageId}`, 400);
  await read(`${other}?worldId=${worldId}&villageId=${villageId}`, 404);
});

it('marks administrator accounts instead of hiding them', async () => {
  const journey = await read(admin);
  expect(journey.account.admin).toBe(true);
  expect(journey.sessions).toEqual([]);
  expect(journey.events).toEqual([]);
});
