import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import type { AppConfig } from '../../config.js';
import { HttpError } from '../../errors.js';
import { createSessionToken } from '../../security/sessions.js';
import { ADMIN_COOKIE_NAME, hashAdminSessionToken } from './auth.js';
import { registerAdminRoutes } from './routes.js';
import { AdminReadService } from './service.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (
  target.hostname !== '127.0.0.1' ||
  target.pathname !== '/arbestra_test' ||
  (target.port && target.port !== '5432')
) {
  throw Error('Unexpected private NOC test database');
}
const db = createDatabase(url),
  accountId = randomUUID(),
  worlds = [randomUUID(), randomUUID()];
const villages = [randomUUID(), randomUUID()],
  activityIds = [randomUUID(), randomUUID()],
  taskIds = [randomUUID(), randomUUID()];
const unreceiptedActivityId = randomUUID(),
  completedActivityId = randomUUID(),
  completedCommandId = randomUUID();
const commandId = randomUUID(),
  token = createSessionToken(),
  secret = 'private-fixture-secret-never-returned';
const at = new Date(Date.now() - 60_000),
  started = new Date(at.getTime() - 60_000);
const service = new AdminReadService(db);
let app: FastifyInstance;
let releaseGuard = () => {};
let taskGuard: Promise<void> | undefined;
let guardError: unknown;
let guardExpired = false;
const config: AppConfig = {
  databaseUrl: url,
  host: '127.0.0.1',
  port: 0,
  isProduction: false,
  cookieName: 'arbestra_session',
  sessionTtlDays: 30,
  constructionDurationOverrideMs: null,
  scheduledTaskPollIntervalMs: 250,
  adminAccountIds: [accountId],
  adminOrigin: 'http://localhost',
};

async function stored() {
  return {
    resources: await db
      .selectFrom('villageResources')
      .selectAll()
      .where('worldId', 'in', worlds)
      .orderBy('worldId')
      .execute(),
    flows: await db
      .selectFrom('villageResourceFlows')
      .selectAll()
      .where('worldId', 'in', worlds)
      .orderBy('worldId')
      .execute(),
    cohorts: await db
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', 'in', worlds)
      .orderBy('worldId')
      .execute(),
    science: await db
      .selectFrom('scienceActivities')
      .selectAll()
      .where('worldId', 'in', worlds)
      .orderBy('worldId')
      .execute(),
    tasks: await db
      .selectFrom('scheduledTasks')
      .selectAll()
      .where('worldId', 'in', worlds)
      .orderBy('worldId')
      .execute(),
    expeditions: await db
      .selectFrom('expeditionSubmissions')
      .selectAll()
      .where('worldId', 'in', worlds)
      .orderBy('worldId')
      .execute(),
    changes: await db
      .selectFrom('villageSyncChanges')
      .selectAll()
      .where('worldId', 'in', worlds)
      .orderBy('worldId')
      .orderBy('transactionId')
      .execute(),
  };
}

