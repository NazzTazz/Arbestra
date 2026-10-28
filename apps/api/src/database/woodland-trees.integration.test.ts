import { sql, type Transaction } from 'kysely';
import { afterAll, expect, it } from 'vitest';
import { createDatabase } from './connection.js';
import { testDatabaseUrl } from './test-environment.js';
import type { Database } from './schema.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected woodland tree test database');
const db = createDatabase(url);
afterAll(() => db.destroy());

class Rollback extends Error {}
/** Runs in a transaction that is always rolled back: the test database keeps no trace. */
async function rolledBack(run: (tx: Transaction<Database>) => Promise<void>) {
  try {
    await db.transaction().execute(async (tx) => {
      await run(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
/** Each refused write in its own savepoint, so the transaction goes on. */
async function refused(tx: Transaction<Database>, write: () => Promise<unknown>, constraint: RegExp) {
  await sql`savepoint refused`.execute(tx);
  await expect(write()).rejects.toThrow(constraint);
  await sql`rollback to savepoint refused`.execute(tx);
}

it('holds a felled tree between 0 and 500, its reservation within its trunk, a removed stump empty', async () => {
  await rolledBack(async (tx) => {
    const grove = await tx
      .selectFrom('woodlandDeposits')
      .select(['worldId', 'featureId'])
      .limit(1)
      .executeTakeFirstOrThrow();
    const tree = (treeIndex: number, values: Record<string, unknown>) =>
      tx
        .insertInto('woodlandTrees')
        .values({ ...grove, treeIndex, remainingAmount: 400, felledAt: new Date(), ...values } as never)
        .execute();
    await tree(0, { reservedAmount: 100 });
    await tree(1, { remainingAmount: 0, reservedAmount: 0, stumpRemovedAt: new Date() });
    await refused(tx, () => tree(2, { remainingAmount: 600 }), /woodland_trees_remaining_amount_check/);
    await refused(tx, () => tree(3, { reservedAmount: 450 }), /woodland_trees_check|reserved_amount/);
    await refused(tx, () => tree(4, { stumpRemovedAt: new Date() }), /woodland_trees_check/);
    await refused(tx, () => tree(0, {}), /woodland_trees_pkey/);
    // Lots and worksite targets may name their trees; null keeps the history.
    const columns = await sql<{ tableName: string; columnName: string; isNullable: string }>`
      select table_name,column_name,is_nullable from information_schema.columns
      where (table_name,column_name) in (('deposit_extractions','tree_index'),('extraction_worksite_targets','tree_indices'))
      order by table_name`.execute(tx);
    expect(columns.rows).toEqual([
      { tableName: 'deposit_extractions', columnName: 'tree_index', isNullable: 'YES' },
      { tableName: 'extraction_worksite_targets', columnName: 'tree_indices', isNullable: 'YES' },
    ]);
  });
  // A grove's trees disappear with it.
  const cascade = await sql<{ confdeltype: string }>`select confdeltype from pg_constraint
    where conrelid='woodland_trees'::regclass and contype='f'`.execute(db);
  expect(cascade.rows).toEqual([{ confdeltype: 'c' }]);
});
