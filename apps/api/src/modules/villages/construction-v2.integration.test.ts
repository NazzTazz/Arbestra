import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  applySyncV2Batch,
  constructionConfirmationV2IsValid,
  villageCommandConfirmationV2IsValid,
  visibleSyncV2Scope,
  type ConstructionConfirmationV2,
  type VillageCommandConfirmationV2,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { buildApp } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';
import { captureSyncV2 } from './sync-v2-capture.js';
import { materializeCohorts } from '../population/work.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected construction V2 test database');
const db = createDatabase(url);
const ids = { world: randomUUID(), village: randomUUID(), account: randomUUID() },
  slug = 'construction-v2-' + ids.world,
  token = randomUUID();
const root = `/api/worlds/${slug}/villages/${ids.village}`;
let app: FastifyInstance;
beforeAll(async () => {
  await migrateToLatest(url);
  await db.transaction().execute(async (tx) => {
    const now = new Date();
    await tx
      .insertInto('accounts')
      .values({ id: ids.account, email: ids.account + '@v2.test', passwordHash: 'fixture' })
      .execute();
    await tx
      .insertInto('sessions')
      .values({ accountId: ids.account, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
      .execute();
    await tx
      .insertInto('worlds')
      .values({
        id: ids.world,
        slug,
        name: 'Construction V2',
        topology: 'torus',
        widthCells: 128,
        heightCells: 128,
        chunkSize: 32,
        seed: 1,
        generationVersion: 1,
        generationStatus: 'ready',
        generatedAt: now,
        isOpen: false,
      })
      .execute();
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++)
        await tx
          .insertInto('worldChunks')
          .values({
            worldId: ids.world,
            chunkX: x,
            chunkY: y,
            generationVersion: 1,
            terrainCodes: Array(1024).fill(1),
            elevations: Array(1024).fill(1),
          })
          .execute();
    await tx
      .insertInto('worldMemberships')
      .values({ worldId: ids.world, accountId: ids.account, playerName: 'V2' })
      .execute();
    await tx
      .insertInto('villages')
      .values({
        id: ids.village,
        worldId: ids.world,
        ownerAccountId: ids.account,
        name: 'V2',
        anchorCellX: 64,
        anchorCellY: 64,
        economyActivatedAt: now,
      })
      .execute();
    const hall = await tx
      .insertInto('buildings')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        buildingType: 'town-hall',
        level: 1,
        status: 'completed',
        completedAt: now,
        constructionStartedAt: null,
        constructionCompletesAt: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx
      .insertInto('worldCellOccupancies')
      .values({ worldId: ids.world, cellX: 64, cellY: 64, buildingId: hall.id, featureId: null, role: 'anchor' })
      .execute();
    for (const resourceCode of ['wood', 'stone', 'timber', 'cut-stone', 'carrot'])
      await tx
        .insertInto('villageResources')
        .values({ worldId: ids.world, villageId: ids.village, resourceCode, amount: 2000 })
        .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: 2000 }))
        .execute();
    await tx
      .insertInto('villageResourceFlows')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        resourceCode: 'wood',
        baseRatePerHour: 0,
        remainder: 0,
        productionUpdatedAt: now,
      })
      .execute();
  });
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
}, 120000);
afterAll(async () => {
  await app?.close();
  await db.deleteFrom('worlds').where('id', '=', ids.world).execute();
  await db.deleteFrom('accounts').where('id', '=', ids.account).execute();
  await db.destroy();
}, 30000);

const place = (
  payload: object,
  headers: Record<string, string> = { 'x-arbestra-protocol': '2', 'x-arbestra-generation': '4' },
) => app.inject({ method: 'POST', url: root + '/buildings', cookies: { session: token }, headers, payload });

