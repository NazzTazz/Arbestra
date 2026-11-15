import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { applyDesireStart, unionDesireEdges } from './desire-start.js';

/** Starting state of the desire paths (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §17, slice T3d):
 * the edges shown today are raised to the visibility threshold, never lowered, and a second run
 * changes and publishes nothing. The threshold is read from the database. */
const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected desire start test database');
const db = createDatabase(url);
let N = 0;

beforeAll(async () => {
  await migrateToLatest(url);
  await resetE2eState(url);
  N = (await sql<{ n: number }>`select world_desire_visible_passages() as n`.execute(db)).rows[0]!.n;
}, 180_000);
afterAll(async () => {
  await db.destroy();
});
const clean = async () => {
  await db.deleteFrom('worldDesireEdges').where('worldId', '=', ids.world).execute();
  await sql`delete from game_sync_changes where world_id=${ids.world} and stream_kind='desire'`.execute(db);
};
beforeEach(clean);
afterEach(clean);

const edges = () =>
  db
    .selectFrom('worldDesireEdges')
    .select(['cellX', 'cellY', 'direction', 'passages', 'lastPassageAt'])
    .where('worldId', '=', ids.world)
    .orderBy('cellX')
    .orderBy('cellY')
    .orderBy('direction')
    .execute();
const journalSize = async () =>
  Number(
    (
      await sql<{
        n: string;
      }>`select count(*)::text as n from game_sync_changes where world_id=${ids.world} and stream_kind='desire'`.execute(
        db,
      )
    ).rows[0]!.n,
  );

it('raises the shown edges to the threshold, keeps higher counts, and is idempotent', async () => {
  const old = new Date('2026-11-01T10:00:00Z');
  // An edge counted once since migration 085, another already well walked.
  await db
    .insertInto('worldDesireEdges')
    .values([
      { worldId: ids.world, cellX: 101, cellY: 200, direction: 0, passages: 1, lastPassageAt: old },
      { worldId: ids.world, cellX: 102, cellY: 200, direction: 0, passages: N + 4, lastPassageAt: old },
    ])
    .execute();
  const shown = unionDesireEdges([
    [
      { cellX: 100, cellY: 200, direction: 0 },
      { cellX: 101, cellY: 200, direction: 0 },
    ],
    [
      { cellX: 101, cellY: 200, direction: 0 },
      { cellX: 102, cellY: 200, direction: 0 },
      { cellX: 100, cellY: 200, direction: 1 },
    ],
  ]);
  expect(shown).toHaveLength(4);

  expect(await applyDesireStart(db, ids.world, shown)).toEqual({ inserted: 2, raised: 1, unchanged: 1 });
  const after = await edges();
  expect(after.map((e) => [e.cellX, e.cellY, e.direction, e.passages])).toEqual([
    [100, 200, 0, N],
    [100, 200, 1, N],
    [101, 200, 0, N],
    [102, 200, 0, N + 4],
  ]);
  // A raised or untouched edge keeps the date of its last real passage.
  expect(after[2]!.lastPassageAt).toEqual(old);
  expect(after[3]!.lastPassageAt).toEqual(old);
  // Three edges became visible: the chunk was published.
  const published = await journalSize();
  expect(published).toBeGreaterThan(0);

  // Second run: nothing changes, nothing is published.
  expect(await applyDesireStart(db, ids.world, shown)).toEqual({ inserted: 0, raised: 0, unchanged: 4 });
  expect(await edges()).toEqual(after);
  expect(await journalSize()).toBe(published);
});

it('writes nothing for no edge', async () => {
  expect(await applyDesireStart(db, ids.world, [])).toEqual({ inserted: 0, raised: 0, unchanged: 0 });
  expect(await edges()).toEqual([]);
});
