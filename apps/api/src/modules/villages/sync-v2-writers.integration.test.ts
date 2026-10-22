import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { up as foundation } from '../../database/migrations/051_game_sync_foundation.js';
import { up as writers, privateSyncSources, privateSyncIndirectSources, privateSyncLookupTables } from '../../database/migrations/053_game_sync_private_writers.js';
import { privateReaderComponents } from './sync-v2-readers.js';

const url = testDatabaseUrl(), target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected writer-test database');
const schema = `sync_writers_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
const pool = new pg.Pool({ connectionString: url, max: 2, options: `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=8000` });
const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
const world = randomUUID();
beforeAll(async () => {
  expect(new Set(privateSyncSources.map(([, component]) => component))).toEqual(privateReaderComponents);
  await admin.query(`create schema ${schema}`);
  await foundation(db);
  // Real column definitions, isolated rows and no foreign keys to production
  // fixtures. An incorrect table/key mapping fails this setup or the checks.
  for (const table of new Set([...privateSyncSources.map(([table]) => table), ...privateSyncIndirectSources, ...privateSyncLookupTables]))
    await pool.query(`create table ${table} (like public.${table} including defaults)`);
  for (const [table, , key] of privateSyncSources) {
    const columns = (await pool.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2', [schema, table])).rows.map(row => row.column_name);
    expect(columns).toContain('world_id');
    expect(columns).toContain(table === 'villages' ? 'id' : 'village_id');
    if (key === '@cell') { expect(columns).toContain('cell_x'); expect(columns).toContain('cell_y'); }
    else if (key !== '*') expect(columns).toContain(key.replace(/^\?/, ''));
  }
  await writers(db);
}, 60000);
afterAll(async () => { await db.destroy(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); }, 30000);
async function transact(run: (client: pg.PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try { await client.query('begin'); await run(client); await client.query('commit'); }
  catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
const changes = async (village: string) => (await pool.query(
  'select revision::text,changes,dependencies,batch_id from game_sync_changes where world_id=$1 and scope_key=$2 order by revision', [world, village])).rows;

it('publishes direct administrative writes at commit, with exact keys and one revision per private stream', async () => {
  const village = randomUUID();
  await transact(async client => {
    await client.query('insert into village_resources(world_id,village_id,resource_code,amount) values($1,$2,$3,100)', [world, village, 'wood']);
    await client.query('update village_resources set amount=75 where world_id=$1 and village_id=$2', [world, village]);
    expect(await changes(village)).toEqual([]);
  });
  expect(await changes(village)).toMatchObject([{ revision: '1', changes: [{ component: 'resources', key: 'wood' }] }]);
  await pool.query('update village_resources set amount=amount where world_id=$1 and village_id=$2', [world, village]);
  expect(await changes(village)).toHaveLength(1);
  await pool.query('delete from village_resources where world_id=$1 and village_id=$2', [world, village]);
  expect(await changes(village)).toMatchObject([{ revision: '1' }, { revision: '2', changes: [{ component: 'resources', key: 'wood' }] }]);
});
it('discards rolled-back savepoint touches while publishing the surviving mutation', async () => {
  const village = randomUUID();
  await transact(async client => {
    await client.query('insert into village_resources(world_id,village_id,resource_code,amount) values($1,$2,$3,100)', [world, village, 'wood']);
    await client.query('savepoint speculative');
    await client.query('insert into village_resources(world_id,village_id,resource_code,amount) values($1,$2,$3,100)', [world, village, 'stone']);
    await client.query('rollback to savepoint speculative');
  });
  expect((await changes(village))[0].changes).toEqual([{ component: 'resources', key: 'wood' }]);
});
it('publishes an expansion footprint change even when its parent row is unchanged', async () => {
  const village=randomUUID(), expansion=randomUUID(), building=randomUUID();
  await transact(async client=>{
    await client.query(`insert into building_expansions(id,world_id,village_id,building_id,status,started_at,completes_at)
      values($1,$2,$3,$4,'under-construction',statement_timestamp(),statement_timestamp()+interval '1 hour')`,[expansion,world,village,building]);
    await client.query(`insert into world_cell_occupancies(world_id,cell_x,cell_y,building_id,pending_expansion_id,role)
      values($1,10,20,$2,$3,'extension')`,[world,building,expansion]);
  });
  await pool.query('update world_cell_occupancies set cell_x=11 where world_id=$1 and pending_expansion_id=$2',[world,expansion]);
  expect((await changes(village))[1]).toMatchObject({revision:'2',changes:[{component:'buildingExpansions',key:expansion}]});
});
it('rolls back the observed stock and pending references on a named failure', async () => {
  const village = randomUUID(), failure = new Error('writer-failure-after-observed-stock');
  await expect(transact(async client => {
    await client.query('insert into village_resources(world_id,village_id,resource_code,amount) values($1,$2,$3,75)', [world, village, 'wood']);
    expect((await client.query('select amount from village_resources where village_id=$1', [village])).rows[0].amount).toBe('75');
    expect((await client.query('select entity_key from game_sync_pending where scope_key=$1', [village])).rows).toEqual([{ entity_key: 'wood' }]);
    throw failure;
  })).rejects.toBe(failure);
  expect(await changes(village)).toEqual([]);
  expect((await pool.query('select * from village_resources where village_id=$1', [village])).rows).toEqual([]);
  expect((await pool.query('select * from game_sync_pending where scope_key=$1', [village])).rows).toEqual([]);
});
it('rejects a business write after explicit terminal publication and rolls everything back', async () => {
  const village = randomUUID();
  await expect(transact(async client => {
    await client.query('insert into village_resources(world_id,village_id,resource_code,amount) values($1,$2,$3,100)', [world, village, 'wood']);
    await client.query('select game_sync_publish()');
    expect((await client.query('select revision from game_sync_streams where scope_key=$1', [village])).rows).toEqual([{ revision: '1' }]);
    await client.query('update village_resources set amount=75 where village_id=$1', [village]);
  })).rejects.toThrow('Business change after synchronization publication');
  expect(await changes(village)).toEqual([]);
  expect((await pool.query('select * from village_resources where village_id=$1', [village])).rows).toEqual([]);
});
it('publishes both sides of an ownership move in the same atomic batch', async () => {
  const first = randomUUID(), second = randomUUID();
  await pool.query('insert into village_resources(world_id,village_id,resource_code,amount) values($1,$2,$3,100)', [world, first, 'wood']);
  await pool.query('update village_resources set village_id=$1 where village_id=$2', [second, first]);
  const left = (await changes(first))[1], right = (await changes(second))[0];
  expect(left.batch_id).toBe(right.batch_id);
  expect(left.dependencies).toEqual(right.dependencies);
  expect(left.dependencies).toHaveLength(2);
});
