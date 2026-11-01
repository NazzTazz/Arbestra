import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { readRegisteredPrivateChanges } from './sync-v2-readers.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected retired components test database');
const db = createDatabase(url),
  context = { worldId: ids.world, villageId: ids.village, through: new Date('2026-10-21T12:00:00Z') };
beforeAll(async () => {
  await resetE2eState(url);
}, 180000);
afterAll(() => db.destroy());

it('skips withdrawn components still named by the retained journal, and refuses unknown ones', async () => {
  await db.transaction().execute(async (tx) => {
    // Alpha's journal still names deferred leveling jobs (until 30 October 2026).
    expect(
      await readRegisteredPrivateChanges(tx, context, [
        { component: 'levelingJobs', key: randomUUID() },
        { component: 'processingOrders', key: randomUUID() },
      ]),
    ).toMatchObject([{ component: 'processingOrders', upsert: [] }]);
    await expect(readRegisteredPrivateChanges(tx, context, [{ component: 'unregistered', key: '*' }])).rejects.toThrow(
      'Unregistered private synchronization component',
    );
  });
});
