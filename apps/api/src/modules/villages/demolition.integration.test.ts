import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Value } from '@sinclair/typebox/value';
import {
  applySyncV2Batch,
  DemolitionConfirmationV2Schema,
  visibleSyncV2Scope,
  type DemolitionConfirmationV2,
  type DemolitionRequest,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { buildApp } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';
import { captureSyncV2 } from './sync-v2-capture.js';
import { demolitionCommandV2, demolitionTestHooks } from './demolition.js';
import { roadCellsCommandV2 } from './road-cells.js';
import { commandProcessingV2 } from './processing-v2.js';
import { upgradeBuilding } from './service.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected demolition test database');
const db = createDatabase(url);
const ids = {
    world: randomUUID(),
    village: randomUUID(),
    account: randomUUID(),
    neighbour: randomUUID(),
    neighbourAccount: randomUUID(),
  },
  slug = 'demolition-' + ids.world,
  token = randomUUID();
const root = `/api/worlds/${slug}/villages/${ids.village}`;
const halls: Record<string, string> = {};
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
        name: 'Demolition ' + villageId.slice(0, 4),
        anchorCellX,
        anchorCellY,
        economyActivatedAt: now,
      })
      .execute();
    halls[villageId] = (
      await tx
        .insertInto('buildings')
        .values({
          worldId: ids.world,
          villageId,
          buildingType: 'town-hall',
          level: 1,
          status: 'completed',
          completedAt: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await tx
      .insertInto('worldCellOccupancies')
      .values({
        worldId: ids.world,
        cellX: anchorCellX,
        cellY: anchorCellY,
        buildingId: halls[villageId]!,
        role: 'anchor',
      })
      .execute();
    const resources = await tx.selectFrom('resourceTypes').select('code').execute();
    await tx
      .insertInto('villageResources')
      .values(resources.map((r) => ({ worldId: ids.world, villageId, resourceCode: r.code, amount: 2000 })))
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
      .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ baseRatePerHour: 0 }))
      .execute();
    await tx
      .insertInto('villagePopulations')
      .values({ worldId: ids.world, villageId, growthStartedAt: now, nextArrivalAt: null })
      .onConflict((c) => c.columns(['worldId', 'villageId']).doUpdateSet({ nextArrivalAt: null }))
      .execute();
    await tx
      .insertInto('playerScience')
      .values({ worldId: ids.world, accountId, observationsSince: null, solarReport: null })
      .onConflict((c) => c.doNothing())
      .execute();
  });
}

beforeAll(async () => {
  await migrateToLatest(url);
  const now = new Date();
  for (const account of [ids.account, ids.neighbourAccount])
    await db
      .insertInto('accounts')
      .values({ id: account, email: account + '@demolition.test', passwordHash: 'fixture' })
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
      name: 'Demolition',
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
  await settle(ids.neighbour, 80, 64, ids.neighbourAccount);
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
  delete demolitionTestHooks.afterLock;
  delete demolitionTestHooks.afterWrites;
});
afterAll(async () => {
  await app?.close();
  await db.deleteFrom('worlds').where('id', '=', ids.world).execute();
  await db.deleteFrom('accounts').where('id', 'in', [ids.account, ids.neighbourAccount]).execute();
  await db.destroy();
}, 30000);

const headers = { 'x-arbestra-protocol': '2', 'x-arbestra-generation': '4' };
const demolish = (payload: object) =>
  app.inject({ method: 'POST', url: root + '/demolitions', cookies: { session: token }, headers, payload });
const designation = (targets: Partial<Omit<DemolitionRequest, 'commandId'>>): DemolitionRequest => ({
  commandId: randomUUID(),
  buildings: [],
  gardenCells: [],
  roadCells: [],
  braziers: [],
  ...targets,
});
const row = (cellX: number, cellY: number) => ({ cellX, cellY });
/** Cleanup between cases, directly: a failure surfaces with its own error. */
const clear = (targets: Parameters<typeof designation>[0]) =>
  demolitionCommandV2(db, ids.account, slug, ids.village, designation(targets), 4);

