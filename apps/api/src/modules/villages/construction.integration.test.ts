import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { CamelCasePlugin, Kysely, PostgresDialect, sql, type KyselyPlugin } from 'kysely';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../../database/schema.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { buildApp } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';
import { constructionConfirmationIsValid, emptyInfrastructure } from '@arbestra/contracts';
import { RC1_CANONICAL_CHECKSUM } from '../onboarding/spawn-map.js';
import { clearWoodland } from '../deposits/woodland.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected construction test DB');
const statements: string[] = [];
const errors: Error[] = [];
let capture = false;
let afterWrite: ((rows: readonly unknown[]) => void) | undefined;
const writes = new WeakSet<object>();
const fault: KyselyPlugin = {
  transformQuery(args) {
    if (args.node.kind === 'RawNode' && JSON.stringify(args.node).includes('paid as (update village_resources'))
      writes.add(args.queryId);
    return args.node;
  },
  async transformResult(args) {
    if (writes.has(args.queryId)) afterWrite?.(args.result.rows);
    return args.result;
  },
};
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }),
  plugins: [new CamelCasePlugin(), fault],
  log: (event) => {
    if (capture && event.level === 'query') statements.push(event.query.sql);
  },
});
const accountId = randomUUID(),
  otherAccountId = randomUUID(),
  token = randomUUID();
let app: FastifyInstance,
  worldId = randomUUID(),
  villageId = randomUUID(),
  hallId = randomUUID(),
  dueId = randomUUID(),
  slug = '';
const payload = (x = 66, y = 64) => ({
  commandId: randomUUID(),
  buildingType: 'dwelling',
  houseVariant: 'logs',
  quarterTurns: 0,
  anchorCellX: x,
  anchorCellY: y,
  cells: [{ cellX: x, cellY: y }],
  expectedCosts: [{ resourceCode: 'wood', amount: 25 }],
});
const post = (body: object, id = villageId) =>
  app.inject({
    method: 'POST',
    url: `/api/worlds/${slug}/villages/${id}/buildings`,
    cookies: { arbestra_session: token },
    headers: { 'x-village-sync': '1', 'x-construction-confirmation': '1' },
    payload: body,
  });
async function cleanup() {
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  // A wood case refers to its feature without cascade; its trees follow it.
  await db.deleteFrom('woodlandDeposits').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
}
beforeAll(async () => {
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@bounded-construction.test', passwordHash: 'fixture' })
    .execute();
  await db
    .insertInto('accounts')
    .values({ id: otherAccountId, email: otherAccountId + '@bounded-construction.test', passwordHash: 'fixture' })
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
  app.addHook('onError', async (_request, _reply, error) => {
    errors.push(error);
  });
  await app.ready();
}, 120000);
beforeEach(async () => {
  capture = false;
  afterWrite = undefined;
  errors.length = 0;
  await cleanup();
  worldId = randomUUID();
  villageId = randomUUID();
  hallId = randomUUID();
  dueId = randomUUID();
  slug = 'bounded-' + worldId;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('worlds')
      .values({
        id: worldId,
        slug,
        name: 'Bounded construction',
        topology: 'torus',
        widthCells: 512,
        heightCells: 256,
        chunkSize: 32,
        seed: 4109,
        generationVersion: 1,
        generationStatus: 'ready',
        isOpen: true,
        generatedAt: new Date(),
      })
      .execute();
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Construction' }).execute();
    await tx
      .insertInto('villages')
      .values({
        id: villageId,
        worldId,
        ownerAccountId: accountId,
        name: 'Construction',
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
    for (const resourceCode of ['wood', 'carrot', 'stone'])
      await tx.insertInto('villageResources').values({ worldId, villageId, resourceCode, amount: 2000 }).execute();
    await tx
      .insertInto('villageResourceFlows')
      .values({
        worldId,
        villageId,
        resourceCode: 'wood',
        baseRatePerHour: 0,
        remainder: 0,
        productionUpdatedAt: new Date(),
      })
      .execute();
    await tx
      .insertInto('buildings')
      .values([
        {
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
        },
        {
          id: dueId,
          worldId,
          villageId,
          buildingType: 'dwelling',
          level: 1,
          targetLevel: null,
          status: 'under-construction',
          constructionStartedAt: new Date(Date.now() - 2000),
          constructionCompletesAt: new Date(Date.now() - 1000),
          completedAt: null,
        },
      ])
      .execute();
    for (const [buildingId, cellX] of [
      [hallId, 64],
      [dueId, 65],
    ] as const)
      await tx
        .insertInto('worldCellOccupancies')
        .values({ worldId, buildingId, cellX, cellY: 64, featureId: null, role: 'anchor' })
        .execute();
  });
});
afterAll(async () => {
  capture = false;
  await app?.close();
  await cleanup();
  await db.deleteFrom('accounts').where('id', 'in', [accountId, otherAccountId]).execute();
  await db.destroy();
}, 60000);

