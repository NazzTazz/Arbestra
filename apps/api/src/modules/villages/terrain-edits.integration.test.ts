import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import {
  fixedBuildingFootprint,
  footprintVertices,
  isBuildingFootprintFlat,
  type GeneratedLandscape,
  type LevelingRequest,
  type TerrainEditGesture,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { RC1_CANONICAL_CHECKSUM } from '../onboarding/spawn-map.js';
import { activateTerrainVertices } from '../worlds/terrain-vertices.js';
import { readRc1Ground } from '../worlds/rc1-ground.js';
import { terrainEditsCommandV2, terrainEditsTestHooks } from './terrain-edits.js';
import { httpErrorBody, type HttpError } from '../../errors.js';
import { assertBuildableCells, buildableCellRefusals, ownedVillage } from './service.js';
import { beginVillageEconomy } from './reconcile-economy.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected terrain edits test database');
const db = createDatabase(url),
  accountId = randomUUID(),
  worldId = randomUUID(),
  villageId = randomUUID(),
  hallId = randomUUID(),
  slug = 'terrain-edits-' + worldId;
const artifact = JSON.parse(
  readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8'),
) as GeneratedLandscape;
beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@terrain-edits.test', passwordHash: 'fixture' })
    .execute();
  await db
    .insertInto('worlds')
    .values({
      id: worldId,
      slug,
      name: 'Nivellement test',
      topology: 'torus',
      widthCells: 512,
      heightCells: 256,
      chunkSize: 32,
      seed: 4109,
      generationVersion: 3,
      generationStatus: 'ready',
      isOpen: false,
      generatedAt: new Date(),
    })
    .execute();
  await db
    .insertInto('worldChunks')
    .values(
      Array.from({ length: 128 }, (_, i) => ({
        worldId,
        chunkX: i % 16,
        chunkY: Math.floor(i / 16),
        generationVersion: 3,
        terrainCodes: Array(1024).fill(1),
        elevations: Array(1024).fill(25),
      })),
    )
    .execute();
  await db
    .insertInto('worldGenerationCandidates')
    .values({
      worldId,
      commandId: randomUUID(),
      ownerAccountId: accountId,
      parameters: artifact.geography!.parameters,
      checksum: RC1_CANONICAL_CHECKSUM,
      status: 'ready',
      artifact,
    })
    .execute();
  await activateTerrainVertices(db, worldId);
  expect(
    (await db.selectFrom('worlds').select('terrainModel').where('id', '=', worldId).executeTakeFirstOrThrow())
      .terrainModel,
  ).toBe('vertices');
  await db.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Terrassier' }).execute();
  await db
    .insertInto('villages')
    .values({
      id: villageId,
      worldId,
      ownerAccountId: accountId,
      name: 'Terrasse',
      anchorCellX: 59,
      anchorCellY: 195,
      economyActivatedAt: new Date(),
    })
    .execute();
  await db
    .insertInto('buildings')
    .values({
      id: hallId,
      worldId,
      villageId,
      buildingType: 'town-hall',
      level: 2,
      status: 'completed',
      completedAt: new Date(),
      constructionStartedAt: null,
      constructionCompletesAt: null,
    })
    .execute();
  await db
    .insertInto('worldCellOccupancies')
    .values({
      worldId,
      cellX: 59,
      cellY: 195,
      buildingId: hallId,
      featureId: null,
      pendingExpansionId: null,
      role: 'anchor',
    })
    .execute();
  for (const cellX of [55, 64]) {
    const id = randomUUID();
    await db
      .insertInto('buildings')
      .values({
        id,
        worldId,
        villageId,
        buildingType: 'dwelling',
        level: 1,
        status: 'completed',
        completedAt: new Date(),
        constructionStartedAt: null,
        constructionCompletesAt: null,
      })
      .execute();
    await db
      .insertInto('worldCellOccupancies')
      .values({ worldId, cellX, cellY: 200, buildingId: id, featureId: null, pendingExpansionId: null, role: 'anchor' })
      .execute();
  }
  await db
    .insertInto('villageResources')
    .values(
      ['wood', 'stone', 'timber', 'cut-stone', 'carrot'].map((resourceCode) => ({
        worldId,
        villageId,
        resourceCode,
        amount: 10000,
      })),
    )
    .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: 10000 }))
    .execute();
  await db
    .insertInto('villageResourceFlows')
    .values({
      worldId,
      villageId,
      resourceCode: 'wood',
      baseRatePerHour: 0,
      remainder: 0,
      productionUpdatedAt: new Date(),
    })
    .execute();
  await db
    .insertInto('populationCohorts')
    .values({
      worldId,
      villageId,
      originVillageId: villageId,
      memberCount: 15,
      activity: 'idle',
      energy: 10,
      energyProgress: 0,
      energyUpdatedAt: new Date(),
      restingSince: null,
      foodUsedSinceRest: 0,
      harvestId: null,
      extractionId: null,
    })
    .execute();
  // Controlled dry, gently sloping test pad over the genuine immutable RC1 source.
  const featureId = randomUUID(),
    removed = artifact.forest!.trees.flatMap((t, i) => (t.x >= 50 && t.x <= 69 && t.y >= 187 && t.y <= 207 ? [i] : []));
  await db
    .insertInto('worldFeatures')
    .values({ id: featureId, worldId, featureTypeCode: 'woodland', state: 'available', variantSeed: 1 })
    .execute();
  await db
    .insertInto('worldRc1Resources')
    .values({
      worldId,
      featureId,
      sourceKey: 'test:cleared-pad',
      treeIndices: JSON.stringify(removed),
      removedIndices: JSON.stringify(removed),
    })
    .execute();
  await db
    .insertInto('worldTerrainVertices')
    .values(
      Array.from({ length: 324 }, (_, i) => {
        const vertexX = 51 + (i % 18),
          vertexY = 188 + Math.floor(i / 18);
        const height =
          vertexX >= 57 && vertexX <= 63 && vertexY >= 198 && vertexY <= 203 ? 0.25 + (vertexX - 60) * 0.015 : 0.25;
        return { worldId, vertexX, vertexY, height };
      }),
    )
    .execute();
}, 120000);
afterAll(async () => {
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
}, 60000);

