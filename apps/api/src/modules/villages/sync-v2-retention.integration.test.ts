import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { up } from '../../database/migrations/051_game_sync_foundation.js';
import type { Database } from '../../database/schema.js';
import { readJournalSelection } from './sync-v2-journal.js';
import { pruneSyncJournal } from './sync-v2-retention.js';

const url = testDatabaseUrl(), target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected retention database');
const schema = `sync_retention_test_${randomUUID().replaceAll('-', '')}`;
const administration = new pg.Pool({ connectionString: url, max: 1 });
const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=8000` });
const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
const world = randomUUID();
beforeAll(async () => { await administration.query(`create schema ${schema}`); await up(db); }, 60000);
afterAll(async () => { await db.destroy(); await administration.query(`drop schema ${schema} cascade`); await administration.end(); }, 30000);

/** Publishes `count` revisions on a fresh village stream, the first `old` of them recorded 8 days ago. */
async function stream(count: number, old = 0) {
  const scope = randomUUID();
  for (let index = 0; index < count; index++) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select game_sync_touch($1,'village',$2,'resources',$3)", [world, scope, 'r' + index]);
      await client.query('select game_sync_publish()');
      await client.query('commit');
    } finally { client.release(); }
  }
  await pool.query(`update game_sync_changes set recorded_at=now()-interval '8 days' where scope_key=$1 and revision<=$2`, [scope, old]);
  return scope;
}
const state = async (scope: string) => ({
  ...(await pool.query("select epoch::text,revision::text,retained_from::text from game_sync_streams where stream_kind='village' and scope_key=$1", [scope])).rows[0],
  revisions: (await pool.query('select revision::int from game_sync_changes where scope_key=$1 order by revision', [scope])).rows.map(row => row.revision),
});
const select = (scope: string, epoch: string, revision: string) => db.transaction().setIsolationLevel('repeatable read').execute(tx =>
  readJournalSelection(tx as Transaction<Database>, world, { kind: 'village', key: scope }, { epoch, revision }, () => true));
const options = { maxAgeMs: 7 * 24 * 3600000, maxEntries: 5, rowBudget: 100, streamBudget: 100 };

it('keeps the last entries and the recent ones, raises the floor with the deletion and keeps epoch and revision', async () => {
  const counted = await stream(8), aged = await stream(4, 3), fresh = await stream(3);
  const before = { counted: await state(counted), aged: await state(aged), fresh: await state(fresh) };
  expect(await pruneSyncJournal(db, options)).toEqual({ streams: 2, rows: 3 + 3 });
  expect(await state(counted)).toEqual({ ...before.counted, retained_from: '3', revisions: [4, 5, 6, 7, 8] });
  expect(await state(aged)).toEqual({ ...before.aged, retained_from: '3', revisions: [4] });
  expect(await state(fresh)).toEqual(before.fresh);
  // A cursor below the floor resumes by snapshot; at the floor, by delta.
  expect(await select(counted, before.counted.epoch, '2')).toMatchObject({ kind: 'snapshot-required', reason: 'floor' });
  expect(await select(counted, before.counted.epoch, '3')).toMatchObject({ kind: 'delta', cursor: { revision: '8' } });
  expect(await select(aged, before.aged.epoch, '3')).toMatchObject({ kind: 'delta', references: [{ key: 'r3' }] });
  expect(await pruneSyncJournal(db, options)).toEqual({ streams: 0, rows: 0 });
});

it('advances a stream by at most its row budget per pass', async () => {
  const scope = await stream(9);
  expect(await pruneSyncJournal(db, { ...options, rowBudget: 2 })).toMatchObject({ rows: 2 });
  expect(await state(scope)).toMatchObject({ retained_from: '2', revisions: [3, 4, 5, 6, 7, 8, 9] });
  await pruneSyncJournal(db, { ...options, rowBudget: 2 });
  expect(await state(scope)).toMatchObject({ retained_from: '4', revisions: [5, 6, 7, 8, 9] });
});

it('skips a stream whose counter a publisher holds instead of waiting for it', async () => {
  const scope = await stream(7), before = await state(scope);
  const publisher = await pool.connect();
  try {
    await publisher.query('begin');
    await publisher.query('update game_sync_streams set revision=revision where scope_key=$1', [scope]);
    const started = Date.now();
    await pruneSyncJournal(db, options);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await state(scope)).toEqual(before);
  } finally { await publisher.query('rollback'); publisher.release(); }
  await pruneSyncJournal(db, options);
  expect(await state(scope)).toMatchObject({ retained_from: '2', revisions: [3, 4, 5, 6, 7] });
});

it('leaves other epochs and streams of the same key untouched', async () => {
  const scope = await stream(7);
  await sql`insert into game_sync_streams(world_id,stream_kind,scope_key,revision) values(${world},'knowledge',${scope},0)`.execute(db);
  await pruneSyncJournal(db, options);
  expect((await pool.query("select count(*)::int as n from game_sync_streams where scope_key=$1", [scope])).rows[0].n).toBe(2);
  expect(await state(scope)).toMatchObject({ retained_from: '2' });
});

it('lets a capture opened before a pass keep its consistent view, and the next one resume by snapshot', async () => {
  const scope = await stream(8), { epoch } = await state(scope);
  await db.transaction().setIsolationLevel('repeatable read').execute(async tx => {
    const read = () => readJournalSelection(tx as Transaction<Database>, world, { kind: 'village', key: scope }, { epoch, revision: '1' }, () => true);
    const before = await read();
    expect(before).toMatchObject({ kind: 'delta', cursor: { revision: '8' } });
    expect(await pruneSyncJournal(db, options)).toMatchObject({ rows: 3 });
    expect(await read()).toEqual(before);
  });
  expect(await select(scope, epoch, '1')).toMatchObject({ kind: 'snapshot-required', reason: 'floor' });
});
