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
import type { TravelNetworkExecutor } from '../navigation/network-job.js';
import { databaseTravelNetworkStore } from '../navigation/network-store.js';
import { constructBuilding, readVillageProjection } from './service.js';
import { VillagePresentationReader, villagePresentation } from './presentation.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
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

// Incident (Pinkystan, 659 buildings): every read queued for a CPU lane and
// recomputed the whole travel network, so a slow village never loaded.
it('reuses one capture while its journal streams stand still and recomputes the network only for a structural change', async () => {
  let networks = 0,
    arrived: (() => void) | undefined,
    gate: Promise<void> = Promise.resolve();
  const executor: TravelNetworkExecutor = {
    network: async (load) => {
      networks++;
      await load({ sources: new Set() });
      arrived?.();
      await gate;
      return [];
    },
  };
  let clock = Date.now();
  const reader = new VillagePresentationReader(db, executor, { freshMs: 60_000, now: () => clock });
  const read = () => reader.read(ids.account, 'aube', ids.village);
  const first = await read();
  expect(networks).toBe(1);
  expect(first.cells.some((cell) => cell.footprint?.buildingType === 'town-hall')).toBe(true);
  // Unchanged village inside the freshness bound: the very same capture.
  clock += 30_000;
  expect(await read()).toBe(first);
  expect(networks).toBe(1);
  // An economic write moves the village stream: a new capture of the same
  // content, without any routing work (the planner input is unchanged).
  await db
    .updateTable('villageResources')
    .set({ amount: 777 })
    .where('worldId', '=', ids.world)
    .where('villageId', '=', ids.village)
    .where('resourceCode', '=', 'carrot')
    .execute();
  const recaptured = await read();
  expect(recaptured).not.toBe(first);
  expect(recaptured.version).toBe(first.version);
  expect(Date.parse(recaptured.observedAt)).toBeGreaterThan(Date.parse(first.observedAt));
  expect(networks).toBe(1);
  // Past the freshness bound, time-projected stocks are recaptured, again
  // without routing.
  clock += 60_000;
  const refreshed = await read();
  expect(refreshed).not.toBe(recaptured);
  expect(Date.parse(refreshed.observedAt)).toBeGreaterThan(Date.parse(recaptured.observedAt));
  expect(networks).toBe(1);
  expect(await read()).toBe(refreshed);
  // Ownership is checked on every read, cached or not.
  await expect(reader.read(randomUUID(), 'aube', ids.village)).rejects.toMatchObject({ statusCode: 404 });
  // A new footprint changes the planner input: one routing for both
  // concurrent readers, held at the executor until both have joined.
  const free = new Set(refreshed.cells.filter((cell) => cell.canBuild).map((cell) => `${cell.cellX}:${cell.cellY}`));
  const anchor = refreshed.cells
    .filter((cell) => [0, 1].every((dx) => [0, 1].every((dy) => free.has(`${cell.cellX + dx}:${cell.cellY + dy}`))))
    .sort((a, b) => Math.hypot(a.cellX - 1024, a.cellY - 512) - Math.hypot(b.cellX - 1024, b.cellY - 512))[0]!;
  await constructBuilding(db, ids.account, 'aube', ids.village, anchor.cellX, anchor.cellY, 'sawmill', 0);
  let release!: () => void;
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const reads = [read(), read()] as const;
  await Promise.race([
    entered,
    new Promise((_, reject) => setTimeout(() => reject(Error('Routing never started')), 30_000)),
  ]);
  expect(networks).toBe(2);
  release();
  const [a, b] = await Promise.all(reads);
  expect(b).toBe(a);
  expect(networks).toBe(2);
  expect(a.version).not.toBe(refreshed.version);
  expect(a.cells.find((cell) => cell.cellX === anchor.cellX && cell.cellY === anchor.cellY)).toMatchObject({
    canBuild: false,
    footprint: { buildingType: 'sawmill', role: 'anchor', state: 'reserved' },
  });
  expect(await read()).toBe(a);
  expect(networks).toBe(2);
}, 120000);

// A deployment restarts the API: every village used to recompute its whole
// network on first read (15 s for Bressuire on a cold dev API).
it('reuses a stored network after a restart and stores a new one for a structural change', async () => {
  const routed = {
    id: 'stored-route',
    kind: 'building',
    destination: { cellX: 1, cellY: 2 },
    cells: [{ cellX: 1, cellY: 2 }],
  };
  let networks = 0;
  const executor: TravelNetworkExecutor = {
    network: async (load) => {
      networks++;
      await load({ sources: new Set() });
      return [{ ...routed, id: `${routed.id}-${networks}` }] as never;
    },
  };
  const store = databaseTravelNetworkStore(db, (error) => {
    throw error;
  });
  await db.deleteFrom('villageTravelNetworks').execute();
  const process = () => new VillagePresentationReader(db, executor, { freshMs: 60_000, store });
  const first = await process().read(ids.account, 'aube', ids.village);
  expect(networks).toBe(1);
  expect(first.travelRoutes.some((route) => route.id === 'stored-route-1')).toBe(true);
  const row = await db
    .selectFrom('villageTravelNetworks')
    .selectAll()
    .where('villageId', '=', ids.village)
    .executeTakeFirstOrThrow();
  expect(row.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  // A new process with an unchanged village: the stored network, no routing.
  const restarted = await process().read(ids.account, 'aube', ids.village);
  expect(networks).toBe(1);
  expect(restarted.travelRoutes.some((route) => route.id === 'stored-route-1')).toBe(true);
  // Another input never reuses it: a stale row is a miss, then replaced.
  await db
    .updateTable('villageTravelNetworks')
    .set({ fingerprint: 'f'.repeat(64) })
    .where('villageId', '=', ids.village)
    .execute();
  const recomputed = await process().read(ids.account, 'aube', ids.village);
  expect(networks).toBe(2);
  expect(recomputed.travelRoutes.some((route) => route.id === 'stored-route-2')).toBe(true);
  expect(
    (
      await db
        .selectFrom('villageTravelNetworks')
        .select('fingerprint')
        .where('villageId', '=', ids.village)
        .executeTakeFirstOrThrow()
    ).fingerprint,
  ).toBe(row.fingerprint);
}, 120000);
