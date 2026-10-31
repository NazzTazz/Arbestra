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

it('refuses the whole batch, without writing, at the first refused gesture, and names it', async () => {
  const before = await rows();
  // The second gesture covers the town hall's cell.
  const refusal = await edit([free([[60, 189]], 0.5), free([[59, 195]], 0.5)]).catch((error: unknown) => error);
  expect(refusal).toMatchObject({ code: 'CELL_OCCUPIED', gesture: 1 });
  expect(await rows()).toEqual(before);
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
