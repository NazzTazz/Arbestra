import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  applySyncV2Batch,
  visibleSyncV2Scope,
  type RoadAnchorsConfirmationV2,
  type RoadAnchorsPreview,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { buildApp } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';
import { captureSyncV2 } from './sync-v2-capture.js';
import { roadAnchorsCommandV2, roadAnchorsTestHooks } from './road-anchors.js';
import { roadCellsCommandV2, roadCellsTestHooks } from './road-cells.js';
import { readNavigationInfrastructure } from './infrastructure.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected road anchors test database');
const db = createDatabase(url);
const ids = {
    world: randomUUID(),
    village: randomUUID(),
    account: randomUUID(),
    neighbour: randomUUID(),
    neighbourAccount: randomUUID(),
  },
  slug = 'road-anchors-' + ids.world,
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
        name: 'Anchors ' + villageId.slice(0, 4),
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
      .values({ id: account, email: account + '@anchors.test', passwordHash: 'fixture' })
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
      name: 'Road anchors',
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
          terrainCodes: Array(1024).fill(1),
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
  delete roadAnchorsTestHooks.afterWrites;
  delete roadAnchorsTestHooks.afterLock;
  delete roadCellsTestHooks.afterWrites;
});
afterAll(async () => {
  await app?.close();
  await db.deleteFrom('worlds').where('id', '=', ids.world).execute();
  await db.deleteFrom('accounts').where('id', 'in', [ids.account, ids.neighbourAccount]).execute();
  await db.destroy();
}, 30000);

const headers = { 'x-arbestra-protocol': '2', 'x-arbestra-generation': '4' };
const post = (path: string, payload: object) =>
  app.inject({ method: 'POST', url: root + path, cookies: { session: token }, headers, payload });
const preview = async (payload: object) => {
  const response = await post('/road-anchors/preview', payload);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<RoadAnchorsPreview>();
};
const cell = (cellX: number, cellY: number) => ({ cellX, cellY });
const vertex = (vertexX: number, vertexY: number) => ({ vertexX, vertexY });
const roads = async (villageId: string, accountId: string, action: 'place' | 'remove', cells: object[]) =>
  roadCellsCommandV2(
    db,
    accountId,
    slug,
    villageId,
    action === 'place'
      ? {
          commandId: randomUUID(),
          action,
          cells: cells as Array<{ cellX: number; cellY: number }>,
          style: { surface: 'earth', sidewalks: false },
          expectedQuote: { stone: 0 },
        }
      : { commandId: randomUUID(), action, cells: cells as Array<{ cellX: number; cellY: number }> },
    4,
  );
const resource = async (code: 'stone' | 'wood', villageId = ids.village) =>
  Number(
    (
      await db
        .selectFrom('villageResources')
        .select('amount')
        .where('worldId', '=', ids.world)
        .where('villageId', '=', villageId)
        .where('resourceCode', '=', code)
        .executeTakeFirstOrThrow()
    ).amount,
  );
const anchors = () =>
  db
    .selectFrom('roadAnchors')
    .select(['villageId', 'vertexX', 'vertexY', 'accessory', 'revision'])
    .where('worldId', '=', ids.world)
    .orderBy('vertexX')
    .orderBy('vertexY')
    .execute();
const streams = async () =>
  (
    await sql<{ kind: string; key: string; revision: string }>`select stream_kind as kind,scope_key as key,
      revision::text from game_sync_streams where world_id=${ids.world} order by stream_kind,scope_key`.execute(db)
  ).rows;
/** Everything a refused gesture must leave untouched. */
const state = async () => ({
  anchors: await anchors(),
  stone: await resource('stone'),
  wood: await resource('wood'),
  receipts: (await db.selectFrom('roadAnchorReceipts').select('commandId').where('worldId', '=', ids.world).execute())
    .length,
  streams: await streams(),
});
const navigationEquipment = async () =>
  (
    await readNavigationInfrastructure(db, {
      worldId: ids.world,
      villageId: ids.village,
      anchorCellX: 64,
      anchorCellY: 64,
      widthCells: 128,
      heightCells: 128,
    })
  ).equipment
    .filter((e) => e.id.startsWith('anchor:'))
    .map((e) => [e.id, e.x, e.y]);
