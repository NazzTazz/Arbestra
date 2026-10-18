import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { scienceSnapshot } from './service.js';

const url = testDatabaseUrl(), target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected test target');
const db = createDatabase(url), worldId = randomUUID(), accountId = randomUUID(), villageId = randomUUID();
beforeAll(async () => {
  await db.transaction().execute(async tx => {
    await tx.insertInto('accounts').values({ id: accountId, email: accountId + '@science-projection.test', passwordHash: 'fixture' }).execute();
    await tx.insertInto('worlds').values({ id: worldId, slug: worldId, name: 'Science projection', topology: 'torus', widthCells: 512, heightCells: 256, chunkSize: 32, seed: 1, generatedAt: null }).execute();
    await tx.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Projection' }).execute();
    await tx.insertInto('villages').values({ id: villageId, worldId, ownerAccountId: accountId, name: 'New village', anchorCellX: 10, anchorCellY: 10 }).execute();
  });
});
afterAll(async () => {
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
});
it('projects a new village without science state in a PostgreSQL read-only transaction', async () => {
  const snapshot = await db.transaction().execute(async tx => {
    await sql`set transaction read only`.execute(tx);
    return scienceSnapshot(tx, { worldId, villageId, through: new Date() }, true);
  });
  expect(snapshot.levels).toEqual({ mathematics: 0, geography: 0, astronomy: 0 });
  expect(snapshot.activities).toEqual([]);
  expect(snapshot.solarObservations).toEqual({ since: null, readyAt: null, complete: false });
  expect(await db.selectFrom('playerScience').selectAll().where('worldId', '=', worldId).execute()).toEqual([]);
});