afterEach(() => {
  delete terrainEditsTestHooks.afterLock;
  delete terrainEditsTestHooks.afterWrites;
});

const world = { widthCells: 512, heightCells: 256 };
const edit = (gestures: TerrainEditGesture[]) =>
  terrainEditsCommandV2(db, accountId, slug, villageId, { commandId: randomUUID(), gestures }, 1);
const free = (cells: Array<[number, number]>, height: number): TerrainEditGesture => ({
  buildingType: 'terrain',
  anchor: { cellX: cells[0]![0], cellY: cells[0]![1] },
  cells: cells.map(([cellX, cellY]) => ({ cellX, cellY })),
  height,
});
const heights = async () =>
  new Map(
    (
      await db
        .selectFrom('worldTerrainVertices')
        .select(['vertexX', 'vertexY', 'height'])
        .where('worldId', '=', worldId)
        .execute()
    ).map((r) => [`${r.vertexX}:${r.vertexY}`, r.height]),
  );
/** Everything a refused or rolled back batch must leave untouched. */
const rows = async () =>
  Promise.all(
    [
      'worldTerrainVertices',
      'terrainEditReceipts',
      'levelingJobs',
      'populationCohorts',
      'worldCellOccupancies',
      'villageResources',
      'scheduledTasks',
    ].map((table) =>
      sql`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as data from ${sql.table(table.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()))} t where world_id=${worldId}`
        .execute(db)
        .then((r) => r.rows),
    ),
  );