const lastJournal = async () =>
  (
    await sql<{ changes: Array<{ component: string; key: string }> }>`select changes from game_sync_changes
      where world_id=${ids.world} and stream_kind='village' and scope_key=${ids.village}
      order by revision desc limit 1`.execute(db)
  ).rows[0]!.changes.filter((c) => c.component === 'roadAnchors')
    .map((c) => c.key)
    .sort();
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

it('places, replays, removes and restores accessories on anchors, with V2 effects, snapshot and navigation', async () => {
  // An elbow: A (65,66), B (66,66), C (65,67). Vertex (66,67) is shared by
  // A, B, C and the empty (66,67): a re-entrant corner, automatic brazier.
  await roads(ids.village, ids.account, 'place', [cell(65, 66), cell(66, 66), cell(65, 67)]);
  expect(await navigationEquipment()).toEqual([['anchor:66:67', 66 * 8 - 4, 67 * 8 - 4]]);
  const { state: base } = await v2Base();
  const gesture = { action: 'place', accessory: 'brazier', anchors: [vertex(65, 66), vertex(66, 67), vertex(90, 90)] };
  const quote = await preview(gesture);
  expect(quote).toEqual({
    valid: true,
    code: null,
    message: null,
    quote: { stone: 2, wood: 1 },
    result: {
      placed: 1,
      restored: 0,
      removed: 0,
      unchanged: 1,
      stone: 2,
      wood: 1,
      skipped: [{ vertexX: 90, vertexY: 90, code: 'ANCHOR_MISSING' }],
    },
  });
  expect(await anchors()).toEqual([]);
  const command = { commandId: randomUUID(), ...gesture, expectedQuote: quote.quote };
  const response = await post('/road-anchors', command);
  expect(response.statusCode, response.body).toBe(200);
  const confirmation = response.json<RoadAnchorsConfirmationV2>();
  expect(confirmation.result).toEqual(quote.result);
  expect([await resource('stone'), await resource('wood')]).toEqual([1998, 1999]);
  expect(await anchors()).toEqual([
    { villageId: ids.village, vertexX: 65, vertexY: 66, accessory: 'brazier', revision: 1 },
  ]);
  // Effects: the anchor and the debited resources, as the client applies them.
  const applied = applySyncV2Batch(base, confirmation.effects);
  expect(applied.kind).toBe('applied');
  const visible = visibleSyncV2Scope(applied.state.scopes.get(`village:${ids.village}`)!);
  expect(visible.get('roadAnchors:65,66')).toEqual({
    id: '65,66',
    vertexX: 65,
    vertexY: 66,
    accessory: 'brazier',
    revision: 1,
  });
  expect(visible.get('resources:stone')).toMatchObject({ amount: 1998 });
  expect(await lastJournal()).toEqual(['65,66']);
  // The snapshot carries the stored anchor.
  const { initial } = await v2Base();
  const snapshot = initial.groups
    .find((g) => g.stream.kind === 'village')!
    .changes.find((c) => c.component === 'roadAnchors')!;
  expect(snapshot.upsert.map((a) => (a as { id: string }).id)).toEqual(['65,66']);
  // Navigation: the manual brazier and the automatic one are obstacles.
  expect(await navigationEquipment()).toEqual([
    ['anchor:65:66', 65 * 8 - 4, 66 * 8 - 4],
    ['anchor:66:67', 66 * 8 - 4, 67 * 8 - 4],
  ]);

  // Exact replay: original result and instant, no effects, nothing written.
  const before = await state();
  const replay = await post('/road-anchors', command);
  expect(replay.statusCode, replay.body).toBe(200);
  expect(replay.json()).toEqual({ ...confirmation, effects: undefined });
  expect(await state()).toEqual(before);

  // Removal: the manual brazier goes, the automatic one is suppressed (`none`),
  // nothing refunded; an empty anchor is unchanged.
  const { state: beforeRemoval } = await v2Base();
  const removal = await post('/road-anchors', {
    commandId: randomUUID(),
    action: 'remove',
    anchors: [vertex(65, 66), vertex(66, 67), vertex(67, 66)],
  });
  expect(removal.statusCode, removal.body).toBe(200);
  const removed = removal.json<RoadAnchorsConfirmationV2>();
  expect(removed.result).toEqual({ placed: 0, restored: 0, removed: 2, unchanged: 1, stone: 0, wood: 0 });
  expect(await anchors()).toEqual([
    { villageId: ids.village, vertexX: 66, vertexY: 67, accessory: 'none', revision: 1 },
  ]);
  expect([await resource('stone'), await resource('wood')]).toEqual([1998, 1999]);
  const afterRemoval = applySyncV2Batch(beforeRemoval, removed.effects);
  expect(afterRemoval.kind).toBe('applied');
  const remaining = visibleSyncV2Scope(afterRemoval.state.scopes.get(`village:${ids.village}`)!);
  expect(remaining.has('roadAnchors:65,66')).toBe(false);
  expect(remaining.get('roadAnchors:66,67')).toMatchObject({ accessory: 'none' });
  expect(await navigationEquipment()).toEqual([]);

  // Restoring the automatic brazier is free: the suppression row goes.
  const restore = await post('/road-anchors', {
    commandId: randomUUID(),
    action: 'place',
    accessory: 'brazier',
    anchors: [vertex(66, 67)],
    expectedQuote: { stone: 0, wood: 0 },
  });
  expect(restore.statusCode, restore.body).toBe(200);
  expect(restore.json<RoadAnchorsConfirmationV2>().result).toMatchObject({ restored: 1, placed: 0, stone: 0 });
  expect(await anchors()).toEqual([]);
  expect(await navigationEquipment()).toEqual([['anchor:66:67', 66 * 8 - 4, 67 * 8 - 4]]);

  // A vertex shared by four road cells is one anchor; its accessory stays while
  // one of them remains and leaves with the last (orphan rule).
  await roads(ids.village, ids.account, 'place', [cell(66, 67)]);
  expect(await navigationEquipment()).toEqual([]); // no longer a re-entrant corner
  const shared = await post('/road-anchors', {
    commandId: randomUUID(),
    action: 'place',
    accessory: 'brazier',
    anchors: [vertex(66, 67), vertex(66, 67)],
    expectedQuote: { stone: 2, wood: 1 },
  });
  expect(shared.statusCode, shared.body).toBe(200);
  expect(shared.json<RoadAnchorsConfirmationV2>().result).toMatchObject({ placed: 1 });
  await roads(ids.village, ids.account, 'remove', [cell(65, 66), cell(66, 66), cell(65, 67)]);
  expect(await anchors()).toEqual([
    { villageId: ids.village, vertexX: 66, vertexY: 67, accessory: 'brazier', revision: 1 },
  ]);
  const { state: beforeOrphan } = await v2Base();
  const last = await roads(ids.village, ids.account, 'remove', [cell(66, 67)]);
  expect(await anchors()).toEqual([]);
  // The road removal publishes the departed accessory.
  expect(await lastJournal()).toEqual(['66,67']);
  const orphaned = applySyncV2Batch(beforeOrphan, last.effects);
  expect(orphaned.kind).toBe('applied');
  expect(visibleSyncV2Scope(orphaned.state.scopes.get(`village:${ids.village}`)!).has('roadAnchors:66,67')).toBe(false);
}, 60000);

