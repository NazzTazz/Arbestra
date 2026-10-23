import { readRc1Resources } from './rc1-resources.js';
import {
  infrastructurePlanSurface,
  spawnDelta,
  SPAWN_TERRAIN_REVISION,
  type SpawnMap,
  type SpawnSurface,
  type SpawnVillage,
  type SpawnInspectionRequest,
  type SpawnTerrainResult,
} from '@arbestra/contracts';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import type { SpawnCompute } from './spawn-compute.js';
import { RC1_CANONICAL_CHECKSUM, type SpawnSnapshot } from './spawn-compute-protocol.js';
export { RC1_CANONICAL_CHECKSUM } from './spawn-compute-protocol.js';
import { STARTER_VILLAGE } from './starter-village.js';
import { spawnSpatialState } from './spawn-state.js';

const worldSize = { widthCells: 512, heightCells: 256 };
export function starterSpawnSurfaces(): SpawnSurface[] {
  const surfaces: SpawnSurface[] = STARTER_VILLAGE.buildings.flatMap((b) =>
    b.cells.map((c) => ({ x: c.x, y: c.y, halfWidth: 0.5, halfHeight: 0.5 })),
  );
  for (const p of infrastructurePlanSurface(STARTER_VILLAGE.infrastructure, worldSize).values()) {
    if (p.material !== 'none' || p.border)
      surfaces.push({
        x: spawnDelta(p.x / 16, 0, 512),
        y: spawnDelta(p.y / 16, 0, 256),
        halfWidth: 1 / 32,
        halfHeight: 1 / 32,
      });
  }
  for (const e of STARTER_VILLAGE.infrastructure.equipment)
    surfaces.push({ x: e.x / 8, y: e.y / 8, halfWidth: 0.125, halfHeight: 0.125 });
  return surfaces;
}
const surfaces = starterSpawnSurfaces();
/** Cheap display metadata. The immutable illustration is NOT a terrain authorization.
 * Full artifact identity is still verified before any diagnostic/preflight. */
export async function getSpawnAtlas(db: Kysely<Database>, slug: string): Promise<Omit<SpawnMap, 'landscape'>> {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      const world = await tx
        .selectFrom('worlds')
        .select(['id', 'slug', 'name'])
        .where('slug', '=', slug)
        .where('isOpen', '=', true)
        .where('generationStatus', '=', 'ready')
        .where('generationVersion', '=', 3)
        .where('widthCells', '=', 512)
        .where('heightCells', '=', 256)
        .executeTakeFirst();
      if (!world) throw new HttpError(404, 'WORLD_NOT_AVAILABLE', 'Monde indisponible.');
      const candidate = await tx
        .selectFrom('worldGenerationCandidates')
        .select('checksum')
        .where('worldId', '=', world.id)
        .where('status', '=', 'ready')
        .executeTakeFirst();
      if (candidate?.checksum !== RC1_CANONICAL_CHECKSUM)
        throw new HttpError(409, 'SPAWN_MAP_NOT_READY', 'Cette carte n’est pas disponible.');
      return {
        worldId: world.id,
        worldSlug: world.slug,
        worldName: world.name,
        artifactChecksum: RC1_CANONICAL_CHECKSUM,
        terrainRevision: SPAWN_TERRAIN_REVISION,
        surfaces,
        villages: await spawnVillages(tx, world.id),
        territories: await tx
          .selectFrom('villageSpawnTerritories')
          .select(['villageId', 'points'])
          .where('worldId', '=', world.id)
          .orderBy('villageId')
          .execute(),
        readiness: 'terrain-only',
      };
    });
}
export async function spawnVillages(db: Kysely<Database>, worldId: string): Promise<SpawnVillage[]> {
  const rows = await db
    .selectFrom('villages')
    .innerJoin('worldMemberships', (join) =>
      join
        .onRef('worldMemberships.worldId', '=', 'villages.worldId')
        .onRef('worldMemberships.accountId', '=', 'villages.ownerAccountId'),
    )
    .select(['villages.id', 'villages.anchorCellX', 'villages.anchorCellY', 'worldMemberships.playerName'])
    .select((eb) =>
      eb
        .selectFrom('populationCohorts')
        .select(sql<number>`coalesce(sum(member_count),0)::integer`.as('count'))
        .whereRef('worldId', '=', 'villages.worldId')
        .whereRef('villageId', '=', 'villages.id')
        .as('population'),
    )
    .where('villages.worldId', '=', worldId)
    .orderBy('villages.id')
    .execute();
  return rows.map((v) => ({
    id: v.id,
    x: v.anchorCellX,
    y: v.anchorCellY,
    playerName: v.playerName,
    population: v.population ?? 0,
  }));
}

