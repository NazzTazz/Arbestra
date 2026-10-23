import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { up } from '../../database/migrations/051_game_sync_foundation.js';
import { up as batchDependencies } from '../../database/migrations/059_game_sync_batch_dependencies.js';
import type { Database } from '../../database/schema.js';
import { readJournalSelection, readSubscribedJournal } from './sync-v2-journal.js';

const url = testDatabaseUrl(), target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected journal database');
const schema = `sync_v2_test_${randomUUID().replaceAll('-', '')}`;
const administration = new pg.Pool({ connectionString: url, max: 1 });
const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=8000` });
const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
const world = randomUUID();
beforeAll(async () => {
  await administration.query(`create schema ${schema}`);
  await up(db); await batchDependencies(db);
  await pool.query('create table business_stock (id text primary key, amount int not null)');
  await pool.query("insert into business_stock values ('wood',100)");
}, 60000);
afterAll(async () => {
  await db.destroy();
  // The schema name is generated here, never supplied by the environment/user.
  await administration.query(`drop schema ${schema} cascade`);
  await administration.end();
}, 30000);
const touch = (client: pg.PoolClient, scope: string, key = 'wood') => client.query(
  "select game_sync_touch($1,'village',$2,'resources',$3)", [world, scope, key]);
const publish = (client: pg.PoolClient) => client.query('select game_sync_publish() as versions');
it('reads counters, journal and entities from one MVCC capture and filters private dependencies', async () => {
  const scope = randomUUID(), peer = randomUUID();
  await transaction(async client => { await touch(client, scope); await touch(client, peer); await publish(client); });
  const stream = (await pool.query('select epoch from game_sync_streams where scope_key=$1', [scope])).rows[0];
  await db.transaction().setIsolationLevel('repeatable read').execute(async tx => {
    await sql`set transaction read only`.execute(tx);
    const base = { epoch: stream.epoch, revision: '0' };
    const read = () => readJournalSelection(tx as Transaction<Database>, world, { kind: 'village', key: scope }, base,
      dependency => dependency.kind === 'village' && dependency.key === scope);
    const before = await read();
    expect(before).toMatchObject({ kind: 'delta', cursor: { revision: '1' }, dependencies: [{ key: scope }] });
    if (before.kind !== 'delta') throw Error('Expected complete journal');
    expect(before.dependencies).toHaveLength(1);
    const stock = (await sql<{ amount: number }>`select amount from business_stock where id='wood'`.execute(tx)).rows[0]!.amount;
    await transaction(async client => {
      await client.query("update business_stock set amount=amount+1 where id='wood'");
      await touch(client, scope, 'stone'); await publish(client);
    });
    expect(await read()).toEqual(before);
    expect((await sql<{ amount: number }>`select amount from business_stock where id='wood'`.execute(tx)).rows[0]!.amount).toBe(stock);
  });
  await db.transaction().setIsolationLevel('repeatable read').execute(async tx => {
    await sql`set transaction read only`.execute(tx);
    expect(await readJournalSelection(tx as Transaction<Database>, world, { kind: 'village', key: scope },
      { epoch: stream.epoch, revision: '1' }, dependency => dependency.key === scope))
      .toMatchObject({ kind: 'delta', cursor: { revision: '2' }, references: [{ component: 'resources', key: 'stone' }] });
  });
});
it('requires a scope snapshot for compacted, missing, future or foreign-epoch bases', async () => {
  const scope = randomUUID();
  await transaction(async client => { await touch(client, scope); await publish(client); });
  const stream = (await pool.query('select epoch from game_sync_streams where scope_key=$1', [scope])).rows[0];
  async function read(epoch: string, revision: string) {
    return db.transaction().setIsolationLevel('repeatable read').execute(async tx => {
      await sql`set transaction read only`.execute(tx);
      return readJournalSelection(tx as Transaction<Database>, world, { kind: 'village', key: scope }, { epoch, revision }, () => true);
    });
  }
  expect(await read(randomUUID(), '0')).toMatchObject({ kind: 'snapshot-required', reason: 'epoch' });
  expect(await read(stream.epoch, '2')).toMatchObject({ kind: 'snapshot-required', reason: 'ahead' });
  await pool.query('delete from game_sync_changes where scope_key=$1', [scope]);
  expect(await read(stream.epoch, '0')).toMatchObject({ kind: 'snapshot-required', reason: 'gap' });
  await pool.query('update game_sync_streams set retained_from=1 where scope_key=$1', [scope]);
  expect(await read(stream.epoch, '0')).toMatchObject({ kind: 'snapshot-required', reason: 'floor' });
  expect(await read(stream.epoch, '1')).toMatchObject({ kind: 'delta', references: [] });
});
it('captures all subscribed companions together and falls back together after compaction', async () => {
  const first=randomUUID(),second=randomUUID(),foreign=randomUUID();
  await transaction(async client=>{await touch(client,first);await touch(client,second);await publish(client);});
  await transaction(async client=>{await touch(client,second,'stone');await touch(client,foreign);await publish(client);});
  const counters=(await pool.query('select scope_key,epoch from game_sync_streams where scope_key=any($1)',[[first,second]])).rows;
  const subscriptions=counters.map(row=>({scope:{kind:'village' as const,key:row.scope_key},base:{epoch:row.epoch,revision:'0'}}));
  const capture=()=>db.transaction().setIsolationLevel('repeatable read').execute(async tx=>{
    await sql`set transaction read only`.execute(tx);
    return readSubscribedJournal(tx as Transaction<Database>,world,subscriptions);
  });
  const delta=await capture();
  expect(delta.kind).toBe('ready');
  if(delta.kind!=='ready')throw Error('Missing subscribed capture');
  expect(delta.coverage).toBe('delta');
  expect(delta.streams.find(stream=>stream.scope.key===second)).toMatchObject({cursor:{revision:'2'},references:expect.arrayContaining([
    {component:'resources',key:'wood'},{component:'resources',key:'stone'},
  ])});
  expect(JSON.stringify(delta)).not.toContain(foreign);
  await pool.query('update game_sync_streams set retained_from=1 where scope_key=$1',[second]);
  await pool.query('delete from game_sync_changes where scope_key=$1 and revision=1',[second]);
  const recovered=await capture();
  expect(recovered).toMatchObject({kind:'ready',coverage:'scope-snapshot'});
  if(recovered.kind!=='ready')throw Error('Missing snapshot capture');
  expect(new Set(recovered.streams.map(stream=>stream.scope.key))).toEqual(new Set([first,second]));
  expect(JSON.stringify(recovered)).not.toContain(foreign);
});
async function transaction(action: (client: pg.PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try { await client.query('begin'); await action(client); await client.query('commit'); }
  catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
async function captured(scope: string) {
  return {
    stock: (await pool.query('select * from business_stock order by id')).rows,
    stream: (await pool.query('select * from game_sync_streams where scope_key=$1', [scope])).rows,
    journal: (await pool.query('select * from game_sync_changes where scope_key=$1', [scope])).rows,
    pending: (await pool.query('select * from game_sync_pending where scope_key=$1', [scope])).rows,
  };
}
it('deduplicates keys, publishes once per stream and preserves cross-stream batch dependencies', async () => {
  const scope = randomUUID(), peer = randomUUID();
  let versions: unknown[] = [];
  await transaction(async client => {
    await touch(client, scope); await touch(client, scope); await touch(client, peer, 'stone');
    versions = (await publish(client)).rows[0].versions;
    expect(versions).toHaveLength(2);
    expect(versions.every(value => (value as { revision: string }).revision === '1')).toBe(true);
  });
  const rows = (await pool.query('select * from game_sync_changes where scope_key=any($1)', [[scope, peer]])).rows;
  expect(rows).toHaveLength(2);
  expect(rows[0].batch_id).toBe(rows[1].batch_id);
  // A multi-stream vector is stored once and equals the returned one; rows reference it.
  expect(rows.map(row => [row.dependencies, row.dependencies_batch_id])).toEqual([[[], rows[0].batch_id], [[], rows[0].batch_id]]);
  expect((await pool.query('select dependencies from game_sync_batches where batch_id=$1', [rows[0].batch_id])).rows)
    .toEqual([{ dependencies: versions }]);
  // A single-stream batch stays inline, without a header.
  await transaction(async client => { await touch(client, scope, 'clay'); await publish(client); });
  const single = (await pool.query('select * from game_sync_changes where scope_key=$1 and revision=2', [scope])).rows[0];
  expect(single).toMatchObject({ dependencies_batch_id: null, dependencies: [{ key: scope, revision: '2' }] });
  expect((await pool.query('select 1 from game_sync_batches where batch_id=$1', [single.batch_id])).rowCount).toBe(0);
  // Both forms read together, each vector once per capture.
  const read = await db.transaction().setIsolationLevel('repeatable read').execute(tx => readJournalSelection(tx as Transaction<Database>,
    world, { kind: 'village', key: scope }, { epoch: single.epoch, revision: '0' }, () => true));
  expect(read).toMatchObject({ kind: 'delta', cursor: { revision: '2' } });
  if (read.kind !== 'delta') throw Error('Expected complete journal');
  expect(new Map(read.dependencies.map(dependency => [dependency.key, dependency.revision]))).toEqual(new Map([[scope, '2'], [peer, '1']]));
  expect(rows.every(row => row.changes.length === 1)).toBe(true);
  expect((await captured(scope)).pending).toEqual([]);
});
it('rolls back observed business mutation, touches, journal and counter on an identified failure', async () => {
  const scope = randomUUID(), before = await captured(scope), failure = new Error('injected-after-published-mutation');
  await expect(transaction(async client => {
    await client.query("update business_stock set amount=75 where id='wood'");
    await touch(client, scope);
    expect((await client.query("select amount from business_stock where id='wood'")).rows[0].amount).toBe(75);
    expect((await client.query('select * from game_sync_pending where scope_key=$1', [scope])).rowCount).toBe(1);
    await publish(client);
    expect((await client.query('select * from game_sync_changes where scope_key=$1', [scope])).rowCount).toBe(1);
    throw failure;
  })).rejects.toBe(failure);
  expect(await captured(scope)).toEqual(before);
});
it('rolls back savepoint touches and rejects a late touch after publication', async () => {
  const scope = randomUUID();
  await transaction(async client => {
    await touch(client, scope);
    await client.query('savepoint discarded');
    await touch(client, scope, 'stone');
    expect((await client.query('select * from game_sync_pending where scope_key=$1', [scope])).rowCount).toBe(2);
    await client.query('rollback to savepoint discarded');
    await publish(client);
  });
  expect((await captured(scope)).journal[0].changes).toEqual([{ component: 'resources', key: 'wood' }]);
  const before = await captured(scope);
  await expect(transaction(async client => { await touch(client, scope); await publish(client); await touch(client, scope, 'late'); }))
    .rejects.toThrow('Business change after synchronization publication');
  expect(await captured(scope)).toEqual(before);
});
it('refuses commit when a writer collected changes but forgot terminal publication', async () => {
  const scope = randomUUID(), before = await captured(scope);
  await expect(transaction(async client => {
    await client.query("update business_stock set amount=75 where id='wood'");
    await touch(client, scope);
  })).rejects.toThrow('Synchronization changes were not published');
  expect(await captured(scope)).toEqual(before);
});
it('forces the second publisher to wait for the first commit before acquiring its revision', async () => {
  const scope = randomUUID(), first = await pool.connect(), second = await pool.connect();
  let flight: Promise<pg.QueryResult> | undefined;
  try {
    await first.query('begin'); await second.query('begin');
    await touch(first, scope); await touch(second, scope);
    await publish(first);
    const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
    flight = publish(second);
    // Attach rejection immediately even if the bounded wait below fails.
    void flight.catch(() => undefined);
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline) {
      const row = (await pool.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0];
      if (row?.wait_event_type === 'Lock') { waiting = true; break; }
      await delay(20);
    }
    expect(waiting).toBe(true);
    await first.query('commit');
    expect((await flight).rows[0].versions[0].revision).toBe('2');
    await second.query('commit');
    expect((await captured(scope)).journal.map(row => row.revision).sort()).toEqual(['1', '2']);
  } finally {
    await first.query('rollback');
    await flight?.catch(() => undefined);
    await second.query('rollback');
    first.release(); second.release();
  }
});

it('allows independent streams to commit in reverse publication order without hiding either change', async () => {
  const scope = randomUUID(), peer = randomUUID(), first = await pool.connect(), second = await pool.connect();
  try {
    await first.query('begin'); await second.query('begin');
    await touch(first, scope); await publish(first);
    await touch(second, peer); await publish(second); await second.query('commit');
    expect((await captured(peer)).journal).toHaveLength(1);
    expect((await captured(scope)).journal).toHaveLength(0);
    await first.query('commit');
    expect((await captured(scope)).journal[0].revision).toBe('1');
    expect((await captured(peer)).journal[0].revision).toBe('1');
  } finally {
    await first.query('rollback'); await second.query('rollback');
    first.release(); second.release();
  }
});