/** Puts the touched vertices back to their previous heights. */
const restore = async (before: Map<string, number>, after: Map<string, number>) => {
  for (const [k, height] of after) {
    if (before.get(k) === height) continue;
    const [vertexX, vertexY] = k.split(':').map(Number) as [number, number];
    if (before.has(k))
      await db
        .updateTable('worldTerrainVertices')
        .set({ height: before.get(k)! })
        .where('worldId', '=', worldId)
        .where('vertexX', '=', vertexX)
        .where('vertexY', '=', vertexY)
        .execute();
    else
      await db
        .deleteFrom('worldTerrainVertices')
        .where('worldId', '=', worldId)
        .where('vertexX', '=', vertexX)
        .where('vertexY', '=', vertexY)
        .execute();
  }
};

it('applies a batch in order at once: a shared vertex takes the later height; free, no job, no worker; replays', async () => {
  const before = await heights();
  const cohortsBefore = await db.selectFrom('populationCohorts').selectAll().where('worldId', '=', worldId).execute();
  const command = {
    commandId: randomUUID(),
    gestures: [
      free(
        [
          [60, 191],
          [61, 191],
        ],
        0.5,
      ),
      free(
        [
          [61, 191],
          [62, 191],
        ],
        0.75,
      ),
    ],
  };
  const confirmation = await terrainEditsCommandV2(db, accountId, slug, villageId, command, 1);
  expect(confirmation.status).toBe('applied');
  const after = await heights();
  // Corners of cell (60,191) alone keep the first height; the shared and later ones take 0.75.
  for (const y of [191, 192]) {
    expect(after.get(`60:${y}`)).toBe(0.5);
    expect(after.get(`61:${y}`)).toBe(0.75);
    expect(after.get(`62:${y}`)).toBe(0.75);
    expect(after.get(`63:${y}`)).toBe(0.75);
  }
  expect(confirmation.result).toEqual({ gestures: 2, unchanged: 0, vertices: 8 });
  const ground = await readRc1Ground(db, worldId);
  expect(ground.field.geometry!.height(61, 191)).toBe(0.75);
  // No site, no job, no worker, no debit.
  expect(await db.selectFrom('levelingJobs').select('id').where('worldId', '=', worldId).execute()).toEqual([]);
  expect(await db.selectFrom('populationCohorts').selectAll().where('worldId', '=', worldId).execute()).toEqual(
    cohortsBefore,
  );
  // An exact replay answers from the receipt; another batch under the same identifier is refused.
  const state = await rows();
  expect(await terrainEditsCommandV2(db, accountId, slug, villageId, command, 1)).toEqual({
    ...confirmation,
    effects: undefined,
  });
  expect(await rows()).toEqual(state);
  await expect(
    terrainEditsCommandV2(db, accountId, slug, villageId, { ...command, gestures: [free([[60, 191]], 1)] }, 1),
  ).rejects.toMatchObject({ code: 'COMMAND_REUSED' });
  await restore(before, after);
}, 120000);

it('counts a gesture without effect as unchanged, not as a refusal', async () => {
  const before = await heights();
  const height = before.get('60:190')!;
  const confirmation = await edit([free([[60, 189]], height)]);
  expect(confirmation.result).toEqual({ gestures: 0, unchanged: 1, vertices: 0 });
  expect(await heights()).toEqual(before);
}, 120000);

