import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  applySyncV2Batch,
  visibleSyncV2Scope,
  type RoadCellsConfirmationV2,
  type RoadCellsPreview,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { buildApp } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';
import { captureSyncV2 } from './sync-v2-capture.js';
import { roadCellsCommandV2, roadCellsTestHooks } from './road-cells.js';
import { placeBuilding } from './construction.js';
import { readNavigationInfrastructure } from './infrastructure.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected road cells test database');
const db = createDatabase(url);
const ids = {
    world: randomUUID(),
    village: randomUUID(),
    account: randomUUID(),
    neighbour: randomUUID(),
    neighbourAccount: randomUUID(),
  },
  slug = 'road-cells-' + ids.world,
  token = randomUUID();
const root = `/api/worlds/${slug}/villages/${ids.village}`;
let app: FastifyInstance;

async function settle(villageId: string, anchorCellX: number, anchorCellY: number, accountId: string) {
  const now = new Date();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('worldMemberships')
      .values({ worldId: ids.world, accountId, playerName: accountId.slice(0, 8) })
      .execute();
    await tx
      .insertInto('villages')
      .values({
        id: villageId,
        worldId: ids.world,
        ownerAccountId: accountId,
        name: 'Roads ' + villageId.slice(0, 4),
        anchorCellX,
        anchorCellY,
        economyActivatedAt: now,
      })
      .execute();
    const hall = await tx
      .insertInto('buildings')
      .values({
        worldId: ids.world,
        villageId,
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
      .values({
        worldId: ids.world,
        cellX: anchorCellX,
        cellY: anchorCellY,
        buildingId: hall.id,
        featureId: null,
        role: 'anchor',
      })
      .execute();
    for (const resourceCode of ['wood', 'stone', 'timber', 'cut-stone', 'carrot'])
      await tx
        .insertInto('villageResources')
        .values({ worldId: ids.world, villageId, resourceCode, amount: 2000 })
        .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: 2000 }))
        .execute();
    await tx
      .insertInto('villageResourceFlows')
      .values({
        worldId: ids.world,
        villageId,
        resourceCode: 'wood',
        baseRatePerHour: 0,
        remainder: 0,
        productionUpdatedAt: now,
      })
      .execute();
  });
}

