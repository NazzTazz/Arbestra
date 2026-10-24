import { it, expect } from 'vitest';
import { sql } from 'kysely';
import { createDatabase } from './connection.js';
import { testDatabaseUrl } from './test-environment.js';
it('survives a transaction timeout during an application gap and replaces the dead connection', async () => {
  const target = new URL(testDatabaseUrl());
  if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
    throw Error('Expected local test database');
  const errors: Error[] = [],
    db = createDatabase(target.href, (e) => errors.push(e));
  let before = 0,
    continued = false;
  try {
    await expect(
      db.transaction().execute(async (tx) => {
        before = (await sql<{ id: number }>`select pg_backend_pid() as id`.execute(tx)).rows[0]!.id;
        await sql`set local transaction_timeout='100ms'`.execute(tx);
        await new Promise((r) => setTimeout(r, 300));
        await sql`select 1`.execute(tx);
        continued = true;
      }),
    ).rejects.toThrow();
    expect(continued).toBe(false);
    expect(errors.some((e) => 'code' in e && e.code === '25P04')).toBe(true);
    const after = (await sql<{ id: number }>`select pg_backend_pid() as id`.execute(db)).rows[0]!.id;
    expect(after).not.toBe(before);
  } finally {
    await db.destroy();
  }
});
