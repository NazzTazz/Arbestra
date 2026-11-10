import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { ownedVillage, stoneTravelPath, refineVillagePath } from './service.js';
import { NavigationCompute } from '../navigation/compute.js';
import { bindTransactionRefiner } from '../navigation/transaction-refinement.js';
import { HttpError } from '../../errors.js';
import { pathTravelDuration } from '../navigation/road-cost.js';
import { travelDuration } from '@arbestra/contracts';

const url = testDatabaseUrl();
const target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected route test database');
const db = createDatabase(url),
  compute = new NavigationCompute();
beforeAll(async () => {
  await migrateToLatest(url);
  await compute.start();
});
afterAll(async () => {
  await compute.close();
  await db.destroy();
});
it('reaches a woodland from the real door when the coarse hall anchor is enclosed, but refuses an actual barrier', async () => {
  const rollback = new Error('route fixture rollback');
  await expect(
    db.transaction().execute(async (tx) => {
      const account = randomUUID(),
        world = randomUUID(),
        village = randomUUID(),
        hall = randomUUID(),
        feature = randomUUID();
      await tx
        .insertInto('accounts')
        .values({ id: account, email: account + '@route.test', passwordHash: 'fixture' })
        .execute();
      await tx
        .insertInto('worlds')
        .values({
          id: world,
          slug: world,
          name: 'Route regression',
          topology: 'torus',
          widthCells: 64,
          heightCells: 64,
          chunkSize: 32,
          seed: 1,
          generationVersion: 1,
          generationStatus: 'ready',
          generatedAt: new Date(),
        })
        .execute();
      await tx
        .insertInto('worldMemberships')
        .values({ worldId: world, accountId: account, playerName: 'Route' })
        .execute();
      await tx
        .insertInto('villages')
        .values({
          id: village,
          worldId: world,
          ownerAccountId: account,
          name: 'Route',
          anchorCellX: 10,
          anchorCellY: 10,
        })
        .execute();
      await tx
        .insertInto('buildings')
        .values({
          id: hall,
          worldId: world,
          villageId: village,
          buildingType: 'town-hall',
          level: 1,
          targetLevel: null,
          status: 'completed',
          constructionStartedAt: null,
          constructionCompletesAt: null,
          completedAt: new Date(),
        })
        .execute();
      await tx
        .insertInto('worldCellOccupancies')
        .values(
          Array.from({ length: 9 }, (_, i) => ({
            worldId: world,
            buildingId: hall,
            featureId: null,
            cellX: 9 + (i % 3),
            cellY: 9 + Math.floor(i / 3),
            role: i === 4 ? 'anchor' : 'body',
          })),
        )
        .execute();
      await tx
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
      await tx
        .insertInto('worldFeatures')
        .values({ id: feature, worldId: world, featureTypeCode: 'woodland', state: 'available', variantSeed: 1 })
        .execute();
      await tx
        .insertInto('woodlandDeposits')
        .values({
          worldId: world,
          featureId: feature,
          cellX: 16,
          cellY: 10,
          initialAmount: 1000,
          remainingAmount: 1000,
          reservedAmount: 0,
          revision: 1,
          updatedAt: new Date(),
          regrowthUpdatedAt: new Date(),
        })
        .execute();
      const owner = await ownedVillage(tx, account, world, village);
      const path = await stoneTravelPath(tx, owner, feature);
      expect(path?.length, 'the door, rather than the occupied coarse anchor, decides access').toBeGreaterThan(1);
      expect(path![0]).not.toEqual({ cellX: 10, cellY: 10 });
      expect(path!.at(-1)).toEqual({ cellX: 16, cellY: 10 });
      const refinement = vi.spyOn(compute, 'refine'),
        unbind = bindTransactionRefiner(db, compute);
      try {
        // All fixtures are still uncommitted: the worker must use the captured
        // geometry, never open another connection or drop the current transaction.
        expect(await stoneTravelPath(tx, owner, feature)).toEqual(path);
        expect(refinement).toHaveBeenCalledTimes(1);
        const busy = new HttpError(503, 'NAVIGATION_BUSY', 'fixture saturation');
        refinement.mockRejectedValueOnce(busy);
        await expect(stoneTravelPath(tx, owner, feature)).rejects.toBe(busy);
        // A full water ring around the destination really is impassable.
        await sql`update world_chunks set terrain_codes = (select array_agg(case when abs((n-1)%32-16)<=1 and abs((n-1)/32-10)<=1 and n<>10*32+16+1 then 0 else v end order by n) from unnest(terrain_codes) with ordinality as a(v,n)) where world_id=${world} and chunk_x=0 and chunk_y=0`.execute(
          tx,
        );
        expect(await stoneTravelPath(tx, owner, feature)).toBeUndefined();
        await expect(refineVillagePath(tx, owner, path!, feature)).rejects.toMatchObject({
          code: 'DESTINATION_UNREACHABLE',
        });
      } finally {
        unbind();
        refinement.mockRestore();
      }
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}, 30000);

it('takes a parallel road to a wood beyond 16 cells and travels faster on it (navigation T1)', async () => {
  // Roads enter the witness of the mini network (audit B1, read in the code;
  // this scene is not a reproduction: here the fine search already took the
  // road before T1) and the duration (decision 8).
  const rollback = new Error('road fixture rollback');
  await expect(
    db.transaction().execute(async (tx) => {
      const account = randomUUID(),
        world = randomUUID(),
        village = randomUUID(),
        hall = randomUUID(),
        feature = randomUUID();
      await tx
        .insertInto('accounts')
        .values({ id: account, email: account + '@road.test', passwordHash: 'fixture' })
        .execute();
      await tx
        .insertInto('worlds')
        .values({
          id: world,
          slug: world,
          name: 'Road regression',
          topology: 'torus',
          widthCells: 64,
          heightCells: 64,
          chunkSize: 32,
          seed: 1,
          generationVersion: 1,
          generationStatus: 'ready',
          generatedAt: new Date(),
        })
        .execute();
      await tx
        .insertInto('worldMemberships')
        .values({ worldId: world, accountId: account, playerName: 'Road' })
        .execute();
      await tx
        .insertInto('villages')
        .values({
          id: village,
          worldId: world,
          ownerAccountId: account,
          name: 'Road',
          anchorCellX: 10,
          anchorCellY: 10,
        })
        .execute();
      await tx
        .insertInto('buildings')
        .values({
          id: hall,
          worldId: world,
          villageId: village,
          buildingType: 'town-hall',
          level: 1,
          targetLevel: null,
          status: 'completed',
          constructionStartedAt: null,
          constructionCompletesAt: null,
          completedAt: new Date(),
        })
        .execute();
      await tx
        .insertInto('worldCellOccupancies')
        .values(
          Array.from({ length: 9 }, (_, i) => ({
            worldId: world,
            buildingId: hall,
            featureId: null,
            cellX: 9 + (i % 3),
            cellY: 9 + Math.floor(i / 3),
            role: i === 4 ? 'anchor' : 'body',
          })),
        )
        .execute();
      await tx
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
      await tx
        .insertInto('worldFeatures')
        .values({ id: feature, worldId: world, featureTypeCode: 'woodland', state: 'available', variantSeed: 1 })
        .execute();
      await tx
        .insertInto('woodlandDeposits')
        .values({
          worldId: world,
          featureId: feature,
          cellX: 10,
          cellY: 40,
          initialAmount: 1000,
          remainingAmount: 1000,
          reservedAmount: 0,
          revision: 1,
          updatedAt: new Date(),
          regrowthUpdatedAt: new Date(),
        })
        .execute();
      const owner = await ownedVillage(tx, account, world, village);
      const plain = (await stoneTravelPath(tx, owner, feature))!;
      const plainMs = await pathTravelDuration(tx, owner, plain);
      // A column of road cells two cells east of the direct line, hall to wood.
      const column = Array.from({ length: 29 }, (_, i) => ({ cellX: 12, cellY: 12 + i }));
      await tx
        .insertInto('roadCells')
        .values(column.map((c) => ({ worldId: world, villageId: village, ...c, surface: 'earth', sidewalks: false })))
        .execute();
      const paved = (await stoneTravelPath(tx, owner, feature))!;
      const keys = new Set(column.map((c) => `${c.cellX}:${c.cellY}`));
      const onRoad =
        paved.filter((p) => keys.has(`${Math.round(p.cellX)}:${Math.round(p.cellY)}`)).length / paved.length;
      expect(onRoad, 'the path follows the road').toBeGreaterThan(0.6);
      // Beyond the village region (y > 25), the path is the witness's tail: on the road too.
      const tail = paved.filter((p) => p.cellY >= 30 && p.cellY <= 38);
      expect(tail.length).toBeGreaterThan(0);
      expect(
        tail.every((p) => Math.round(p.cellX) === 12),
        'the witness tail follows the road',
      ).toBe(true);
      const pavedMs = await pathTravelDuration(tx, owner, paved);
      expect(pavedMs, 'roads shorten travel (decision 8)').toBeLessThan(plainMs);
      // The same path is slower when its roads are not counted: the gain is the road's.
      expect(travelDuration(paved, owner)).toBeGreaterThan(pavedMs);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}, 30000);
