import { describe, expect, it } from 'vitest';
import { SpawnCompute } from './spawn-compute.js';
import type { SpawnJob } from './spawn-compute-protocol.js';
const job: SpawnJob = { kind: 'map', snapshot: { artifactJSON: '{}', seed: 1,
  map: { worldId: 'test', worldName: 'Test', worldSlug: 'test', artifactChecksum: '', terrainRevision: 2, surfaces: [], villages: [], readiness: 'terrain-only' },
  spatial: { protectedSurfaces: [], walkBlockedSurfaces: [] } } };
describe('bounded spawn CPU worker', () => {
  it('rejects overload immediately and settles all pending jobs when closed', async () => {
    const compute = new SpawnCompute();
    const pending = Array.from({ length: 4 }, () => compute.run(job).catch(e => e));
    try {
      await expect(compute.run(job)).rejects.toMatchObject({ statusCode: 503, code: 'SPAWN_COMPUTE_BUSY' });
    } finally { await compute.close(); }
    for (const error of await Promise.all(pending)) expect(error).toMatchObject({ code: 'SPAWN_COMPUTE_FAILED' });
    await expect(compute.run(job)).rejects.toMatchObject({ code: 'SPAWN_COMPUTE_CLOSED' });
  });
  it('rejects invalid geometry within the worker without killing subsequent jobs', async () => {
    const compute = new SpawnCompute();
    try { for (let i = 0; i < 2; i++) await expect(compute.run(job)).rejects.toMatchObject({ statusCode: 409, code: 'SPAWN_MAP_NOT_READY' }); }
    finally { await compute.close(); }
  });
});