it('creates only the requested building and debit, without reconciling unrelated due work or projecting the village', async () => {
  const before = await db.selectFrom('buildings').selectAll().where('id', '=', dueId).executeTakeFirstOrThrow();
  statements.length = 0;
  capture = true;
  const response = await post(payload());
  capture = false;
  expect(response.statusCode, errors.at(-1)?.stack ?? response.body).toBe(201);
  const ack = response.json();
  expect(constructionConfirmationIsValid(ack)).toBe(true);
  expect(await db.selectFrom('buildings').selectAll().where('id', '=', dueId).executeTakeFirstOrThrow()).toEqual(
    before,
  );
  expect(ack.cells).toHaveLength(1);
  expect(ack.cells[0]).toMatchObject({
    cellX: 66,
    cellY: 64,
    canBuild: false,
    building: { type: 'dwelling', status: 'under-construction' },
  });
  expect(ack.commandTime).toBe(ack.cells[0].building.constructionStartedAt);
  expect(ack.serverTime).toBe(ack.commandTime);
  expect(ack.resources.find((r: { code: string }) => r.code === 'wood').amount).toBe(1975);
  expect(await db.selectFrom('scheduledTasks').select('id').where('worldId', '=', worldId).execute()).toHaveLength(1);
  expect(statements.filter((q) => !/^\s*(begin|commit|start transaction|set transaction)/i.test(q))).toHaveLength(5);
  expect(statements.join('\n')).not.toMatch(
    /reconcile|science_programs|population_cohorts|processing_orders|exploitation_orders/i,
  );
});

it('protects nearby equipment and sparse engaged paths without advancing their missions', async () => {
  const plan = {
    ...emptyInfrastructure(),
    equipment: [{ id: randomUUID(), x: 66 * 8, y: 64 * 8, quarterTurns: 0, version: 1 }],
  };
  await db
    .insertInto('villageInfrastructure')
    .values({ worldId, villageId, plan: JSON.stringify(plan) })
    .execute();
  expect((await post(payload())).json().code).toBe('INFRASTRUCTURE_OCCUPIED');
  await db.deleteFrom('villageInfrastructure').where('worldId', '=', worldId).execute();
  await db
    .insertInto('gardenHarvests')
    .values({
      worldId,
      villageId,
      buildingId: hallId,
      commandId: randomUUID(),
      status: 'in-progress',
      workerCount: 1,
      reservedCarrots: 1,
      startedAt: new Date(Date.now() - 2000),
      completesAt: new Date(Date.now() - 1000),
      completedAt: null,
      pathCells: sql`${JSON.stringify([
        { cellX: 60, cellY: 64 },
        { cellX: 72, cellY: 64 },
      ])}::jsonb`,
    })
    .execute();
  const before = await db.selectFrom('gardenHarvests').selectAll().where('worldId', '=', worldId).execute();
  expect((await post(payload())).json().code, errors.at(-1)?.stack).toBe('ENGAGED_PASSAGE');
  expect((await post(payload(66, 66))).statusCode, errors.at(-1)?.stack).toBe(201);
  expect(await db.selectFrom('gardenHarvests').selectAll().where('worldId', '=', worldId).execute()).toEqual(before);
  expect(await wood()).toBe(1975);
});