/** A completed building of the village on one cell (or several for a garden row). */
async function building(buildingType: string, cells: Array<{ cellX: number; cellY: number }>, villageId = ids.village) {
  const now = new Date();
  const id = (
    await db
      .insertInto('buildings')
      .values({ worldId: ids.world, villageId, buildingType, level: 1, status: 'completed', completedAt: now })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  for (const [i, c] of cells.entries()) {
    await db
      .insertInto('worldCellOccupancies')
      .values({ worldId: ids.world, ...c, buildingId: id, role: i === 0 ? 'anchor' : 'extension' })
      .execute();
    if (buildingType === 'garden')
      await db
        .insertInto('gardenPlots')
        .values({
          worldId: ids.world,
          villageId,
          buildingId: id,
          ...c,
          storedAmount: 3,
          remainder: 0,
          productionUpdatedAt: now,
        })
        .execute();
  }
  return id;
}
/** Inhabitants of the village: one group per call. */
async function cohort(values: Record<string, unknown>) {
  return (
    await db
      .insertInto('populationCohorts')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        originVillageId: ids.village,
        memberCount: 2,
        activity: 'idle',
        energy: 10,
        energyProgress: 0,
        energyUpdatedAt: new Date(),
        restingSince: null,
        foodUsedSinceRest: 0,
        harvestId: null,
        extractionId: null,
        ...values,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
}
const cohorts = () =>
  db
    .selectFrom('populationCohorts')
    .select([
      'id',
      'memberCount',
      'activity',
      'restBuildingId',
      'processingLotId',
      'scienceActivityId',
      'harvestId',
      'cartographer',
    ])
    .where('worldId', '=', ids.world)
    .where('villageId', '=', ids.village)
    .orderBy('id')
    .execute();
const occupancies = () =>
  db
    .selectFrom('worldCellOccupancies')
    .select(['cellX', 'cellY', 'buildingId', 'role'])
    .where('worldId', '=', ids.world)
    .orderBy('cellX')
    .orderBy('cellY')
    .execute();
const streams = async () =>
  (
    await sql<{ kind: string; key: string; revision: string }>`select stream_kind as kind,scope_key as key,
      revision::text from game_sync_streams where world_id=${ids.world} order by stream_kind,scope_key`.execute(db)
  ).rows;
/** Everything a refused or rolled back command must leave untouched. */
const state = async () => ({
  buildings: await db
    .selectFrom('buildings')
    .select(['id', 'buildingType', 'level'])
    .where('worldId', '=', ids.world)
    .orderBy('id')
    .execute(),
  occupancies: await occupancies(),
  plots: await db
    .selectFrom('gardenPlots')
    .select(['cellX', 'cellY', 'buildingId'])
    .where('worldId', '=', ids.world)
    .orderBy('cellX')
    .orderBy('cellY')
    .execute(),
  roads: await db
    .selectFrom('roadCells')
    .select(['villageId', 'cellX', 'cellY'])
    .where('worldId', '=', ids.world)
    .orderBy('cellX')
    .orderBy('cellY')
    .execute(),
  anchors: await db
    .selectFrom('roadAnchors')
    .select(['vertexX', 'vertexY', 'accessory'])
    .where('worldId', '=', ids.world)
    .orderBy('vertexX')
    .orderBy('vertexY')
    .execute(),
  cohorts: await cohorts(),
  science: await db.selectFrom('scienceActivities').select(['id', 'status']).where('worldId', '=', ids.world).execute(),
  receipts: (await db.selectFrom('demolitionReceipts').select('commandId').where('worldId', '=', ids.world).execute())
    .length,
  streams: await streams(),
});
const placeRoads = async (
  cells: Array<{ cellX: number; cellY: number }>,
  villageId = ids.village,
  accountId = ids.account,
) =>
  roadCellsCommandV2(
    db,
    accountId,
    slug,
    villageId,
    {
      commandId: randomUUID(),
      action: 'place',
      cells,
      style: { surface: 'earth', sidewalks: false },
      expectedQuote: { stone: 0 },
    },
    4,
  );
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
const clearPopulation = () => db.deleteFrom('populationCohorts').where('worldId', '=', ids.world).execute();

it('demolishes at once: buildings, roads and a brazier; releases workers, rehouses sleepers, publishes and replays', async () => {
  await clearPopulation();
  const dwelling = await building('dwelling', [row(66, 64)]);
  const sawmill = await building('sawmill', [row(67, 64)]);
  const university = await building('university', [row(68, 64)]);
  const sleepers = await cohort({ activity: 'resting', energy: 2, restingSince: new Date(), restBuildingId: dwelling });
  await cohort({ memberCount: 4 });
  const started = await commandProcessingV2(
    db,
    ids.account,
    slug,
    ids.village,
    { commandId: randomUUID(), action: 'start', buildingId: sawmill, lots: 2, workerCount: 1 },
    4,
  );
  expect(started.result.orderId).toBeTruthy();
  const now = new Date();
  const training = (
    await db
      .insertInto('scienceActivities')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        accountId: ids.account,
        buildingId: university,
        programCode: null,
        kind: 'training',
        status: 'in-progress',
        workMs: 0,
        workerCount: 2,
        startedAt: now,
        completesAt: new Date(now.getTime() + 3600000),
        pathCells: JSON.stringify([]) as never,
        surveyCells: JSON.stringify([]) as never,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  const trainees = await cohort({ activity: 'working', scienceActivityId: training });
  // A 2 × 2 block of road cells and a manual brazier on its outer corner.
  await placeRoads([row(66, 70), row(67, 70), row(66, 71), row(67, 71)]);
  await db
    .insertInto('roadAnchors')
    .values({ worldId: ids.world, villageId: ids.village, vertexX: 66, vertexY: 70, accessory: 'brazier' })
    .execute();
  const lotWorkers = (await cohorts()).filter((c) => c.processingLotId);
  expect(lotWorkers.map((c) => c.memberCount)).toEqual([1]);
  const base = await v2Base();

  const command = designation({
    buildings: [{ id: dwelling }, { id: sawmill }, { id: university }],
    roadCells: [row(67, 71), row(90, 90)],
    // The inner vertex becomes an automatic corner once (67, 71) leaves: the
    // sweep suppresses it too (decision 5); the outer corner keeps a manual brazier.
    braziers: [
      { vertexX: 67, vertexY: 71 },
      { vertexX: 66, vertexY: 70 },
    ],
  });
  const response = await demolish(command);
  expect(response.statusCode, response.body).toBe(200);
  const confirmation = response.json<DemolitionConfirmationV2>();
  expect(Value.Check(DemolitionConfirmationV2Schema, confirmation)).toBe(true);
  expect(confirmation.result).toEqual({ buildings: 3, gardenCells: 0, roadCells: 1, braziers: 2, unchanged: 1 });

  const after = await state();
  expect(after.buildings.map((b) => b.id).sort()).toEqual([halls[ids.village]!, halls[ids.neighbour]!].sort());
  expect(after.occupancies.map((o) => [o.cellX, o.cellY])).toEqual([
    [64, 64],
    [80, 64],
  ]);
  expect(after.roads.map((r) => [r.cellX, r.cellY])).toEqual([
    [66, 70],
    [66, 71],
    [67, 70],
  ]);
  // Manual brazier gone; the new automatic corner suppressed.
  expect(after.anchors).toEqual([{ vertexX: 67, vertexY: 71, accessory: 'none' }]);
  expect(after.science).toEqual([]);
  expect(await db.selectFrom('processingOrders').select('id').where('worldId', '=', ids.world).execute()).toEqual([]);
  // Nobody keeps an assignment; the training granted nothing; the sleepers
  // sleep at the town hall, the only bed left.
  for (const c of after.cohorts) {
    expect(c.processingLotId).toBeNull();
    expect(c.scienceActivityId).toBeNull();
    expect(c.cartographer).toBe(false);
  }
  expect(after.cohorts.find((c) => c.id === sleepers)).toMatchObject({
    activity: 'resting',
    restBuildingId: halls[ids.village],
  });
  expect(after.cohorts.find((c) => c.id === trainees)?.activity).not.toBe('working');
  expect(after.cohorts.reduce((n, c) => n + c.memberCount, 0)).toBe(8);

  // The effects remove the buildings and the road cell from the client state.
  const applied = applySyncV2Batch(base, confirmation.effects!);
  expect(applied.kind).toBe('applied');
  const visible = visibleSyncV2Scope(applied.state.scopes.get(`village:${ids.village}`)!);
  for (const id of [dwelling, sawmill, university]) expect(visible.has(`buildings:${id}`)).toBe(false);
  expect(visible.has('roadCells:67,71')).toBe(false);
  expect(visible.has('roadCells:66,70')).toBe(true);

  // An exact replay answers from the receipt without writing or publishing.
  const before = await state();
  const replay = await demolish(command);
  expect(replay.statusCode, replay.body).toBe(200);
  expect(replay.json()).toEqual({ ...confirmation, effects: undefined });
  expect(await state()).toEqual(before);
  const reused = await demolish({ ...command, roadCells: [row(66, 70)] });
  expect(reused.statusCode).toBe(409);
  expect(reused.json()).toMatchObject({ code: 'COMMAND_REUSED' });
  // Clean the road block for the following cases.
  await clear({ roadCells: [row(66, 70), row(67, 70), row(66, 71)] });
}, 60000);

it('refuses without writing: town hall, garden by id, foreign garden cell, foreign road, empty designation', async () => {
  const garden = await building('garden', [row(70, 66)]);
  const foreignGarden = await building('garden', [row(82, 66)], ids.neighbour);
  await placeRoads([row(82, 70)], ids.neighbour, ids.neighbourAccount);
  const before = await state();
  for (const [targets, code] of [
    [{ buildings: [{ id: halls[ids.village]! }] }, 'TOWN_HALL'],
    [{ buildings: [{ id: garden }] }, 'GARDEN_BY_CELL'],
    [{ gardenCells: [row(70, 66), row(82, 66)] }, 'FOREIGN_INFRASTRUCTURE'],
    [{ roadCells: [row(82, 70)] }, 'FOREIGN_INFRASTRUCTURE'],
    [{}, 'EMPTY_DEMOLITION'],
  ] satisfies Array<[Partial<Omit<DemolitionRequest, 'commandId'>>, string]>) {
    const response = await demolish(designation(targets));
    expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400);
    expect(response.json()).toMatchObject({ code });
  }
  expect(await state()).toEqual(before);
  // A building of another village named by id is simply not found here.
  const response = await demolish(designation({ buildings: [{ id: foreignGarden }] }));
  expect(response.json()).toMatchObject({ result: { buildings: 0, unchanged: 1 } });
  await clear({ gardenCells: [row(70, 66)] });
}, 60000);

it('removes only the touched cells of a merged garden, moves a lost anchor, and stops the harvest through them', async () => {
  await clearPopulation();
  // Row A: (72,66) anchor, (73,66) extension; row B: (74,66), merged with A.
  const a = await building('garden', [row(72, 66), row(73, 66)]);
  const b = await building('garden', [row(74, 66)]);
  const now = new Date();
  const harvest = (
    await db
      .insertInto('gardenHarvests')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        buildingId: b,
        commandId: randomUUID(),
        status: 'in-progress',
        startedAt: now,
        completesAt: new Date(now.getTime() + 600000),
        workerCount: 2,
        reservedCarrots: 4,
        stops: JSON.stringify([
          { cellX: 74, cellY: 66, path: [], arrivesAfterMs: 0, workEndsAfterMs: 1000, reservedCarrots: 2 },
          { cellX: 72, cellY: 66, path: [], arrivesAfterMs: 0, workEndsAfterMs: 1000, reservedCarrots: 2 },
        ]) as never,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  const harvesters = await cohort({ activity: 'working', harvestId: harvest });
  const response = await demolish(designation({ gardenCells: [row(72, 66), row(74, 66)] }));
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json<DemolitionConfirmationV2>().result).toEqual({
    buildings: 0,
    gardenCells: 2,
    roadCells: 0,
    braziers: 0,
    unchanged: 0,
  });
  const after = await state();
  // Row A keeps (73,66), now its anchor; row B, left without a cell, is gone.
  expect(after.buildings.some((x) => x.id === b)).toBe(false);
  expect(after.buildings.some((x) => x.id === a)).toBe(true);
  expect(after.occupancies.filter((o) => o.buildingId === a)).toEqual([
    { cellX: 73, cellY: 66, buildingId: a, role: 'anchor' },
  ]);
  expect(after.plots.filter((p) => p.buildingId === a).map((p) => [p.cellX, p.cellY])).toEqual([[73, 66]]);
  expect(await db.selectFrom('gardenHarvests').select('id').where('id', '=', harvest).execute()).toEqual([]);
  expect(after.cohorts.find((c) => c.id === harvesters)).toMatchObject({ harvestId: null });
  expect(after.cohorts.find((c) => c.id === harvesters)?.activity).not.toBe('working');
  await clear({ gardenCells: [row(73, 66)] });
}, 60000);

it('rolls back every deletion and release when the transaction fails after writing them', async () => {
  await clearPopulation();
  const dwelling = await building('dwelling', [row(66, 68)]);
  await cohort({ activity: 'resting', energy: 2, restingSince: new Date(), restBuildingId: dwelling });
  await building('garden', [row(70, 68), row(71, 68)]);
  await placeRoads([row(66, 74)]);
  const before = await state();
  let inside: { buildings: number; roads: number; plots: number; beds: number } | undefined;
  demolitionTestHooks.afterWrites = async (tx) => {
    const count = async (table: 'buildings' | 'roadCells' | 'gardenPlots') =>
      (await tx.selectFrom(table).select('worldId').where('worldId', '=', ids.world).execute()).length;
    inside = {
      buildings: await count('buildings'),
      roads: await count('roadCells'),
      plots: await count('gardenPlots'),
      beds: (
        await tx
          .selectFrom('populationCohorts')
          .select('id')
          .where('worldId', '=', ids.world)
          .where('restBuildingId', '=', dwelling)
          .execute()
      ).length,
    };
    throw new Error('injected demolition failure');
  };
  await expect(
    demolitionCommandV2(
      db,
      ids.account,
      slug,
      ids.village,
      designation({ buildings: [{ id: dwelling }], gardenCells: [row(70, 68)], roadCells: [row(66, 74)] }),
      4,
    ),
  ).rejects.toThrow('injected demolition failure');
  // The deletions did happen before the injected error...
  expect(inside).toEqual({
    buildings: before.buildings.length - 1,
    roads: before.roads.length - 1,
    plots: before.plots.length - 1,
    beds: 0,
  });
  // ...and none survives it.
  expect(await state()).toEqual(before);
  delete demolitionTestHooks.afterWrites;
  await clear({ buildings: [{ id: dwelling }], gardenCells: [row(70, 68), row(71, 68)], roadCells: [row(66, 74)] });
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

it('serializes a demolition and an upgrade of the same building: demolition first, the upgrade finds nothing', async () => {
  const dwelling = await building('dwelling', [row(68, 68)]);
  const gate = barrier();
  demolitionTestHooks.afterWrites = gate.wait;
  const demolition = demolitionCommandV2(
    db,
    ids.account,
    slug,
    ids.village,
    designation({ buildings: [{ id: dwelling }] }),
    4,
  );
  const settledDemolition = demolition.catch((error) => error);
  try {
    await gate.arrived;
    delete demolitionTestHooks.afterWrites;
    const upgrade = upgradeBuilding(db, ids.account, slug, ids.village, dwelling, undefined, undefined, 1000).catch(
      (error: { code?: string; statusCode?: number }) => error,
    );
    await lockWaiter();
    gate.release();
    const [demolished, upgraded] = await Promise.all([settledDemolition, upgrade]);
    expect(demolished).toMatchObject({ status: 'applied', result: { buildings: 1 } });
    expect(upgraded).toMatchObject({ statusCode: 404 });
    expect(await db.selectFrom('buildings').select('id').where('id', '=', dwelling).execute()).toEqual([]);
  } finally {
    gate.release();
    await settledDemolition;
  }
}, 60000);

it('serializes an upgrade and a demolition of the same building: the upgrade first, then the site is demolished', async () => {
  const dwelling = await building('dwelling', [row(69, 68)]);
  const gate = barrier();
  const upgrade = upgradeBuilding(
    db,
    ids.account,
    slug,
    ids.village,
    dwelling,
    undefined,
    undefined,
    1000,
    undefined,
    undefined,
    undefined,
    'commit',
    gate.wait,
  ).catch((error) => error);
  try {
    await gate.arrived;
    const demolition = demolitionCommandV2(
      db,
      ids.account,
      slug,
      ids.village,
      designation({ buildings: [{ id: dwelling }] }),
      4,
    ).catch((error) => error);
    await lockWaiter();
    gate.release();
    const [upgraded, demolished] = await Promise.all([upgrade, demolition]);
    expect(upgraded).not.toBeInstanceOf(Error);
    expect(demolished).toMatchObject({ status: 'applied', result: { buildings: 1 } });
    expect(await db.selectFrom('buildings').select('id').where('id', '=', dwelling).execute()).toEqual([]);
    // The upgrade debit stays spent: no refund.
  } finally {
    gate.release();
    await upgrade;
  }
}, 60000);
