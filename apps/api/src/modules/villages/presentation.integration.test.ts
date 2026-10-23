import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { villagePresentationIsValid, type VillagePresentation } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { hashSessionToken } from '../../security/sessions.js';
import { buildApp } from '../../app.js';
import { constructBuilding, readVillageProjection } from './service.js';
import { villagePresentation } from './presentation.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test')
  throw Error('Unexpected presentation test database');
const db = createDatabase(url),
  token = randomUUID(),
  path = `/api/worlds/aube/villages/${ids.village}/presentation`;
let app: FastifyInstance;
beforeAll(async () => {
  // The global reset alone takes 26–31 s with the sync triggers active.
  await resetE2eState(url);
  await db
    .insertInto('sessions')
    .values({ accountId: ids.account, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
    .execute();
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
afterAll(async () => {
  await app?.close();
  await db.deleteFrom('sessions').where('tokenHash', '=', hashSessionToken(token)).execute();
  await db.destroy();
}, 30000);

const read = (etag?: string) =>
  app.inject({
    method: 'GET',
    url: path,
    cookies: { session: token },
    headers: { 'x-arbestra-protocol': '2', ...(etag ? { 'if-none-match': etag } : {}) },
  });
// Everything a presentation read could touch if it woke the economy.
const durableState = async () => ({
  tasks: (
    await sql`select id,completed_at,available_at from scheduled_tasks where world_id=${ids.world} order by id`.execute(
      db,
    )
  ).rows,
  resources: await db
    .selectFrom('villageResources')
    .selectAll()
    .where('villageId', '=', ids.village)
    .orderBy('resourceCode')
    .execute(),
  cohorts: await db
    .selectFrom('populationCohorts')
    .selectAll()
    .where('villageId', '=', ids.village)
    .orderBy('id')
    .execute(),
  village: await db.selectFrom('villages').selectAll().where('id', '=', ids.village).executeTakeFirstOrThrow(),
});

it('matches the historical projection, revalidates by version and mutates nothing', async () => {
  const before = await durableState();
  const first = await read();
  expect(first.statusCode, first.body).toBe(200);
  const presentation = first.json<VillagePresentation>();
  expect(villagePresentationIsValid(presentation)).toBe(true);
  expect(presentation).toMatchObject({ protocol: 2, worldId: ids.world, villageId: ids.village });
  expect(presentation.cells.some((cell) => cell.canBuild)).toBe(true);
  expect(presentation.cells.some((cell) => cell.footprint?.buildingType === 'town-hall')).toBe(true);
  expect(presentation.travelRoutes.length).toBeGreaterThan(0);
  expect(first.headers.etag).toBe(`"${presentation.version}"`);
  // Same rules as the inline historical reader, not a second implementation.
  const reference = villagePresentation(await readVillageProjection(db, ids.account, 'aube', ids.village));
  expect({ ...presentation, observedAt: undefined }).toEqual({ ...reference, observedAt: undefined });
  // A client holding this terrain window receives null in its place.
  const known = await app.inject({
    method: 'GET',
    url: `${path}?knownRegion=${presentation.regionVersion}`,
    cookies: { session: token },
    headers: { 'x-arbestra-protocol': '2' },
  });
  expect(known.statusCode, known.body).toBe(200);
  // Each read is a new capture: compare everything but its instant.
  expect({ ...known.json(), observedAt: undefined }).toEqual({ ...presentation, region: null, observedAt: undefined });
  expect(known.body.length).toBeLessThan(first.body.length / 1.5);
  const stale = await app.inject({
    method: 'GET',
    url: `${path}?knownRegion=${'0'.repeat(64)}`,
    cookies: { session: token },
    headers: { 'x-arbestra-protocol': '2' },
  });
  expect({ ...stale.json(), observedAt: undefined }).toEqual({ ...presentation, observedAt: undefined });
  const unchanged = await read(first.headers.etag as string);
  expect(unchanged.statusCode).toBe(304);
  expect(unchanged.body).toBe('');
  expect(await durableState()).toEqual(before);
  expect((await app.inject({ method: 'GET', url: path, cookies: { session: token } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'GET', url: path, headers: { 'x-arbestra-protocol': '2' } })).statusCode).toBe(
    401,
  );
}, 120000);

it('keeps its version through an economic change and renews it for a new footprint', async () => {
  const initial = (await read()).json<VillagePresentation>();
  await db
    .updateTable('villageResources')
    .set({ amount: 1234 })
    .where('worldId', '=', ids.world)
    .where('villageId', '=', ids.village)
    .where('resourceCode', '=', 'carrot')
    .execute();
  expect((await read()).json<VillagePresentation>().version).toBe(initial.version);
  await db
    .updateTable('villageResources')
    .set({ amount: 100 })
    .where('worldId', '=', ids.world)
    .where('villageId', '=', ids.village)
    .where('resourceCode', '=', 'stone')
    .execute();
  const free = new Set(initial.cells.filter((cell) => cell.canBuild).map((cell) => `${cell.cellX}:${cell.cellY}`));
  const anchor = initial.cells
    .filter((cell) => [0, 1].every((dx) => [0, 1].every((dy) => free.has(`${cell.cellX + dx}:${cell.cellY + dy}`))))
    .sort((a, b) => Math.hypot(a.cellX - 1024, a.cellY - 512) - Math.hypot(b.cellX - 1024, b.cellY - 512))[0]!;
  await constructBuilding(db, ids.account, 'aube', ids.village, anchor.cellX, anchor.cellY, 'stonemason', 0);
  const renewed = await read(`"${initial.version}"`);
  expect(renewed.statusCode).toBe(200);
  const next = renewed.json<VillagePresentation>();
  expect(next.version).not.toBe(initial.version);
  const placed = next.cells.find((cell) => cell.cellX === anchor.cellX && cell.cellY === anchor.cellY)!;
  expect(placed).toMatchObject({
    canBuild: false,
    footprint: { buildingType: 'stonemason', role: 'anchor', state: 'reserved' },
  });
}, 120000);
