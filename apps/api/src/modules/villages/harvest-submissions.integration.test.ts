import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { HttpError } from '../../errors.js';
import type { ScheduledTask } from '../../jobs/scheduled-tasks.js';
import { HARVEST_SUBMISSION_TASK, processHarvestSubmission } from './harvest-submissions.js';

// The route computation of this submission never finishes in time.
vi.mock('./harvest-intents.js', () => ({
  acceptHarvestIntent: vi.fn(async () => {
    throw new HttpError(503, 'NAVIGATION_UNAVAILABLE', 'Calcul du trajet interrompu. Réessayez.');
  }),
}));

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected harvest submission test database');
const db = createDatabase(url);
const ids = { world: randomUUID(), village: randomUUID(), account: randomUUID(), command: randomUUID() };
beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('accounts')
    .values({ id: ids.account, email: ids.account + '@harvest.test', passwordHash: 'fixture' })
    .execute();
  await db
    .insertInto('worlds')
    .values({
      id: ids.world,
      slug: 'harvest-' + ids.world,
      name: 'Harvest',
      topology: 'torus',
      widthCells: 64,
      heightCells: 64,
      chunkSize: 32,
      seed: 1,
      generationVersion: 1,
      generationStatus: 'ready',
      generatedAt: new Date(),
      isOpen: false,
    })
    .execute();
  await db
    .insertInto('worldMemberships')
    .values({ worldId: ids.world, accountId: ids.account, playerName: 'H' })
    .execute();
  await db
    .insertInto('villages')
    .values({
      id: ids.village,
      worldId: ids.world,
      ownerAccountId: ids.account,
      name: 'H',
      anchorCellX: 8,
      anchorCellY: 8,
    })
    .execute();
  const wood = randomUUID();
  await db
    .insertInto('harvestSubmissions')
    .values({
      worldId: ids.world,
      villageId: ids.village,
      accountId: ids.account,
      commandId: ids.command,
      request: JSON.stringify({ commandId: ids.command, gardens: [], wood: [wood], stone: [] }),
      receipt: null,
    })
    .execute();
});
afterAll(async () => {
  await db.deleteFrom('worlds').where('id', '=', ids.world).execute();
  await db.deleteFrom('accounts').where('id', '=', ids.account).execute();
  await db.destroy();
});

it('refuses a submission whose route keeps failing instead of retrying it forever', async () => {
  // Alpha, 24 October: a wood submission retried 294 times in a day, each try
  // holding the single navigation lane and the scheduler up to 30 s.
  const task = (attempts: number) =>
    ({
      id: randomUUID(),
      worldId: ids.world,
      taskType: HARVEST_SUBMISSION_TASK,
      subjectId: randomUUID(),
      payload: { villageId: ids.village, commandId: ids.command },
      dueAt: new Date(),
      availableAt: new Date(),
      attempts,
      lastError: null,
      completedAt: null,
      createdAt: new Date(),
    }) satisfies ScheduledTask;
  const receipt = async () =>
    (
      await db
        .selectFrom('harvestSubmissions')
        .select('receipt')
        .where('commandId', '=', ids.command)
        .executeTakeFirstOrThrow()
    ).receipt;
  // A transient failure is retried by the scheduler.
  await expect(db.transaction().execute((tx) => processHarvestSubmission(tx, task(0)))).rejects.toMatchObject({
    statusCode: 503,
  });
  expect(await receipt()).toBeNull();
  // Once the retries are exhausted, the player gets a refusal.
  await db.transaction().execute((tx) => processHarvestSubmission(tx, task(8)));
  expect(await receipt()).toMatchObject({
    commandId: ids.command,
    accepted: [],
    refused: [{ reason: 'Calcul du trajet interrompu. Réessayez.' }],
  });
});
