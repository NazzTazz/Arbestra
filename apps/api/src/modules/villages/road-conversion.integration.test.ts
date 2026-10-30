import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { InfrastructurePlan, RoadStroke } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import type { Database } from '../../database/schema.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import * as conversionMigration from '../../database/migrations/076_legacy_road_conversion.js';
import { captureSyncV2 } from './sync-v2-capture.js';
import { convertLegacyRoads, countLegacyRoadConversion, legacyRoadCells } from './road-conversion.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected road conversion test database');
const db = createDatabase(url);
const ids = {
  world: randomUUID(),
  village: randomUUID(),
  account: randomUUID(),
  neighbour: randomUUID(),
  neighbourAccount: randomUUID(),
};
const slug = 'road-conversion-' + ids.world;
const world = { widthCells: 128, heightCells: 128 };

/** A stroke between cell centres (or any eighth of a cell). */
let strokeId = 0;
const stroke = (
  points: Array<[number, number]>,
  material: RoadStroke['material'],
  border = false,
  width = 4,
  operation: RoadStroke['operation'] = 'paint',
): RoadStroke => ({
  id: 'r' + ++strokeId,
  points: points.map(([x, y]) => ({ x: Math.round(x * 8), y: Math.round(y * 8) })),
  width,
  material,
  border,
  operation,
});
/** The synthetic legacy plan (see the test for what each part proves). */
const legacyPlan = (): InfrastructurePlan => ({
  revision: 7,
  roads: [
    // Straight, later partly restyled and partly removed.
    stroke(
      [
        [56, 60],
        [60, 60],
      ],
      'stone-1',
    ),
    // Elbow: its inner corner is a re-entrant anchor.
    stroke(
      [
        [56, 62],
        [58, 62],
        [58, 65],
      ],
      'earth',
    ),
    // Full width on the boundary of rows 67 and 68: half of each cell.
    stroke(
      [
        [60, 67.5],
        [62, 67.5],
      ],
      'rubble',
      false,
      8,
    ),
    // Narrow, on the boundary of rows 69 and 70: a quarter of each cell, lost.
    stroke(
      [
        [64, 69.5],
        [66, 69.5],
      ],
      'earth',
    ),
    // Sidewalks and another surface; (66,58) already is an own road cell,
    // (70,58) a neighbour's.
    stroke(
      [
        [66, 58],
        [70, 58],
      ],
      'stone-2',
      true,
    ),
    // Most recent stroke on (59,60) and (60,60).
    stroke(
      [
        [59, 60],
        [60, 60],
      ],
      'rubble',
      true,
    ),
    // Removal of (56,60) and of half of (57,60).
    stroke(
      [
        [56, 60],
        [57, 60],
      ],
      'none',
      false,
      4,
      'remove',
    ),
    // Through the town hall (64,64).
    stroke(
      [
        [63, 64],
        [65, 64],
      ],
      'earth',
    ),
    // Onto water (60,70).
    stroke(
      [
        [60, 70],
        [60, 71],
      ],
      'earth',
    ),
  ],
  equipment: [
    // Near the corner (59,60) of the straight road: moved there.
    { id: 'e1', x: 466, y: 475, quarterTurns: 0, version: 1 },
    // Far from any road: deleted.
    { id: 'e2', x: 320, y: 320, quarterTurns: 0, version: 1 },
  ],
  // The brazier's cell (no matching anchor) and a far cell: abandoned.
  manualLighting: ['58:59', '40:40'],
  // The automatic fire of the elbow, inside (58,62) towards (57,63).
  suppressedBraziers: ['auto:58:62:sub:464:496:-1:1'],
  stoneReserve: 137,
  inheritedRoads: [],
  inheritedCells: [],
});

