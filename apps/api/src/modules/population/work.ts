import type { Selectable, Transaction } from 'kysely';
import type { Database, PopulationCohortsTable } from '../../database/schema.js';
import { advanceEnergy, canWorkFor, type EnergyState } from './energy.js';

type Cohort = Selectable<PopulationCohortsTable>;
type Assignment = { harvestId: string; extractionId: null } | { harvestId: null; extractionId: string };

export function energyState(cohort: Cohort): EnergyState {
  return { energy: cohort.energy, progress: cohort.energyProgress, activity: cohort.activity,
    restingSince: cohort.restingSince, foodUsedSinceRest: cohort.foodUsedSinceRest, updatedAt: cohort.energyUpdatedAt };
}

export function withoutAssignment(cohort: Pick<Cohort, 'harvestId' | 'extractionId'>): boolean {
  return cohort.harvestId === null && cohort.extractionId === null;
}

/** The village lock and chronological reconciliation protect every cursor. */
export async function materializeCohorts(tx: Transaction<Database>, worldId: string, villageId: string, through: Date) {
  const cohorts = await tx.selectFrom('populationCohorts').selectAll().where('worldId', '=', worldId)
    .where('villageId', '=', villageId).orderBy('id').forUpdate().execute();
  for (const cohort of cohorts) {
    const energy = advanceEnergy(energyState(cohort), through);
    const values = { energy: energy.energy, energyProgress: energy.progress, activity: energy.activity,
      restingSince: energy.restingSince, foodUsedSinceRest: energy.foodUsedSinceRest, energyUpdatedAt: energy.updatedAt };
    await tx.updateTable('populationCohorts').set(values).where('worldId', '=', worldId).where('id', '=', cohort.id).execute();
    Object.assign(cohort, values);
  }
  return cohorts;
}

export function eligibleWorkers(cohorts: Cohort[], durationMs: number): Cohort[] {
  return cohorts.filter((cohort) => withoutAssignment(cohort) && cohort.activity === 'idle'
    && canWorkFor(energyState(cohort), durationMs)).sort((a, b) => a.id.localeCompare(b.id));
}

/** Caller has validated the complete count before inserting the work. */
export async function assignWorkers(tx: Transaction<Database>, cohorts: Cohort[], count: number, assignment: Assignment): Promise<void> {
  let needed = count;
  for (const cohort of cohorts) {
    if (needed === 0) break;
    const memberCount = Math.min(needed, cohort.memberCount);
    if (memberCount === cohort.memberCount) {
      await tx.updateTable('populationCohorts').set({ activity: 'working', ...assignment })
        .where('worldId', '=', cohort.worldId).where('id', '=', cohort.id).execute();
    } else {
      await tx.updateTable('populationCohorts').set({ memberCount: cohort.memberCount - memberCount })
        .where('worldId', '=', cohort.worldId).where('id', '=', cohort.id).execute();
      await tx.insertInto('populationCohorts').values({ worldId: cohort.worldId, villageId: cohort.villageId,
        originVillageId: cohort.originVillageId, memberCount, activity: 'working', energy: cohort.energy,
        energyProgress: cohort.energyProgress, energyUpdatedAt: cohort.energyUpdatedAt,
        restingSince: null, foodUsedSinceRest: cohort.foodUsedSinceRest, ...assignment }).execute();
    }
    needed -= memberCount;
  }
  if (needed !== 0) throw new Error('Workforce allocation invariant failed');
}

export async function releaseWorkers(tx: Transaction<Database>, workers: Cohort[], expectedCount: number, through: Date): Promise<void> {
  if (workers.reduce((total, cohort) => total + cohort.memberCount, 0) !== expectedCount)
    throw new Error('Workforce conservation invariant failed');
  for (const cohort of workers) {
    const empty = cohort.energy === 0 && cohort.energyProgress === 0;
    await tx.updateTable('populationCohorts').set({ activity: empty ? 'resting' : 'idle',
      restingSince: empty ? through : null, harvestId: null, extractionId: null })
      .where('worldId', '=', cohort.worldId).where('id', '=', cohort.id).execute();
  }
}
