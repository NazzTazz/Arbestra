import type { SpawnInspectionRequest, SpawnResourcePreflight } from '@arbestra/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { readSpawnSnapshot } from './spawn-map.js';
import type { SpawnCompute } from './spawn-compute.js';

export async function inspectSpawnResources(db: Kysely<Database>, slug: string, input: SpawnInspectionRequest, compute: SpawnCompute): Promise<SpawnResourcePreflight> {
  const snapshot = await readSpawnSnapshot(db, slug, true);
  if (input.artifactChecksum !== snapshot.map.artifactChecksum) throw new HttpError(409, 'SPAWN_MAP_STALE', 'La carte a chang?. Rechargez-la.');
  return await compute.run({ kind: 'resources', snapshot, input }) as SpawnResourcePreflight;
}