it('applies the accepted gesture of a batch and lists the refused one in the answer and the receipt', async () => {
  const before = await heights();
  // The second gesture covers the town hall's cell; the first is free.
  const command = { commandId: randomUUID(), gestures: [free([[60, 189]], 0.5), free([[59, 195]], 0.5)] };
  const confirmation = await terrainEditsCommandV2(db, accountId, slug, villageId, command, 1);
  const refused = [
    { gesture: 1, cell: { cellX: 59, cellY: 195 }, code: 'CELL_OCCUPIED', at: { cellX: 59, cellY: 195 } },
  ];
  expect(confirmation.result).toEqual({ gestures: 1, unchanged: 0, vertices: 4, refused });
  const after = await heights();
  for (const k of ['60:189', '61:189', '60:190', '61:190']) expect(after.get(k)).toBe(0.5);
  // The refused unit wrote nothing: the hall's corners keep their heights.
  for (const k of ['59:195', '60:195', '59:196', '60:196']) expect(after.get(k)).toBe(before.get(k));
  const receipt = await db
    .selectFrom('terrainEditReceipts')
    .select('result')
    .where('worldId', '=', worldId)
    .where('commandId', '=', command.commandId)
    .executeTakeFirstOrThrow();
  expect(receipt.result).toEqual(confirmation.result);
  // The replay answers the same partial result from the receipt, without writing.
  const state = await rows();
  expect((await terrainEditsCommandV2(db, accountId, slug, villageId, command, 1)).result).toEqual(confirmation.result);
  expect(await rows()).toEqual(state);
  await restore(before, after);
}, 120000);

it('refuses one painted cell whose 3 × 3 meets an obstacle, names the obstacle, and keeps the rest of the stroke', async () => {
  const before = await heights();
  // (59,194)'s ring holds the hall (59,195); (62,191) and (63,191) are free.
  // Processing order is canonical: (59,194), then (62,191), then (63,191).
  const confirmation = await edit([
    free(
      [
        [62, 191],
        [59, 194],
        [63, 191],
      ],
      0.75,
    ),
  ]);
  expect(confirmation.result).toEqual({
    gestures: 1,
    unchanged: 0,
    vertices: 6,
    refused: [{ gesture: 0, cell: { cellX: 59, cellY: 194 }, code: 'CELL_OCCUPIED', at: { cellX: 59, cellY: 195 } }],
  });
  const after = await heights();
  // The accepted cells share two vertices: the same heights as the stroke without its refused cell.
  for (const x of [62, 63, 64]) for (const y of [191, 192]) expect(after.get(`${x}:${y}`)).toBe(0.75);
  for (const k of ['59:194', '60:194', '59:195', '60:195']) expect(after.get(k)).toBe(before.get(k));
  await restore(before, after);
}, 120000);

it('lets a refused unit write nothing, even on a vertex an accepted unit shares, in batch order', async () => {
  const before = await heights();
  // Gesture 0 lifts (60,193) to 0.5; gesture 1 would put (59,194), which shares
  // the vertex (60,194), at 1, but its ring holds the hall: (60,194) stays at 0.5.
  const confirmation = await edit([free([[60, 193]], 0.5), free([[59, 194]], 1)]);
  expect(confirmation.result.refused).toEqual([
    { gesture: 1, cell: { cellX: 59, cellY: 194 }, code: 'CELL_OCCUPIED', at: { cellX: 59, cellY: 195 } },
  ]);
  const after = await heights();
  expect(after.get('60:194')).toBe(0.5);
  expect(after.get('59:194')).toBe(before.get('59:194'));
  await restore(before, after);
}, 120000);

it('refuses the whole batch, without writing, when no unit is accepted, and names every refused one', async () => {
  const before = await rows();
  const refusal = await edit([free([[59, 195]], 0.5), free([[59, 194]], 0.5)]).catch((error: unknown) => error);
  expect(refusal).toMatchObject({ code: 'CELL_OCCUPIED', gesture: 0 });
  // The HTTP body names the gesture and the units too: the client points the Oracle at them.
  expect(httpErrorBody(refusal as HttpError)).toMatchObject({
    code: 'CELL_OCCUPIED',
    gesture: 0,
    refused: [
      { gesture: 0, cell: { cellX: 59, cellY: 195 }, code: 'CELL_OCCUPIED', at: { cellX: 59, cellY: 195 } },
      { gesture: 1, cell: { cellX: 59, cellY: 194 }, code: 'CELL_OCCUPIED', at: { cellX: 59, cellY: 195 } },
    ],
  });
  expect(await rows()).toEqual(before);
}, 120000);