beforeAll(async () => {
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('accounts')
      .values({ id: accountId, email: `${accountId}@noc.test`, passwordHash: secret })
      .execute();
    for (let index = 0; index < worlds.length; index++) {
      const worldId = worlds[index]!,
        villageId = villages[index]!,
        activityId = activityIds[index]!;
      await tx
        .insertInto('worlds')
        .values({
          id: worldId,
          slug: `noc-${worldId}`,
          name: `Private NOC ${index}`,
          topology: 'torus',
          widthCells: 128,
          heightCells: 128,
          chunkSize: 32,
          seed: 42,
          generationVersion: 1,
          generationStatus: 'ready',
          isOpen: false,
          generatedAt: started,
        })
        .execute();
      await tx
        .insertInto('worldMemberships')
        .values({ worldId, accountId, playerName: `NOC ${index}` })
        .execute();
      await tx
        .insertInto('villages')
        .values({
          id: villageId,
          worldId,
          ownerAccountId: accountId,
          name: `Village ${index}`,
          anchorCellX: index + 1,
          anchorCellY: 1,
          economyActivatedAt: started,
        })
        .execute();
      await tx
        .insertInto('villageResources')
        .values({ worldId, villageId, resourceCode: 'wood', amount: index ? '17' : '9007199254740993' })
        .execute();
      await tx
        .insertInto('villageResourceFlows')
        .values({
          worldId,
          villageId,
          resourceCode: 'wood',
          baseRatePerHour: 1,
          remainder: 0,
          productionUpdatedAt: started,
        })
        .execute();
      await tx
        .insertInto('playerScience')
        .values({ worldId, accountId, observationsSince: null, solarReport: null })
        .execute();
      await tx
        .insertInto('scienceActivities')
        .values({
          id: activityId,
          worldId,
          villageId,
          accountId,
          buildingId: null,
          programCode: null,
          kind: 'exploration',
          status: 'in-progress',
          workerCount: 1,
          workMs: 1_000,
          startedAt: started,
          completesAt: at,
          completedAt: null,
          pathCells: [],
          surveyCells: [],
        })
        .execute();
      await tx
        .insertInto('populationCohorts')
        .values({
          worldId,
          villageId,
          originVillageId: villageId,
          memberCount: 1,
          activity: 'working',
          energy: 10,
          energyProgress: 0,
          energyUpdatedAt: started,
          restingSince: null,
          foodUsedSinceRest: 0,
          harvestId: null,
          extractionId: null,
          scienceActivityId: activityId,
        })
        .execute();
      await tx
        .insertInto('expeditionSubmissions')
        .values({
          worldId,
          villageId,
          accountId,
          commandId,
          request: JSON.stringify({ commandId, action: 'explore', target: { cellX: 4, cellY: 4 }, budgetSeconds: 600 }),
          receipt: JSON.stringify({
            kind: 'expedition-receipt',
            worldId,
            villageId,
            commandId,
            status: 'admitted',
            version: 2,
            receivedAt: started.toISOString(),
            requestedTarget: { cellX: 4, cellY: 4 },
            effectiveTarget: { cellX: 4, cellY: 4 },
            activityId,
            startedAt: started.toISOString(),
            completesAt: at.toISOString(),
          }),
          attemptToken: randomUUID(),
        })
        .execute();
      await tx
        .insertInto('scheduledTasks')
        .values({
          id: taskIds[index]!,
          worldId,
          taskType: 'science.wake',
          subjectId: activityId,
          // Keep the setup-commit -> guardian-lock interval ineligible to any live worker.
          payload: { villageId, privateValue: secret },
          dueAt: at,
          availableAt: new Date(Date.now() + 86_400_000),
          attempts: 2,
          lastError: secret,
          completedAt: null,
        })
        .execute();
    }
    // The current total must include an expedition without a receipt, while
    // the recent completed counter follows the persisted activity linked to its receipt.
    const worldId = worlds[0]!,
      villageId = villages[0]!;
    await tx
      .insertInto('scienceActivities')
      .values([
        {
          id: unreceiptedActivityId,
          worldId,
          villageId,
          accountId,
          buildingId: null,
          programCode: null,
          kind: 'survey',
          status: 'in-progress',
          workerCount: 1,
          workMs: 1_000,
          startedAt: started,
          completesAt: new Date(Date.now() + 3_600_000),
          completedAt: null,
          pathCells: [],
          surveyCells: [],
        },
        {
          id: completedActivityId,
          worldId,
          villageId,
          accountId,
          buildingId: null,
          programCode: null,
          kind: 'exploration',
          status: 'completed',
          workerCount: 1,
          workMs: 1_000,
          startedAt: started,
          completesAt: at,
          completedAt: at,
          pathCells: [],
          surveyCells: [],
        },
      ])
      .execute();
    await tx
      .insertInto('expeditionSubmissions')
      .values({
        worldId,
        villageId,
        accountId,
        commandId: completedCommandId,
        request: JSON.stringify({
          commandId: completedCommandId,
          action: 'explore',
          target: { cellX: 4, cellY: 4 },
          budgetSeconds: 600,
        }),
        receipt: JSON.stringify({
          kind: 'expedition-receipt',
          worldId,
          villageId,
          commandId: completedCommandId,
          status: 'admitted',
          version: 2,
          receivedAt: started.toISOString(),
          requestedTarget: { cellX: 4, cellY: 4 },
          effectiveTarget: { cellX: 4, cellY: 4 },
          activityId: completedActivityId,
          startedAt: started.toISOString(),
          completesAt: at.toISOString(),
        }),
      })
      .execute();
    await tx
      .insertInto('sessions')
      .values({ accountId, tokenHash: hashAdminSessionToken(token), expiresAt: new Date(Date.now() + 60_000) })
      .execute();
  });
  let locked!: () => void, failed!: (error: unknown) => void;
  const acquired = new Promise<void>((resolve, reject) => {
    locked = resolve;
    failed = reject;
  });
  const released = new Promise<void>((resolve) => {
    releaseGuard = resolve;
  });
  taskGuard = db
    .transaction()
    .execute(async (tx) => {
      await sql`set local statement_timeout='5s'`.execute(tx);
      await sql`set local lock_timeout='2s'`.execute(tx);
      await sql`set local transaction_timeout='120s'`.execute(tx);
      const lockedTasks = await tx
        .selectFrom('scheduledTasks')
        .select('id')
        .where('worldId', 'in', worlds)
        .where('id', 'in', taskIds)
        .forUpdate()
        .execute();
      if (lockedTasks.length !== taskIds.length)
        throw Error('The private task guardian did not acquire every fixture task');
      locked();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          released,
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              guardExpired = true;
              resolve();
            }, 90_000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      // Deleting while still holding every lock prevents an acquisition window
      // when the guardian commits, including when a live QA worker is polling.
      await tx.deleteFrom('scheduledTasks').where('worldId', 'in', worlds).where('id', 'in', taskIds).execute();
    })
    .catch((error) => {
      guardError = error;
      failed(error);
    });
  await acquired;
  const skippedTasks = await db
    .transaction()
    .execute((tx) =>
      tx
        .selectFrom('scheduledTasks')
        .select('id')
        .where('worldId', 'in', worlds)
        .where('id', 'in', taskIds)
        .forUpdate()
        .skipLocked()
        .execute(),
    );
  expect(skippedTasks).toEqual([]);
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
});

