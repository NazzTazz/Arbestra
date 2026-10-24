import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CamelCasePlugin, Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { GeneratedLandscape } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { RC1_CANONICAL_CHECKSUM } from '../onboarding/spawn-compute-protocol.js';
import { readRc1Ground } from './rc1-ground.js';
import { getTerrain, getTerrainUpdates } from './terrain.js';
import { readSpatialChanges } from '../villages/sync-v2-spatial-readers.js';
import { readTerrainProjection } from './terrain.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected RC1 cache test target');
const queries: string[] = [];
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }),
  plugins: [new CamelCasePlugin()],
  log: (event) => {
    if (event.level === 'query') queries.push(event.query.sql);
  },
});
const accountId = randomUUID(),
  worlds = [randomUUID(), randomUUID()],
  villageId = randomUUID(),
  featureId = randomUUID();
const artifact = JSON.parse(
  readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8'),
) as GeneratedLandscape;
const bodies = () => queries.filter((q) => q.includes('artifact::text')).length;

describe('RC1 verified source cache on isolated worlds', () => {
  beforeAll(async () => {
    await migrateToLatest(url);
    await db
      .insertInto('accounts')
      .values({ id: accountId, email: accountId + '@rc1-cache.test', passwordHash: 'fixture' })
      .execute();
    for (const id of worlds) {
      await db
        .insertInto('worlds')
        .values({
          id,
          slug: 'rc1-cache-' + id,
          name: 'Cache fixture',
          topology: 'torus',
          widthCells: 512,
          heightCells: 256,
          chunkSize: 32,
          seed: 4109,
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
          ownerAccountId: accountId,
          parameters: artifact.geography!.parameters,
          status: 'ready',
          checksum: RC1_CANONICAL_CHECKSUM,
          artifact,
        })
        .execute();
    }
    await db
      .insertInto('worldMemberships')
      .values({ worldId: worlds[0]!, accountId, playerName: 'Cache fixture' })
      .execute();
    await db
      .insertInto('villages')
      .values({
        id: villageId,
        worldId: worlds[0]!,
        ownerAccountId: accountId,
        name: 'Cache fixture',
        anchorCellX: 140,
        anchorCellY: 20,
      })
      .execute();
    await db
      .insertInto('worldFeatures')
      .values({ id: featureId, worldId: worlds[0]!, featureTypeCode: 'woodland', state: 'available', variantSeed: 1 })
      .execute();
    await db
      .insertInto('worldRc1Resources')
      .values({
        worldId: worlds[0]!,
        featureId,
        sourceKey: 'wood:test',
        treeIndices: sql`'[0]'::jsonb`,
        removedIndices: sql`'[]'::jsonb`,
      })
      .execute();
  }, 120000);
  afterAll(async () => {
    await db.deleteFrom('worlds').where('id', 'in', worlds).execute();
    await db.deleteFrom('accounts').where('id', '=', accountId).execute();
    await db.destroy();
  }, 60000);

  it('reuses a verified body across transactions while rechecking identity and local edits', async () => {
    queries.length = 0;
    await db.transaction().execute((tx) => readRc1Ground(tx, worlds[0]!));
    expect(bodies()).toBe(1);
    await db.transaction().execute((tx) => readRc1Ground(tx, worlds[0]!));
    expect(bodies()).toBe(1);
    expect(queries.filter((q) => q.includes('as "row_version"'))).toHaveLength(3); // Two identities and the initial body.
    expect(queries.filter((q) => q.includes('left join lateral') && q.includes('"world_rc1_resources"'))).toHaveLength(
      1,
    );
    await readRc1Ground(db, worlds[1]!);
    expect(bodies()).toBe(2); // Another world's row must be verified independently.
    const tree = artifact.forest!.trees[0]!,
      surface = { ...tree, halfWidth: 0, halfHeight: 0 };
    const before = await readRc1Ground(db, worlds[0]!);
    expect(before.field.intersectsTree(surface)).toBe(true);
    const height = before.field.sample(140, 20).elevation + 0.25;
    await db
      .insertInto('worldSpawnTerraces')
      .values({ worldId: worlds[0]!, villageId, cellX: 140, cellY: 20, height })
      .execute();
    await db
      .updateTable('worldRc1Resources')
      .set({ removedIndices: sql`'[0]'::jsonb` })
      .where('worldId', '=', worlds[0]!)
      .where('featureId', '=', featureId)
      .execute();
    const after = await readRc1Ground(db, worlds[0]!);
    expect(after.field.sample(140, 20).elevation).toBe(height);
    expect(after.field.intersectsTree(surface)).toBe(false);
    const other = await readRc1Ground(db, worlds[1]!);
    expect(other.terraces).toEqual([]);
    expect(other.field.intersectsTree(surface)).toBe(true);
    expect(bodies()).toBe(2);
  });

  it('observes two terrain edits in one transaction and restores the committed geometry after rollback', async () => {
    const before = await readRc1Ground(db, worlds[0]!),
      height = before.field.sample(140, 20).elevation;
    const rollback = Error('GROUND_EDITS_ROLLBACK');
    await expect(
      db.transaction().execute(async (tx) => {
        for (const offset of [0.25, 0.5]) {
          await tx
            .insertInto('worldSpawnTerraces')
            .values({ worldId: worlds[0]!, villageId, cellX: 140, cellY: 20, height: height + offset })
            .onConflict((oc) => oc.columns(['worldId', 'cellX', 'cellY']).doUpdateSet({ height: height + offset }))
            .execute();
          expect((await readRc1Ground(tx, worlds[0]!)).field.sample(140, 20).elevation).toBe(height + offset);
        }
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect((await readRc1Ground(db, worlds[0]!)).field.sample(140, 20).elevation).toBe(height);
  });

  it('keeps an older repeatable-read view when a newer geometry has already warmed the shared cache', async () => {
    const before = await readRc1Ground(db, worlds[0]!),
      height = before.field.sample(140, 20).elevation;
    try {
      await db
        .transaction()
        .setIsolationLevel('repeatable read')
        .execute(async (tx) => {
          expect((await readRc1Ground(tx, worlds[0]!)).field.sample(140, 20).elevation).toBe(height);
          // The old reader has established its MVCC snapshot. Commit the change
          // through another connection before returning to that reader.
          await db
            .updateTable('worldSpawnTerraces')
            .set({ height: height + 0.75 })
            .where('worldId', '=', worlds[0]!)
            .where('cellX', '=', 140)
            .where('cellY', '=', 20)
            .execute();
          expect((await readRc1Ground(db, worlds[0]!)).field.sample(140, 20).elevation).toBe(height + 0.75);
          expect((await readRc1Ground(tx, worlds[0]!)).field.sample(140, 20).elevation).toBe(height);
        });
    } finally {
      await db
        .updateTable('worldSpawnTerraces')
        .set({ height })
        .where('worldId', '=', worlds[0]!)
        .where('cellX', '=', 140)
        .where('cellY', '=', 20)
        .execute();
    }
  });

  it('keeps ordinary stock changes out of the geometry cache but invalidates the physical woodland threshold', async () => {
    const rollback = Error('GROUND_THRESHOLD_ROLLBACK'),
      tree = artifact.forest!.trees[0]!,
      surface = { ...tree, halfWidth: 0, halfHeight: 0 };
    await expect(
      db.transaction().execute(async (tx) => {
        await tx
          .updateTable('worldRc1Resources')
          .set({ removedIndices: sql`'[]'::jsonb` })
          .where('worldId', '=', worlds[0]!)
          .where('featureId', '=', featureId)
          .execute();
        await tx
          .insertInto('woodlandDeposits')
          .values({
            worldId: worlds[0]!,
            featureId,
            cellX: 140,
            cellY: 20,
            initialAmount: 1000,
            remainingAmount: 900,
            reservedAmount: 0,
            revision: 1,
            updatedAt: new Date(),
            regrowthUpdatedAt: new Date(),
          })
          .execute();
        const first = await readRc1Ground(tx, worlds[0]!);
        expect(first.field.intersectsTree(surface)).toBe(true);
        await tx
          .updateTable('woodlandDeposits')
          .set({ remainingAmount: 800 })
          .where('worldId', '=', worlds[0]!)
          .where('featureId', '=', featureId)
          .execute();
        queries.length = 0;
        expect((await readRc1Ground(tx, worlds[0]!)).field).toBe(first.field);
        expect(queries.some((q) => q.includes('left join lateral') && q.includes('"world_rc1_resources"'))).toBe(false);
        await tx
          .updateTable('woodlandDeposits')
          .set({ remainingAmount: 100 })
          .where('worldId', '=', worlds[0]!)
          .where('featureId', '=', featureId)
          .execute();
        expect((await readRc1Ground(tx, worlds[0]!)).field.intersectsTree(surface)).toBe(false);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect((await readRc1Ground(db, worlds[0]!)).navigation.sample(tree.x, tree.y).blocked).toBe(false);
  });

  it('serves negotiated mutable RC1 edits without repeating the substrate and keeps legacy compatibility', async () => {
    const slug = 'rc1-cache-' + worlds[0]!;
    const full = await getTerrain(db, accountId, slug, '4,0');
    const legacy = await getTerrainUpdates(db, accountId, slug, '4,0');
    const compact = await getTerrainUpdates(db, accountId, slug, '4,0', false, true);
    expect(legacy.chunks[0]!.rc1).toEqual(full.chunks[0]!.rc1);
    expect(compact.chunks[0]!.rc1).toBeUndefined();
    expect(compact.chunks[0]!.rc1Edits!.terraces).toEqual(full.chunks[0]!.rc1!.terraces);
    expect(JSON.stringify(compact)).not.toMatch(/heights|water|stride|terrainCodes|elevations/);
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(Buffer.byteLength(JSON.stringify(legacy)) / 10);
  });
  it('does not prepare an immutable patch for a mutable-only RC1 refresh', async () => {
    const ground = await readRc1Ground(db, worlds[0]!);
    const patch = vi.spyOn(ground, 'patch');
    try {
      const compact = await getTerrainUpdates(db, accountId, 'rc1-cache-' + worlds[0]!, '4,0;5,1', false, true);
      expect(compact.chunks[0]!.rc1Edits?.terraces).toEqual(
        ground.terraces.filter((t) => t.cellX >= 128 && t.cellX < 160 && t.cellY < 32),
      );
      expect(compact.chunks[1]!.rc1Edits?.terraces).toEqual([]);
      expect(patch).not.toHaveBeenCalled();
    } finally {
      patch.mockRestore();
    }
  });
  it('rejects a changed artifact even with the declared checksum and transaction xmin unchanged', async () => {
    const rollback = Error('EXPECTED_CACHE_TEST_ROLLBACK');
    await expect(
      db.transaction().execute(async (tx) => {
        // Both versions below have the same xmin but distinct physical tuples.
        await tx.updateTable('worldGenerationCandidates').set({ artifact }).where('worldId', '=', worlds[0]!).execute();
        await readRc1Ground(tx, worlds[0]!);
        await tx
          .updateTable('worldGenerationCandidates')
          .set({ artifact: { ...artifact, seed: 123 } })
          .where('worldId', '=', worlds[0]!)
          .execute();
        await expect(readRc1Ground(tx, worlds[0]!)).rejects.toMatchObject({ code: 'WORLD_NOT_READY' });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect((await readRc1Ground(db, worlds[0]!)).data.seed).toBe(4109);
  });

  it('revalidates world dimensions and seed on cache hits', async () => {
    const rollback = Error('EXPECTED_WORLD_TEST_ROLLBACK');
    await expect(
      db.transaction().execute(async (tx) => {
        await tx.updateTable('worlds').set({ heightCells: 512 }).where('id', '=', worlds[0]!).execute();
        await expect(readRc1Ground(tx, worlds[0]!)).rejects.toMatchObject({ code: 'WORLD_NOT_READY' });
        await tx.updateTable('worlds').set({ heightCells: 256, seed: 123 }).where('id', '=', worlds[0]!).execute();
        await expect(readRc1Ground(tx, worlds[0]!)).rejects.toMatchObject({ code: 'WORLD_NOT_READY' });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it('keeps selected V2 feature elevations equal to terrain after local vertex edits', async () => {
    const rollback = Error('V2_GEOMETRY_ROLLBACK'),
      worldId = worlds[0]!,
      tree = artifact.forest!.trees[0]!;
    await expect(
      db.transaction().execute(async (tx) => {
        await tx.updateTable('worlds').set({ terrainModel: 'vertices' }).where('id', '=', worldId).execute();
        await tx
          .updateTable('worldRc1Resources')
          .set({ removedIndices: sql`'[]'::jsonb` })
          .where('worldId', '=', worldId)
          .where('featureId', '=', featureId)
          .execute();
        await tx
          .insertInto('worldCellOccupancies')
          .values({ worldId, cellX: 140, cellY: 20, featureId, role: 'body' })
          .execute();
        const x = Math.floor(tree.x + 0.5),
          y = Math.floor(tree.y + 0.5);
        for (const dx of [0, 1])
          for (const dy of [0, 1])
            await tx
              .insertInto('worldTerrainVertices')
              .values({
                worldId,
                vertexX: (((x + dx) % 512) + 512) % 512,
                vertexY: (((y + dy) % 256) + 256) % 256,
                height: 123,
              })
              .execute();
        const historical = await readTerrainProjection(tx, accountId, 'rc1-cache-' + worldId, '4,0', true);
        const expected = historical.chunks[0]!.features.find((feature) => feature.id === featureId)!.rc1!;
        expect(expected.trees[0]?.elevation).toBe(123);
        queries.length = 0;
        const changes = await readSpatialChanges(
          tx,
          {
            worldId,
            worldSlug: 'rc1-cache-' + worldId,
            accountId,
            widthCells: 512,
            heightCells: 256,
            chunkSize: 32,
            generationVersion: 3,
            chunkX: 4,
            chunkY: 0,
          },
          [{ component: 'spatialFeatures', key: featureId }],
        );
        expect(changes).toMatchObject([
          { component: 'spatialFeatures', upsert: [{ id: featureId, locations: [{ rc1: expected }] }] },
        ]);
        expect(
          queries.some(
            (query) =>
              query.includes('string_agg') ||
              (query.includes('left join lateral') && query.includes('"world_rc1_resources"')),
          ),
        ).toBe(false);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }, 60000);

  it.each(['legacy', 'vertices'] as const)(
    'reads selected V2 ground at the torus seam without world geometry aggregation (%s)',
    async (model) => {
      const rollback = Error('V2_GROUND_ROLLBACK'),
        worldId = worlds[0]!;
      await expect(
        db.transaction().execute(async (tx) => {
          if (model === 'vertices') {
            await tx.updateTable('worlds').set({ terrainModel: 'vertices' }).where('id', '=', worldId).execute();
            await tx
              .insertInto('worldTerrainVertices')
              .values({ worldId, vertexX: 0, vertexY: 0, height: 123 })
              .onConflict((c) => c.columns(['worldId', 'vertexX', 'vertexY']).doUpdateSet({ height: 123 }))
              .execute();
          }
          const historical = await readTerrainProjection(tx, accountId, 'rc1-cache-' + worldId, '15,7', true);
          const { features: _features, occupiedCells: _occupied, ...expected } = historical.chunks[0]!;
          void _features;
          void _occupied;
          queries.length = 0;
          const changes = await readSpatialChanges(
            tx,
            {
              worldId,
              worldSlug: 'rc1-cache-' + worldId,
              accountId,
              widthCells: 512,
              heightCells: 256,
              chunkSize: 32,
              generationVersion: 3,
              chunkX: 15,
              chunkY: 7,
            },
            [{ component: 'spatialGround', key: '*' }],
          );
          expect(changes).toEqual([{ component: 'spatialGround', upsert: [{ id: '*', data: expected }], remove: [] }]);
          expect(
            queries.some(
              (query) =>
                query.includes('string_agg') ||
                query.includes('"world_rc1_resources"') ||
                query.includes('"world_cell_occupancies"'),
            ),
          ).toBe(false);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
    120000,
  );
});