beforeAll(async () => {
  await migrateToLatest(url);
  const now = new Date();
  for (const account of [ids.account, ids.neighbourAccount])
    await db
      .insertInto('accounts')
      .values({ id: account, email: account + '@roads.test', passwordHash: 'fixture' })
      .execute();
  await db
    .insertInto('sessions')
    .values({ accountId: ids.account, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
    .execute();
  await db
    .insertInto('worlds')
    .values({
      id: ids.world,
      slug,
      name: 'Road cells',
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
      await db
        .insertInto('worldChunks')
        .values({
          worldId: ids.world,
          chunkX: x,
          chunkY: y,
          generationVersion: 1,
          // Water (code 2) on cell (60, 70) for the terrain refusal.
          terrainCodes: Array.from({ length: 1024 }, (_, i) =>
            x === 1 && y === 2 && i === (70 - 64) * 32 + (60 - 32) ? 2 : 1,
          ),
          elevations: Array(1024).fill(1),
        })
        .execute();
  await settle(ids.village, 64, 64, ids.account);
  await settle(ids.neighbour, 72, 64, ids.neighbourAccount);
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
afterEach(() => {
  delete roadCellsTestHooks.afterWrites;
});
afterAll(async () => {
  await app?.close();
  // Stone deposits restrict the deletion of their world features.
  await db.deleteFrom('stoneDeposits').where('worldId', '=', ids.world).execute();
  await db.deleteFrom('worlds').where('id', '=', ids.world).execute();
  await db.deleteFrom('accounts').where('id', 'in', [ids.account, ids.neighbourAccount]).execute();
  await db.destroy();
}, 30000);

const headers = { 'x-arbestra-protocol': '2', 'x-arbestra-generation': '4' };
const post = (path: string, payload: object) =>
  app.inject({ method: 'POST', url: root + path, cookies: { session: token }, headers, payload });
const preview = async (payload: object) => {
  const response = await post('/road-cells/preview', payload);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<RoadCellsPreview>();
};
const row = (cellX: number, cellY: number) => ({ cellX, cellY });
const stone = async (villageId = ids.village) =>
  Number(
    (
      await db
        .selectFrom('villageResources')
        .select('amount')
        .where('worldId', '=', ids.world)
        .where('villageId', '=', villageId)
        .where('resourceCode', '=', 'stone')
        .executeTakeFirstOrThrow()
    ).amount,
  );
const roads = () =>
  db
    .selectFrom('roadCells')
    .select(['villageId', 'cellX', 'cellY', 'surface', 'sidewalks', 'gauge', 'revision'])
    .where('worldId', '=', ids.world)
    .orderBy('cellX')
    .orderBy('cellY')
    .execute();
const streams = async () =>
  (
    await sql<{ kind: string; key: string; revision: string }>`select stream_kind as kind,scope_key as key,
      revision::text from game_sync_streams where world_id=${ids.world} order by stream_kind,scope_key`.execute(db)
  ).rows;
/** Everything a refused gesture must leave untouched. */
const state = async () => ({
  roads: await roads(),
  stone: await stone(),
  receipts: (await db.selectFrom('roadCellReceipts').select('commandId').where('worldId', '=', ids.world).execute())
    .length,
  streams: await streams(),
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
  return { initial, state: base.state };
}

it('places, replays, restyles and removes road cells with a compact receipt and V2 effects', async () => {
  const { state: base } = await v2Base();
  const style = { surface: 'stone-1', sidewalks: true };
  const cells = [row(65, 66), row(66, 66), row(67, 66)];
  const quote = await preview({ action: 'place', cells, style });
  expect(quote).toEqual({
    valid: true,
    code: null,
    message: null,
    quote: { stone: 18 },
    result: { placed: 3, restyled: 0, removed: 0, unchanged: 0, stone: 18 },
  });
  // The quote is read-only.
  expect(await roads()).toEqual([]);
  const command = { commandId: randomUUID(), action: 'place', cells, style, expectedQuote: quote.quote };
  const response = await post('/road-cells', command);
  expect(response.statusCode, response.body).toBe(200);
  const confirmation = response.json<RoadCellsConfirmationV2>();
  expect(confirmation.result).toEqual({ placed: 3, restyled: 0, removed: 0, unchanged: 0, stone: 18 });
  expect(await stone()).toBe(2000 - 18);
  expect(await roads()).toEqual(
    cells.map((c) => ({
      villageId: ids.village,
      ...c,
      surface: 'stone-1',
      sidewalks: true,
      gauge: 'chemin',
      revision: 1,
    })),
  );
  // Effects: each cell and the debited stone, as the client applies them.
  const applied = applySyncV2Batch(base, confirmation.effects);
  expect(applied.kind).toBe('applied');
  const visible = visibleSyncV2Scope(applied.state.scopes.get(`village:${ids.village}`)!);
  expect(visible.get('roadCells:66,66')).toEqual({
    id: '66,66',
    cellX: 66,
    cellY: 66,
    surface: 'stone-1',
    sidewalks: true,
    gauge: 'chemin',
    revision: 1,
  });
  expect(visible.get('resources:stone')).toMatchObject({ amount: 2000 - 18 });
  // The journal names each cell (read directly).
  const journal = (
    await sql<{ changes: Array<{ component: string; key: string }> }>`select changes from game_sync_changes
      where world_id=${ids.world} and stream_kind='village' and scope_key=${ids.village}
      order by revision desc limit 1`.execute(db)
  ).rows[0]!.changes;
  expect(
    journal
      .filter((c) => c.component === 'roadCells')
      .map((c) => c.key)
      .sort(),
  ).toEqual(['65,66', '66,66', '67,66']);
  // The snapshot carries the cells, and so does the rebuilt village state.
  const { initial } = await v2Base();
  const snapshot = initial.groups
    .find((g) => g.stream.kind === 'village')!
    .changes.find((c) => c.component === 'roadCells')!;
  expect(snapshot.upsert.map((c) => (c as { id: string }).id).sort()).toEqual(['65,66', '66,66', '67,66']);

  // Exact replay: original result and instant, no effects, nothing published.
  const before = await state();
  const replay = await post('/road-cells', command);
  expect(replay.statusCode, replay.body).toBe(200);
  expect(replay.json()).toEqual({ ...confirmation, effects: undefined });
  expect(await state()).toEqual(before);

  // Restyle: a dearer style pays the difference, a cheaper one refunds nothing.
  const dearer = await preview({
    action: 'place',
    cells: [row(66, 66), row(68, 66)],
    style: { surface: 'stone-2', sidewalks: true },
  });
  expect(dearer.result).toEqual({ placed: 1, restyled: 1, removed: 0, unchanged: 0, stone: 6 });
  const cheaperQuote = await preview({ action: 'place', cells, style: { surface: 'earth', sidewalks: false } });
  expect(cheaperQuote.result).toEqual({ placed: 0, restyled: 3, removed: 0, unchanged: 0, stone: 0 });
  const cheaper = await post('/road-cells', {
    commandId: randomUUID(),
    action: 'place',
    cells: [row(65, 66)],
    style: { surface: 'earth', sidewalks: false },
    expectedQuote: { stone: 0 },
  });
  expect(cheaper.statusCode, cheaper.body).toBe(200);
  expect(cheaper.json<RoadCellsConfirmationV2>().result).toMatchObject({ restyled: 1, stone: 0 });
  expect(await stone()).toBe(2000 - 18);
  expect((await roads())[0]).toMatchObject({ cellX: 65, surface: 'earth', sidewalks: false, revision: 2 });
  // Same style again: unchanged, free.
  const same = await post('/road-cells', {
    commandId: randomUUID(),
    action: 'place',
    cells: [row(65, 66)],
    style: { surface: 'earth', sidewalks: false },
    expectedQuote: { stone: 0 },
  });
  expect(same.json<RoadCellsConfirmationV2>().result).toMatchObject({ unchanged: 1, restyled: 0 });

  // Removal: no refund, one tombstone per removed cell.
  const { state: beforeRemoval } = await v2Base();
  const removal = await post('/road-cells', {
    commandId: randomUUID(),
    action: 'remove',
    cells: [row(65, 66), row(66, 66), row(90, 66)],
  });
  expect(removal.statusCode, removal.body).toBe(200);
  const removed = removal.json<RoadCellsConfirmationV2>();
  expect(removed.result).toEqual({ placed: 0, restyled: 0, removed: 2, unchanged: 1, stone: 0 });
  expect(await stone()).toBe(2000 - 18);
  expect((await roads()).map((r) => r.cellX)).toEqual([67]);
  const afterRemoval = applySyncV2Batch(beforeRemoval, removed.effects);
  expect(afterRemoval.kind).toBe('applied');
  const remaining = visibleSyncV2Scope(afterRemoval.state.scopes.get(`village:${ids.village}`)!);
  expect(remaining.has('roadCells:65,66') || remaining.has('roadCells:66,66')).toBe(false);
  expect(remaining.has('roadCells:67,66')).toBe(true);

  // Navigation reads the cells of the village and of its neighbours.
  const navigation = await readNavigationInfrastructure(db, {
    worldId: ids.world,
    villageId: ids.neighbour,
    anchorCellX: 72,
    anchorCellY: 64,
    widthCells: 128,
    heightCells: 128,
  });
  expect(navigation.roadCells).toEqual([{ cellX: 67, cellY: 66, surface: 'stone-1', sidewalks: true }]);
}, 60000);

it('refuses without writing: reused identifier, building, deposit, terrain, reach, gauge, resources, stale quote', async () => {
  const style = { surface: 'stone-1', sidewalks: false };
  const accepted = {
    commandId: randomUUID(),
    action: 'place',
    cells: [row(64, 70)],
    style,
    expectedQuote: { stone: 4 },
  };
  expect((await post('/road-cells', accepted)).statusCode).toBe(200);
  // A stone deposit blocking (63, 70).
  const feature = randomUUID();
  await db
    .insertInto('worldFeatures')
    .values({ id: feature, worldId: ids.world, featureTypeCode: 'stone_outcrop', variantSeed: 1, state: 'available' })
    .execute();
  await db
    .insertInto('worldCellOccupancies')
    .values({ worldId: ids.world, cellX: 63, cellY: 70, buildingId: null, featureId: feature, role: 'body' })
    .execute();
  await db
    .insertInto('stoneDeposits')
    .values({
      worldId: ids.world,
      featureId: feature,
      cellX: 63,
      cellY: 70,
      initialAmount: 100,
      remainingAmount: 100,
      reservedAmount: 0,
      revision: 1,
      updatedAt: new Date(),
    })
    .execute();
  const cases: Array<[object, number, string]> = [
    [{ ...accepted, cells: [row(64, 71)] }, 409, 'COMMAND_REUSED'],
    [{ ...accepted, commandId: randomUUID(), cells: [row(64, 64)], expectedQuote: { stone: 4 } }, 409, 'CELL_OCCUPIED'],
    [{ ...accepted, commandId: randomUUID(), cells: [row(72, 64)] }, 409, 'CELL_OCCUPIED'],
    [{ ...accepted, commandId: randomUUID(), cells: [row(63, 70)] }, 409, 'CELL_OCCUPIED'],
    [{ ...accepted, commandId: randomUUID(), cells: [row(60, 70)] }, 409, 'INCOMPATIBLE_TERRAIN'],
    [{ ...accepted, commandId: randomUUID(), cells: [row(100, 64)] }, 409, 'OUTSIDE_INFRASTRUCTURE_REACH'],
    [
      { ...accepted, commandId: randomUUID(), cells: [row(64, 72)], style: { ...style, gauge: 'charretiere' } },
      409,
      'GAUGE_UNAVAILABLE',
    ],
    [{ ...accepted, commandId: randomUUID(), cells: [row(64, 72)], expectedQuote: { stone: 0 } }, 409, 'QUOTE_CHANGED'],
    [{ ...accepted, commandId: randomUUID(), cells: [row(64, 64 + 129)] }, 400, 'INVALID_COORDINATES'],
  ];
  for (const [payload, status, code] of cases) {
    const before = await state();
    const response = await post('/road-cells', payload);
    expect(response.statusCode, `${code} ${response.body}`).toBe(status);
    if (code) expect(response.body).toContain(code);
    expect(await state(), code).toEqual(before);
  }
  // The neighbour cannot take or remove a cell this village owns.
  const neighbour = await roadCellsCommandV2(
    db,
    ids.neighbourAccount,
    slug,
    ids.neighbour,
    {
      commandId: randomUUID(),
      action: 'remove',
      cells: [row(67, 66)],
    },
    0,
  ).catch((error: { code?: string }) => error.code);
  expect(neighbour).toBe('FOREIGN_INFRASTRUCTURE');
  // Resources: 2 000 stones buy 500 stone cells at most.
  await db
    .updateTable('villageResources')
    .set({ amount: '3' })
    .where('villageId', '=', ids.village)
    .where('resourceCode', '=', 'stone')
    .execute();
  const before = await state();
  const poor = await post('/road-cells', { ...accepted, commandId: randomUUID(), cells: [row(64, 72)] });
  expect(poor.statusCode).toBe(409);
  expect(poor.body).toContain('INSUFFICIENT_RESOURCES');
  expect((await preview({ action: 'place', cells: [row(64, 72)], style })).code).toBe('INSUFFICIENT_RESOURCES');
  expect(await state()).toEqual(before);
  await db
    .updateTable('villageResources')
    .set({ amount: '2000' })
    .where('villageId', '=', ids.village)
    .where('resourceCode', '=', 'stone')
    .execute();
}, 60000);

it('counts a cell named twice in one gesture once: quote, command, replay and removal', async () => {
  // Tristan, 30 October: a gesture that passes over a cell twice is not refused.
  const style = { surface: 'stone-1', sidewalks: false };
  const twice = [row(68, 66), row(65, 66), row(68, 66)];
  const quote = await preview({ action: 'place', cells: twice, style });
  expect(quote).toMatchObject({ valid: true, quote: { stone: 8 } });
  expect(quote.result).toEqual({ placed: 2, restyled: 0, removed: 0, unchanged: 0, stone: 8 });
  const before = await stone();
  const command = { commandId: randomUUID(), action: 'place', cells: twice, style, expectedQuote: { stone: 8 } };
  const response = await post('/road-cells', command);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json<RoadCellsConfirmationV2>().result).toEqual({
    placed: 2,
    restyled: 0,
    removed: 0,
    unchanged: 0,
    stone: 8,
  });
  expect(await stone()).toBe(before - 8);
  expect((await roads()).filter((r) => r.cellY === 66 && r.cellX !== 67).map((r) => [r.cellX, r.revision])).toEqual([
    [65, 1],
    [68, 1],
  ]);
  // The same identifier with the cell named once is the same gesture: a replay.
  const snapshot = await state();
  const replay = await post('/road-cells', { ...command, cells: [row(68, 66), row(65, 66)] });
  expect(replay.statusCode, replay.body).toBe(200);
  expect(await state()).toEqual(snapshot);
  const removal = await post('/road-cells', {
    commandId: randomUUID(),
    action: 'remove',
    cells: [row(65, 66), row(68, 66), row(65, 66)],
  });
  expect(removal.statusCode, removal.body).toBe(200);
  expect(removal.json<RoadCellsConfirmationV2>().result).toEqual({
    placed: 0,
    restyled: 0,
    removed: 2,
    unchanged: 0,
    stone: 0,
  });
  expect((await roads()).some((r) => r.cellY === 66 && (r.cellX === 65 || r.cellX === 68))).toBe(false);
}, 60000);

it('rolls back cells, debit and receipt when the transaction fails after writing them', async () => {
  const before = await state();
  let inside: { roads: number; stone: string } | undefined;
  roadCellsTestHooks.afterWrites = async (tx) => {
    inside = {
      roads: (
        await tx
          .selectFrom('roadCells')
          .select('cellX')
          .where('worldId', '=', ids.world)
          .where('cellY', '=', 74)
          .execute()
      ).length,
      stone: (
        await tx
          .selectFrom('villageResources')
          .select('amount')
          .where('villageId', '=', ids.village)
          .where('resourceCode', '=', 'stone')
          .executeTakeFirstOrThrow()
      ).amount,
    };
    throw new Error('injected road cells failure');
  };
  await expect(
    roadCellsCommandV2(
      db,
      ids.account,
      slug,
      ids.village,
      {
        commandId: randomUUID(),
        action: 'place',
        cells: [row(64, 74), row(65, 74)],
        style: { surface: 'stone-2', sidewalks: false },
        expectedQuote: { stone: 8 },
      },
      4,
    ),
  ).rejects.toThrow('injected road cells failure');
  // The writes did happen before the injected error...
  expect(inside).toEqual({ roads: 2, stone: String(before.stone - 8) });
  // ...and none survives it.
  expect(await state()).toEqual(before);
}, 60000);

/** A bounded barrier: the holder waits until released, at most 15 s. */
function barrier() {
  let release!: () => void, arrive!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  return {
    arrived,
    release,
    wait: async () => {
      arrive();
      await Promise.race([gate, new Promise((_, reject) => setTimeout(() => reject(Error('barrier timeout')), 15000))]);
    },
  };
}
/** Bounded wait until a session of this database waits on a lock. */
async function lockWaiter() {
  for (let i = 0; i < 100; i++) {
    const waiting = (
      await sql<{ n: number }>`select count(*)::int as n from pg_stat_activity
        where datname=current_database() and wait_event_type='Lock'`.execute(db)
    ).rows[0]!.n;
    if (waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('No session waited for the lock');
}
const house = (cellX: number, cellY: number) => ({
  buildingType: 'dwelling' as const,
  anchor: row(cellX, cellY),
  cells: [row(cellX, cellY)],
  commandId: randomUUID(),
  quarterTurns: 0,
  houseVariant: 'logs' as const,
});

it('serializes a road and a neighbour building on the same cell: the road first, the building refused', async () => {
  const gate = barrier();
  roadCellsTestHooks.afterWrites = gate.wait;
  const road = roadCellsCommandV2(
    db,
    ids.account,
    slug,
    ids.village,
    {
      commandId: randomUUID(),
      action: 'place',
      cells: [row(70, 64)],
      style: { surface: 'earth', sidewalks: false },
      expectedQuote: { stone: 0 },
    },
    4,
  );
  const settledRoad = road.catch((error) => error);
  try {
    await gate.arrived;
    delete roadCellsTestHooks.afterWrites;
    const building = placeBuilding(db, ids.neighbourAccount, slug, ids.neighbour, house(70, 64), null).catch(
      (error: { code?: string }) => error,
    );
    await lockWaiter();
    gate.release();
    const [roadResult, buildingResult] = await Promise.all([settledRoad, building]);
    expect(roadResult).toMatchObject({ status: 'applied', result: { placed: 1 } });
    expect(buildingResult).toMatchObject({ code: 'INFRASTRUCTURE_OCCUPIED' });
    expect(
      await db
        .selectFrom('worldCellOccupancies')
        .select('buildingId')
        .where('worldId', '=', ids.world)
        .where('cellX', '=', 70)
        .where('cellY', '=', 64)
        .execute(),
    ).toEqual([]);
  } finally {
    gate.release();
    await settledRoad;
  }
}, 60000);

it('serializes a neighbour building and a road on the same cell: the building first, the road refused', async () => {
  const gate = barrier();
  const building = placeBuilding(db, ids.neighbourAccount, slug, ids.neighbour, house(71, 65), null, gate.wait).catch(
    (error) => error,
  );
  try {
    await gate.arrived;
    const before = await stone();
    const road = roadCellsCommandV2(
      db,
      ids.account,
      slug,
      ids.village,
      {
        commandId: randomUUID(),
        action: 'place',
        cells: [row(71, 65)],
        style: { surface: 'stone-1', sidewalks: false },
        expectedQuote: { stone: 4 },
      },
      4,
    ).catch((error: { code?: string }) => error);
    await lockWaiter();
    gate.release();
    const [buildingResult, roadResult] = await Promise.all([building, road]);
    expect(buildingResult).not.toBeInstanceOf(Error);
    expect(roadResult).toMatchObject({ code: 'CELL_OCCUPIED' });
    expect((await roads()).some((r) => r.cellX === 71 && r.cellY === 65)).toBe(false);
    expect(await stone()).toBe(before);
  } finally {
    gate.release();
    await building;
  }
}, 60000);