it('answers a placement with its private effects, then replays the original result without publishing again', async () => {
  const request = { protocol: 2 as const, generation: 4, scopes: [], cursors: [] };
  const initial = await captureSyncV2(db, ids.account, slug, ids.village, request);
  const base = applySyncV2Batch(
    {
      worldId: ids.world,
      villageId: ids.village,
      generation: 4,
      scopes: new Map(),
      subscribedScopes: new Set(initial.groups.map((group) => `${group.stream.kind}:${group.stream.key}`)),
    },
    initial,
  );
  expect(base.kind).toBe('applied');
  const command = {
    commandId: randomUUID(),
    buildingType: 'dwelling',
    anchorCellX: 66,
    anchorCellY: 64,
    cells: [{ cellX: 66, cellY: 64 }],
    quarterTurns: 0,
    houseVariant: 'logs',
  };
  const response = await place(command);
  expect(response.statusCode, response.body).toBe(201);
  const confirmation = response.json<ConstructionConfirmationV2>();
  expect(constructionConfirmationV2IsValid(confirmation)).toBe(true);
  const buildingId = confirmation.result.buildingId!;
  expect(
    await db.selectFrom('buildings').select('status').where('id', '=', buildingId).executeTakeFirstOrThrow(),
  ).toEqual({ status: 'under-construction' });
  // The effects alone show the new building and the debited stock.
  const applied = applySyncV2Batch(base.state, confirmation.effects);
  expect(applied.kind).toBe('applied');
  const visible = visibleSyncV2Scope(applied.state.scopes.get(`village:${ids.village}`)!);
  expect(visible.get(`buildings:${buildingId}`)).toMatchObject({
    id: buildingId,
    type: 'dwelling',
    status: 'under-construction',
  });
  const wood = Number(
    (
      await db
        .selectFrom('villageResources')
        .select('amount')
        .where('villageId', '=', ids.village)
        .where('resourceCode', '=', 'wood')
        .executeTakeFirstOrThrow()
    ).amount,
  );
  expect(wood).toBeLessThan(2000);
  expect(visible.get('resources:wood')).toMatchObject({ amount: wood });
  const revisions = async () =>
    (
      await sql<{
        revision: string;
      }>`select revision::text from game_sync_streams where world_id=${ids.world} order by stream_kind,scope_key`.execute(
        db,
      )
    ).rows;
  const before = await revisions();
  const replay = await place(command);
  expect(replay.statusCode, replay.body).toBe(201);
  expect(replay.json()).toEqual({ ...confirmation, effects: undefined });
  expect(await revisions()).toEqual(before);
  expect((await place({ ...command, commandId: undefined })).statusCode).toBe(400);
}, 60000);

const post = (path: string, payload: object) =>
  app.inject({
    method: 'POST',
    url: root + path,
    cookies: { session: token },
    headers: { 'x-arbestra-protocol': '2', 'x-arbestra-generation': '4' },
    payload,
  });
async function v2Base() {
  const initial = await captureSyncV2(db, ids.account, slug, ids.village, {
    protocol: 2,
    generation: 4,
    scopes: [],
    cursors: [],
  });
  const base = applySyncV2Batch(
    {
      worldId: ids.world,
      villageId: ids.village,
      generation: 4,
      scopes: new Map(),
      subscribedScopes: new Set(initial.groups.map((group) => `${group.stream.kind}:${group.stream.key}`)),
    },
    initial,
  );
  if (base.kind !== 'applied') throw Error('Expected an applied bootstrap');
  return base.state;
}
const streamRevisions = async () =>
  (
    await sql<{
      revision: string;
    }>`select revision::text from game_sync_streams where world_id=${ids.world} order by stream_kind,scope_key`.execute(
      db,
    )
  ).rows;

