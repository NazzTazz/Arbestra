import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { VillageState } from '@arbestra/contracts';

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

const databaseUrl = testDatabaseUrl();
const taskHandlers = { [COMPLETE_CONSTRUCTION_TASK]: completeConstruction };

describe.sequential('deferred construction with PostgreSQL', () => {
  let app: FastifyInstance;
  let db: Kysely<Database>;

  beforeAll(async () => {
    await migrateToLatest(databaseUrl);
    await resetE2eState(databaseUrl);
    db = createDatabase(databaseUrl);
    const config: AppConfig = {
      databaseUrl, host: '127.0.0.1', port: 0, isProduction: false,
      cookieName: 'arbestra_session', sessionTtlDays: 30,
      constructionDurationOverrideMs: 10_000, scheduledTaskPollIntervalMs: 25,
    };
    app = await buildApp(config, db);
  });
  beforeEach(() => resetE2eState(databaseUrl));
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  async function authenticatedCookie(): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'player@arbestra.local', password: 'arbestra' } });
    expect(response.statusCode).toBe(200);
    const header = response.headers['set-cookie'];
    const cookie = (Array.isArray(header) ? header[0] : header)?.split(';')[0];
    if (!cookie) throw new Error('Login did not return a session cookie');
    return cookie;
  }

  async function requestConstruction(cookie: string) {
    return app.inject({
      method: 'POST',
      url: `/api/worlds/aube/villages/${DEVELOPMENT_IDS.village}/buildings`,
      headers: { cookie }, payload: { buildingType: 'dwelling', ...DEVELOPMENT_CELLS.dwelling },
    });
  }

  async function makeConstructionDue(): Promise<string> {
    const building = await db.selectFrom('worldCellOccupancies').innerJoin('buildings', 'buildings.id', 'worldCellOccupancies.buildingId')
      .select('buildings.id').where('worldCellOccupancies.cellX', '=', DEVELOPMENT_CELLS.dwelling.cellX)
      .where('worldCellOccupancies.cellY', '=', DEVELOPMENT_CELLS.dwelling.cellY)
      .where('worldCellOccupancies.role', '=', 'anchor').executeTakeFirstOrThrow();
    await db.updateTable('buildings').set({
      constructionStartedAt: sql`transaction_timestamp() - interval '2 seconds'`,
      constructionCompletesAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where('id', '=', building.id).execute();
    await db.updateTable('scheduledTasks').set({
      dueAt: sql`transaction_timestamp() - interval '1 second'`, availableAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where('subjectId', '=', building.id).execute();
    return building.id;
  }

  it('creates the action and task atomically with PostgreSQL time', async () => {
    const response = await requestConstruction(await authenticatedCookie());
    expect(response.statusCode).toBe(201);
    const state = response.json<VillageState>();
    const building = state.cells.find((cell) => cell.cellX === DEVELOPMENT_CELLS.dwelling.cellX && cell.cellY === DEVELOPMENT_CELLS.dwelling.cellY)?.building;
    expect(state.village.wood).toBe(1975);
    expect(building?.status).toBe('under-construction');
    expect(Date.parse(building!.constructionCompletesAt!) - Date.parse(building!.constructionStartedAt!)).toBe(10_000);
    expect(Math.abs(Date.parse(state.serverTime) - Date.parse(building!.constructionStartedAt!))).toBeLessThan(10);
    const task = await db.selectFrom('scheduledTasks').selectAll().where('subjectId', '=', building!.id).executeTakeFirstOrThrow();
    expect(task.worldId).toBe(DEVELOPMENT_IDS.world);
    expect(task.dueAt.getTime()).toBe(Date.parse(building!.constructionCompletesAt!));
  });

  it('rejects concurrent duplicate construction and debits once', async () => {
    const cookie = await authenticatedCookie();
    const responses = await Promise.all([requestConstruction(cookie), requestConstruction(cookie)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const wood = await db.selectFrom('villageResources').select('amount')
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(Number(wood.amount)).toBe(1975);
    expect(await db.selectFrom('worldCellOccupancies').select('buildingId').where('cellX', '=', DEVELOPMENT_CELLS.dwelling.cellX)
      .where('cellY', '=', DEVELOPMENT_CELLS.dwelling.cellY).where('role', '=', 'anchor').execute()).toHaveLength(1);
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
    await db.insertInto('scheduledTasks').values([1, 2].map(() => ({
      worldId: DEVELOPMENT_IDS.world, taskType, subjectId: randomUUID(), payload: {},
      dueAt: sql`transaction_timestamp() - interval '1 second'`, availableAt: sql`transaction_timestamp() - interval '1 second'`,
      lastError: null, completedAt: null,
    }))).execute();
    let entered = 0;
    let release!: () => void;
    let bothEntered!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const both = new Promise<void>((resolve) => { bothEntered = resolve; });
    const handlers = { [taskType]: async () => { entered += 1; if (entered === 2) bothEntered(); await released; } };
    const workers = [processNextScheduledTask(db, handlers), processNextScheduledTask(db, handlers)];
    try {
      await Promise.race([both, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('workers blocked')), 2_000))]);
    } finally { release(); }
    expect((await Promise.all(workers)).every((result) => result?.outcome === 'completed')).toBe(true);
  });

  it('retries after a transactional handler error', async () => {
    const taskType = 'test.retry';
    const subjectId = randomUUID();
    await db.insertInto('scheduledTasks').values({
      worldId: DEVELOPMENT_IDS.world, taskType, subjectId, payload: {},
      dueAt: sql`transaction_timestamp() - interval '1 second'`, availableAt: sql`transaction_timestamp() - interval '1 second'`,
      lastError: null, completedAt: null,
    }).execute();
    expect((await processNextScheduledTask(db, {
      [taskType]: async (transaction) => { await sql`select * from table_that_does_not_exist`.execute(transaction); },
    }, 0))?.outcome).toBe('retry-scheduled');
    expect((await processNextScheduledTask(db, { [taskType]: async () => undefined }, 0))?.outcome).toBe('completed');
  });

  it('rolls back domain changes when the transaction crashes', async () => {
    await requestConstruction(await authenticatedCookie());
    const id = await makeConstructionDue();
    await expect(db.transaction().execute(async (transaction) => {
      const task = await transaction.selectFrom('scheduledTasks').selectAll().where('subjectId', '=', id).forUpdate().executeTakeFirstOrThrow();
      await completeConstruction(transaction, task);
      throw new Error('simulated crash');
    })).rejects.toThrow('simulated crash');
    expect((await db.selectFrom('buildings').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status).toBe('under-construction');
    expect((await processNextScheduledTask(db, taskHandlers))?.outcome).toBe('completed');
  });

  it('reconciles an overdue deadline on read and survives restart', async () => {
    const cookie = await authenticatedCookie();
    await requestConstruction(cookie);
    const id = await makeConstructionDue();
    const state = (await app.inject({ method: 'GET', url: '/api/worlds/aube/village', headers: { cookie } })).json<VillageState>();
    expect(state.cells.find((cell) => cell.cellX === DEVELOPMENT_CELLS.dwelling.cellX && cell.cellY === DEVELOPMENT_CELLS.dwelling.cellY)?.building?.status).toBe('completed');
    const restarted = createDatabase(databaseUrl);
    try { expect((await processNextScheduledTask(restarted, taskHandlers))?.outcome).toBe('completed'); }
    finally { await restarted.destroy(); }
    expect((await db.selectFrom('buildings').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status).toBe('completed');
  });
});
