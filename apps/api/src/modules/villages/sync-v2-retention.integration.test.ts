import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { up } from '../../database/migrations/051_game_sync_foundation.js';
import { up as batchDependencies } from '../../database/migrations/059_game_sync_batch_dependencies.js';
import type { Database } from '../../database/schema.js';
import { readJournalSelection } from './sync-v2-journal.js';
import {
  pruneSyncJournal,
  startSyncJournalRetention,
  sweepSyncBatches,
  type SyncBatchKey,
} from './sync-v2-retention.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected retention database');
const schema = `sync_retention_test_${randomUUID().replaceAll('-', '')}`;
const administration = new pg.Pool({ connectionString: url, max: 1 });
const pool = new pg.Pool({
  connectionString: url,
  max: 4,
  options: `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=8000`,
});
const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
const world = randomUUID();
beforeAll(async () => {
  await administration.query(`create schema ${schema}`);
  await up(db);
  await batchDependencies(db);
}, 60000);
afterAll(async () => {
  await db.destroy();
  await administration.query(`drop schema ${schema} cascade`);
  await administration.end();
}, 30000);

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
    } finally {
      client.release();
    }
  }
  await pool.query(
    `update game_sync_changes set recorded_at=now()-interval '8 days' where scope_key=$1 and revision<=$2`,
    [scope, old],
  );
  return scope;
}
const state = async (scope: string) => ({
  ...(
    await pool.query(
      "select epoch::text,revision::text,retained_from::text from game_sync_streams where stream_kind='village' and scope_key=$1",
      [scope],
    )
  ).rows[0],
  revisions: (
    await pool.query('select revision::int from game_sync_changes where scope_key=$1 order by revision', [scope])
  ).rows.map((row) => row.revision),
});
const select = (scope: string, epoch: string, revision: string) =>
  db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute((tx) =>
      readJournalSelection(
        tx as Transaction<Database>,
        world,
        { kind: 'village', key: scope },
        { epoch, revision },
        () => true,
      ),
    );
const options = { maxAgeMs: 7 * 24 * 3600000, maxEntries: 5, rowBudget: 100, streamBudget: 100, batchBudget: 100 };

it('keeps the last entries and the recent ones, raises the floor with the deletion and keeps epoch and revision', async () => {
  const counted = await stream(8),
    aged = await stream(4, 3),
    fresh = await stream(3);
  const before = { counted: await state(counted), aged: await state(aged), fresh: await state(fresh) };
  expect(await pruneSyncJournal(db, options)).toEqual({ streams: 2, rows: 3 + 3 });
  expect(await state(counted)).toEqual({ ...before.counted, retained_from: '3', revisions: [4, 5, 6, 7, 8] });
  expect(await state(aged)).toEqual({ ...before.aged, retained_from: '3', revisions: [4] });
  expect(await state(fresh)).toEqual(before.fresh);
  // A cursor below the floor resumes by snapshot; at the floor, by delta.
  expect(await select(counted, before.counted.epoch, '2')).toMatchObject({
    kind: 'snapshot-required',
    reason: 'floor',
  });
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
  const scope = await stream(7),
    before = await state(scope);
  const publisher = await pool.connect();
  try {
    await publisher.query('begin');
    await publisher.query('update game_sync_streams set revision=revision where scope_key=$1', [scope]);
    const started = Date.now();
    await pruneSyncJournal(db, options);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await state(scope)).toEqual(before);
  } finally {
    await publisher.query('rollback');
    publisher.release();
  }
  await pruneSyncJournal(db, options);
  expect(await state(scope)).toMatchObject({ retained_from: '2', revisions: [3, 4, 5, 6, 7] });
});