it('answers an upgrade and a garden expansion on the V2 contract, replays without publishing, refuses no identity', async () => {
  // A completed house to upgrade and a completed garden to extend.
  const house = await post('/buildings', {
    commandId: randomUUID(),
    buildingType: 'dwelling',
    anchorCellX: 68,
    anchorCellY: 64,
    cells: [{ cellX: 68, cellY: 64 }],
    quarterTurns: 0,
    houseVariant: 'logs',
  });
  const garden = await post('/buildings', {
    commandId: randomUUID(),
    buildingType: 'garden',
    anchorCellX: 64,
    anchorCellY: 68,
    cells: [{ cellX: 64, cellY: 68 }],
    quarterTurns: 0,
  });
  expect([house.statusCode, garden.statusCode], house.body + garden.body).toEqual([201, 201]);
  const houseId = house.json<ConstructionConfirmationV2>().result.buildingId!,
    gardenId = garden.json<ConstructionConfirmationV2>().result.buildingId!;
  await db
    .updateTable('buildings')
    .set({ status: 'completed', completedAt: new Date(), constructionCompletesAt: null })
    .where('id', 'in', [houseId, gardenId])
    .execute();
  await sql`update world_cell_occupancies set pending_expansion_id=null where world_id=${ids.world}`.execute(db);

  const base = await v2Base();
  const upgrade = { commandId: randomUUID(), expectedLevel: 2 };
  const upgraded = await post(`/buildings/${houseId}/upgrade`, upgrade);
  expect(upgraded.statusCode, upgraded.body).toBe(201);
  const upgradeConfirmation = upgraded.json<ConstructionConfirmationV2>();
  expect(constructionConfirmationV2IsValid(upgradeConfirmation)).toBe(true);
  expect(upgradeConfirmation.result.buildingId).toBe(houseId);
  const afterUpgrade = applySyncV2Batch(base, upgradeConfirmation.effects);
  expect(afterUpgrade.kind).toBe('applied');
  if (afterUpgrade.kind !== 'applied') throw Error('Expected applied effects');
  expect(
    visibleSyncV2Scope(afterUpgrade.state.scopes.get(`village:${ids.village}`)!).get(`buildings:${houseId}`),
  ).toMatchObject({
    status: 'under-construction',
    targetLevel: 2,
  });
  let before = await streamRevisions();
  const upgradeReplay = await post(`/buildings/${houseId}/upgrade`, upgrade);
  expect(upgradeReplay.statusCode, upgradeReplay.body).toBe(201);
  // Same identity and result; a replay reports its receipt's instant.
  const { effects: _effects, commandTime: _time, ...stable } = upgradeConfirmation;
  void _effects;
  void _time;
  expect(upgradeReplay.json()).toEqual({ ...stable, commandTime: expect.any(String) });
  expect(upgradeReplay.json().effects).toBeUndefined();
  expect(await streamRevisions()).toEqual(before);

  const expansion = { commandId: randomUUID(), cells: [{ cellX: 65, cellY: 68 }] };
  const expanded = await post(`/buildings/${gardenId}/expansions`, expansion);
  expect(expanded.statusCode, expanded.body).toBe(201);
  const expansionConfirmation = expanded.json<ConstructionConfirmationV2>();
  expect(constructionConfirmationV2IsValid(expansionConfirmation)).toBe(true);
  const afterExpansion = applySyncV2Batch(afterUpgrade.state, expansionConfirmation.effects);
  expect(afterExpansion.kind).toBe('applied');
  if (afterExpansion.kind !== 'applied') throw Error('Expected applied effects');
  const expansions = [
    ...visibleSyncV2Scope(afterExpansion.state.scopes.get(`village:${ids.village}`)!).entries(),
  ].filter(([key]) => key.startsWith('buildingExpansions:'));
  expect(expansions).toHaveLength(1);
  before = await streamRevisions();
  const expansionReplay = await post(`/buildings/${gardenId}/expansions`, expansion);
  expect(expansionReplay.statusCode, expansionReplay.body).toBe(201);
  expect(expansionReplay.json().effects).toBeUndefined();
  expect(await streamRevisions()).toEqual(before);

  expect((await post(`/buildings/${houseId}/upgrade`, { expectedLevel: 3 })).statusCode).toBe(400);
  expect((await post(`/buildings/${gardenId}/expansions`, { cells: [{ cellX: 66, cellY: 68 }] })).statusCode).toBe(400);
}, 120000);