it('classifies each cell as assertBuildableCells would refuse it alone', async () => {
  await db
    .insertInto('roadCells')
    .values({ worldId, villageId, cellX: 66, cellY: 191, surface: 'earth', sidewalks: false })
    .execute();
  try {
    const cells = [
      { cellX: 59, cellY: 195 }, // the hall
      { cellX: 66, cellY: 191 }, // a road
      { cellX: 60, cellY: 190 }, // free
      { cellX: 200, cellY: 40 }, // far away
    ];
    await db.transaction().execute(async (tx) => {
      const village = await ownedVillage(tx, accountId, slug, villageId);
      // As a spatial writer does: the zones of these cells, exclusive (docs/VERROUS-2026-11-04.md).
      await beginVillageEconomy(tx, worldId, villageId, undefined, [], [], { write: cells });
      const map = await buildableCellRefusals(tx, village, cells);
      for (const cell of cells) {
        const alone = await assertBuildableCells(tx, village, [cell]).then(
          () => null,
          (error: HttpError) => error.code,
        );
        expect(map.get(`${cell.cellX}:${cell.cellY}`)?.code ?? null).toBe(alone);
      }
      expect(map.get('66:191')?.code).toBe('INFRASTRUCTURE_OCCUPIED');
      expect(map.has('60:190')).toBe(false);
    });
  } finally {
    await db.deleteFrom('roadCells').where('worldId', '=', worldId).execute();
  }
}, 120000);

it('levels a building footprint instantly for the placement', async () => {
  const request: LevelingRequest = {
    buildingType: 'university',
    anchor: { cellX: 59, cellY: 200 },
    quarterTurns: 1,
    workerCount: 1,
  };
  const footprint = fixedBuildingFootprint('university', request.anchor, 1, world);
  const corners = footprintVertices(footprint, world);
  const ground = await readRc1Ground(db, worldId);
  expect(isBuildingFootprintFlat(corners.map((p) => ground.field.geometry!.height(p.vertexX, p.vertexY) * 100))).toBe(
    false,
  );
  const before = await heights();
  const confirmation = await edit([
    { buildingType: 'university', anchor: request.anchor, quarterTurns: request.quarterTurns },
  ]);
  expect(confirmation.result.gestures).toBe(1);
  const after = await readRc1Ground(db, worldId);
  expect(isBuildingFootprintFlat(corners.map((p) => after.field.geometry!.height(p.vertexX, p.vertexY) * 100))).toBe(
    true,
  );
  expect(await db.selectFrom('levelingJobs').select('id').where('worldId', '=', worldId).execute()).toEqual([]);
  await restore(before, await heights());
}, 120000);

it('rolls the heights and the receipt back when the transaction fails after writing them', async () => {
  const before = await rows();
  let inside: number | undefined;
  terrainEditsTestHooks.afterWrites = async (tx) => {
    inside = (
      await tx
        .selectFrom('worldTerrainVertices')
        .select('height')
        .where('worldId', '=', worldId)
        .where('vertexX', '=', 60)
        .where('vertexY', '=', 189)
        .executeTakeFirstOrThrow()
    ).height;
    throw new Error('injected terrain edits failure');
  };
  await expect(edit([free([[60, 189]], 0.5)])).rejects.toThrow('injected terrain edits failure');
  // The height was written before the injected error...
  expect(inside).toBe(0.5);
  // ...and nothing survives it.
  expect(await rows()).toEqual(before);
}, 120000);

it('accepts an edit that cuts a building off: no connectivity guarantee (moats are legitimate)', async () => {
  // A wall of steep ground at Chebyshev distance 2 around the dwelling at (55,200):
  // its corners are untouched (no foundation refusal), its access is cut.
  const ring: Array<[number, number]> = [];
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) ring.push([55 + dx, 200 + dy]);
  const before = await heights();
  const confirmation = await edit([free(ring, 3)]);
  expect(confirmation.result.gestures).toBe(1);
  const ground = await readRc1Ground(db, worldId);
  expect(ground.field.geometry!.height(53, 198)).toBe(3);
  await restore(before, await heights());
}, 120000);

