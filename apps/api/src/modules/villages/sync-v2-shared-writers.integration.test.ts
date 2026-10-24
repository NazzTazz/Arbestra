import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { up as foundation } from '../../database/migrations/051_game_sync_foundation.js';
import {
  up as privateWriters,
  privateSyncSources,
  privateSyncIndirectSources,
} from '../../database/migrations/053_game_sync_private_writers.js';
import {
  up as sharedWriters,
  sharedSyncSources,
  globalCatalogSyncSources,
} from '../../database/migrations/054_game_sync_shared_writers.js';
import { up as backfillScopes } from '../../database/migrations/055_game_sync_scope_backfill.js';
import { up as rc1BatchVertices } from '../../database/migrations/058_game_sync_rc1_batch_vertices.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected shared-writer database');
const schema = 'shared_writers_test_' + randomUUID().replaceAll('-', '');
const admin = new pg.Pool({ connectionString: url, max: 1 });
const pool = new pg.Pool({
  connectionString: url,
  max: 2,
  options: `-c search_path=${schema} -c statement_timeout=20000 -c lock_timeout=10000`,
});
const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
const world = randomUUID(),
  village = randomUUID(),
  owner = randomUUID();
beforeAll(async () => {
  await admin.query(`create schema ${schema}`);
  await foundation(db);
  for (const table of new Set([
    ...privateSyncSources.map(([table]) => table),
    ...privateSyncIndirectSources,
    ...sharedSyncSources,
    ...globalCatalogSyncSources,
  ]))
    await pool.query(`create table ${table} (like public.${table} including defaults)`);
  await pool.query(
    `insert into worlds(id,slug,name,topology,width_cells,height_cells,chunk_size,seed,generation_status)
    values($1,'shared-writer','Fixture','torus',64,64,32,1,'ready')`,
    [world],
  );
  await pool.query(
    `insert into villages(id,world_id,owner_account_id,name,anchor_cell_x,anchor_cell_y)
    values($1,$2,$3,'Fixture',5,5)`,
    [village, world, owner],
  );
  await privateWriters(db);
  await sharedWriters(db);
  await rc1BatchVertices(db);
}, 60000);
afterAll(async () => {
  await db.destroy();
  await admin.query(`drop schema ${schema} cascade`);
  await admin.end();
}, 30000);
async function transaction(run: (client: pg.PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await run(client);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
const journal = async () =>
  (
    await pool.query(
      'select stream_kind,scope_key,revision::text,changes,dependencies,batch_id from game_sync_changes order by stream_kind,scope_key,revision',
    )
  ).rows;

it('publishes construction and occupancy as linked private/spatial groups without a knowledge-wide refresh', async () => {
  const building = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `insert into buildings(id,world_id,village_id,building_type,level,status)
      values($1,$2,$3,'sawmill',1,'under-construction')`,
      [building, world, village],
    );
    await client.query(
      `insert into world_cell_occupancies(world_id,cell_x,cell_y,building_id,role)
      values($1,5,5,$2,'anchor')`,
      [world, building],
    );
  });
  const rows = await journal();
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.stream_kind))).toEqual(new Set(['village', 'spatial']));
  expect(new Set(rows.map((row) => row.batch_id)).size).toBe(1);
  expect(rows.find((row) => row.stream_kind === 'spatial').changes).toEqual([
    { component: 'spatialCells', key: '5,5' },
    { component: 'spatialExteriors', key: building },
  ]);
  expect(rows.every((row) => row.dependencies.length === 2)).toBe(true);
  // A bookkeeping clock does not invalidate the identity or shared science.
  await pool.query('update villages set created_at=statement_timestamp() where id=$1', [village]);
  expect(await journal()).toEqual(rows);
});
it('invalidates all affected chunk halos at a toric vertex boundary', async () => {
  await pool.query('insert into world_terrain_vertices(world_id,vertex_x,vertex_y,height) values($1,0,0,2)', [world]);
  const rows = (await journal()).filter((row) =>
    row.changes.some((change: { component: string }) => change.component === 'spatialGround'),
  );
  expect(new Set(rows.map((row) => row.scope_key))).toEqual(new Set(['0,0', '0,1', '1,0', '1,1']));
  expect(new Set(rows.map((row) => row.batch_id)).size).toBe(1);
});
it('publishes direct science and catalog writes to their own shared scopes', async () => {
  await pool.query(
    `insert into science_places(world_id,account_id,cell_x,cell_y,terrain_code,elevation,observed_at,surveyed)
    values($1,$2,6,6,1,0,statement_timestamp(),true)`,
    [world, owner],
  );
  const science = (await journal()).find((row) => row.stream_kind === 'knowledge');
  expect(science).toMatchObject({
    scope_key: owner,
    changes: [
      { component: 'knowledgePlaces', key: '6,6' },
      { component: 'knowledgeScience', key: '*' },
    ],
  });
  await pool.query("insert into resource_types(code,display_name,icon_key) values('wood','Bois','wood')");
  expect((await journal()).find((row) => row.stream_kind === 'manifest')).toMatchObject({
    scope_key: world,
    changes: [{ component: 'gameManifest', key: '*' }],
  });
});
it('rolls back observed cross-stream business writes and terminal publication on a named error', async () => {
  const before = await journal(),
    building = randomUUID(),
    failure = Error('shared-rollback-after-publication');
  await expect(
    transaction(async (client) => {
      await client.query(
        `insert into buildings(id,world_id,village_id,building_type,level,status)
      values($1,$2,$3,'sawmill',1,'under-construction')`,
        [building, world, village],
      );
      await client.query(
        `insert into world_cell_occupancies(world_id,cell_x,cell_y,building_id,role)
      values($1,7,7,$2,'anchor')`,
        [world, building],
      );
      expect((await client.query('select id from buildings where id=$1', [building])).rowCount).toBe(1);
      expect(
        (await client.query('select distinct stream_kind from game_sync_pending')).rows
          .map((row) => row.stream_kind)
          .sort(),
      ).toEqual(['spatial', 'village']);
      await client.query('select game_sync_publish()');
      expect((await client.query('select count(*)::integer as count from game_sync_changes')).rows[0].count).toBe(
        before.length + 2,
      );
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await journal()).toEqual(before);
  expect((await pool.query('select id from buildings where id=$1', [building])).rowCount).toBe(0);
  expect(
    (await pool.query('select building_id from world_cell_occupancies where building_id=$1', [building])).rowCount,
  ).toBe(0);
  expect((await pool.query('select * from game_sync_pending')).rowCount).toBe(0);
});
it('publishes revealed deposits without occupancy alongside the discovering knowledge', async () => {
  const feature = randomUUID();
  await pool.query(`insert into woodland_deposits(world_id,feature_id,cell_x,cell_y) values($1,$2,40,40)`, [
    world,
    feature,
  ]);
  const before = (await journal()).length;
  await pool.query(
    `insert into science_places(world_id,account_id,cell_x,cell_y,terrain_code,elevation,observed_at,surveyed)
    values($1,$2,40,40,1,0,statement_timestamp(),true)`,
    [world, owner],
  );
  const rows = await journal();
  expect(rows).toHaveLength(before + 2);
  const knowledge = rows.filter((row) => row.stream_kind === 'knowledge').at(-1)!;
  const companions = rows.filter((row) => row.batch_id === knowledge.batch_id);
  expect(companions).toHaveLength(2);
  expect(companions.find((row) => row.stream_kind === 'spatial')).toMatchObject({
    scope_key: '1,1',
    changes: [
      { component: 'spatialCells', key: '40,40' },
      { component: 'spatialFeatures', key: feature },
    ],
  });
});
it('publishes a grounded feature when its supporting vertex changes in another chunk', async () => {
  const feature = randomUUID();
  await pool.query(
    `insert into world_generation_candidates(world_id,command_id,owner_account_id,parameters,status,checksum,artifact)
    values($1,$2,$3,'{}','ready',$4,$5)`,
    [
      world,
      randomUUID(),
      owner,
      'a'.repeat(64),
      JSON.stringify({ forest: { trees: [{ x: 32.25, y: 32.25, elevation: 0 }] }, stoneSites: [] }),
    ],
  );
  await pool.query(`insert into woodland_deposits(world_id,feature_id,cell_x,cell_y) values($1,$2,31,31)`, [
    world,
    feature,
  ]);
  await pool.query(
    `insert into world_rc1_resources(world_id,feature_id,source_key,tree_indices,removed_indices)
    values($1,$2,'wood:boundary','[0]','[]')`,
    [world, feature],
  );
  expect(
    (
      await pool.query(
        'select vertex_x,vertex_y from game_sync_feature_vertices where world_id=$1 and feature_id=$2 order by vertex_x,vertex_y',
        [world, feature],
      )
    ).rows,
  ).toEqual([
    { vertex_x: 32, vertex_y: 32 },
    { vertex_x: 32, vertex_y: 33 },
    { vertex_x: 33, vertex_y: 32 },
    { vertex_x: 33, vertex_y: 33 },
  ]);
  await pool.query('insert into world_terrain_vertices(world_id,vertex_x,vertex_y,height) values($1,33,33,4)', [world]);
  const batch = (await journal())
    .filter((row) => row.stream_kind === 'spatial' && row.scope_key === '1,1')
    .at(-1)!.batch_id;
  const companions = (await journal()).filter((row) => row.batch_id === batch);
  expect(companions.find((row) => row.scope_key === '0,0')?.changes).toEqual(
    expect.arrayContaining([{ component: 'spatialFeatures', key: feature }]),
  );
  await pool.query(`update world_rc1_resources set removed_indices='[0]' where world_id=$1 and feature_id=$2`, [
    world,
    feature,
  ]);
  expect(
    (await pool.query('select * from game_sync_feature_vertices where world_id=$1 and feature_id=$2', [world, feature]))
      .rowCount,
  ).toBe(0);
});
it('grounds a multi-row RC1 insert exactly as the whole-world expansion, with the same spatial references', async () => {
  const other = randomUUID(),
    [woods, stone, removed] = [randomUUID(), randomUUID(), randomUUID()];
  await pool.query(
    `insert into worlds(id,slug,name,topology,width_cells,height_cells,chunk_size,seed,generation_status)
    values($1,'rc1-batch','Fixture','torus',64,64,32,1,'ready')`,
    [other],
  );
  await pool.query(
    `insert into world_generation_candidates(world_id,command_id,owner_account_id,parameters,status,checksum,artifact)
    values($1,$2,$3,'{}','ready',$4,$5)`,
    [
      other,
      randomUUID(),
      owner,
      'b'.repeat(64),
      JSON.stringify({
        forest: {
          trees: [
            { x: 10.4, y: 10.6 },
            { x: 63.7, y: 5 },
            { x: 20, y: 20 },
          ],
        },
        stoneSites: [
          {
            id: 's1',
            rocks: [
              { x: 40.2, y: 41.8 },
              { x: 42, y: 40 },
            ],
          },
        ],
      }),
    ],
  );
  await pool.query(
    `insert into woodland_deposits(world_id,feature_id,cell_x,cell_y) values($1,$2,10,10),($1,$3,20,20)`,
    [other, woods, removed],
  );
  await pool.query(
    `insert into stone_deposits(world_id,feature_id,cell_x,cell_y,initial_amount,remaining_amount) values($1,$2,41,41,10,10)`,
    [other, stone],
  );
  // The journal is ordered by scope, not time: tell new rows by their batch.
  const seen = new Set((await journal()).map((row) => row.batch_id));
  await pool.query(
    `insert into world_rc1_resources(world_id,feature_id,source_key,tree_indices,removed_indices)
    values($1,$2,'wood:a','[0,1]','[]'),($1,$3,'stone:s1','[]','[]'),($1,$4,'wood:b','[2]','[2]')`,
    [other, woods, stone, removed],
  );
  const vertices = async () =>
    (
      await pool.query(
        'select feature_id,vertex_x,vertex_y from game_sync_feature_vertices where world_id=$1 order by 1,2,3',
        [other],
      )
    ).rows;
  const batched = await vertices();
  // Toric wrap (63.7 → 0), rocks by source key, removed trees excluded.
  expect(batched.filter((row) => row.feature_id === woods)).toHaveLength(8);
  expect(batched.filter((row) => row.feature_id === stone)).toHaveLength(8);
  expect(batched.some((row) => row.feature_id === removed)).toBe(false);
  await pool.query('select game_sync_refresh_world_feature_vertices($1)', [other]);
  expect(await vertices()).toEqual(batched);
  const spatial = (await journal())
    .filter((row) => !seen.has(row.batch_id) && row.stream_kind === 'spatial')
    .flatMap((row) => row.changes);
  expect(spatial).toEqual(
    expect.arrayContaining([
      { component: 'spatialFeatures', key: woods },
      { component: 'spatialCells', key: '10,10' },
      { component: 'spatialFeatures', key: stone },
      { component: 'spatialCells', key: '41,41' },
      { component: 'spatialFeatures', key: removed },
    ]),
  );
  // An empty statement publishes nothing.
  const after = (await journal()).length;
  await pool.query(`insert into world_rc1_resources select * from world_rc1_resources where false`);
  expect((await journal()).length).toBe(after);
});
it('backfills every existing scope without replacing epochs and initializes new worlds at terminal publication', async () => {
  const before = (await pool.query('select * from game_sync_streams order by world_id,stream_kind,scope_key')).rows;
  await backfillScopes(db);
  const after = (await pool.query('select * from game_sync_streams order by world_id,stream_kind,scope_key')).rows;
  for (const row of before)
    expect(
      after.find(
        (candidate) =>
          candidate.world_id === row.world_id &&
          candidate.stream_kind === row.stream_kind &&
          candidate.scope_key === row.scope_key,
      ),
    ).toEqual(row);
  expect(
    after
      .filter((row) => row.world_id === world)
      .map((row) => `${row.stream_kind}:${row.scope_key}`)
      .sort(),
  ).toEqual(
    [
      `knowledge:${owner}`,
      `manifest:${world}`,
      'offers:all',
      'spatial:0,0',
      'spatial:0,1',
      'spatial:1,0',
      'spatial:1,1',
      `village:${village}`,
    ].sort(),
  );
  await backfillScopes(db);
  expect((await pool.query('select * from game_sync_streams order by world_id,stream_kind,scope_key')).rows).toEqual(
    after,
  );
  const added = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `insert into worlds(id,slug,name,topology,width_cells,height_cells,chunk_size,seed,generation_status)
      values($1,$2,'New fixture','torus',64,64,32,1,'ready')`,
      [added, 'shared-' + added],
    );
    expect((await client.query('select * from game_sync_streams where world_id=$1', [added])).rowCount).toBe(0);
    expect((await client.query('select * from game_sync_pending where world_id=$1', [added])).rowCount).toBe(6);
  });
  expect((await pool.query('select * from game_sync_streams where world_id=$1', [added])).rowCount).toBe(6);
  const published = (await journal()).filter(
    (row) =>
      row.scope_key === added ||
      row.dependencies.some((dependency: { worldId: string }) => dependency.worldId === added),
  );
  expect(published).toHaveLength(6);
  expect(new Set(published.map((row) => row.batch_id)).size).toBe(1);
});
