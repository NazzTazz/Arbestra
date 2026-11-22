import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { travelDuration, type TravelCell } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { pathTrailLookup, pathTravelDuration, readVisibleTrails } from './road-cost.js';

/** The beaten track as the server reads it (docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md §3.4,
 * R2b): only edges at the visibility threshold, by window or along a path, wrapped on the torus,
 * and only for the callers that ask for it. */
const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected road cost test database');
const db = createDatabase(url);
let N = 0,
  world = { worldId: ids.world, widthCells: 0, heightCells: 0 };

beforeAll(async () => {
  await migrateToLatest(url);
  await resetE2eState(url);
  N = (await sql<{ n: number }>`select world_desire_visible_passages() as n`.execute(db)).rows[0]!.n;
  const row = await db
    .selectFrom('worlds')
    .select(['widthCells', 'heightCells'])
    .where('id', '=', ids.world)
    .executeTakeFirstOrThrow();
  world = { worldId: ids.world, widthCells: row.widthCells, heightCells: row.heightCells };
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
const c = (cellX: number, cellY: number): TravelCell => ({ cellX, cellY });
const insert = (rows: Array<[number, number, 0 | 1 | 2 | 3, number]>) =>
  db
    .insertInto('worldDesireEdges')
    .values(
      rows.map(([cellX, cellY, direction, passages]) => ({
        worldId: ids.world,
        cellX,
        cellY,
        direction,
        passages,
        lastPassageAt: new Date('2026-11-22T12:00:00Z'),
      })),
    )
    .execute();

it('reads the visible edges of a window and of the cells around it, across the seams', async () => {
  const W = world.widthCells,
    H = world.heightCells;
  await insert([
    [10, 10, 0, N], // inside
    [11, 10, 2, N + 5], // inside, diagonal
    [12, 10, 1, N - 1], // inside, hidden
    [9, 12, 0, N], // west of the window: enters it eastward
    [40, 40, 0, N], // far away
    [W - 1, 5, 0, N], // across the seam, west of a window at x = 0
    [3, H - 1, 1, N], // across the seam, north of a window at y = 0
  ]);
  const read = await readVisibleTrails(db, world, { originCellX: 10, originCellY: 10, width: 10, height: 10 });
  expect(read).toEqual([
    { cellX: 9, cellY: 12, direction: 0 },
    { cellX: 10, cellY: 10, direction: 0 },
    { cellX: 11, cellY: 10, direction: 2 },
  ]);
  const seam = await readVisibleTrails(db, world, { originCellX: 0, originCellY: 0, width: 8, height: 8 });
  expect(seam).toEqual([
    { cellX: 3, cellY: H - 1, direction: 1 },
    { cellX: W - 1, cellY: 5, direction: 0 },
  ]);
});

it('times a mission path on its visible paths only when asked, as the village search costs it', async () => {
  await insert([
    [10, 10, 0, N],
    [11, 10, 0, N],
    [12, 10, 0, N - 1],
    [13, 10, 2, N],
  ]);
  const path = [c(10, 10), c(11, 10), c(12, 10), c(13, 10), c(14, 11)];
  const plain = travelDuration(path, world);
  expect(plain).toBe(Math.round((3 + Math.SQRT2) * 1000));
  expect(await pathTravelDuration(db, world, path)).toBe(plain);
  // Two straight steps and the diagonal on visible paths (0.9), the hidden edge at full cost.
  expect(await pathTravelDuration(db, world, path, { trails: true })).toBe(
    Math.round((2 * 0.9 + 1 + Math.SQRT2 * 0.9) * 1000),
  );
  const lookup = await pathTrailLookup(db, world, [path]);
  expect(lookup?.(c(11, 10), c(10, 10))).toBe(true);
  expect(lookup?.(c(12, 10), c(13, 10))).toBe(false);
  // Without a visible edge under the path, no lookup at all.
  expect(await pathTrailLookup(db, world, [[c(30, 30), c(31, 30)]])).toBeUndefined();
});