it('protects a sparse engaged path across the torus seam', async () => {
  await db.updateTable('villages').set({ anchorCellX: 0, anchorCellY: 0 }).where('id', '=', villageId).execute();
  await db.updateTable('worldCellOccupancies').set({ cellX: 0, cellY: 0 }).where('buildingId', '=', hallId).execute();
  await db
    .insertInto('gardenHarvests')
    .values({
      worldId,
      villageId,
      buildingId: hallId,
      commandId: randomUUID(),
      status: 'in-progress',
      workerCount: 1,
      reservedCarrots: 1,
      startedAt: new Date(),
      completesAt: new Date(Date.now() + 600000),
      completedAt: null,
      pathCells: sql`${JSON.stringify([
        { cellX: 509, cellY: 0 },
        { cellX: 3, cellY: 0 },
      ])}::jsonb`,
    })
    .execute();
  expect((await post(payload(-1, 0))).json().code, errors.at(-1)?.stack).toBe('ENGAGED_PASSAGE');
  expect(await wood()).toBe(2000);
});

const wood = async () =>
  Number(
    (
      await db
        .selectFrom('villageResources')
        .select('amount')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('resourceCode', '=', 'wood')
        .executeTakeFirstOrThrow()
    ).amount,
  );
it('replays exactly once and rejects a reused identity with a different intention', async () => {
  const body = payload(),
    first = await post(body),
    second = await post(body);
  expect(first.statusCode, errors.at(-1)?.message).toBe(201);
  expect(second.statusCode, errors.at(-1)?.message).toBe(201);
  expect(first.json().cells[0].building.id).toBe(second.json().cells[0].building.id);
  expect(await wood()).toBe(1975);
  const conflict = await post({ ...body, ...{ anchorCellX: 67, cells: [{ cellX: 67, cellY: 64 }] } });
  expect(conflict.json().code).toBe('COMMAND_ID_CONFLICT');
  expect(await wood()).toBe(1975);
  expect(
    await db.selectFrom('buildingCommandReceipts').select('commandId').where('worldId', '=', worldId).execute(),
  ).toHaveLength(1);
  expect(await db.selectFrom('scheduledTasks').select('id').where('worldId', '=', worldId).execute()).toHaveLength(1);
  await db
    .updateTable('buildings')
    .set({ targetLevel: 2 })
    .where('id', '=', first.json().cells[0].building.id)
    .execute();
  const upgrading = await post(body);
  expect(upgrading.json().cells[0].footprint.state).toBe('active');
  expect(await wood()).toBe(1975);
});

it.each(['occupied', 'reach', 'water', 'stock', 'quote', 'foreign'] as const)(
  'rejects %s without debit, reservation, receipt or task',
  async (kind) => {
    let body = payload(),
      id = villageId;
    if (kind === 'occupied') body = payload(64);
    if (kind === 'reach') body = payload(90);
    if (kind === 'water')
      await db
        .updateTable('worldChunks')
        .set({ terrainCodes: Array(1024).fill(2) })
        .where('worldId', '=', worldId)
        .execute();
    if (kind === 'stock')
      await db
        .updateTable('villageResources')
        .set({ amount: 24 })
        .where('worldId', '=', worldId)
        .where('resourceCode', '=', 'wood')
        .execute();
    if (kind === 'quote') body.expectedCosts[0]!.amount = 1;
    if (kind === 'foreign') {
      await db
        .insertInto('worldMemberships')
        .values({ worldId, accountId: otherAccountId, playerName: 'Other owner' })
        .execute();
      id = randomUUID();
      await db
        .insertInto('villages')
        .values({
          id,
          worldId,
          ownerAccountId: otherAccountId,
          name: 'Other owner',
          anchorCellX: 100,
          anchorCellY: 100,
          economyActivatedAt: new Date(),
        })
        .execute();
    }
    const before = await wood(),
      response = await post(body, id);
    expect(response.statusCode, errors.at(-1)?.message).toBe(kind === 'foreign' ? 404 : 409);
    expect(response.json().code).toBe(
      {
        occupied: 'CELL_OCCUPIED',
        reach: 'OUTSIDE_VILLAGE_REACH',
        water: 'TERRAIN_NOT_BUILDABLE',
        stock: 'INSUFFICIENT_RESOURCES',
        quote: 'BUILDING_COST_CHANGED',
        foreign: 'VILLAGE_NOT_FOUND',
      }[kind],
    );
    expect(await wood()).toBe(before);
    for (const table of ['buildingCommandReceipts', 'scheduledTasks'] as const)
      expect(await db.selectFrom(table).selectAll().where('worldId', '=', worldId).execute()).toHaveLength(0);
    expect(await db.selectFrom('buildings').select('id').where('worldId', '=', worldId).execute()).toHaveLength(2);
  },
);

