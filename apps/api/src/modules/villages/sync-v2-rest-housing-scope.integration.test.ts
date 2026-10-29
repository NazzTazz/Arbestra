import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { readPrivateScopeSnapshot, readRegisteredPrivateChanges } from './sync-v2-readers.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected rest housing test database');
const db = createDatabase(url),
  through = new Date('2026-10-21T12:00:00Z');
beforeAll(async () => {
  await resetE2eState(url);
}, 180000);
afterAll(() => db.destroy());

const building = (
  buildingType: string,
  level: number,
  status: 'completed' | 'under-construction',
  targetLevel: number | null = null,
) =>
  db
    .insertInto('buildings')
    .values({
      worldId: ids.world,
      villageId: ids.village,
      buildingType,
      level,
      targetLevel,
      status,
      completedAt: status === 'completed' ? through : null,
      constructionStartedAt: status === 'completed' ? null : through,
      constructionCompletesAt: status === 'completed' ? null : through,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
    .then((row) => row.id);

/** Snapshot restHousing exactly as the client receives it, and the references it cost. */
async function snapshot() {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      await sql`set transaction read only`.execute(tx);
      const changes = await readPrivateScopeSnapshot(tx, { worldId: ids.world, villageId: ids.village, through });
      const housing = changes.find((change) => change.component === 'restHousing');
      if (housing?.component !== 'restHousing') throw Error('Missing restHousing');
      const countRows = await sql<{ n: number }>`select count(*)::int as n from buildings
        where world_id=${ids.world} and village_id=${ids.village}`.execute(tx);
      return { changes, housing: housing.upsert, buildings: countRows.rows[0]!.n };
    });
}
/** The old enumeration: every building offered to the restHousing reader. */
async function legacyHousing() {
  return db.transaction().execute(async (tx) => {
    const rows = await tx.selectFrom('buildings').select('id').where('villageId', '=', ids.village).execute();
    const [change] = await readRegisteredPrivateChanges(
      tx,
      { worldId: ids.world, villageId: ids.village, through },
      rows.map((row) => ({ component: 'restHousing', key: row.id })),
    );
    if (change?.component !== 'restHousing') throw Error('Missing restHousing');
    return change.upsert;
  });
}
async function references() {
  // The enumeration is the only caller of the 4096 bound; count what it offers.
  return db.transaction().execute(async (tx) => {
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from buildings
      where world_id=${ids.world} and village_id=${ids.village}
      and building_type in ('dwelling','town-hall') and (status='completed' or target_level is not null)`.execute(tx);
    return rows[0]!.n;
  });
}

it('enumerates restHousing only for housing, with the same visible state as every building', async () => {
  const dwelling = await building('dwelling', 1, 'completed');
  const upgrading = await building('dwelling', 1, 'completed', 2);
  await building('dwelling', 1, 'under-construction');
  for (let i = 0; i < 6; i++) await building('sawmill', 1, 'completed');
  const before = await snapshot();
  expect(before.housing.map((row) => row.buildingId)).toEqual(expect.arrayContaining([dwelling, upgrading]));
  expect(new Set(before.housing.map((row) => row.buildingId)).size).toBe(before.housing.length);
  // Parity: what the old enumeration (all buildings) gave the client.
  const legacy = await legacyHousing();
  expect(before.housing.toSorted((a, b) => a.buildingId.localeCompare(b.buildingId))).toEqual(
    legacy.toSorted((a, b) => a.buildingId.localeCompare(b.buildingId)),
  );
  // Non-housing buildings cost no reference.
  expect(before.buildings).toBeGreaterThan(before.housing.length);
  expect(await references()).toBe(before.housing.length);
  // Other components keep all their buildings.
  const buildings = before.changes.find((change) => change.component === 'buildings');
  expect(buildings?.upsert).toHaveLength(before.buildings);
});

it('fits a village whose building count alone would have doubled past the bound', async () => {
  // 2100 non-housing buildings: two references each used to exceed 4096.
  await sql`insert into buildings(world_id,village_id,building_type,level,status,completed_at)
    select ${ids.world},${ids.village},'sawmill',1,'completed',${through} from generate_series(1,2100)`.execute(db);
  const result = await snapshot();
  expect(result.buildings).toBeGreaterThan(2100);
  expect(result.changes.find((change) => change.component === 'buildings')?.upsert).toHaveLength(result.buildings);
  await sql`delete from buildings where village_id=${ids.village} and building_type='sawmill'`.execute(db);
}, 120000);

it('journals a building that becomes housing, and a demolished housing', async () => {
  const id = await building('dwelling', 1, 'under-construction');
  const touched = async (run: (tx: Transaction<Database>) => Promise<unknown>) =>
    db.transaction().execute(async (tx) => {
      await run(tx);
      const { rows } = await sql<{ key: string }>`select entity_key as key from game_sync_pending
        where transaction_id=txid_current() and component='restHousing'`.execute(tx);
      return rows.map((row) => row.key);
    });
  expect(
    await touched((tx) =>
      tx.updateTable('buildings').set({ status: 'completed', completedAt: through }).where('id', '=', id).execute(),
    ),
  ).toContain(id);
  expect(await touched((tx) => tx.updateTable('buildings').set({ level: 2 }).where('id', '=', id).execute())).toContain(
    id,
  );
  expect(await touched((tx) => tx.deleteFrom('buildings').where('id', '=', id).execute())).toContain(id);
});