/** A restoration gesture (§7.10): the corners of each cell, in `cellVertices` order,
 * and the heights the undone stroke left there (restored only while intact). */
const restoration = (cells: Array<[number, number, number[], number[]]>): TerrainEditGesture => ({
  buildingType: 'terrain-restore',
  cells: cells.map(([cellX, cellY, corners, expected]) => ({ cellX, cellY, corners, expected })),
});
/** A restoration of cells whose stroke left exactly the heights `current` shows. */
const restoreFrom = (current: Map<string, number>, cells: Array<[number, number, number[]]>): TerrainEditGesture =>
  restoration(cells.map(([x, y, c]) => [x, y, c, corners(current, x, y)]));
const corners = (map: Map<string, number>, x: number, y: number) =>
  [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
  ].map(([vx, vy]) => map.get(`${vx}:${vy}`)!);

it('restores the corners of a stroke to arbitrary heights: undo of a stroke, idempotent by command', async () => {
  const before = await heights();
  await edit([
    free(
      [
        [60, 190],
        [61, 190],
      ],
      0.75,
    ),
  ]);
  const painted = await heights();
  expect(painted.get('61:190')).toBe(0.75);
  // The inverse gesture: the stroke's cells back to the heights before it.
  const command = {
    commandId: randomUUID(),
    gestures: [restoration([60, 61].map((x) => [x, 190, corners(before, x, 190), [0.75, 0.75, 0.75, 0.75]]))],
  };
  const confirmation = await terrainEditsCommandV2(db, accountId, slug, villageId, command, 1);
  expect(confirmation.result).toEqual({ gestures: 1, unchanged: 0, vertices: 6 });
  expect(await heights()).toEqual(before);
  // Corners at four different heights, which no painted cell can write.
  const sloped = await edit([restoreFrom(await heights(), [[62, 190, [0.3, 0.35, 0.4, 0.45]]])]);
  expect(sloped.result).toEqual({ gestures: 1, unchanged: 0, vertices: 4 });
  const after = await heights();
  expect(corners(after, 62, 190)).toEqual([0.3, 0.35, 0.4, 0.45]);
  // The replay answers from the receipt without writing; another content under the same identifier is refused.
  const state = await rows();
  expect((await terrainEditsCommandV2(db, accountId, slug, villageId, command, 1)).result).toEqual(confirmation.result);
  expect(await rows()).toEqual(state);
  await expect(
    terrainEditsCommandV2(
      db,
      accountId,
      slug,
      villageId,
      { ...command, gestures: [restoration([[60, 190, [1, 1, 1, 1], [0.75, 0.75, 0.75, 0.75]]])] },
      1,
    ),
  ).rejects.toMatchObject({ code: 'COMMAND_REUSED' });
  await restore(before, after);
}, 120000);

