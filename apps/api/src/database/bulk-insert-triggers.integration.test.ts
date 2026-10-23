import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabaseUrl } from './test-environment.js';
import { migrateToLatest } from './migrate.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test')
  throw Error('Unexpected bulk trigger database');
const pool = new pg.Pool({ connectionString: url, max: 2 });
beforeAll(async () => {
  await migrateToLatest(url);
}, 120000);
afterAll(async () => {
  await pool.end();
});

// The row triggers 060/061 replaced for plain inserts, as created by 041/042/053/054.
const historical = `
  drop trigger game_sync_shared_building on world_cell_occupancies;
  drop trigger game_sync_private_indirect_expansion on world_cell_occupancies;
  ${['world_cell_occupancies', 'world_features', 'woodland_deposits', 'stone_deposits']
    .map(
      (table) => `
    drop trigger bulk_insert_collect on ${table};
    drop trigger game_sync_shared on ${table};
    create trigger game_sync_shared after insert or update or delete on ${table} for each row execute function game_sync_shared_change();
    drop trigger village_sync_change on ${table};
    create trigger village_sync_change after insert or update or delete on ${table} for each row execute function mark_village_sync_change();
    ${
      table === 'stone_deposits'
        ? ''
        : `drop trigger navigation_change on ${table};
    create trigger navigation_change after insert or update or delete on ${table} for each row execute function mark_navigation_change();`
    }
    ${
      table === 'world_features'
        ? ''
        : `drop trigger game_sync_private_indirect on ${table};
    create trigger game_sync_private_indirect after insert or update or delete on ${table} for each row execute function game_sync_private_indirect_change();`
    }
  `,
    )
    .join('')}
  drop trigger bulk_insert_collect on science_places;
  drop trigger game_sync_shared on science_places;
  create trigger game_sync_shared after insert or update or delete on science_places for each row execute function game_sync_shared_change();
  drop trigger village_sync_change on science_places;
  create trigger village_sync_change after insert or update or delete on science_places for each row execute function mark_village_sync_change();`;

/** Every collected reference of the current transaction, as sorted text. */
async function collected(client: pg.PoolClient) {
  const rows = async (query: string) => (await client.query(query)).rows.map((row) => JSON.stringify(row)).sort();
  return [
    ...(await rows(
      'select world_id,stream_kind,scope_key,component,entity_key from game_sync_pending where transaction_id=txid_current()',
    )),
    ...(await rows(
      'select world_id,chunk_x,chunk_y from navigation_chunk_versions where transaction_id=txid_current()',
    )),
    ...(await rows('select world_id,navigation_changed from village_sync_changes where transaction_id=txid_current()')),
  ];
}

/** Runs the RC1-like insert sequence in a rolled-back transaction and returns
 * what each statement added to the collected references. */