it('reserves a 25-cell garden in the same SQL budget and debits only its area', async () => {
  const cells = Array.from({ length: 25 }, (_, i) => ({ cellX: 66 + (i % 5), cellY: 66 + Math.floor(i / 5) }));
  const body = {
    ...payload(66, 66),
    buildingType: 'garden',
    cells,
    expectedCosts: [{ resourceCode: 'wood', amount: 1250 }],
  };
  statements.length = 0;
  capture = true;
  const response = await post(body);
  capture = false;
  expect(response.statusCode, errors.at(-1)?.stack ?? response.body).toBe(201);
  expect(response.json().cells).toHaveLength(25);
  expect(await wood()).toBe(750);
  expect(response.json().cells.filter((c: { building: unknown }) => c.building)).toHaveLength(1);
  expect(
    await db.selectFrom('buildingResourceBuffers').select('buildingId').where('worldId', '=', worldId).execute(),
  ).toHaveLength(1);
  expect(statements.filter((q) => !/^\s*(begin|commit|start transaction|set transaction)/i.test(q))).toHaveLength(5);
  await db
    .updateTable('buildings')
    .set({ status: 'completed', completedAt: new Date() })
    .where('id', '=', response.json().cells[0].building.id)
    .execute();
  const retry = await post(body);
  expect(retry.statusCode).toBe(201);
  expect(retry.json().cells).toEqual([]);
  expect(await wood()).toBe(750); // Never reintroduce the physical anchor of a now-fusible garden.
});

it('canonicalizes a seam-crossing placement and keeps its retry idempotent', async () => {
  await db.updateTable('villages').set({ anchorCellX: 0, anchorCellY: 0 }).where('id', '=', villageId).execute();
  await db.updateTable('worldCellOccupancies').set({ cellX: 0, cellY: 0 }).where('buildingId', '=', hallId).execute();
  await db
    .insertInto('worldChunks')
    .values({
      worldId,
      chunkX: 15,
      chunkY: 0,
      generationVersion: 1,
      terrainCodes: Array(1024).fill(1),
      elevations: Array(1024).fill(0),
    })
    .execute();
  const body = payload(-1, 0),
    first = await post(body),
    second = await post({ ...body, anchorCellX: 511, cells: [{ cellX: 511, cellY: 0 }] });
  expect(first.statusCode, errors.at(-1)?.message).toBe(201);
  expect(second.statusCode).toBe(201);
  expect(second.json().cells[0]).toMatchObject({ cellX: 511, cellY: 0, x: -2.5, z: 0 });
  expect(await wood()).toBe(1975);
});

