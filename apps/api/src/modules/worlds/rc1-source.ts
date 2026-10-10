import {sql, type Kysely} from 'kysely';
import {RC1_WORLD, createSpawnTerrainField, type GeneratedLandscape} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {HttpError} from '../../errors.js';
import {artifactChecksum} from '../world-generator/artifact.js';
import {RC1_CANONICAL_CHECKSUM} from '../onboarding/spawn-compute-protocol.js';

type Source = {data: GeneratedLandscape; field: ReturnType<typeof createSpawnTerrainField>};
let canonical: Source | undefined;
// Transactions and plugin variants share their database's dialect adapter.
// Different database instances must never share a verified row identity.
const verified = new WeakMap<object, Map<string, string>>();
// ctid also detects two updates within the same transaction (same xmin).
const rowVersion = sql<string>`xmin::text || ':' || ctid::text`.as('rowVersion');

/** Only immutable, checksum-verified geography is cached. No local edits live here. */
export async function readRc1Source(db: Kysely<Database>, worldId: string) {
  const world = await db.selectFrom('worlds').select(['widthCells', 'heightCells', 'chunkSize', 'seed'])
    .where('id', '=', worldId).executeTakeFirstOrThrow();
  if (world.widthCells !== RC1_WORLD.widthCells || world.heightCells !== RC1_WORLD.heightCells || world.chunkSize !== RC1_WORLD.chunkSize)
    throw new HttpError(409, 'WORLD_NOT_READY', 'Dimensions RC1 incohérentes.');
  const identity = await db.selectFrom('worldGenerationCandidates').select(['checksum', rowVersion])
    .where('worldId', '=', worldId).executeTakeFirst();
  if (!identity || identity.checksum !== RC1_CANONICAL_CHECKSUM)
    throw new HttpError(409, 'WORLD_NOT_READY', 'Géographie RC1 indisponible.');
  const adapter = db.getExecutor().adapter;
  let versions = verified.get(adapter);
  if (!versions) { versions = new Map(); verified.set(adapter, versions); }
  if (!canonical || versions.get(worldId) !== identity.rowVersion) {
    const row = await db.selectFrom('worldGenerationCandidates')
      .select(['checksum', rowVersion, sql<string>`artifact::text`.as('json')])
      .where('worldId', '=', worldId).executeTakeFirst();
    if (!row || row.checksum !== RC1_CANONICAL_CHECKSUM)
      throw new HttpError(409, 'WORLD_NOT_READY', 'Géographie RC1 indisponible.');
    const data = JSON.parse(row.json) as GeneratedLandscape;
    if (artifactChecksum(data) !== RC1_CANONICAL_CHECKSUM)
      throw new HttpError(409, 'WORLD_NOT_READY', 'Géographie RC1 invalide.');
    canonical ??= {data, field: createSpawnTerrainField(data)};
    versions.set(worldId, row.rowVersion);
    while (versions.size > 32) versions.delete(versions.keys().next().value!);
  }
  if (Number(world.seed) !== canonical.data.seed)
    throw new HttpError(409, 'WORLD_NOT_READY', 'Identité RC1 incohérente.');
  return {world, ...canonical};
}