it('leaves other epochs and streams of the same key untouched', async () => {
  const scope = await stream(7);
  await sql`insert into game_sync_streams(world_id,stream_kind,scope_key,revision) values(${world},'knowledge',${scope},0)`.execute(
    db,
  );
  await pruneSyncJournal(db, options);
  expect(
    (await pool.query('select count(*)::int as n from game_sync_streams where scope_key=$1', [scope])).rows[0].n,
  ).toBe(2);
  expect(await state(scope)).toMatchObject({ retained_from: '2' });
});

it('lets a capture opened before a pass keep its consistent view, and the next one resume by snapshot', async () => {
  const scope = await stream(8),
    { epoch } = await state(scope);
  await db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      const read = () =>
        readJournalSelection(
          tx as Transaction<Database>,
          world,
          { kind: 'village', key: scope },
          { epoch, revision: '1' },
          () => true,
        );
      const before = await read();
      expect(before).toMatchObject({ kind: 'delta', cursor: { revision: '8' } });
      expect(await pruneSyncJournal(db, options)).toMatchObject({ rows: 3 });
      expect(await read()).toEqual(before);
    });
  expect(await select(scope, epoch, '1')).toMatchObject({ kind: 'snapshot-required', reason: 'floor' });
});

/** One multi-stream publication: its rows share one stored vector, returned. */
async function shared(...scopes: string[]): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const scope of scopes)
      await client.query("select game_sync_touch($1,'village',$2,'resources','shared')", [world, scope]);
    await client.query('select game_sync_publish()');
    await client.query('commit');
  } finally {
    client.release();
  }
  return (
    await pool.query(
      'select dependencies_batch_id::text as id from game_sync_changes where scope_key=$1 order by revision desc limit 1',
      [scopes[0]],
    )
  ).rows[0].id;
}
const headers = async (batch: string) =>
  (await pool.query('select count(*)::int as n from game_sync_batches where batch_id=$1', [batch])).rows[0].n;
/** Records the rows of these streams (and their vector) 8 days ago, as a publication of that day did. */
async function age(scopes: string[], batch?: string) {
  await pool.query(`update game_sync_changes set recorded_at=now()-interval '8 days' where scope_key=any($1)`, [
    scopes,
  ]);
  if (batch)
    await pool.query(`update game_sync_batches set recorded_at=now()-interval '8 days' where batch_id=$1`, [batch]);
}

it('removes a stored dependency vector with the last journal row that references it', async () => {
  const [left, right] = [randomUUID(), randomUUID()];
  const batch = await shared(left, right);
  await age([left]);
  await pruneSyncJournal(db, options);
  expect(await state(left)).toMatchObject({ retained_from: '1', revisions: [] });
  expect(await headers(batch)).toBe(1);
  await age([right]);
  await pruneSyncJournal(db, options);
  expect(await headers(batch)).toBe(0);
});

// Test barrier: an advisory key that no application lock uses. Its waiters
// are read from pg_locks, never inferred from two concurrent promises.
const BARRIER = 1597463007;
const barrierWaiters = async () =>
  (
    await administration.query<{ pid: number; blockers: number[] }>(
      `select pid,pg_blocking_pids(pid) as blockers from pg_locks where locktype='advisory' and not granted
        and classid=0 and objid=$1 and objsubid=1 and database=(select oid from pg_database where datname=current_database())`,
      [BARRIER],
    )
  ).rows;
async function until<T>(probe: () => Promise<T | undefined>, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw Error('Barrier not reached');
    await delay(10);
  }
}