async function settle(villageId: string, anchorCellX: number, anchorCellY: number, accountId: string) {
  const now = new Date();
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@conversion.test', passwordHash: 'fixture' })
    .execute();
  await db
    .insertInto('worldMemberships')
    .values({ worldId: ids.world, accountId, playerName: accountId.slice(0, 8) })
    .execute();
  await db
    .insertInto('villages')
    .values({
      id: villageId,
      worldId: ids.world,
      ownerAccountId: accountId,
      name: 'Convert ' + villageId.slice(0, 4),
      anchorCellX,
      anchorCellY,
      economyActivatedAt: now,
    })
    .execute();
  const hall = await db
    .insertInto('buildings')
    .values({
      worldId: ids.world,
      villageId,
      buildingType: 'town-hall',
      level: 1,
      status: 'completed',
      completedAt: now,
      constructionStartedAt: null,
      constructionCompletesAt: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('worldCellOccupancies')
    .values({
      worldId: ids.world,
      cellX: anchorCellX,
      cellY: anchorCellY,
      buildingId: hall.id,
      featureId: null,
      role: 'anchor',
    })
    .execute();
  await db
    .insertInto('villageResources')
    .values({ worldId: ids.world, villageId, resourceCode: 'stone', amount: 2000 })
    .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: 2000 }))
    .execute();
}

beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('worlds')
    .values({
      id: ids.world,
      slug,
      name: 'Road conversion',
      topology: 'torus',
      widthCells: 128,
      heightCells: 128,
      chunkSize: 32,
      seed: 1,
      generationVersion: 1,
      generationStatus: 'ready',
      generatedAt: new Date(),
      isOpen: false,
    })
    .execute();
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++)
      await db
        .insertInto('worldChunks')
        .values({
          worldId: ids.world,
          chunkX: x,
          chunkY: y,
          generationVersion: 1,
          // Water (code 2) on cell (60, 70).
          terrainCodes: Array.from({ length: 1024 }, (_, i) =>
            x === 1 && y === 2 && i === (70 - 64) * 32 + (60 - 32) ? 2 : 1,
          ),
          elevations: Array(1024).fill(1),
        })
        .execute();
  await settle(ids.village, 64, 64, ids.account);
  await settle(ids.neighbour, 72, 64, ids.neighbourAccount);
}, 120000);
afterAll(async () => {
  await db.deleteFrom('worlds').where('id', '=', ids.world).execute();
  await db.deleteFrom('accounts').where('id', 'in', [ids.account, ids.neighbourAccount]).execute();
  await db.destroy();
}, 30000);

type Executor = Kysely<Database>;
const cells = (q: Executor = db) =>
  q
    .selectFrom('roadCells')
    .select(['villageId', 'cellX', 'cellY', 'surface', 'sidewalks', 'revision'])
    .where('worldId', '=', ids.world)
    .orderBy('cellX')
    .orderBy('cellY')
    .execute();
const anchors = (q: Executor = db) =>
  q
    .selectFrom('roadAnchors')
    .select(['villageId', 'vertexX', 'vertexY', 'accessory'])
    .where('worldId', '=', ids.world)
    .orderBy('vertexX')
    .orderBy('vertexY')
    .execute();
const stone = async (q: Executor = db) =>
  Number(
    (
      await q
        .selectFrom('villageResources')
        .select('amount')
        .where('worldId', '=', ids.world)
        .where('villageId', '=', ids.village)
        .where('resourceCode', '=', 'stone')
        .executeTakeFirstOrThrow()
    ).amount,
  );
const plan = async (q: Executor = db) =>
  (
    await q
      .selectFrom('villageInfrastructure')
      .select('plan')
      .where('worldId', '=', ids.world)
      .where('villageId', '=', ids.village)
      .executeTakeFirstOrThrow()
  ).plan;
/** Only this world: the test database holds other suites' worlds. */
const convert = () => db.transaction().execute((tx) => convertLegacyRoads(tx, ids.world));

it('keeps a stroke that ends at a cell centre and drops a quarter-cell stroke (pure)', () => {
  const result = legacyRoadCells(
    {
      revision: 0,
      roads: [
        stroke(
          [
            [10, 10],
            [12, 10],
          ],
          'earth',
        ),
        stroke(
          [
            [10, 12.5],
            [12, 12.5],
          ],
          'earth',
        ),
      ],
      equipment: [],
      manualLighting: [],
      suppressedBraziers: [],
      stoneReserve: 0,
    },
    world,
  );
  expect(result.cells.map((c) => [c.cellX, c.cellY])).toEqual([
    [10, 10],
    [11, 10],
    [12, 10],
  ]);
  expect(result.strokes).toEqual({ manual: 2, removed: 0, inherited: 0, lost: 1 });
});