it('refuses a restored cell under the rules of a painted one, keeps the others, and never refuses an unchanged cell', async () => {
  await db
    .insertInto('roadCells')
    .values({ worldId, villageId, cellX: 66, cellY: 191, surface: 'earth', sidewalks: false })
    .execute();
  try {
    const before = await heights();
    // (60,189) is free; (65,190)'s ring holds the road (66,191); the road cell itself
    // is restored to its own heights: no effect, no refusal.
    const confirmation = await edit([
      restoreFrom(before, [
        [60, 189, [0.5, 0.5, 0.6, 0.6]],
        [65, 190, [0.5, 0.5, 0.5, 0.5]],
        [66, 191, corners(before, 66, 191)],
      ]),
    ]);
    expect(confirmation.result).toEqual({
      gestures: 1,
      unchanged: 0,
      vertices: 4,
      refused: [
        { gesture: 0, cell: { cellX: 65, cellY: 190 }, code: 'INFRASTRUCTURE_OCCUPIED', at: { cellX: 66, cellY: 191 } },
      ],
    });
    const after = await heights();
    expect(corners(after, 60, 189)).toEqual([0.5, 0.5, 0.6, 0.6]);
    expect(corners(after, 65, 190)).toEqual(corners(before, 65, 190));
    // Refused alone: 409 with the list, nothing written.
    const state = await rows();
    const refusal = await edit([restoreFrom(before, [[65, 190, [0.5, 0.5, 0.5, 0.5]]])]).catch(
      (error: unknown) => error,
    );
    expect(httpErrorBody(refusal as HttpError)).toMatchObject({
      code: 'INFRASTRUCTURE_OCCUPIED',
      gesture: 0,
      refused: [
        { gesture: 0, cell: { cellX: 65, cellY: 190 }, code: 'INFRASTRUCTURE_OCCUPIED', at: { cellX: 66, cellY: 191 } },
      ],
    });
    expect(await rows()).toEqual(state);
    // A foundation's corner is never restored: the town hall at (59,195).
    const foundation = await edit([restoreFrom(before, [[60, 196, [0.5, 0.5, 0.5, 0.5]]])]).catch(
      (error: unknown) => error,
    );
    expect(foundation).toMatchObject({ code: 'CELL_OCCUPIED' });
    // A duplicated cell makes the gesture invalid as a whole.
    const duplicate = await edit([
      restoreFrom(before, [
        [60, 189, [1, 1, 1, 1]],
        [60, 189, [1, 1, 1, 1]],
      ]),
    ]).catch((error: unknown) => error);
    expect(duplicate).toMatchObject({ code: 'INVALID_TERRAFORM_SELECTION' });
    await restore(before, after);
  } finally {
    await db.deleteFrom('roadCells').where('worldId', '=', worldId).execute();
  }
}, 120000);

it('restores only the corners still at the height the stroke left; a cell with none intact has no effect, no refusal (§7.10)', async () => {
  const before = await heights();
  await edit([
    free(
      [
        [60, 190],
        [61, 190],
      ],
      0.75,
    ),
  ]);
  const painted = await heights();
  // Another gesture (another stroke, another player) repaints cell (62,190): vertices 62 and 63 leave 0.75.
  await edit([free([[62, 190]], 1.25)]);
  const modified = await heights();
  expect(corners(modified, 61, 190)).toEqual([0.75, 1.25, 1.25, 0.75]);
  // Undo of the first stroke: its cells back to the heights before it, each corner expected at 0.75.
  const undo = restoration(
    [60, 61].map(
      (x) => [x, 190, corners(before, x, 190), [0.75, 0.75, 0.75, 0.75]] as [number, number, number[], number[]],
    ),
  );
  const command = { commandId: randomUUID(), gestures: [undo] };
  const confirmation = await terrainEditsCommandV2(db, accountId, slug, villageId, command, 1);
  expect(confirmation.result.refused).toBeUndefined();
  const after = await heights();
  // Intact corners (vertices 60, 61) are back; the shared vertices 62 keep the other gesture's height.
  expect(corners(after, 60, 190)).toEqual(corners(before, 60, 190));
  expect(corners(after, 61, 190)).toEqual([before.get('61:190'), 1.25, 1.25, before.get('61:191')]);
  expect(corners(after, 62, 190)).toEqual(corners(modified, 62, 190));
  // Replay by commandId: the receipt answers, nothing is written.
  const state = await rows();
  expect((await terrainEditsCommandV2(db, accountId, slug, villageId, command, 1)).result).toEqual(confirmation.result);
  expect(await rows()).toEqual(state);
  // Cell (62,190) is wholly modified since the stroke (expected 0.75, now 1.25 and the original ground): no effect.
  const none = await edit([restoration([[62, 190, [0.1, 0.1, 0.1, 0.1], [0.75, 0.75, 0.75, 0.75]]])]);
  expect(none.result.refused).toBeUndefined();
  expect(none.result.gestures).toBe(0);
  expect(none.result.unchanged).toBe(1);
  expect(await heights()).toEqual(after);
  await restore(before, painted);
  await restore(before, modified);
}, 120000);