it('lets no stored vector outlive its rows when two processes prune the streams sharing it at once', async () => {
  // Leftovers of earlier tests must not reach the barrier.
  await pruneSyncJournal(db, options);
  expect(await pruneSyncJournal(db, options)).toEqual({ streams: 0, rows: 0 });
  const [left, right] = [randomUUID(), randomUUID()].sort();
  const batch = await shared(left!, right!);
  await age([left!, right!], batch);
  // Every vector deletion statement, once evaluated, waits for the barrier
  // before its transaction commits.
  await pool.query(`create function retention_barrier() returns trigger language plpgsql as $$
    begin perform pg_advisory_xact_lock_shared(${BARRIER}); return null; end $$`);
  await pool.query(
    'create trigger retention_barrier after delete on game_sync_batches for each statement execute function retention_barrier()',
  );
  const holder = await pool.connect();
  let held = false;
  const release = async () => {
    if (held) await holder.query('select pg_advisory_unlock($1)', [BARRIER]);
    held = false;
  };
  const passes: Array<Promise<{ streams: number; rows: number }>> = [];
  let outcome: 'returned' | 'paused' | undefined;
  try {
    await holder.query('select pg_advisory_lock($1)', [BARRIER]);
    held = true;
    const holderPid = (await holder.query('select pg_backend_pid() as pid')).rows[0].pid;
    passes.push(pruneSyncJournal(db, options));
    void passes[0]!.catch(() => undefined);
    // Process 1 has removed its row of the vector, checked the vector and holds its transaction open.
    const paused = await until(async () => {
      const waiting = await barrierWaiters();
      return waiting.length === 1 ? waiting : undefined;
    });
    expect(paused[0]!.blockers).toEqual([holderPid]);
    expect(await headers(batch)).toBe(1);
    // Process 2 starts its own pass meanwhile.
    let settled = false;
    passes.push(pruneSyncJournal(db, options));
    void passes[1]!.then(
      () => (settled = true),
      () => (settled = true),
    );
    outcome = await until(async () =>
      settled ? 'returned' : (await barrierWaiters()).length === 2 ? 'paused' : undefined,
    );
    await release();
    await Promise.all(passes);
  } finally {
    await release();
    await Promise.allSettled(passes);
    holder.release();
    await pool.query('drop trigger retention_barrier on game_sync_batches; drop function retention_barrier()');
  }
  expect(await state(left!)).toMatchObject({ retained_from: '1', revisions: [] });
  expect(await state(right!)).toMatchObject({ retained_from: '1', revisions: [] });
  expect(await headers(batch)).toBe(0);
  // Retention excludes itself across processes, and the second pass stops instead of waiting.
  expect(outcome).toBe('returned');
  expect(await passes[1]).toEqual({ streams: 0, rows: 0 });
});

const dump = async () => ({
  streams: (await pool.query('select * from game_sync_streams order by world_id,stream_kind,scope_key')).rows,
  changes: (await pool.query('select * from game_sync_changes order by world_id,stream_kind,scope_key,epoch,revision'))
    .rows,
  batches: (await pool.query('select * from game_sync_batches order by world_id,batch_id')).rows,
});

it('rolls back the rows, the floor and the vector of a stream together when its pass fails after removing them', async () => {
  await pruneSyncJournal(db, options);
  expect(await pruneSyncJournal(db, options)).toEqual({ streams: 0, rows: 0 });
  const [left, right] = [randomUUID(), randomUUID()];
  const batch = await shared(left, right);
  await age([right]);
  await pruneSyncJournal(db, options);
  // The row of left is now the last one that references the vector.
  expect(await state(right)).toMatchObject({ retained_from: '1', revisions: [] });
  expect(await headers(batch)).toBe(1);
  // Whatever the caller, the foreign key refuses to delete a referenced vector.
  await expect(pool.query('delete from game_sync_batches where batch_id=$1', [batch])).rejects.toMatchObject({
    code: '23503',
  });
  await age([left], batch);
  const before = await dump();
  await pool.query(`create function retention_failure() returns trigger language plpgsql as $$ begin
    raise exception 'injected retention failure: % rows left, floor %, vector %',
      (select count(*) from game_sync_changes where scope_key=tg_argv[0]),
      (select retained_from from game_sync_streams where stream_kind='village' and scope_key=tg_argv[0]),
      (select count(*) from game_sync_batches where world_id=old.world_id and batch_id=old.batch_id);
  end $$`);
  await pool.query(
    `create trigger retention_failure after delete on game_sync_batches for each row execute function retention_failure('${left}')`,
  );
  try {
    // Raised once the transaction has removed the row, raised the floor and removed the vector.
    await expect(pruneSyncJournal(db, options)).rejects.toMatchObject({
      code: 'P0001',
      message: 'injected retention failure: 0 rows left, floor 1, vector 0',
    });
  } finally {
    await pool.query('drop trigger retention_failure on game_sync_batches; drop function retention_failure()');
  }
  expect(await dump()).toEqual(before);
  expect(await pruneSyncJournal(db, options)).toEqual({ streams: 1, rows: 1 });
  expect(await state(left)).toMatchObject({ retained_from: '1', revisions: [] });
  expect(await headers(batch)).toBe(0);
});