it('converts a legacy plan into road cells and anchors, drops the reserve unrefunded, empties the plan, and reverts', async () => {
  // Existing road cells: one of the village (kept as it is), one of the neighbour.
  await db
    .insertInto('roadCells')
    .values([
      { worldId: ids.world, villageId: ids.village, cellX: 66, cellY: 58, surface: 'earth', sidewalks: false },
      { worldId: ids.world, villageId: ids.neighbour, cellX: 70, cellY: 58, surface: 'earth', sidewalks: false },
    ])
    .execute();
  const original = legacyPlan();
  await db
    .insertInto('villageInfrastructure')
    .values({ worldId: ids.world, villageId: ids.village, plan: JSON.stringify(original) })
    .execute();
  const revisionBefore = Number(
    (
      await sql<{ revision: string | null }>`select max(revision)::text as revision from game_sync_changes
        where world_id=${ids.world} and stream_kind='village' and scope_key=${ids.village}`.execute(db)
    ).rows[0]!.revision ?? 0,
  );

  // Read-only count first: same report, nothing written.
  const counted = await db.transaction().execute(async (tx) => {
    await sql`set transaction read only`.execute(tx);
    return countLegacyRoadConversion(tx, ids.world);
  });
  expect(await cells()).toHaveLength(2);
  expect(await anchors()).toEqual([]);

  const reports = await convert();
  expect(reports).toEqual(counted);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({
    villageId: ids.village,
    strokes: { manual: 8, removed: 1, inherited: 0, lost: 1 },
    cells: {
      candidates: 26,
      created: 22,
      kept: 1,
      refused: { FOREIGN_INFRASTRUCTURE: 1, CELL_OCCUPIED: 1, INCOMPATIBLE_TERRAIN: 1 },
    },
    braziers: { manual: 2, moved: 1, deleted: 1 },
    suppressions: { entries: 3, translated: 1, abandoned: 2, anchors: 1 },
    stone: { reserve: 137, credited: 0 },
  });

  // The backup keeps the report (read as text: the camel-case plugin would
  // rename its refusal codes).
  const stored = await sql<{ report: string }>`select report::text as report from road_conversion_backups
    where world_id=${ids.world} and village_id=${ids.village}`.execute(db);
  expect(JSON.parse(stored.rows[0]!.report)).toEqual(reports[0]);
  const own = (await cells()).filter((c) => c.villageId === ids.village);
  const style = (x: number, y: number) => {
    const c = own.find((r) => r.cellX === x && r.cellY === y);
    return c ? `${c.surface}${c.sidewalks ? '+' : ''}` : null;
  };
  // Straight: (56,60) removed, (57,60) half removed but its centre stays;
  // the most recent stroke styles (59,60) and (60,60).
  expect([56, 57, 58, 59, 60].map((x) => style(x, 60))).toEqual([null, 'stone-1', 'stone-1', 'rubble+', 'rubble+']);
  // Elbow.
  expect(
    [
      [56, 62],
      [57, 62],
      [58, 62],
      [58, 63],
      [58, 64],
      [58, 65],
    ].map(([x, y]) => style(x!, y!)),
  ).toEqual(Array(6).fill('earth'));
  // Half of two rows of cells each.
  for (const y of [67, 68]) expect([60, 61, 62].map((x) => style(x, y))).toEqual(Array(3).fill('rubble'));
  // The quarter-cell stroke gives nothing.
  for (const y of [69, 70]) expect([64, 65, 66].map((x) => style(x, y))).toEqual([null, null, null]);
  // Sidewalks; the existing own cell is kept as it was, the neighbour's stays its own.
  expect([66, 67, 68, 69].map((x) => style(x, 58))).toEqual(['earth', 'stone-2+', 'stone-2+', 'stone-2+']);
  expect((await cells()).find((c) => c.cellX === 70 && c.cellY === 58)).toMatchObject({ villageId: ids.neighbour });
  expect(own.find((c) => c.cellX === 66)).toMatchObject({ revision: 1 });
  // No road cell under the town hall nor on water.
  expect([style(63, 64), style(64, 64), style(65, 64)]).toEqual(['earth', null, 'earth']);
  expect([style(60, 70), style(60, 71)]).toEqual([null, 'earth']);
  expect(own).toHaveLength(23);
  const underBuildings = await sql<{ n: number }>`select count(*)::int as n from road_cells r
    join world_cell_occupancies o on o.world_id=r.world_id and o.cell_x=r.cell_x and o.cell_y=r.cell_y
    where r.world_id=${ids.world} and o.building_id is not null`.execute(db);
  expect(underBuildings.rows[0]!.n).toBe(0);

  // The manual brazier moved to the corner (59,60); the elbow's suppressed
  // automatic brazier became `none` on its re-entrant corner (58,63).
  expect(await anchors()).toEqual([
    { villageId: ids.village, vertexX: 58, vertexY: 63, accessory: 'none' },
    { villageId: ids.village, vertexX: 59, vertexY: 60, accessory: 'brazier' },
  ]);
  // The reserve of 137/256 is dropped without refund; the plan is emptied.
  expect(await stone()).toBe(2000);
  expect(await plan()).toEqual({
    revision: 8,
    roads: [],
    equipment: [],
    manualLighting: [],
    suppressedBraziers: [],
    stoneReserve: 0,
  });

  // Published through the V2 triggers, in one batch.
  const journal = (
    await sql<{ revision: string; changes: Array<{ component: string; key: string }> }>`select revision::text,changes
      from game_sync_changes where world_id=${ids.world} and stream_kind='village' and scope_key=${ids.village}
      order by revision desc limit 1`.execute(db)
  ).rows[0]!;
  expect(Number(journal.revision)).toBe(revisionBefore + 1);
  const keys = (component: string) =>
    journal.changes
      .filter((c) => c.component === component)
      .map((c) => c.key)
      .sort();
  expect(keys('roadCells')).toHaveLength(22);
  expect(keys('roadAnchors')).toEqual(['58,63', '59,60']);
  expect(keys('infrastructure')).toEqual(['*']);
  expect(keys('resources')).toEqual([]);
  const after = await captureSyncV2(db, ids.account, slug, ids.village, {
    protocol: 2,
    generation: 4,
    scopes: [],
    cursors: [],
  });
  const snapshot = after.groups.find((g) => g.stream.kind === 'village')!.changes;
  expect(snapshot.find((c) => c.component === 'roadCells')!.upsert).toHaveLength(23);
  expect(snapshot.find((c) => c.component === 'roadAnchors')!.upsert).toHaveLength(2);

  // Idempotent: a second run converts nothing and writes nothing.
  const state = async () => ({
    cells: await cells(),
    anchors: await anchors(),
    stone: await stone(),
    plan: await plan(),
  });
  const converted = await state();
  expect(await convert()).toEqual([]);
  expect(await state()).toEqual(converted);

  // Rollback (076 down), observed inside its transaction then discarded:
  // the legacy plan is back with a new revision; the created cells, the
  // written anchors and the credit are gone; the backup table is dropped.
  class Discard extends Error {}
  await expect(
    db.transaction().execute(async (tx) => {
      await conversionMigration.down(tx as unknown as Kysely<unknown>);
      expect(await plan(tx)).toEqual({ ...original, revision: 9 });
      expect(await cells(tx)).toEqual([
        expect.objectContaining({ villageId: ids.village, cellX: 66, cellY: 58, surface: 'earth', revision: 1 }),
        expect.objectContaining({ villageId: ids.neighbour, cellX: 70, cellY: 58 }),
      ]);
      expect(await anchors(tx)).toEqual([]);
      expect(await stone(tx)).toBe(2000);
      const table = await sql<{
        name: string | null;
      }>`select to_regclass('road_conversion_backups')::text as name`.execute(tx);
      expect(table.rows[0]!.name).toBeNull();
      throw new Discard();
    }),
  ).rejects.toBeInstanceOf(Discard);
  expect(await state()).toEqual(converted);
}, 120000);