const ids = {
  account: randomUUID(),
  world: randomUUID(),
  village: randomUUID(),
  building: randomUUID(),
  expansion: randomUUID(),
  worksite: randomUUID(),
  stone: randomUUID(),
  grove: randomUUID(),
  cleared: randomUUID(),
  outcrop: randomUUID(),
};
async function scenario(variant: 'statement' | 'historical') {
  const client = await pool.connect();
  const steps: string[][] = [];
  try {
    await client.query('begin');
    if (variant === 'historical') await client.query(historical);
    await client.query(
      `insert into accounts(id,email,password_hash) values($1::uuid,$1::text||'@bulk.test','fixture')`,
      [ids.account],
    );
    await client.query(
      `insert into worlds(id,slug,name,topology,width_cells,height_cells,chunk_size,seed,generation_status)
      values($1::uuid,'bulk-'||$1::text,'Bulk','torus',64,64,32,1,'ready')`,
      [ids.world],
    );
    await client.query(
      `insert into world_generation_candidates(world_id,command_id,owner_account_id,parameters,status,checksum,artifact)
      values($1,$2,$3,'{}','ready',$4,$5)`,
      [
        ids.world,
        randomUUID(),
        ids.account,
        'c'.repeat(64),
        JSON.stringify({
          forest: {
            trees: [
              { x: 30.5, y: 31.2, crown: 1.2, size: 1.1 },
              { x: 63.6, y: 2, crown: 1, size: 1 },
            ],
          },
          stoneSites: [],
        }),
      ],
    );
    await client.query(`insert into world_memberships(world_id,account_id,player_name) values($1,$2,'Bulk')`, [
      ids.world,
      ids.account,
    ]);
    await client.query(
      `insert into villages(id,world_id,owner_account_id,name,anchor_cell_x,anchor_cell_y) values($1,$2,$3,'Bulk',10,10)`,
      [ids.village, ids.world, ids.account],
    );
    await client.query(
      `insert into buildings(id,world_id,village_id,building_type,level,status,completed_at)
      values($1,$2,$3,'dwelling',1,'completed',now())`,
      [ids.building, ids.world, ids.village],
    );
    await client.query(
      `insert into building_expansions(id,world_id,village_id,building_id,status,started_at,completes_at)
      values($1,$2,$3,$4,'under-construction',now(),now()+interval '1 hour')`,
      [ids.expansion, ids.world, ids.village, ids.building],
    );
    // Each step starts from empty collections (rolled back anyway), so it
    // compares exactly what that one statement collects.
    const step = async (query: string, values: unknown[]) => {
      await client.query(`delete from game_sync_pending where transaction_id=txid_current();
        delete from navigation_chunk_versions where transaction_id=txid_current();
        delete from village_sync_changes where transaction_id=txid_current()`);
      await client.query(query, values);
      steps.push(await collected(client));
    };
    await step(
      `insert into world_features(id,world_id,feature_type_code,variant_seed)
      values($1,$4,'stone_outcrop',1),($2,$4,'woodland',2),($3,$4,'woodland',3),($5,$4,'stone_outcrop',4)`,
      [ids.stone, ids.grove, ids.cleared, ids.world, ids.outcrop],
    );
    await client.query(
      `insert into world_rc1_resources(world_id,feature_id,source_key,tree_indices,removed_indices)
      values($1,$2,'wood:cleared','[0,1]','[]')`,
      [ids.world, ids.cleared],
    );
    await client.query(
      `insert into extraction_worksites(id,world_id,village_id,command_id,resource_code,mode,worker_cap,requested_worker_cap)
      values($1,$2,$3,$4,'stone','extract',1,1)`,
      [ids.worksite, ids.world, ids.village, randomUUID()],
    );
    await client.query(
      `insert into extraction_worksite_targets(worksite_id,world_id,village_id,feature_id,ordinal)
      values($1,$2,$3,$4,0)`,
      [ids.worksite, ids.world, ids.village, ids.stone],
    );
    await step(
      `insert into stone_deposits(world_id,feature_id,cell_x,cell_y,initial_amount,remaining_amount)
      values($1,$2,40,40,10,10),($1,$3,63,0,10,10)`,
      [ids.world, ids.stone, ids.outcrop],
    );
    await step(
      `insert into woodland_deposits(world_id,feature_id,cell_x,cell_y,cleared) values($1,$2,31,31,false),($1,$3,0,63,true)`,
      [ids.world, ids.grove, ids.cleared],
    );
    await step(
      `insert into world_cell_occupancies(world_id,cell_x,cell_y,building_id,feature_id,role,pending_expansion_id) values
      ($1,40,40,null,$2,'body',null),($1,41,40,null,$2,'body',null),($1,31,32,null,$3,'body',null),
      ($1,10,10,$4,null,'anchor',null),($1,11,10,$4,null,'extension',$5)`,
      [ids.world, ids.stone, ids.grove, ids.building, ids.expansion],
    );
    // Survey of a completed building: cells with a feature occupancy, a
    // stone deposit, a grove, and bare ground; one already known (update).
    await client.query(`insert into player_science(world_id,account_id) values($1,$2)`, [ids.world, ids.account]);
    await client.query(
      `insert into science_places(world_id,account_id,cell_x,cell_y,terrain_code,elevation,observed_at,surveyed)
      values($1,$2,5,5,1,0,now(),false)`,
      [ids.world, ids.account],
    );
    await step(
      `insert into science_places(world_id,account_id,cell_x,cell_y,terrain_code,elevation,observed_at,surveyed)
      select $1,$2,x,y,1,0,now(),true from (values (40,40),(41,40),(31,31),(63,0),(12,12),(5,5)) cells(x,y)
      on conflict(world_id,account_id,cell_x,cell_y) do update set surveyed=excluded.surveyed`,
      [ids.world, ids.account],
    );
    return steps;
  } finally {
    await client.query('rollback');
    client.release();
  }
}

it('collects plain inserts once per statement with exactly the historical row-trigger references', async () => {
  const statement = await scenario('statement'),
    historical = await scenario('historical');
  // Same identifiers in both rolled-back runs: references compare exactly.
  expect(statement).toEqual(historical);
  expect(statement.every((step) => step.length > 0)).toBe(true);
}, 120000);