/** A stored vector without any journal row, as two overlapping passes left them. */
async function orphan(worldId: string, days: number): Promise<string> {
  return (
    await pool.query(
      `insert into game_sync_batches(world_id,batch_id,recorded_at,dependencies)
      values($1,gen_random_uuid(),now()-make_interval(days=>$2),'[]') returning batch_id::text as id`,
      [worldId, days],
    )
  ).rows[0].id;
}

it('stops a pass and a sweep without waiting while another process holds the retention', async () => {
  const scope = await stream(7),
    before = await state(scope),
    left = await orphan(randomUUID(), 8);
  const other = await pool.connect();
  try {
    await other.query('begin');
    await other.query("select pg_advisory_xact_lock(hashtextextended('sync-journal-retention',0))");
    const started = Date.now();
    expect(await pruneSyncJournal(db, options)).toEqual({ streams: 0, rows: 0 });
    expect(await sweepSyncBatches(db, null, options)).toEqual({ examined: 0, removed: 0, next: null });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await state(scope)).toEqual(before);
    expect(await headers(left)).toBe(1);
  } finally {
    await other.query('rollback');
    other.release();
  }
  await pruneSyncJournal(db, options);
  expect(await state(scope)).toMatchObject({ retained_from: '2', revisions: [3, 4, 5, 6, 7] });
});

it('sweeps old vectors that no row references, a bounded slice per call, and keeps referenced or recent ones', async () => {
  const owner = randomUUID();
  const legacy: string[] = [];
  for (let index = 0; index < 5; index++) legacy.push(await orphan(owner, 8 + index));
  const recent = await orphan(owner, 1);
  // Old and still referenced: its streams are not pruned yet.
  const [left, right] = [randomUUID(), randomUUID()];
  const referenced = await shared(left, right);
  await age([left, right], referenced);
  const total = (await pool.query('select count(*)::int as n from game_sync_batches')).rows[0].n;
  let after: SyncBatchKey | null = null,
    calls = 0;
  do {
    const sweep: Awaited<ReturnType<typeof sweepSyncBatches>> = await sweepSyncBatches(db, after, {
      ...options,
      batchBudget: 2,
    });
    expect(sweep.examined).toBeLessThanOrEqual(2);
    expect(sweep.removed).toBeLessThanOrEqual(sweep.examined);
    after = sweep.next;
    calls++;
  } while (after && calls < 1000);
  // One full walk of the primary key, two entries per call.
  expect(calls).toBe(Math.floor(total / 2) + 1);
  for (const batch of legacy) expect(await headers(batch)).toBe(0);
  expect(await headers(recent)).toBe(1);
  expect(await headers(referenced)).toBe(1);
  expect(await state(left)).toMatchObject({ revisions: [1] });
  // The next pass releases the referenced vector through its streams.
  await pruneSyncJournal(db, options);
  expect(await headers(referenced)).toBe(0);
});

it('sweeps after each periodic pass', async () => {
  const left = await orphan(randomUUID(), 8),
    errors: unknown[] = [];
  const stop = startSyncJournalRetention(db, 20, (error) => errors.push(error), options);
  try {
    await until(async () => ((await headers(left)) === 0 ? true : undefined));
  } finally {
    await stop();
  }
  expect(errors).toEqual([]);
});
