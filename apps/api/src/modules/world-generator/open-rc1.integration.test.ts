import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GeneratedLandscape } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { availableWorlds } from '../onboarding/service.js';
import { getSpawnAtlas } from '../onboarding/spawn-map.js';
import { RC1_CANONICAL_CHECKSUM } from '../onboarding/spawn-compute-protocol.js';
import { openCanonicalRc1World } from './open-rc1.js';

const url = testDatabaseUrl(),
  db = createDatabase(url),
  ownerAccountId = randomUUID();
const artifact = JSON.parse(
  readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8'),
) as GeneratedLandscape;
const worlds: string[] = [];
const identity = () => ({ ownerAccountId, slug: 'open-rc1-' + randomUUID(), name: 'RC1 opening test', artifact });

describe('explicit opening of canonical RC1 worlds', () => {
  beforeAll(async () => {
    await migrateToLatest(url);
    await db
      .insertInto('accounts')
      .values({ id: ownerAccountId, email: ownerAccountId + '@open-rc1.test', passwordHash: 'not-a-login' })
      .execute();
  }, 60000);
  afterAll(async () => {
    if (worlds.length) await db.deleteFrom('worlds').where('id', 'in', worlds).execute();
    await db.deleteFrom('accounts').where('id', '=', ownerAccountId).execute();
    await db.destroy();
  }, 60000);

  it('opens an independent canonical world discoverable by new players and its spawn atlas', async () => {
    const input = identity(),
      result = await openCanonicalRc1World(db, input);
    worlds.push(result.worldId);
    expect(result.created).toBe(true);
    const world = await db.selectFrom('worlds').selectAll().where('id', '=', result.worldId).executeTakeFirstOrThrow();
    expect(world).toMatchObject({
      generationVersion: 3,
      generationStatus: 'ready',
      isOpen: true,
      widthCells: 512,
      heightCells: 256,
    });
    expect(Number(world.seed)).toBe(4109);
    const candidate = await db
      .selectFrom('worldGenerationCandidates')
      .select(['status', 'checksum', 'retainedAt'])
      .where('worldId', '=', result.worldId)
      .executeTakeFirstOrThrow();
    expect(candidate).toMatchObject({ status: 'ready', checksum: RC1_CANONICAL_CHECKSUM });
    expect(candidate.retainedAt).toBeInstanceOf(Date);
    expect((await availableWorlds(db, ownerAccountId)).find((w) => w.slug === input.slug)).toMatchObject({
      joined: false,
      canJoin: true,
      spawnMode: 'atlas',
    });
    expect(await getSpawnAtlas(db, input.slug)).toMatchObject({
      worldId: result.worldId,
      artifactChecksum: RC1_CANONICAL_CHECKSUM,
      villages: [],
    });
    expect(await db.selectFrom('worldChunks').select('chunkX').where('worldId', '=', result.worldId).execute()).toEqual(
      [],
    );
    const second = await openCanonicalRc1World(db, { ...input, slug: 'second-' + randomUUID() });
    worlds.push(second.worldId);
    expect(second.worldId).not.toBe(result.worldId);
  }, 60000);

  it('is idempotent and preserves existing player state and presentation', async () => {
    const input = identity(),
      first = await openCanonicalRc1World(db, input);
    worlds.push(first.worldId);
    await db
      .insertInto('worldMemberships')
      .values({ worldId: first.worldId, accountId: ownerAccountId, playerName: 'Existing player' })
      .execute();
    const village = await db
      .insertInto('villages')
      .values({
        worldId: first.worldId,
        ownerAccountId,
        name: 'Preserve this village',
        anchorCellX: 140,
        anchorCellY: 20,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .updateTable('worldAtlasPresentations')
      .set({ slogan: 'Operator-edited presentation' })
      .where('worldId', '=', first.worldId)
      .execute();
    expect(await openCanonicalRc1World(db, input)).toEqual({ ...first, created: false });
    expect(await db.selectFrom('villages').select('id').where('worldId', '=', first.worldId).execute()).toEqual([
      village,
    ]);
    expect(
      await db
        .selectFrom('worldAtlasPresentations')
        .select('slogan')
        .where('worldId', '=', first.worldId)
        .executeTakeFirst(),
    ).toEqual({ slogan: 'Operator-edited presentation' });
  }, 60000);

  it('refuses another geometry or an unknown author without leaving a world', async () => {
    const input = identity();
    await expect(
      openCanonicalRc1World(db, { ...input, artifact: { ...artifact, seed: artifact.seed + 1 } }),
    ).rejects.toThrow('signed canonical');
    await expect(openCanonicalRc1World(db, { ...input, ownerAccountId: randomUUID() })).rejects.toThrow(
      'author account',
    );
    expect(await db.selectFrom('worlds').select('id').where('slug', '=', input.slug).execute()).toEqual([]);
  }, 60000);

  it('never overwrites another world at the requested slug', async () => {
    const input = identity();
    const world = await db
      .insertInto('worlds')
      .values({
        slug: input.slug,
        name: 'Existing historical world',
        topology: 'torus',
        widthCells: 64,
        heightCells: 64,
        chunkSize: 32,
        seed: 7,
        generationVersion: 2,
        isOpen: false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    worlds.push(world.id);
    await expect(openCanonicalRc1World(db, input)).rejects.toThrow('different identity');
    expect(await db.selectFrom('worlds').selectAll().where('id', '=', world.id).executeTakeFirst()).toEqual(world);
  }, 60000);
});
