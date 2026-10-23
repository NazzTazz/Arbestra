import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { footprintVertices, type GeneratedLandscape, type SpawnPoseRequest } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { STARTER_KIT } from './starter-kit.js';
import { RC1_CANONICAL_CHECKSUM } from './spawn-map.js';
import { SpawnCompute } from './spawn-compute.js';
import { installVillage } from './installation.js';
import { readRc1Ground } from '../worlds/rc1-ground.js';
import { getTerrain, getTerrainUpdates } from '../worlds/terrain.js';
const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected test target');
const db = createDatabase(url),
  compute = new SpawnCompute(),
  worldId = randomUUID(),
  accountId = randomUUID(),
  slug = 'vertex-install-' + worldId;
const artifact = JSON.parse(
  readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8'),
) as GeneratedLandscape;
let pending: Promise<unknown> | undefined;
beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@vertex-install.test', passwordHash: 'fixture' })
    .execute();
  await db
    .insertInto('worlds')
    .values({
      id: worldId,
      slug,
      name: 'Vertex installation test',
      topology: 'torus',
      widthCells: 512,
      heightCells: 256,
      chunkSize: 32,
      seed: 4109,
      terrainModel: 'vertices',
      generationVersion: 3,
      generationStatus: 'ready',
      isOpen: true,
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
      status: 'ready',
      checksum: RC1_CANONICAL_CHECKSUM,
      artifact,
    })
    .execute();
}, 120000);
afterAll(async () => {
  await compute.close();
  await pending?.catch(() => undefined);
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('woodlandDeposits').where('worldId', '=', worldId).execute();
  await db.deleteFrom('stoneDeposits').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
}, 120000);
it(
  'installs a real starter platform on shared vertices and serves the same surface in terrain refreshes',
  () =>
    (pending = (async () => {
      const input: SpawnPoseRequest = {
        commandId: randomUUID(),
        artifactChecksum: RC1_CANONICAL_CHECKSUM,
        kitVersion: STARTER_KIT.version,
        point: { x: 140, y: 20 },
        quarterTurns: 0,
        mode: 'manual',
        playerName: 'Recette',
        villageName: 'Sommets',
      };
      const installed = await installVillage(db, compute, accountId, slug, input);
      const cells = await db
        .selectFrom('worldCellOccupancies')
        .select(['cellX', 'cellY'])
        .where('worldId', '=', worldId)
        .where('buildingId', 'is not', null)
        .execute();
      const ground = await readRc1Ground(db, worldId);
      for (const v of footprintVertices(cells, { widthCells: 512, heightCells: 256 }))
        expect(ground.field.geometry!.height(v.vertexX, v.vertexY)).toBeCloseTo(installed.referenceHeight, 6);
      expect(await db.selectFrom('worldSpawnTerraces').selectAll().where('worldId', '=', worldId).execute()).toEqual(
        [],
      );
      const full = await getTerrain(db, accountId, slug, '4,0'),
        refresh = await getTerrainUpdates(db, accountId, slug, '4,0', false, true);
      expect(full.chunks[0]!.rc1).toMatchObject({ model: 'vertices', stride: 33, terraces: [] });
      expect(refresh.chunks[0]!.rc1).toEqual(full.chunks[0]!.rc1);
      expect(full.chunks[0]!.rc1!.heights).toHaveLength(1089);
      expect(await installVillage(db, compute, accountId, slug, input)).toEqual(installed);
    })()),
  300000,
);
