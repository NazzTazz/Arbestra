import type { Selectable, Transaction } from 'kysely';
import type { Database, PopulationCohortsTable } from '../../database/schema.js';
import { advanceEnergy, canWorkFor, type EnergyState } from './energy.js';
import {allocateRestHousing} from './housing.js';

type Cohort = Selectable<PopulationCohortsTable>;
type Assignment = { harvestId: string; extractionId: null; scienceActivityId?: null }
  | { harvestId: null; extractionId: string; scienceActivityId?: null }
  | { harvestId: null; extractionId: null; scienceActivityId: string };

export function energyState(cohort: Cohort): EnergyState {
  return { energy: cohort.energy, progress: cohort.energyProgress, activity: cohort.activity,
    restingSince: cohort.restingSince, foodUsedSinceRest: cohort.foodUsedSinceRest, updatedAt: cohort.energyUpdatedAt };
}

export function withoutAssignment(cohort: Pick<Cohort, 'harvestId' | 'extractionId'> & { scienceActivityId?: string | null }): boolean {
  return cohort.harvestId === null && cohort.extractionId === null && !cohort.scienceActivityId;
}

/** The village lock and chronological reconciliation protect every cursor. */
export async function materializeCohorts(tx: Transaction<Database>, worldId: string, villageId: string, through: Date) {
  const cohorts = await tx.selectFrom('populationCohorts').selectAll().where('worldId', '=', worldId)
    .where('villageId', '=', villageId).orderBy('id').forUpdate().execute();
  for (const cohort of cohorts) {
    const energy = advanceEnergy(energyState(cohort), through);
    const values = { energy: energy.energy, energyProgress: energy.progress, activity: energy.activity,
      restingSince: energy.restingSince, foodUsedSinceRest: energy.foodUsedSinceRest, energyUpdatedAt: energy.updatedAt,
      restBuildingId:energy.activity==='resting'&&withoutAssignment(cohort)?cohort.restBuildingId:null };
    await tx.updateTable('populationCohorts').set(values).where('worldId', '=', worldId).where('id', '=', cohort.id).execute();
    Object.assign(cohort, values);
  }
  return allocateRestHousing(tx,worldId,villageId,cohorts);
}

/** Snapshots only persist activity transitions and bed changes, not every
 * cohort's energy cursor on each polling request. Full work materialization
 * remains in commands and chronological completions. */
export async function reconcileRestHousing(tx:Transaction<Database>,worldId:string,villageId:string,through:Date){
  const cohorts=await tx.selectFrom('populationCohorts').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).orderBy('id').forUpdate().execute();
  for(const cohort of cohorts){const e=advanceEnergy(energyState(cohort),through);
    if(e.activity===cohort.activity&&(e.activity==='resting'||cohort.restBuildingId===null))continue;
    const values={activity:e.activity,energy:e.energy,energyProgress:e.progress,restingSince:e.restingSince,
      foodUsedSinceRest:e.foodUsedSinceRest,energyUpdatedAt:e.updatedAt,restBuildingId:e.activity==='resting'&&withoutAssignment(cohort)?cohort.restBuildingId:null};
    await tx.updateTable('populationCohorts').set(values).where('worldId','=',worldId).where('id','=',cohort.id).execute();Object.assign(cohort,values);
  }
  return allocateRestHousing(tx,worldId,villageId,cohorts);
}

export function eligibleWorkers(cohorts: Cohort[], durationMs: number): Cohort[] {
  return cohorts.filter((cohort) => withoutAssignment(cohort) && cohort.activity === 'idle'
    && canWorkFor(energyState(cohort), durationMs)).sort((a, b) => a.id.localeCompare(b.id));
}

/** Shared by previews and real departures; more workers can shorten the work. */
export function workingTeam(cohorts: Cohort[], cap: number, durationFor: (count: number) => number, preferredId?: string) {
  for (let count = Math.min(cap, cohorts.reduce((n, c) => n + c.memberCount, 0)); count >= 1; count--) {
    const durationMs = durationFor(count);
    const eligible = eligibleWorkers(cohorts, durationMs).filter(c => !preferredId || c.id === preferredId);
    if (eligible.reduce((n, c) => n + c.memberCount, 0) >= count) return { count, durationMs, cohorts: eligible };
  }
  return { count: 0, durationMs: 0, cohorts: [] as Cohort[] };
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
        restingSince: null, foodUsedSinceRest: cohort.foodUsedSinceRest, cartographer: cohort.cartographer, ...assignment }).execute();
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
      restingSince: empty ? through : null, harvestId: null, extractionId: null, scienceActivityId: null,restBuildingId:null })
      .where('worldId', '=', cohort.worldId).where('id', '=', cohort.id).execute();
  }
}
