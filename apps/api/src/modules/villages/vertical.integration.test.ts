import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import type { AppConfig } from '../../config.js';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import type { Database } from '../../database/schema.js';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { processNextScheduledTask } from '../../jobs/scheduled-tasks.js';
import { COMPLETE_CONSTRUCTION_TASK, completeConstruction } from './complete-construction.js';
import { villageCommandConfirmationV2IsValid } from '@arbestra/contracts';
import { configureTownHallFactory } from './service.js';
import { getVillageState } from './legacy-commands.fixture.js';

const databaseUrl = testDatabaseUrl();
const taskHandlers = { [COMPLETE_CONSTRUCTION_TASK]: completeConstruction };
const V2 = { 'x-arbestra-protocol': '2', 'x-arbestra-generation': '1' };

describe.sequential('deferred construction with PostgreSQL', () => {
  let app: FastifyInstance;
  let db: Kysely<Database>;

  beforeAll(async () => {
    await migrateToLatest(databaseUrl);
    await resetE2eState(databaseUrl);
    db = createDatabase(databaseUrl);
    const config: AppConfig = {
      databaseUrl,
      host: '127.0.0.1',
      port: 0,
      isProduction: false,
      cookieName: 'arbestra_session',
      sessionTtlDays: 30,
      constructionDurationOverrideMs: 10_000,
      scheduledTaskPollIntervalMs: 25,
    };
    app = await buildApp(config, db);
  });
  beforeEach(async () => {
    await resetE2eState(databaseUrl);
    // These fixtures exercise deferred construction, with its actual refined price funded.
    await db
      .updateTable('villageResources')
      .set({ amount: 25 })
      .where('worldId', '=', DEVELOPMENT_IDS.world)
      .where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'timber')
      .execute();
    await db
      .updateTable('villageResources')
      .set({ amount: 10 })
      .where('worldId', '=', DEVELOPMENT_IDS.world)
      .where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'cut-stone')
      .execute();
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
  });

  async function authenticatedCookie(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'player@arbestra.local', password: 'arbestra' },
    });
    expect(response.statusCode).toBe(200);
    const header = response.headers['set-cookie'];
    const cookie = (Array.isArray(header) ? header[0] : header)?.split(';')[0];
    if (!cookie) throw new Error('Login did not return a session cookie');
    return cookie;
  }

  it('factory pilot reserves exactly two cells and retains its persistent layout on repeat', async () => {
    const cell = { cellX: DEVELOPMENT_CELLS.townHall.cellX, cellY: DEVELOPMENT_CELLS.townHall.cellY - 1 };
    const before = await db
      .selectFrom('villageResources')
      .selectAll()
      .where('villageId', '=', DEVELOPMENT_IDS.village)
      .orderBy('resourceCode')
      .execute();
    await configureTownHallFactory(
      db,
      DEVELOPMENT_IDS.account,
      'aube',
      DEVELOPMENT_IDS.village,
      cell.cellX,
      cell.cellY,
      false,
    );
    expect(
      await db
        .selectFrom('villageResources')
        .selectAll()
        .where('villageId', '=', DEVELOPMENT_IDS.village)
        .orderBy('resourceCode')
        .execute(),
    ).toEqual(before);
    expect(
      await db
        .selectFrom('worldCellOccupancies')
        .selectAll()
        .where('buildingId', '=', DEVELOPMENT_IDS.townHall)
        .execute(),
    ).toHaveLength(1);
    await configureTownHallFactory(
      db,
      DEVELOPMENT_IDS.account,
      'aube',
      DEVELOPMENT_IDS.village,
      cell.cellX,
      cell.cellY,
    );
    await configureTownHallFactory(
      db,
      DEVELOPMENT_IDS.account,
      'aube',
      DEVELOPMENT_IDS.village,
      cell.cellX,
      cell.cellY,
    );
    const snapshot = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(snapshot.cells.filter((c) => c.footprint?.buildingId === DEVELOPMENT_IDS.townHall)).toHaveLength(2);
    expect(snapshot.cells.find((c) => c.building?.id === DEVELOPMENT_IDS.townHall)?.building?.visualLayout).toEqual({
      recipe: 'town-hall',
      version: 1,
      quarterTurns: 0,
      entranceFace: '-x',
      offset: [0, 0],
    });
    expect(
      await db
        .selectFrom('buildings')
        .select(['level', 'targetLevel', 'status'])
        .where('id', '=', DEVELOPMENT_IDS.townHall)
        .executeTakeFirstOrThrow(),
    ).toEqual({ level: 1, targetLevel: null, status: 'completed' });
  });

  it('factory catalog exposes the barracks without enabling construction or inventing costs', async () => {
    const snapshot = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(snapshot.buildingTypes.find((t) => t.code === 'barracks')).toMatchObject({
      displayName: 'Caserne',
      buildable: false,
      levels: [],
      productionMode: 'none',
    });
    const cookie = await authenticatedCookie();
    const response = await requestConstruction(cookie, 'barracks');
    expect(response.statusCode, response.body).toBe(409);
    expect(await db.selectFrom('buildings').select('id').where('buildingType', '=', 'barracks').execute()).toHaveLength(
      0,
    );
  });

  it('factory pilot rejects an occupied target without changing its layout or footprint', async () => {
    const cell = { cellX: DEVELOPMENT_CELLS.townHall.cellX, cellY: DEVELOPMENT_CELLS.townHall.cellY - 1 };
    const other = await db
      .insertInto('buildings')
      .values({
        worldId: DEVELOPMENT_IDS.world,
        villageId: DEVELOPMENT_IDS.village,
        buildingType: 'dwelling',
        level: 1,
        targetLevel: null,
        status: 'completed',
        constructionStartedAt: null,
        constructionCompletesAt: null,
        completedAt: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('worldCellOccupancies')
      .values({ worldId: DEVELOPMENT_IDS.world, ...cell, buildingId: other.id, featureId: null, role: 'anchor' })
      .execute();
    const before = await db
      .selectFrom('buildings')
      .selectAll()
      .where('id', '=', DEVELOPMENT_IDS.townHall)
      .executeTakeFirstOrThrow();
    await expect(
      configureTownHallFactory(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, cell.cellX, cell.cellY),
    ).rejects.toMatchObject({ code: 'CELL_OCCUPIED' });
    expect(
      await db.selectFrom('buildings').selectAll().where('id', '=', DEVELOPMENT_IDS.townHall).executeTakeFirstOrThrow(),
    ).toEqual(before);
    expect(
      await db
        .selectFrom('worldCellOccupancies')
        .selectAll()
        .where('buildingId', '=', DEVELOPMENT_IDS.townHall)
        .execute(),
    ).toHaveLength(1);
  });

  /** A bounded V2 placement on the seeded dwelling site, each call with its own command identifier. */
  async function requestConstruction(cookie: string, buildingType = 'dwelling') {
    const { cellX, cellY } = DEVELOPMENT_CELLS.dwelling;
    return app.inject({
      method: 'POST',
      url: `/api/worlds/aube/villages/${DEVELOPMENT_IDS.village}/buildings`,
      headers: { cookie, ...V2 },
      payload: {
        commandId: randomUUID(),
        buildingType,
        anchorCellX: cellX,
        anchorCellY: cellY,
        cells: [{ cellX, cellY }],
      },
    });
  }

  async function makeConstructionDue(): Promise<string> {
    const building = await db
      .selectFrom('worldCellOccupancies')
      .innerJoin('buildings', 'buildings.id', 'worldCellOccupancies.buildingId')
      .select('buildings.id')
      .where('worldCellOccupancies.cellX', '=', DEVELOPMENT_CELLS.dwelling.cellX)
      .where('worldCellOccupancies.cellY', '=', DEVELOPMENT_CELLS.dwelling.cellY)
      .where('worldCellOccupancies.role', '=', 'anchor')
      .executeTakeFirstOrThrow();
    await db
      .updateTable('buildings')
      .set({
        constructionStartedAt: sql`transaction_timestamp() - interval '2 seconds'`,
        constructionCompletesAt: sql`transaction_timestamp() - interval '1 second'`,
      })
      .where('id', '=', building.id)
      .execute();
    await db
      .updateTable('scheduledTasks')
      .set({
        dueAt: sql`transaction_timestamp() - interval '1 second'`,
        availableAt: sql`transaction_timestamp() - interval '1 second'`,
      })
      .where('subjectId', '=', building.id)
      .execute();
    return building.id;
  }

  it('records cat eyes once with ownership checks and keeps the first journal entry on retry', async () => {
    const url = `/api/worlds/aube/villages/${DEVELOPMENT_IDS.village}/discover-cat-eyes`;
    const gesture = () => ({ ...V2, 'x-arbestra-command': randomUUID() });
    expect((await app.inject({ method: 'POST', url, headers: gesture() })).statusCode).toBe(401);
    const cookie = await authenticatedCookie();
    const send = (path: string) => app.inject({ method: 'POST', url: path, headers: { cookie, ...gesture() } });
    expect((await send(url.replace('aube', 'unknown'))).statusCode).toBe(404);
    expect((await send(url.replace(DEVELOPMENT_IDS.village, randomUUID()))).statusCode).toBe(404);
    const journal = () =>
      db
        .selectFrom('villageAccomplishments')
        .select(['code', 'completedAt'])
        .where('villageId', '=', DEVELOPMENT_IDS.village)
        .where('code', '=', 'cat-eyes')
        .execute();
    expect(await journal()).toEqual([]);
    const first = await send(url);
    expect(first.statusCode, first.body).toBe(200);
    expect(villageCommandConfirmationV2IsValid(first.json())).toBe(true);
    const entry = await journal();
    expect(entry).toHaveLength(1);
    // The entry is dated by the command's own bound, which the acknowledgement reports.
    expect(entry[0]!.completedAt.toISOString()).toBe(first.json().commandTime);
    const retry = await send(url);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(await journal()).toEqual(entry);
  });

  it('creates the action and task atomically with PostgreSQL time', async () => {
    const response = await requestConstruction(await authenticatedCookie());
    expect(response.statusCode, response.body).toBe(201);
    const ack = response.json<{ commandTime: string; result: { buildingId: string } }>();
    const amount = async (resourceCode: string) =>
      Number(
        (
          await db
            .selectFrom('villageResources')
            .select('amount')
            .where('villageId', '=', DEVELOPMENT_IDS.village)
            .where('resourceCode', '=', resourceCode)
            .executeTakeFirstOrThrow()
        ).amount,
      );
    expect(await amount('wood')).toBe(2000);
    expect(await amount('timber')).toBe(0);
    expect(await amount('cut-stone')).toBe(0);
    const building = await db
      .selectFrom('buildings')
      .selectAll()
      .where('id', '=', ack.result.buildingId)
      .executeTakeFirstOrThrow();
    expect(building.status).toBe('under-construction');
    expect(building.constructionCompletesAt!.getTime() - building.constructionStartedAt!.getTime()).toBe(10_000);
    // The acknowledgement retains the command's bound H, which dates the construction.
    expect(ack.commandTime).toBe(building.constructionStartedAt!.toISOString());
    const task = await db
      .selectFrom('scheduledTasks')
      .selectAll()
      .where('subjectId', '=', building.id)
      .executeTakeFirstOrThrow();
    expect(task.worldId).toBe(DEVELOPMENT_IDS.world);
    expect(task.dueAt.getTime()).toBe(building.constructionCompletesAt!.getTime());
  });

  it('rejects concurrent duplicate construction and debits once', async () => {
    const cookie = await authenticatedCookie();
    const responses = await Promise.all([requestConstruction(cookie), requestConstruction(cookie)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const wood = await db
      .selectFrom('villageResources')
      .select('amount')
      .where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', '=', 'wood')
      .executeTakeFirstOrThrow();
    expect(Number(wood.amount)).toBe(2000);
    const refined = await db
      .selectFrom('villageResources')
      .select(['resourceCode', 'amount'])
      .where('villageId', '=', DEVELOPMENT_IDS.village)
      .where('resourceCode', 'in', ['timber', 'cut-stone'])
      .execute();
    expect(refined.map((r) => Number(r.amount))).toEqual([0, 0]);
    expect(
      await db
        .selectFrom('worldCellOccupancies')
        .select('buildingId')
        .where('cellX', '=', DEVELOPMENT_CELLS.dwelling.cellX)
        .where('cellY', '=', DEVELOPMENT_CELLS.dwelling.cellY)
        .where('role', '=', 'anchor')
        .execute(),
    ).toHaveLength(1);
  });

  it('completes exactly once when presented twice', async () => {
    await requestConstruction(await authenticatedCookie());
    const id = await makeConstructionDue();
    expect((await processNextScheduledTask(db, taskHandlers))?.outcome).toBe('completed');
    expect(await processNextScheduledTask(db, taskHandlers)).toBeNull();
    const building = await db.selectFrom('buildings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(building.status).toBe('completed');
    expect(building.completedAt?.getTime()).toBe(building.constructionCompletesAt?.getTime());
  });

  it('lets concurrent workers claim distinct due tasks', async () => {
    const taskType = 'test.concurrent';
    await db
      .insertInto('scheduledTasks')
      .values(
        [1, 2].map(() => ({
          worldId: DEVELOPMENT_IDS.world,
          taskType,
          subjectId: randomUUID(),
          payload: {},
          dueAt: sql`transaction_timestamp() - interval '1 second'`,
          availableAt: sql`transaction_timestamp() - interval '1 second'`,
          lastError: null,
          completedAt: null,
        })),
      )
      .execute();
    let entered = 0;
    let release!: () => void;
    let bothEntered!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const both = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    const handlers = {
      [taskType]: async () => {
        entered += 1;
        if (entered === 2) bothEntered();
        await released;
      },
    };
    const workers = [processNextScheduledTask(db, handlers), processNextScheduledTask(db, handlers)];
    try {
      await Promise.race([
        both,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('workers blocked')), 2_000)),
      ]);
    } finally {
      release();
    }
    expect((await Promise.all(workers)).every((result) => result?.outcome === 'completed')).toBe(true);
  });

  it('retries after a transactional handler error', async () => {
    const taskType = 'test.retry';
    const subjectId = randomUUID();
    await db
      .insertInto('scheduledTasks')
      .values({
        worldId: DEVELOPMENT_IDS.world,
        taskType,
        subjectId,
        payload: {},
        dueAt: sql`transaction_timestamp() - interval '1 second'`,
        availableAt: sql`transaction_timestamp() - interval '1 second'`,
        lastError: null,
        completedAt: null,
      })
      .execute();
    expect(
      (
        await processNextScheduledTask(
          db,
          {
            [taskType]: async (transaction) => {
              await sql`select * from table_that_does_not_exist`.execute(transaction);
            },
          },
          0,
        )
      )?.outcome,
    ).toBe('retry-scheduled');
    expect((await processNextScheduledTask(db, { [taskType]: async () => undefined }, 0))?.outcome).toBe('completed');
  });

  it('rolls back domain changes when the transaction crashes', async () => {
    await requestConstruction(await authenticatedCookie());
    const id = await makeConstructionDue();
    await expect(
      db.transaction().execute(async (transaction) => {
        const task = await transaction
          .selectFrom('scheduledTasks')
          .selectAll()
          .where('subjectId', '=', id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        await completeConstruction(transaction, task);
        throw new Error('simulated crash');
      }),
    ).rejects.toThrow('simulated crash');
    expect(
      (await db.selectFrom('buildings').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status,
    ).toBe('under-construction');
    expect((await processNextScheduledTask(db, taskHandlers))?.outcome).toBe('completed');
  });

  it('completes an overdue construction through the worker after a restart', async () => {
    await requestConstruction(await authenticatedCookie());
    const id = await makeConstructionDue();
    const restarted = createDatabase(databaseUrl);
    try {
      expect((await processNextScheduledTask(restarted, taskHandlers))?.outcome).toBe('completed');
    } finally {
      await restarted.destroy();
    }
    expect(
      (await db.selectFrom('buildings').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status,
    ).toBe('completed');
  });
});