it.each(['same-command', 'same-cell', 'last-stock'] as const)(
  'serializes %s after an observed PostgreSQL wait and uses a post-lock clock',
  async (kind) => {
    if (kind === 'last-stock')
      await db
        .updateTable('villageResources')
        .set({ amount: 25 })
        .where('worldId', '=', worldId)
        .where('resourceCode', '=', 'wood')
        .execute();
    let unlock!: () => void, locked!: () => void;
    const gate = new Promise<void>((resolve) => {
        unlock = resolve;
      }),
      ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
    const holder = db.transaction().execute(async (tx) => {
      await sql`set local statement_timeout='20s'`.execute(tx);
      await tx.selectFrom('villages').select('id').where('id', '=', villageId).forUpdate().execute();
      locked();
      await gate;
    });
    await ready;
    const one = payload(),
      two = kind === 'same-command' ? one : payload(kind === 'last-stock' ? 67 : 66),
      requests = [post(one).then((r) => r), post(two).then((r) => r)];
    let releasedAt: Date | undefined;
    try {
      const deadline = Date.now() + 10000;
      let waiting = 0;
      do {
        waiting = (
          await sql<{
            n: number;
          }>`select count(*)::int as n from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()
      and state='active' and wait_event_type='Lock' and query like '%with owner as materialized%'`.execute(db)
        ).rows[0]!.n;
        if (waiting < 2) await delay(20);
      } while (waiting < 2 && Date.now() < deadline);
      expect(waiting).toBe(2);
      releasedAt = (await sql<{ at: Date }>`select statement_timestamp() as at`.execute(db)).rows[0]!.at;
    } finally {
      unlock();
      await holder;
      await Promise.allSettled(requests);
    }
    const responses = await Promise.all(requests);
    expect(responses.map((r) => r.statusCode).sort()).toEqual(kind === 'same-command' ? [201, 201] : [201, 409]);
    for (const r of responses.filter((r) => r.statusCode === 201))
      expect(Date.parse(r.json().commandTime)).toBeGreaterThanOrEqual(releasedAt!.getTime());
    expect(await wood()).toBe(kind === 'last-stock' ? 0 : 1975);
    expect(await db.selectFrom('scheduledTasks').select('id').where('worldId', '=', worldId).execute()).toHaveLength(1);
  },
);

it('rolls back all placement writes after an identified failure following observed debit and reservations', async () => {
  const stored = async () =>
    Promise.all(
      (
        [
          'buildings',
          'worldCellOccupancies',
          'villageResources',
          'villageResourceFlows',
          'buildingCommandReceipts',
          'scheduledTasks',
          'buildingResourceBuffers',
        ] as const
      ).map(async (table) =>
        JSON.stringify(await db.selectFrom(table).selectAll().where('worldId', '=', worldId).execute()),
      ),
    );
  const before = await stored(),
    injected = Error('construction rollback after observed writes');
  let observed = false;
  afterWrite = (rows) => {
    expect(rows[0]).toMatchObject({ debited: 1, reserved: 1 });
    observed = true;
    throw injected;
  };
  try {
    const response = await post(payload());
    expect(response.statusCode).toBe(500);
    expect(errors).toContain(injected);
    expect(observed).toBe(true);
  } finally {
    afterWrite = undefined;
  }
  expect(await stored()).toEqual(before);
});

