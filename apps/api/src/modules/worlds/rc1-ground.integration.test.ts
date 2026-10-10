import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {CamelCasePlugin, Kysely, PostgresDialect, sql} from 'kysely';
import {Pool} from 'pg';
import type {GeneratedLandscape} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {migrateToLatest} from '../../database/migrate.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {RC1_CANONICAL_CHECKSUM} from '../onboarding/spawn-compute-protocol.js';
import {readRc1Ground} from './rc1-ground.js';

const url = testDatabaseUrl(), target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected RC1 cache test target');
const queries: string[] = [];
const db = new Kysely<Database>({dialect: new PostgresDialect({pool: new Pool({connectionString: url})}),
  plugins: [new CamelCasePlugin()], log: event => { if (event.level === 'query') queries.push(event.query.sql); }});
const accountId = randomUUID(), worlds = [randomUUID(), randomUUID()], villageId = randomUUID(), featureId = randomUUID();
const artifact = JSON.parse(readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8')) as GeneratedLandscape;
const bodies = () => queries.filter(q => q.includes('artifact::text')).length;

describe('RC1 verified source cache on isolated worlds', () => {
  beforeAll(async () => {
    await migrateToLatest(url);
    await db.insertInto('accounts').values({id: accountId, email: accountId + '@rc1-cache.test', passwordHash: 'fixture'}).execute();
    for (const id of worlds) {
      await db.insertInto('worlds').values({id, slug: 'rc1-cache-' + id, name: 'Cache fixture', topology: 'torus', widthCells: 512, heightCells: 256, chunkSize: 32, seed: 4109, generationStatus: 'ready', generationVersion: 3, isOpen: true, generatedAt: new Date()}).execute();
      await db.insertInto('worldGenerationCandidates').values({worldId: id, commandId: randomUUID(), ownerAccountId: accountId, parameters: artifact.geography!.parameters, status: 'ready', checksum: RC1_CANONICAL_CHECKSUM, artifact}).execute();
    }
    await db.insertInto('worldMemberships').values({worldId: worlds[0]!, accountId, playerName: 'Cache fixture'}).execute();
    await db.insertInto('villages').values({id: villageId, worldId: worlds[0]!, ownerAccountId: accountId, name: 'Cache fixture', anchorCellX: 140, anchorCellY: 20}).execute();
    await db.insertInto('worldFeatures').values({id: featureId, worldId: worlds[0]!, featureTypeCode: 'woodland', state: 'available', variantSeed: 1}).execute();
    await db.insertInto('worldRc1Resources').values({worldId: worlds[0]!, featureId, sourceKey: 'wood:test', treeIndices: sql`'[0]'::jsonb`, removedIndices: sql`'[]'::jsonb`}).execute();
  }, 120000);
  afterAll(async () => {
    await db.deleteFrom('worlds').where('id', 'in', worlds).execute();
    await db.deleteFrom('accounts').where('id', '=', accountId).execute();
    await db.destroy();
  }, 60000);

  it('reuses a verified body across transactions while rechecking identity and local edits', async () => {
    queries.length = 0;
    await db.transaction().execute(tx => readRc1Ground(tx, worlds[0]!));
    expect(bodies()).toBe(1);
    await db.transaction().execute(tx => readRc1Ground(tx, worlds[0]!));
    expect(bodies()).toBe(1);
    expect(queries.filter(q => q.includes('xmin::text'))).toHaveLength(3); // Two identities and the initial body.
    await readRc1Ground(db, worlds[1]!);
    expect(bodies()).toBe(2); // Another world's row must be verified independently.
    const tree = artifact.forest!.trees[0]!, surface = {...tree, halfWidth: 0, halfHeight: 0};
    const before = await readRc1Ground(db, worlds[0]!);
    expect(before.field.intersectsTree(surface)).toBe(true);
    const height = before.field.sample(140, 20).elevation + .25;
    await db.insertInto('worldSpawnTerraces').values({worldId: worlds[0]!, villageId, cellX: 140, cellY: 20, height}).execute();
    await db.updateTable('worldRc1Resources').set({removedIndices: sql`'[0]'::jsonb`}).where('worldId', '=', worlds[0]!).where('featureId', '=', featureId).execute();
    const after = await readRc1Ground(db, worlds[0]!);
    expect(after.field.sample(140, 20).elevation).toBe(height);
    expect(after.field.intersectsTree(surface)).toBe(false);
    const other = await readRc1Ground(db, worlds[1]!);
    expect(other.terraces).toEqual([]);
    expect(other.field.intersectsTree(surface)).toBe(true);
    expect(bodies()).toBe(2);
  });

  it('rejects a changed artifact even with the declared checksum and transaction xmin unchanged', async () => {
    const rollback = Error('EXPECTED_CACHE_TEST_ROLLBACK');
    await expect(db.transaction().execute(async tx => {
      // Both versions below have the same xmin but distinct physical tuples.
      await tx.updateTable('worldGenerationCandidates').set({artifact}).where('worldId', '=', worlds[0]!).execute();
      await readRc1Ground(tx, worlds[0]!);
      await tx.updateTable('worldGenerationCandidates').set({artifact: {...artifact, seed: 123}}).where('worldId', '=', worlds[0]!).execute();
      await expect(readRc1Ground(tx, worlds[0]!)).rejects.toMatchObject({code: 'WORLD_NOT_READY'});
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await readRc1Ground(db, worlds[0]!)).data.seed).toBe(4109);
  });

  it('revalidates world dimensions and seed on cache hits', async () => {
    const rollback = Error('EXPECTED_WORLD_TEST_ROLLBACK');
    await expect(db.transaction().execute(async tx => {
      await tx.updateTable('worlds').set({heightCells: 512}).where('id', '=', worlds[0]!).execute();
      await expect(readRc1Ground(tx, worlds[0]!)).rejects.toMatchObject({code: 'WORLD_NOT_READY'});
      await tx.updateTable('worlds').set({heightCells: 256, seed: 123}).where('id', '=', worlds[0]!).execute();
      await expect(readRc1Ground(tx, worlds[0]!)).rejects.toMatchObject({code: 'WORLD_NOT_READY'});
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
