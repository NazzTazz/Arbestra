import type { Kysely } from 'kysely';
import type { LevelingJob } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { VillageEconomy } from './reconcile-economy.js';

// Deferred leveling was withdrawn on 1 November 2026 for instant terrain edits
// (docs/SPEC-TERRAFORMATION-INSTANTANEE.md). No command creates a job any
// more; this reader keeps the V2 component until it is removed with its table.
export async function levelingSnapshot(
  tx: Kysely<Database>,
  ctx: VillageEconomy,
  selected?: readonly string[],
): Promise<LevelingJob[]> {
  if (selected?.length === 0) return [];
  if (selected && selected.length > 4096) throw new RangeError('Too many leveling ids');
  const query = tx
    .selectFrom('levelingJobs')
    .selectAll()
    .where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId)
    .where('completedAt', 'is', null)
    .orderBy('id');
  const jobs = await (selected ? query.where('id', 'in', selected) : query).execute();
  return jobs.map((j) => ({
    id: j.id,
    featureId: j.featureId,
    buildingType: j.request.buildingType,
    cells: j.quote.affectedCells ?? j.quote.cells,
    height: j.quote.height,
    workerCount: j.workerCount,
    path: j.path,
    transportMs: j.quote.transportMs,
    startedAt: j.startedAt.toISOString(),
    completesAt: j.completesAt.toISOString(),
  }));
}