it('skips invalid anchors, refuses without writing when all are invalid, and guards engaged passages', async () => {
  // Own road (60,70)-(61,70); a neighbour's elbow at (68..69, 70..71).
  await roads(ids.village, ids.account, 'place', [cell(60, 70), cell(61, 70)]);
  await roads(ids.neighbour, ids.neighbourAccount, 'place', [cell(68, 70), cell(69, 70), cell(68, 71)]);
  // The neighbour's automatic brazier (69,71) touches our new cell (69,71)? No:
  // give us the fourth cell of its corner, so the vertex is ours too.
  await roads(ids.village, ids.account, 'place', [cell(69, 71)]);
  const accepted = {
    commandId: randomUUID(),
    action: 'place',
    accessory: 'brazier',
    anchors: [vertex(61, 70)],
    expectedQuote: { stone: 2, wood: 1 },
  };
  expect((await post('/road-anchors', accepted)).statusCode).toBe(200);
  const cases: Array<[object, number, string]> = [
    [{ ...accepted, anchors: [vertex(62, 70)] }, 409, 'COMMAND_REUSED'],
    [{ ...accepted, commandId: randomUUID(), anchors: [vertex(40, 40)] }, 409, 'ANCHOR_MISSING'],
    // Only a neighbour's road touches (68,70).
    [{ ...accepted, commandId: randomUUID(), anchors: [vertex(68, 70)] }, 409, 'ANCHOR_MISSING'],
    // The neighbour's automatic brazier, on a vertex our cell also touches.
    [{ ...accepted, commandId: randomUUID(), anchors: [vertex(69, 71)] }, 409, 'FOREIGN_INFRASTRUCTURE'],
    [
      { ...accepted, commandId: randomUUID(), anchors: [vertex(62, 70)], expectedQuote: { stone: 0, wood: 0 } },
      409,
      'QUOTE_CHANGED',
    ],
    [{ ...accepted, commandId: randomUUID(), anchors: [vertex(62, 128)] }, 400, 'INVALID_COORDINATES'],
  ];
  for (const [payload, status, code] of cases) {
    const before = await state();
    const response = await post('/road-anchors', payload);
    expect(response.statusCode, `${code} ${response.body}`).toBe(status);
    expect(response.body).toContain(code);
    expect(await state(), code).toEqual(before);
  }
  // A removal naming a foreign anchor refuses the whole gesture.
  const beforeForeign = await state();
  const foreignRemoval = await post('/road-anchors', {
    commandId: randomUUID(),
    action: 'remove',
    anchors: [vertex(61, 70), vertex(69, 71)],
  });
  expect(foreignRemoval.statusCode).toBe(409);
  expect(foreignRemoval.body).toContain('FOREIGN_INFRASTRUCTURE');
  expect(await state()).toEqual(beforeForeign);

  // A trip in progress of another village crossing the vertex (60,70): the
  // anchor is skipped (ENGAGED_PASSAGE), the free one (62,70) is placed.
  const job = await db
    .insertInto('levelingJobs')
    .values({
      worldId: ids.world,
      villageId: ids.neighbour,
      featureId: randomUUID(),
      commandId: randomUUID(),
      request: JSON.stringify({}),
      quote: JSON.stringify({}),
      // Diagonal from (59,69) to (60,70): through the vertex at (59.5, 69.5).
      path: JSON.stringify([cell(59, 69), cell(60, 70)]),
      workerCount: 1,
      startedAt: new Date(),
      completesAt: new Date(Date.now() + 86400000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  try {
    const engaged = await preview({ action: 'place', accessory: 'brazier', anchors: [vertex(60, 70), vertex(62, 70)] });
    expect(engaged.result).toMatchObject({
      placed: 1,
      stone: 2,
      wood: 1,
      skipped: [{ vertexX: 60, vertexY: 70, code: 'ENGAGED_PASSAGE' }],
    });
    // Every anchor engaged: refusal with the first code, no write.
    const before = await state();
    const refused = await post('/road-anchors', {
      commandId: randomUUID(),
      action: 'place',
      accessory: 'brazier',
      anchors: [vertex(60, 70)],
      expectedQuote: { stone: 0, wood: 0 },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('ENGAGED_PASSAGE');
    expect(await state()).toEqual(before);
    const allMissing = await preview({
      action: 'place',
      accessory: 'brazier',
      anchors: [vertex(40, 40), vertex(60, 70)],
    });
    expect(allMissing).toMatchObject({
      valid: false,
      code: 'ANCHOR_MISSING',
      result: {
        skipped: [
          { vertexX: 40, vertexY: 40, code: 'ANCHOR_MISSING' },
          { vertexX: 60, vertexY: 70, code: 'ENGAGED_PASSAGE' },
        ],
      },
    });
  } finally {
    await db.deleteFrom('levelingJobs').where('id', '=', job.id).execute();
  }
  // Resources: one stone short.
  await db
    .updateTable('villageResources')
    .set({ amount: '1' })
    .where('villageId', '=', ids.village)
    .where('resourceCode', '=', 'stone')
    .execute();
  try {
    const before = await state();
    const poor = await post('/road-anchors', { ...accepted, commandId: randomUUID(), anchors: [vertex(62, 70)] });
    expect(poor.statusCode).toBe(409);
    expect(poor.body).toContain('INSUFFICIENT_RESOURCES');
    expect(await state()).toEqual(before);
  } finally {
    await db
      .updateTable('villageResources')
      .set({ amount: '2000' })
      .where('villageId', '=', ids.village)
      .where('resourceCode', '=', 'stone')
      .execute();
  }
}, 60000);

it('rolls back anchors, debit and receipt when the transaction fails after writing them', async () => {
  await roads(ids.village, ids.account, 'place', [cell(60, 74)]);
  const before = await state();
  let inside: { anchors: number; stone: string; wood: string } | undefined;
  roadAnchorsTestHooks.afterWrites = async (tx) => {
    const amount = async (code: string) =>
      (
        await tx
          .selectFrom('villageResources')
          .select('amount')
          .where('villageId', '=', ids.village)
          .where('resourceCode', '=', code)
          .executeTakeFirstOrThrow()
      ).amount;
    inside = {
      anchors: (
        await tx
          .selectFrom('roadAnchors')
          .select('vertexX')
          .where('worldId', '=', ids.world)
          .where('vertexY', 'in', [74, 75])
          .execute()
      ).length,
      stone: await amount('stone'),
      wood: await amount('wood'),
    };
    throw new Error('injected road anchors failure');
  };
  await expect(
    roadAnchorsCommandV2(
      db,
      ids.account,
      slug,
      ids.village,
      {
        commandId: randomUUID(),
        action: 'place',
        accessory: 'brazier',
        anchors: [vertex(60, 74), vertex(61, 75)],
        expectedQuote: { stone: 4, wood: 2 },
      },
      4,
    ),
  ).rejects.toThrow('injected road anchors failure');
  // The writes did happen before the injected error...
  expect(inside).toEqual({ anchors: 2, stone: String(before.stone - 4), wood: String(before.wood - 2) });
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
const brazier = (anchors: Array<{ vertexX: number; vertexY: number }>, stone: number) => ({
  commandId: randomUUID(),
  action: 'place' as const,
  accessory: 'brazier' as const,
  anchors,
  expectedQuote: { stone, wood: stone / 2 },
});

it('serializes an accessory and the removal of its road: the accessory first, then it leaves with the road', async () => {
  await roads(ids.village, ids.account, 'place', [cell(56, 60)]);
  const gate = barrier();
  roadAnchorsTestHooks.afterWrites = gate.wait;
  const placing = roadAnchorsCommandV2(db, ids.account, slug, ids.village, brazier([vertex(56, 60)], 2), 4);
  const settled = placing.catch((error) => error);
  try {
    await gate.arrived;
    delete roadAnchorsTestHooks.afterWrites;
    const removal = roads(ids.village, ids.account, 'remove', [cell(56, 60)]).catch((error) => error);
    await lockWaiter();
    gate.release();
    const [placed, removed] = await Promise.all([settled, removal]);
    expect(placed).toMatchObject({ status: 'applied', result: { placed: 1 } });
    expect(removed).toMatchObject({ status: 'applied', result: { removed: 1 } });
    expect((await anchors()).some((a) => a.vertexX === 56 && a.vertexY === 60)).toBe(false);
  } finally {
    gate.release();
    await settled;
  }
}, 60000);

it('serializes the removal of a road and an accessory on its anchor: the removal first, the accessory refused', async () => {
  await roads(ids.village, ids.account, 'place', [cell(52, 60)]);
  const gate = barrier();
  roadCellsTestHooks.afterWrites = gate.wait;
  const removal = roads(ids.village, ids.account, 'remove', [cell(52, 60)]);
  const settled = removal.catch((error) => error);
  try {
    await gate.arrived;
    delete roadCellsTestHooks.afterWrites;
    const before = await state();
    const placing = roadAnchorsCommandV2(db, ids.account, slug, ids.village, brazier([vertex(52, 60)], 2), 4).catch(
      (error: { code?: string }) => error,
    );
    await lockWaiter();
    gate.release();
    const [removed, placed] = await Promise.all([settled, placing]);
    expect(removed).toMatchObject({ status: 'applied', result: { removed: 1 } });
    expect(placed).toMatchObject({ code: 'ANCHOR_MISSING' });
    const after = await state();
    expect([after.anchors, after.stone, after.wood, after.receipts]).toEqual([
      before.anchors,
      before.stone,
      before.wood,
      before.receipts,
    ]);
  } finally {
    gate.release();
    await settled;
  }
}, 60000);