/** Finish the read-only snapshot before any CPU job is admitted to the worker.
 * JSONB text avoids parsing/cloning the full artifact on the API event loop. */
export async function readSpawnSnapshot(
  db: Kysely<Database>,
  slug: string,
  privateState: boolean,
): Promise<SpawnSnapshot> {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute((tx) => spawnSnapshot(tx, slug, privateState));
}
export async function spawnSnapshot(tx: Kysely<Database>, slug: string, privateState: boolean): Promise<SpawnSnapshot> {
  const world = await tx
    .selectFrom('worlds')
    .selectAll()
    .where('slug', '=', slug)
    .where('isOpen', '=', true)
    .where('generationStatus', '=', 'ready')
    .executeTakeFirst();
  if (!world) throw new HttpError(404, 'WORLD_NOT_AVAILABLE', 'Monde indisponible.');
  const candidate = await tx
    .selectFrom('worldGenerationCandidates')
    .select(['status', 'checksum', sql<string>`artifact::text`.as('artifactText')])
    .where('worldId', '=', world.id)
    .executeTakeFirst();
  if (
    world.generationVersion !== 3 ||
    world.widthCells !== 512 ||
    world.heightCells !== 256 ||
    world.chunkSize !== 32 ||
    !candidate?.artifactText ||
    candidate.status !== 'ready' ||
    candidate.checksum !== RC1_CANONICAL_CHECKSUM
  )
    throw new HttpError(409, 'SPAWN_MAP_NOT_READY', 'Cette carte d’arrivée n’est pas disponible.');
  const resourceState = await readRc1Resources(tx, world.id);
  const terraces = await tx
    .selectFrom('worldSpawnTerraces')
    .select(['cellX', 'cellY', 'height'])
    .where('worldId', '=', world.id)
    .execute();
  const vertices =
    world.terrainModel === 'vertices'
      ? await tx
          .selectFrom('worldTerrainVertices')
          .select(['vertexX', 'vertexY', 'height'])
          .where('worldId', '=', world.id)
          .execute()
      : undefined;
  return {
    resources: resourceState.length ? resourceState : undefined,
    map: {
      ...(vertices ? { vertices } : {}),
      terraces,
      removedTreeIndices: resourceState.flatMap((r) => r.removedIndices),
      worldId: world.id,
      worldSlug: world.slug,
      worldName: world.name,
      artifactChecksum: RC1_CANONICAL_CHECKSUM,
      terrainRevision: SPAWN_TERRAIN_REVISION,
      surfaces,
      villages: await spawnVillages(tx, world.id),
      territories: await tx
        .selectFrom('villageSpawnTerritories')
        .select(['villageId', 'points'])
        .where('worldId', '=', world.id)
        .orderBy('villageId')
        .execute(),
      readiness: 'terrain-only',
    },
    artifactJSON: candidate.artifactText,
    seed: Number(world.seed),
    spatial: privateState ? await spawnSpatialState(tx, world.id) : { protectedSurfaces: [], walkBlockedSurfaces: [] },
  };
}
export async function getSpawnMap(db: Kysely<Database>, slug: string, compute: SpawnCompute): Promise<SpawnMap> {
  const snapshot = await readSpawnSnapshot(db, slug, false);
  return (await compute.run({ kind: 'map', snapshot })) as SpawnMap;
}
export async function inspectSpawnTerrain(
  db: Kysely<Database>,
  slug: string,
  input: SpawnInspectionRequest,
  compute: SpawnCompute,
): Promise<SpawnTerrainResult> {
  const snapshot = await readSpawnSnapshot(db, slug, true);
  if (input.artifactChecksum !== snapshot.map.artifactChecksum)
    throw new HttpError(409, 'SPAWN_MAP_STALE', 'La carte a changé. Rechargez-la.');
  return (await compute.run({ kind: 'terrain', snapshot, input })) as SpawnTerrainResult;
}
