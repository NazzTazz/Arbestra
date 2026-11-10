import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { certificateValid, navigationVersions, routeDependencies } from './route-cache.js';
import { loadNavigationContext, navigationRevision } from './context.js';

// Navigation T1 (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §3): trade and
// expeditions plan over road cells and accessories, and migration 082 makes
// a change of either invalidate what was prepared over the old ground.
const url = testDatabaseUrl(),
  db = createDatabase(url),
  world = randomUUID(),
  account = randomUUID(),
  village = randomUUID();
beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('accounts')
    .values({ id: account, email: account + '@roads.test', passwordHash: 'fixture' })
    .execute();
  await db
    .insertInto('worlds')
    .values({
      id: world,
      slug: `roads-${world}`,
      name: 'Road navigation',
      topology: 'torus',
      widthCells: 64,
      heightCells: 64,
      chunkSize: 32,
      seed: 3,
      generationVersion: 1,
      generationStatus: 'ready',
      isOpen: false,
      generatedAt: new Date(),
    })
    .execute();
  await db
    .insertInto('worldChunks')
    .values(
      [0, 1, 2, 3].map((i) => ({
        worldId: world,
        chunkX: i % 2,
        chunkY: Math.floor(i / 2),
        generationVersion: 1,
        terrainCodes: Array(1024).fill(1),
        elevations: Array(1024).fill(0),
      })),
    )
    .execute();
  await db.insertInto('worldMemberships').values({ worldId: world, accountId: account, playerName: 'Roads' }).execute();
  await db
    .insertInto('villages')
    .values({ id: village, worldId: world, ownerAccountId: account, name: 'Roads', anchorCellX: 10, anchorCellY: 10 })
    .execute();
}, 60000);
afterAll(async () => {
  await db.deleteFrom('worlds').where('id', '=', world).execute();
  await db.deleteFrom('accounts').where('id', '=', account).execute();
  await db.destroy();
});

it('invalidates a route through a new road cell or accessory, not a distant one (migration 082)', async () => {
  const through = [
      { cellX: 2, cellY: 5 },
      { cellX: 9, cellY: 5 },
    ],
    distant = [
      { cellX: 40, cellY: 40 },
      { cellX: 50, cellY: 40 },
    ];
  const certify = async (path: typeof through) => {
    const manifest = await navigationVersions(db, world);
    return { namespace: manifest.namespace, dependencies: routeDependencies(manifest, path) };
  };
  let near = await certify(through);
  const far = await certify(distant),
    revision = Number(await navigationRevision(db, world));
  await db
    .insertInto('roadCells')
    .values({ worldId: world, villageId: village, cellX: 5, cellY: 5, surface: 'earth', sidewalks: false })
    .execute();
  expect(certificateValid(await navigationVersions(db, world), near), 'a road on the route').toBe(false);
  expect(certificateValid(await navigationVersions(db, world), far), 'a distant road').toBe(true);
  expect(Number(await navigationRevision(db, world))).toBe(revision + 1);

  near = await certify(through);
  await db
    .insertInto('roadAnchors')
    .values({ worldId: world, villageId: village, vertexX: 6, vertexY: 6, accessory: 'brazier' })
    .execute();
  expect(certificateValid(await navigationVersions(db, world), near), 'an accessory on the route').toBe(false);
  expect(certificateValid(await navigationVersions(db, world), far)).toBe(true);
  expect(Number(await navigationRevision(db, world))).toBe(revision + 2);

  near = await certify(through);
  await db.deleteFrom('roadCells').where('worldId', '=', world).execute();
  expect(certificateValid(await navigationVersions(db, world), near), 'a removed road').toBe(false);
  expect(Number(await navigationRevision(db, world))).toBe(revision + 3);
  await db.deleteFrom('roadAnchors').where('worldId', '=', world).execute();
});

it('gives the world navigation context the road cells and their accessories', async () => {
  await db
    .insertInto('roadCells')
    .values([
      { worldId: world, villageId: village, cellX: 5, cellY: 5, surface: 'stone-1', sidewalks: false },
      { worldId: world, villageId: village, cellX: 6, cellY: 5, surface: 'earth', sidewalks: false },
    ])
    .execute();
  await db
    .insertInto('roadAnchors')
    .values({ worldId: world, villageId: village, vertexX: 6, vertexY: 6, accessory: 'brazier' })
    .execute();
  try {
    const context = await loadNavigationContext(db, world, new Set(), new Set());
    const plan = context.data!.plans.find((p) => p.roadCells?.length);
    expect(plan?.roadCells).toEqual([
      { cellX: 5, cellY: 5, surface: 'stone-1', sidewalks: false },
      { cellX: 6, cellY: 5, surface: 'earth', sidewalks: false },
    ]);
    // The accessory blocks at its vertex's sub-point, as in a village.
    expect(plan?.equipment).toEqual([expect.objectContaining({ id: 'anchor:6:6', x: 44, y: 44 })]);
  } finally {
    await db.deleteFrom('roadCells').where('worldId', '=', world).execute();
    await db.deleteFrom('roadAnchors').where('worldId', '=', world).execute();
  }
});
