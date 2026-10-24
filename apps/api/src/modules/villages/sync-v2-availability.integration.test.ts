import { sql } from 'kysely';
import { afterAll, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { assertSyncV2Available } from './sync-v2-routes.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected availability database');
const db = createDatabase(url);
afterAll(async () => {
  await db.destroy();
});

// Deployment revokes every right on kysely_migration from the runtime role
// (ops/deploy/deploy.py): the V2 gate must not read it, or every V2 route
// fails with 500 in production while tests, run as owner, stay green.
it('reports V2 available to a role that cannot read the migration table', async () => {
  const rollback = Error('AVAILABILITY_ROLLBACK');
  await expect(
    db.transaction().execute(async (tx) => {
      await sql`revoke all on kysely_migration from current_user`.execute(tx);
      await expect(sql`select 1 from kysely_migration limit 1`.execute(tx)).rejects.toThrow();
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  await expect(
    db.transaction().execute(async (tx) => {
      await sql`revoke all on kysely_migration from current_user`.execute(tx);
      await assertSyncV2Available(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