afterAll(async () => {
  try {
    if (app) await app.close();
  } finally {
    releaseGuard();
    await taskGuard;
    try {
      await db.deleteFrom('populationCohorts').where('worldId', 'in', worlds).execute();
      await db.deleteFrom('worlds').where('id', 'in', worlds).execute();
      await db.deleteFrom('accounts').where('id', '=', accountId).execute();
      expect(await db.selectFrom('worlds').select('id').where('id', 'in', worlds).execute()).toEqual([]);
      expect(await db.selectFrom('accounts').select('id').where('id', '=', accountId).execute()).toEqual([]);
      expect(guardError).toBeUndefined();
      expect(guardExpired).toBe(false);
    } finally {
      await db.destroy();
    }
  }
});

describe.sequential('isolated NOC business diagnostics', () => {
  it('reads overdue persisted economy without production, reconciliation, notification acknowledgement or sync writes', async () => {
    const before = await stored();
    const village = await service.village(worlds[0]!, villages[0]!);
    expect(village.economy.resources.find((r) => r.code === 'wood')).toEqual({
      code: 'wood',
      amount: '9007199254740993',
      productionUpdatedAt: started.toISOString(),
    });
    expect(village.economy).toMatchObject({
      mode: 'persisted-only',
      scienceDue: 1,
      population: { total: 1, working: 1, idle: 0, resting: 0 },
    });
    expect(village.diagnostics[0]).toMatchObject({ status: 'attention', code: 'RECONCILIATION_DUE' });
    expect(await stored()).toEqual(before);
  });
  it('keeps world filters on reused command IDs and refuses a village from another world', async () => {
    const first = await service.activity(worlds[0]!, 'expedition', commandId, villages[0]!);
    const second = await service.activity(worlds[1]!, 'expedition', commandId, villages[1]!);
    expect(first.activity).toMatchObject({
      worldId: worlds[0],
      villageId: villages[0],
      status: 'in-progress',
      receiptStatus: 'admitted',
      relatedActivityId: activityIds[0],
    });
    expect(second.relatedActivities[0]!.id).toBe(activityIds[1]);
    await expect(service.village(worlds[1]!, villages[0]!)).rejects.toMatchObject({ code: 'VILLAGE_NOT_FOUND' });
  });
  it('returns bounded support identities and safe task diagnostics without credentials, payload or raw errors', async () => {
    const account = await service.account(accountId);
    expect(account.memberships).toHaveLength(2);
    expect(account.villages).toHaveLength(2);
    const task = await service.activity(worlds[0]!, 'task', taskIds[0]!);
    expect(task.activity).toMatchObject({
      villageId: villages[0],
      accountId,
      status: 'retrying',
      attempts: 2,
      errorCode: 'TASK_HANDLER_FAILED',
    });
    expect(JSON.stringify({ account, task })).not.toContain(secret);
    expect(JSON.stringify({ account, task })).not.toMatch(/passwordHash|tokenHash|attemptToken|payload|lastError/);
    expect((await service.accounts(accountId)).items.map((a) => a.id)).toEqual([accountId]);
    const world = await service.world(worlds[0]!);
    expect(world.world).toMatchObject({ accounts: 1, villages: 1, activeScience: 2 });
    expect(world.expeditions).toMatchObject({
      pending: 0,
      admitted: 2,
      active: 2,
      completed: 1,
      sampleSize: 2,
      truncated: false,
    });
    expect(world.expeditions.note).toContain('totaux actuels');
    expect(world.expeditions.note).toContain('2 reçus récents');
    expect((await service.world(worlds[1]!)).expeditions).toMatchObject({ active: 1, completed: 0, admitted: 1 });
    expect(world.tasks).toMatchObject({ pending: 1, due: 0, retrying: 1, oldestDueAt: at.toISOString() });
    expect(world.synchronization.revision).toBeNull();
  });
  it('authenticates every read endpoint before querying business or runtime data', async () => {
    const urls = [
      '/overview',
      '/infrastructure',
      '/worlds',
      `/worlds/${worlds[0]}`,
      '/accounts',
      `/accounts/${accountId}`,
      `/villages/${villages[0]}?worldId=${worlds[0]}`,
      '/activities',
      `/activities/${commandId}?worldId=${worlds[0]}&kind=expedition`,
    ];
    for (const path of urls) {
      const response = await app.inject({ method: 'GET', url: '/api/admin' + path, headers: { host: 'localhost' } });
      expect(response.statusCode).toBe(401);
      expect(response.headers['cache-control']).toContain('no-store');
    }
  });
  it('serializes the read projection behind a separate administrator session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/villages/${villages[0]}?worldId=${worlds[0]}`,
      headers: { host: 'localhost', cookie: `${ADMIN_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().economy.resources.find((r: { code: string }) => r.code === 'wood').amount).toBe(
      '9007199254740993',
    );
    expect(response.body).not.toContain(secret);
  });
});
