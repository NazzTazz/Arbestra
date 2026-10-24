import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'kysely';
import {
  canWalkSpawnSegment,
  emptyInfrastructure,
  footprintVertices,
  type GeneratedLandscape,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { RC1_CANONICAL_CHECKSUM } from '../onboarding/spawn-map.js';
import { readRc1Ground } from './rc1-ground.js';
import {
  activateTerrainVertices,
  activateTerrainVerticesInTransaction,
  auditTerrainVertices,
} from './terrain-vertices.js';
import { navigationRevision } from '../navigation/context.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected test target');
const db = createDatabase(url),
  accountId = randomUUID(),
  worldIds: string[] = [];
const artifact = JSON.parse(
  readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8'),
) as GeneratedLandscape;
beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@conversion.test', passwordHash: 'fixture' })
    .execute();
});
afterAll(async () => {
  if (worldIds.length) {
    await db.deleteFrom('depositExtractions').where('worldId', 'in', worldIds).execute();
    await db.deleteFrom('stoneDeposits').where('worldId', 'in', worldIds).execute();
    await db.deleteFrom('worlds').where('id', 'in', worldIds).execute();
  }
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
}, 60000);
async function fixture() {
  const worldId = randomUUID(),
    villageId = randomUUID();
  worldIds.push(worldId);
  await db
    .insertInto('worlds')
    .values({
      id: worldId,
      slug: 'conversion-' + worldId,
      name: 'Conversion',
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
  await db.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Conversion' }).execute();
  await db
    .insertInto('villages')
    .values({
      id: villageId,
      worldId,
      ownerAccountId: accountId,
      name: 'Existing village',
      anchorCellX: 59,
      anchorCellY: 195,
    })
    .execute();
  const sites = [
    { type: 'town-hall', cells: [{ cellX: 59, cellY: 195 }] },
    { type: 'dwelling', cells: [{ cellX: 63, cellY: 200 }] },
    {
      type: 'stonemason',
      cells: [
        { cellX: 58, cellY: 200 },
        { cellX: 59, cellY: 200 },
        { cellX: 58, cellY: 201 },
        { cellX: 59, cellY: 201 },
      ],
    },
  ];
  const buildings = [];
  for (const site of sites) {
    const id = randomUUID();
    await db
      .insertInto('buildings')
      .values({
        id,
        worldId,
        villageId,
        buildingType: site.type,
        level: 1,
        status: 'completed',
        completedAt: new Date(),
        constructionStartedAt: null,
        constructionCompletesAt: null,
      })
      .execute();
    await db
      .insertInto('worldCellOccupancies')
      .values(
        site.cells.map((c, i) => ({
          ...c,
          worldId,
          buildingId: id,
          featureId: null,
          role: i === 0 ? ('anchor' as const) : ('body' as const),
        })),
      )
      .execute();
    buildings.push({ ...site, id });
  }
  await db
    .insertInto('worldSpawnTerraces')
    .values({ worldId, villageId, cellX: 59, cellY: 195, height: 0.25 })
    .execute();
  await db
    .insertInto('villageResources')
    .values({ worldId, villageId, resourceCode: 'wood', amount: 1234 })
    .onConflict((c) => c.doNothing())
    .execute();
  const ground = await readRc1Ground(db, worldId);
  // Use a genuinely traversable short corridor in the signed RC1 terrain.
  const starts = Array.from({ length: 100 }, (_, i) => ({ x: 55 + (i % 10), y: 190 + Math.floor(i / 10) }));
  const start = starts.find((a) => canWalkSpawnSegment(ground.navigation, a, { x: a.x + 0.25, y: a.y }))!;
  expect(start).toBeDefined();
  const plan = emptyInfrastructure();
  plan.roads = [
    {
      id: 'existing-road',
      operation: 'paint',
      material: 'stone-1',
      width: 2,
      border: true,
      points: [
        { x: start.x * 8, y: start.y * 8 },
        { x: start.x * 8 + 2, y: start.y * 8 },
      ],
    },
  ];
  await db
    .insertInto('villageInfrastructure')
    .values({ worldId, villageId, plan: JSON.stringify(plan) })
    .execute();
  const featureId = randomUUID();
  await db
    .insertInto('worldFeatures')
    .values({ id: featureId, worldId, featureTypeCode: 'stone_outcrop', state: 'available', variantSeed: 1 })
    .execute();
  await db
    .insertInto('stoneDeposits')
    .values({
      worldId,
      featureId,
      cellX: 70,
      cellY: 200,
      initialAmount: 1000,
      remainingAmount: 1000,
      reservedAmount: 20,
      revision: 1,
      updatedAt: new Date(),
    })
    .execute();
  const path = [
    { cellX: start.x, cellY: start.y },
    { cellX: start.x + 0.25, cellY: start.y },
  ];
  await db
    .insertInto('depositExtractions')
    .values({
      worldId,
      villageId,
      featureId,
      commandId: randomUUID(),
      status: 'in-progress',
      startedAt: new Date(),
      completesAt: new Date(Date.now() + 600000),
      completedAt: null,
      workerCount: 1,
      reservedAmount: 20,
      pathCells: sql<typeof path>`${JSON.stringify(path)}::jsonb`,
      transportMs: 250,
    })
    .execute();
  return { worldId, villageId, buildings };
}
async function business(worldId: string) {
  return {
    accounts: await db.selectFrom('accounts').selectAll().where('id', '=', accountId).execute(),
    villages: await db.selectFrom('villages').selectAll().where('worldId', '=', worldId).execute(),
    buildings: await db.selectFrom('buildings').selectAll().where('worldId', '=', worldId).orderBy('id').execute(),
    occupancy: await db
      .selectFrom('worldCellOccupancies')
      .selectAll()
      .where('worldId', '=', worldId)
      .orderBy('cellX')
      .orderBy('cellY')
      .execute(),
    resources: await db
      .selectFrom('villageResources')
      .selectAll()
      .where('worldId', '=', worldId)
      .orderBy('resourceCode')
      .execute(),
    extractions: await db.selectFrom('depositExtractions').selectAll().where('worldId', '=', worldId).execute(),
    deposits: await db.selectFrom('stoneDeposits').selectAll().where('worldId', '=', worldId).execute(),
    infrastructure: await db.selectFrom('villageInfrastructure').selectAll().where('worldId', '=', worldId).execute(),
  };
}
it('converts a populated world without moving buildings or changing resources and engaged extraction contracts', async () => {
  const f = await fixture(),
    before = await business(f.worldId),
    ground = await readRc1Ground(db, f.worldId);
  const bases = f.buildings.map((b) =>
    Math.max(...b.cells.map((c) => ground.field.sample(c.cellX, c.cellY).elevation)),
  );
  const revision = await navigationRevision(db, f.worldId),
    audit = await auditTerrainVertices(db, f.worldId);
  expect(audit.issues).toEqual([]);
  expect(audit.stats.extractions).toBe(1);
  expect(audit.stats.roadSamples).toBeGreaterThan(0);
  await activateTerrainVertices(db, f.worldId);
  const after = await readRc1Ground(db, f.worldId);
  for (const [i, b] of f.buildings.entries())
    expect(Math.max(...b.cells.map((c) => after.field.sample(c.cellX, c.cellY).elevation))).toBeCloseTo(bases[i]!, 6);
  const mason = f.buildings.find((b) => b.type === 'stonemason')!;
  const heights = footprintVertices(mason.cells, { widthCells: 512, heightCells: 256 }).map((v) =>
    after.field.geometry!.height(v.vertexX, v.vertexY),
  );
  expect(Math.max(...heights) - Math.min(...heights)).toBe(0);
  expect(await business(f.worldId)).toEqual(before);
  expect(await navigationRevision(db, f.worldId)).not.toBe(revision);
  const vertices = await db
    .selectFrom('worldTerrainVertices')
    .selectAll()
    .where('worldId', '=', f.worldId)
    .orderBy('vertexX')
    .orderBy('vertexY')
    .execute();
  const convertedRevision = await navigationRevision(db, f.worldId);
  await activateTerrainVertices(db, f.worldId);
  expect(await navigationRevision(db, f.worldId)).toBe(convertedRevision);
  expect(
    await db
      .selectFrom('worldTerrainVertices')
      .selectAll()
      .where('worldId', '=', f.worldId)
      .orderBy('vertexX')
      .orderBy('vertexY')
      .execute(),
  ).toEqual(vertices);
}, 120000);
it('refuses incompatible terraces without changing the model or terrain', async () => {
  const f = await fixture();
  await db
    .insertInto('worldSpawnTerraces')
    .values([
      { worldId: f.worldId, villageId: f.villageId, cellX: 100, cellY: 100, height: 1 },
      { worldId: f.worldId, villageId: f.villageId, cellX: 101, cellY: 100, height: 2 },
    ])
    .execute();
  const before = await business(f.worldId),
    revision = await navigationRevision(db, f.worldId);
  await expect(activateTerrainVertices(db, f.worldId)).rejects.toMatchObject({ code: 'TERRAIN_CONVERSION_BLOCKED' });
  expect(await business(f.worldId)).toEqual(before);
  expect(await navigationRevision(db, f.worldId)).toBe(revision);
  expect(
    (await db.selectFrom('worlds').select('terrainModel').where('id', '=', f.worldId).executeTakeFirstOrThrow())
      .terrainModel,
  ).toBe('terraces');
  expect(await db.selectFrom('worldTerrainVertices').selectAll().where('worldId', '=', f.worldId).execute()).toEqual(
    [],
  );
}, 120000);
it('refuses conversion when an engaged extraction cannot be audited', async () => {
  const f = await fixture();
  await db.updateTable('depositExtractions').set({ pathCells: null }).where('worldId', '=', f.worldId).execute();
  const before = await business(f.worldId);
  await expect(activateTerrainVertices(db, f.worldId)).rejects.toMatchObject({ code: 'TERRAIN_CONVERSION_BLOCKED' });
  expect(await business(f.worldId)).toEqual(before);
}, 120000);
it('rolls back proven terrain and model writes when the operator verification fails', async () => {
  const f = await fixture(),
    before = await business(f.worldId),
    revision = await navigationRevision(db, f.worldId);
  const injected = new Error('OPERATOR_VERIFICATION_FAILED');
  let wrote = false;
  await expect(
    db.transaction().execute(async (tx) => {
      await activateTerrainVerticesInTransaction(tx, f.worldId);
      expect(
        (await tx.selectFrom('worlds').select('terrainModel').where('id', '=', f.worldId).executeTakeFirstOrThrow())
          .terrainModel,
      ).toBe('vertices');
      expect(
        (await tx.selectFrom('worldTerrainVertices').selectAll().where('worldId', '=', f.worldId).execute()).length,
      ).toBeGreaterThan(0);
      expect(await navigationRevision(tx, f.worldId)).not.toBe(revision);
      wrote = true;
      throw injected;
    }),
  ).rejects.toBe(injected);
  expect(wrote).toBe(true);
  expect(await business(f.worldId)).toEqual(before);
  expect(await navigationRevision(db, f.worldId)).toBe(revision);
  expect(
    (await db.selectFrom('worlds').select('terrainModel').where('id', '=', f.worldId).executeTakeFirstOrThrow())
      .terrainModel,
  ).toBe('terraces');
  expect(await db.selectFrom('worldTerrainVertices').selectAll().where('worldId', '=', f.worldId).execute()).toEqual(
    [],
  );
}, 120000);
