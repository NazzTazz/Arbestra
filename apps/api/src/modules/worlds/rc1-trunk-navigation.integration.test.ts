import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { woodlandTrees, type GeneratedLandscape, spawnDistance } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { RC1_CANONICAL_CHECKSUM } from '../onboarding/spawn-compute-protocol.js';
import { readRc1Ground } from './rc1-ground.js';
const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test')
  throw Error('Unexpected isolated RC1 ground DB');
const db = createDatabase(url),
  account = randomUUID(),
  world = randomUUID(),
  other = randomUUID(),
  wood = randomUUID(),
  natural = randomUUID();
const artifact = JSON.parse(
  readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8'),
) as GeneratedLandscape;
const feature = { cellX: 140, cellY: 20, variantSeed: 3, rc1: { trees: [], rocks: [] } };
describe.sequential('RC1 authoritative trunk navigation on isolated worlds', () => {
  beforeAll(async () => {
    await db
      .insertInto('accounts')
      .values({ id: account, email: account + '@trunks.test', passwordHash: 'fixture' })
      .execute();
    for (const id of [world, other]) {
      await db
        .insertInto('worlds')
        .values({
          id,
          slug: 'trunks-' + id,
          name: 'Trunk fixture',
          topology: 'torus',
          widthCells: 512,
          heightCells: 256,
          chunkSize: 32,
          seed: artifact.seed,
          generationStatus: 'ready',
          generationVersion: 3,
          isOpen: true,
          generatedAt: new Date(),
        })
        .execute();
      await db
        .insertInto('worldGenerationCandidates')
        .values({
          worldId: id,
          commandId: randomUUID(),
          ownerAccountId: account,
          parameters: artifact.geography!.parameters,
          status: 'ready',
          checksum: RC1_CANONICAL_CHECKSUM,
          artifact,
        })
        .execute();
    }
    await db
      .insertInto('worldFeatures')
      .values({ id: wood, worldId: world, featureTypeCode: 'woodland', state: 'available', variantSeed: 3 })
      .execute();
    await db
      .insertInto('worldRc1Resources')
      .values({
        worldId: world,
        featureId: wood,
        sourceKey: 'starter:' + wood,
        treeIndices: '[]',
        removedIndices: '[]',
      })
      .execute();
    await db
      .insertInto('woodlandDeposits')
      .values({
        worldId: world,
        featureId: wood,
        cellX: 140,
        cellY: 20,
        initialAmount: 1500,
        remainingAmount: 1500,
        reservedAmount: 0,
        revision: 1,
        updatedAt: new Date(),
        regrowthUpdatedAt: new Date(),
      })
      .execute();
    await db
      .insertInto('worldCellOccupancies')
      .values({ worldId: world, cellX: 140, cellY: 20, featureId: wood, buildingId: null, role: 'body' })
      .execute();
  }, 60000);
  afterAll(async () => {
    await db.deleteFrom('woodlandDeposits').where('worldId', 'in', [world, other]).execute();
    await db.deleteFrom('worlds').where('id', 'in', [world, other]).execute();
    await db.deleteFrom('accounts').where('id', '=', account).execute();
    await db.destroy();
  }, 60000);
  it('uses the rendered synthetic tree positions, keeps occupancy and isolates worlds', async () => {
    const tree = woodlandTrees({ ...feature, deposit: null })[0]!,
      ground = await readRc1Ground(db, world),
      foreign = await readRc1Ground(db, other);
    expect(foreign.navigation.sample(tree.x, tree.y).blocked).toBe(false);
    expect(ground.navigation.sample(tree.x, tree.y).blocked).toBe(true);
    expect(ground.navigation.woodedCells).toContainEqual({ cellX: 140, cellY: 20 });
    expect(
      await db
        .selectFrom('worldCellOccupancies')
        .select('featureId')
        .where('worldId', '=', world)
        .where('cellX', '=', 140)
        .where('cellY', '=', 20)
        .executeTakeFirst(),
    ).toEqual({ featureId: wood });
    const revision = ground.navigation.revision;
    await db
      .updateTable('woodlandDeposits')
      .set({ remainingAmount: 100 })
      .where('worldId', '=', world)
      .where('featureId', '=', wood)
      .execute();
    expect((await readRc1Ground(db, world)).navigation.revision).toBe(revision);
    await db
      .updateTable('woodlandDeposits')
      .set({ cleared: true })
      .where('worldId', '=', world)
      .where('featureId', '=', wood)
      .execute();
    const cleared = await readRc1Ground(db, world);
    expect(cleared.navigation.revision).not.toBe(revision);
    expect(cleared.navigation.sample(tree.x, tree.y).blocked).toBe(false);
  });
  it('removes a natural trunk only when its persisted geometry is removed', async () => {
    const ground = await readRc1Ground(db, world),
      trees = artifact.forest!.trees;
    const index = trees.findIndex(
      (t, i) =>
        !ground.field.intersectsRock({ x: t.x, y: t.y, halfWidth: 0.2, halfHeight: 0.2 }) &&
        trees.every((other, j) => i === j || spawnDistance(t, other, 512, 256) > 0.4),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const tree = trees[index]!;
    await db
      .insertInto('worldFeatures')
      .values({ id: natural, worldId: world, featureTypeCode: 'woodland', state: 'available', variantSeed: 3 })
      .execute();
    await db
      .insertInto('worldRc1Resources')
      .values({
        worldId: world,
        featureId: natural,
        sourceKey: 'wood:fixture',
        treeIndices: JSON.stringify([index]),
        removedIndices: '[]',
      })
      .execute();
    const before = await readRc1Ground(db, world);
    expect(before.navigation.sample(tree.x, tree.y).blocked).toBe(true);
    await db
      .updateTable('worldRc1Resources')
      .set({ removedIndices: JSON.stringify([index]) })
      .where('worldId', '=', world)
      .where('featureId', '=', natural)
      .execute();
    const after = await readRc1Ground(db, world);
    expect(after.navigation.sample(tree.x, tree.y).blocked).toBe(false);
    expect(after.navigation.revision).not.toBe(before.navigation.revision);
    expect((await readRc1Ground(db, other)).navigation.sample(tree.x, tree.y).blocked).toBe(true);
  });
});
