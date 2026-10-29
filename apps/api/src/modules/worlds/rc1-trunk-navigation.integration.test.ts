import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { woodlandTrees, type GeneratedLandscape, spawnDistance } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { sql } from 'kysely';
import { RC1_CANONICAL_CHECKSUM } from '../onboarding/spawn-compute-protocol.js';
import { loadNavigationContext, navigationRevision } from '../navigation/context.js';
import { networkFingerprint } from '../villages/presentation.js';
import { readRc1Ground } from './rc1-ground.js';
const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected isolated RC1 ground DB');
const db = createDatabase(url),
  account = randomUUID(),
  world = randomUUID(),
  other = randomUUID(),
  wood = randomUUID(),
  natural = randomUUID(),
  pair = randomUUID();
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
  // Slice 2e (docs/PLAN-BOIS-ARBRE-TRANCHE-2.md): only trunks block, a felled tree
  // stays an obstacle until its stump goes, then leaves before its case clears.
  it('removes a trunk from the navigation when its stump is removed, never when its wood goes', async () => {
    const trees = artifact.forest!.trees,
      start = await readRc1Ground(db, world);
    // Two isolated natural trees, after the one of the previous test.
    const isolated: number[] = [];
    for (let i = 0; i < trees.length && isolated.length < 3; i++)
      if (
        !start.field.intersectsRock({ x: trees[i]!.x, y: trees[i]!.y, halfWidth: 0.2, halfHeight: 0.2 }) &&
        trees.every((other, j) => i === j || spawnDistance(trees[i]!, other, 512, 256) > 0.4)
      )
        isolated.push(i);
    const [a, b] = isolated.slice(1) as [number, number];
    const cellX = Math.floor(trees[a]!.x + 0.5),
      cellY = Math.floor(trees[a]!.y + 0.5),
      t = new Date();
    await db
      .insertInto('worldFeatures')
      .values({ id: pair, worldId: world, featureTypeCode: 'woodland', state: 'available', variantSeed: 3 })
      .execute();
    await db
      .insertInto('worldRc1Resources')
      .values({
        worldId: world,
        featureId: pair,
        sourceKey: 'wood:pair',
        treeIndices: JSON.stringify([a, b]),
        removedIndices: '[]',
      })
      .execute();
    await db
      .insertInto('woodlandDeposits')
      .values({
        worldId: world,
        featureId: pair,
        cellX,
        cellY,
        initialAmount: 1000,
        remainingAmount: 1000,
        reservedAmount: 0,
        revision: 1,
        updatedAt: t,
        regrowthUpdatedAt: t,
      })
      .execute();
    await db
      .insertInto('worldCellOccupancies')
      .values({ worldId: world, cellX, cellY, featureId: pair, buildingId: null, role: 'body' })
      .execute();
    const input = {
      world: { id: world, widthCells: 512, heightCells: 256 },
      village: { anchorCellX: 0, anchorCellY: 0 },
      region: { originCellX: 0, originCellY: 0, width: 1, height: 1, terrainCodes: [], features: [] },
      cells: [],
    } as unknown as Parameters<typeof networkFingerprint>[0];
    const observe = async () => {
      const ground = await readRc1Ground(db, world);
      return {
        ground,
        revision: ground.navigation.revision,
        fingerprint: networkFingerprint(input, ground),
        navigation: await navigationRevision(db, world),
        chunks: Number(
          (
            await sql<{ n: string }>`select count(*)::text as n from navigation_chunk_versions
              where world_id=${world} and chunk_x=${Math.floor(cellX / 32)} and chunk_y=${Math.floor(cellY / 32)}`.execute(
              db,
            )
          ).rows[0]!.n,
        ),
      };
    };
    const standing = await observe();
    expect(standing.ground.navigation.sample(trees[a]!.x, trees[a]!.y).blocked).toBe(true);
    expect(standing.ground.navigation.sample(trees[b]!.x, trees[b]!.y).blocked).toBe(true);
    const unchanged = async () => {
      const now = await observe();
      expect([now.revision, now.fingerprint, now.navigation, now.chunks]).toEqual([
        standing.revision,
        standing.fingerprint,
        standing.navigation,
        standing.chunks,
      ]);
      expect(now.ground.navigation.sample(trees[a]!.x, trees[a]!.y).blocked).toBe(true);
    };
    // Felled with a lot debited, then cut to its stump: still an obstacle, nothing moves.
    await db
      .insertInto('woodlandTrees')
      .values({ worldId: world, featureId: pair, treeIndex: a, remainingAmount: 300, felledAt: t })
      .execute();
    await unchanged();
    await db
      .updateTable('woodlandTrees')
      .set({ remainingAmount: 0 })
      .where('featureId', '=', pair)
      .where('treeIndex', '=', a)
      .execute();
    await unchanged();
    // The stump removed: its trunk leaves, the other stays, the case stays occupied.
    await db
      .updateTable('woodlandTrees')
      .set({ stumpRemovedAt: t })
      .where('featureId', '=', pair)
      .where('treeIndex', '=', a)
      .execute();
    const removed = await observe();
    expect(removed.ground.navigation.sample(trees[a]!.x, trees[a]!.y).blocked).toBe(false);
    expect(removed.ground.navigation.sample(trees[b]!.x, trees[b]!.y).blocked).toBe(true);
    expect(removed.ground.field.intersectsTree({ x: trees[a]!.x, y: trees[a]!.y, halfWidth: 0, halfHeight: 0 })).toBe(
      false,
    );
    expect(removed.ground.navigationEdits.absent).toContain(a);
    expect(removed.ground.navigationEdits.absent).not.toContain(b);
    expect(removed.revision).not.toBe(standing.revision);
    expect(removed.fingerprint).not.toBe(standing.fingerprint);
    expect(Number(removed.navigation)).toBe(Number(standing.navigation) + 1);
    expect(removed.chunks).toBeGreaterThan(standing.chunks);
    expect(
      await db.selectFrom('worldCellOccupancies').select('featureId').where('featureId', '=', pair).execute(),
    ).toEqual([{ featureId: pair }]);
    // The route field of the travel planner reads the same removal.
    const context = await loadNavigationContext(db, world, new Set(), new Set());
    expect(context.data!.treeEdits.find((e) => e.removed.includes(a))).toBeDefined();
    expect(context.data!.treeEdits.some((e) => e.removed.includes(b))).toBe(false);
    // A starter supplement (three drawn trees): its first stump removed, its first trunk leaves.
    await db
      .updateTable('woodlandDeposits')
      .set({ cleared: false })
      .where('worldId', '=', world)
      .where('featureId', '=', wood)
      .execute();
    const [first, second] = woodlandTrees({ ...feature, deposit: null });
    const supplement = await readRc1Ground(db, world);
    expect(supplement.navigation.sample(first!.x, first!.y).blocked).toBe(true);
    await db
      .insertInto('woodlandTrees')
      .values({ worldId: world, featureId: wood, treeIndex: 0, remainingAmount: 0, felledAt: t, stumpRemovedAt: t })
      .execute();
    const starter = await readRc1Ground(db, world);
    expect(starter.navigation.sample(first!.x, first!.y).blocked).toBe(false);
    expect(starter.navigation.sample(second!.x, second!.y).blocked).toBe(true);
    expect(starter.navigation.revision).not.toBe(supplement.navigation.revision);
    expect(starter.navigationEdits.groves).toContainEqual(expect.objectContaining({ removedTrees: [0] }));
    const groveContext = await loadNavigationContext(db, world, new Set(), new Set());
    expect(groveContext.data!.treeEdits).toContainEqual(expect.objectContaining({ grove: true, removedTrees: [0] }));
  }, 120000);
});