it('answers bodyless village gestures on the V2 contract with their effects, and requires a gesture identity', async () => {
  const hall = await db
    .selectFrom('buildings')
    .select('id')
    .where('villageId', '=', ids.village)
    .where('buildingType', '=', 'town-hall')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('buildingHiddenSupplies')
    .values({ worldId: ids.world, villageId: ids.village, buildingId: hall.id, resourceCode: 'carrot', amount: 40 })
    .execute();
  const carrots = async () =>
    Number(
      (
        await db
          .selectFrom('villageResources')
          .select('amount')
          .where('villageId', '=', ids.village)
          .where('resourceCode', '=', 'carrot')
          .executeTakeFirstOrThrow()
      ).amount,
    );
  const gesture = (path: string, commandId?: string) =>
    app.inject({
      method: 'POST',
      url: root + path,
      cookies: { session: token },
      headers: {
        'x-arbestra-protocol': '2',
        'x-arbestra-generation': '4',
        ...(commandId ? { 'x-arbestra-command': commandId } : {}),
      },
    });
  const base = await v2Base();
  const before = await carrots();
  // Without an identity nothing is claimed.
  expect((await gesture(`/buildings/${hall.id}/discover-supplies`)).statusCode).toBe(400);
  expect(await carrots()).toBe(before);

  const commandId = randomUUID();
  const supplies = await gesture(`/buildings/${hall.id}/discover-supplies`, commandId);
  expect(supplies.statusCode, supplies.body).toBe(200);
  const confirmation = supplies.json<VillageCommandConfirmationV2>();
  expect(villageCommandConfirmationV2IsValid(confirmation)).toBe(true);
  expect(confirmation).toMatchObject({ commandId, worldId: ids.world, villageId: ids.village, status: 'applied' });
  expect(await carrots()).toBe(before + 40);
  // The effects alone carry the credited stock and the accomplishment.
  const applied = applySyncV2Batch(base, confirmation.effects);
  expect(applied.kind).toBe('applied');
  if (applied.kind !== 'applied') return;
  const visible = visibleSyncV2Scope(applied.state.scopes.get(`village:${ids.village}`)!);
  expect(visible.get('resources:carrot')).toMatchObject({ amount: before + 40 });
  expect(visible.get('accomplishments:town-hall-supplies')).toBeDefined();
  // A retry is naturally idempotent: no second credit.
  const retry = await gesture(`/buildings/${hall.id}/discover-supplies`, commandId);
  expect(retry.statusCode, retry.body).toBe(200);
  expect(await carrots()).toBe(before + 40);

  const eyes = await gesture('/discover-cat-eyes', randomUUID());
  expect(eyes.statusCode, eyes.body).toBe(200);
  const seen = eyes.json<VillageCommandConfirmationV2>();
  const next = applySyncV2Batch(applied.state, seen.effects);
  expect(next.kind).toBe('applied');
  if (next.kind !== 'applied') return;
  expect(
    visibleSyncV2Scope(next.state.scopes.get(`village:${ids.village}`)!).get('accomplishments:cat-eyes'),
  ).toBeDefined();
  const revisions = await streamRevisions();
  const again = await gesture('/discover-cat-eyes', randomUUID());
  expect(again.statusCode).toBe(200);
  expect(again.json<VillageCommandConfirmationV2>().effects).toBeUndefined();
  expect(await streamRevisions()).toEqual(revisions);

  // A science refusal keeps the business error of the historical contract.
  const science = await app.inject({
    method: 'POST',
    url: root + '/science',
    cookies: { session: token },
    headers: { 'x-arbestra-protocol': '2', 'x-arbestra-generation': '4', 'x-arbestra-command': randomUUID() },
    payload: { action: 'train', buildingId: hall.id },
  });
  expect(science.statusCode).toBeGreaterThanOrEqual(400);
  expect(science.statusCode).toBeLessThan(500);
}, 60000);

it('bootstraps a village with more than 1 024 single-member cohorts (one per arrival) on V2', async () => {
  const now = new Date();
  await db
    .insertInto('populationCohorts')
    .values(
      Array.from({ length: 1100 }, (_, i) => ({
        worldId: ids.world,
        villageId: ids.village,
        originVillageId: ids.village,
        memberCount: 1,
        activity: 'idle' as const,
        energy: 10,
        energyProgress: 0,
        energyUpdatedAt: new Date(now.getTime() - i * 1000),
        restingSince: null,
        foodUsedSinceRest: 0,
      })),
    )
    .execute();
  try {
    const initial = await captureSyncV2(db, ids.account, slug, ids.village, {
      protocol: 2,
      generation: 4,
      scopes: [],
      cursors: [],
    });
    const cohorts = initial.groups
      .flatMap((group) => group.changes)
      .filter((change) => change.component === 'cohorts')
      .reduce((n, change) => n + change.upsert.length, 0);
    expect(cohorts).toBeGreaterThanOrEqual(1100);
    // Materialization regroups the arrivals per energy point without losing anyone.
    const members = async () =>
      await db
        .selectFrom('populationCohorts')
        .select([sql<number>`count(*)::int`.as('rows'), sql<number>`sum(member_count)::int`.as('members')])
        .where('villageId', '=', ids.village)
        .executeTakeFirstOrThrow();
    const before = await members();
    await db.transaction().execute((tx) => materializeCohorts(tx, ids.world, ids.village, new Date()));
    const after = await members();
    expect(after.members).toBe(before.members);
    expect(after.rows).toBeLessThanOrEqual(20);
  } finally {
    await db.deleteFrom('populationCohorts').where('villageId', '=', ids.village).execute();
  }
}, 60000);