it('validates only the selected RC1 vertices, rejects slopes, then creates with five warm SQL calls', async () => {
  const artifact = JSON.parse(readFileSync('apps/world-web/public/studies/t1-alpha512-rc1.json', 'utf8'));
  await db
    .updateTable('worlds')
    .set({ generationVersion: 3, terrainModel: 'vertices' })
    .where('id', '=', worldId)
    .execute();
  await db.updateTable('villages').set({ anchorCellX: 140, anchorCellY: 20 }).where('id', '=', villageId).execute();
  await db
    .updateTable('worldCellOccupancies')
    .set({ cellX: 140, cellY: 20 })
    .where('buildingId', '=', hallId)
    .execute();
  await db
    .insertInto('worldGenerationCandidates')
    .values({
      worldId,
      commandId: randomUUID(),
      ownerAccountId: accountId,
      parameters: artifact.geography.parameters,
      status: 'ready',
      checksum: RC1_CANONICAL_CHECKSUM,
      artifact,
    })
    .execute();
  for (const vertexX of [142, 143, 144])
    for (const vertexY of [20, 21])
      await db
        .insertInto('worldTerrainVertices')
        .values({ worldId, vertexX, vertexY, height: 50 + (vertexX === 142 && vertexY === 20 ? 1 : 0) })
        .execute();
  const blocked = await post(payload(142, 20));
  expect(blocked.json().code, errors.at(-1)?.stack).toBe('UNEVEN_TERRAIN');
  await db.updateTable('worldTerrainVertices').set({ height: 50 }).where('worldId', '=', worldId).execute();
  const samples = [];
  for (const x of [142, 143]) {
    statements.length = 0;
    capture = true;
    const started = performance.now(),
      response = await post(payload(x, 20));
    capture = false;
    expect(response.statusCode, errors.at(-1)?.stack ?? response.body).toBe(201);
    expect(response.json().cells).toHaveLength(1);
    expect(statements.filter((q) => !/^\s*(begin|commit|start transaction|set transaction)/i.test(q))).toHaveLength(5);
    samples.push({
      ms: Math.round(performance.now() - started),
      sqlCalls: statements.length,
      jsonBytes: Buffer.byteLength(response.body),
    });
  }
  mkdirSync('test-results/construction-latency', { recursive: true });
  writeFileSync(
    'test-results/construction-latency/bounded-rc1.json',
    JSON.stringify({ scenario: 'isolated RC1 vertex test, warm source, two new houses', samples }, null, 2),
  );
}, 120000);

it('refuses to build on a wood case while a stump stands, even after a read, and builds once it is cleared', async () => {
  const featureId = randomUUID(),
    t = new Date();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('worldFeatures')
      .values({ id: featureId, worldId, featureTypeCode: 'woodland', state: 'available', variantSeed: 4 })
      .execute();
    // Two trees cut to nothing: two stumps, no wood left.
    await tx
      .insertInto('woodlandDeposits')
      .values({
        worldId,
        featureId,
        cellX: 67,
        cellY: 64,
        initialAmount: 1000,
        remainingAmount: 0,
        reservedAmount: 0,
        cutAmount: 1000,
        revision: 1,
        updatedAt: t,
        regrowthUpdatedAt: t,
      })
      .execute();
    await tx
      .insertInto('woodlandTrees')
      .values([0, 1].map((treeIndex) => ({ worldId, featureId, treeIndex, remainingAmount: 0, felledAt: t })))
      .execute();
    await tx
      .insertInto('worldCellOccupancies')
      .values({ worldId, featureId, cellX: 67, cellY: 64, buildingId: null, role: 'body' })
      .execute();
  });
  // The former read freed a case under 10 % of its wood; a stump now keeps it occupied.
  expect(
    (await app.inject({ url: `/api/worlds/${slug}/village`, cookies: { arbestra_session: token } })).statusCode,
  ).toBe(200);
  expect((await post(payload(67, 64))).json().code, errors.at(-1)?.stack).toBe('CELL_OCCUPIED');
  expect(await wood()).toBe(2000);
  // One stump removed (its trunk leaves the navigation): the other keeps the case occupied.
  await db
    .updateTable('woodlandTrees')
    .set({ stumpRemovedAt: t })
    .where('featureId', '=', featureId)
    .where('treeIndex', '=', 0)
    .execute();
  expect((await post(payload(67, 64))).json().code, errors.at(-1)?.stack).toBe('CELL_OCCUPIED');
  expect(await wood()).toBe(2000);
  // Both stumps removed: the case clears and frees its cell.
  await db.transaction().execute(async (tx) => {
    await tx.selectFrom('villages').select('id').where('id', '=', villageId).forUpdate().execute();
    await tx.updateTable('woodlandTrees').set({ stumpRemovedAt: t }).where('featureId', '=', featureId).execute();
    await clearWoodland(tx, worldId, featureId, t);
  });
  const built = await post(payload(67, 64));
  expect(built.statusCode, errors.at(-1)?.stack).toBe(201);
});
