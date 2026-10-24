import { sql, type Selectable, type Transaction } from 'kysely';
import type { Database, PopulationCohortsTable } from '../../database/schema.js';
import { advanceEnergy, canWorkFor, type EnergyState } from './energy.js';
import { allocateRestHousing } from './housing.js';

type Cohort = Selectable<PopulationCohortsTable>;
type Assignment =
  | {
      harvestId: null;
      extractionId: null;
      scienceActivityId: null;
      processingLotId: null;
      tradeJourneyId: null;
      levelingJobId: string;
    }
  | { harvestId: null; extractionId: null; scienceActivityId: null; processingLotId: null; tradeJourneyId: string }
  | { harvestId: null; extractionId: null; scienceActivityId: null; processingLotId: string }
  | { harvestId: string; extractionId: null; scienceActivityId?: null }
  | { harvestId: null; extractionId: string; scienceActivityId?: null }
  | { harvestId: null; extractionId: null; scienceActivityId: string };

export function energyState(cohort: Cohort): EnergyState {
  return {
    energy: cohort.energy,
    progress: cohort.energyProgress,
    activity: cohort.activity,
    restingSince: cohort.restingSince,
    foodUsedSinceRest: cohort.foodUsedSinceRest,
    updatedAt: cohort.energyUpdatedAt,
  };
}

function projectCohort(cohort: Cohort, through: Date): Cohort {
  const energy = advanceEnergy(energyState(cohort), through);
  return {
    ...cohort,
    energy: energy.energy,
    energyProgress: energy.progress,
    activity: energy.activity,
    restingSince: energy.restingSince,
    foodUsedSinceRest: energy.foodUsedSinceRest,
    energyUpdatedAt: energy.updatedAt,
    avoidWorksiteId: energy.activity === 'resting' ? null : cohort.avoidWorksiteId,
    restBuildingId: energy.activity === 'resting' && withoutAssignment(cohort) ? cohort.restBuildingId : null,
  };
}

/** Idle, unassigned inhabitants without a skill who share an origin, an
 * energy point and a food count form one cohort (Tristan, 24 October): one
 * cohort per energy level rather than one per arrival. Skilled inhabitants
 * (cartographers) and cohorts named by a pending initial departure stay
 * apart. Every cohort must already be projected to the same instant. */
function mergeKey(cohort: Cohort, referenced: ReadonlySet<string>): string | null {
  if (
    cohort.activity !== 'idle' ||
    !withoutAssignment(cohort) ||
    cohort.pendingRelease !== null ||
    cohort.avoidWorksiteId !== null ||
    cohort.restBuildingId !== null ||
    cohort.restingSince !== null ||
    cohort.cartographer ||
    referenced.has(cohort.id)
  )
    return null;
  return [cohort.originVillageId, cohort.energy, cohort.foodUsedSinceRest, cohort.energyUpdatedAt.getTime()].join(':');
}

/** The survivor keeps the oldest identity, so an established group keeps its
 * ID when an arrival joins it. Sub-point progress is the member-weighted
 * mean, floored: the group keeps its energy point and loses less than one
 * energy unit in total. */
export function mergeCohorts(cohorts: readonly Cohort[], referenced: ReadonlySet<string> = new Set()) {
  const groups = new Map<string, Cohort[]>();
  for (const cohort of cohorts) {
    const key = mergeKey(cohort, referenced);
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), cohort]);
  }
  const absorbed = new Set<string>(),
    merged = new Map<string, Cohort>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [survivor, ...rest] = [...group].sort(
      (a, b) =>
        new Date(a.createdAt as unknown as string).getTime() - new Date(b.createdAt as unknown as string).getTime() ||
        a.id.localeCompare(b.id),
    );
    const members = group.reduce((n, c) => n + c.memberCount, 0);
    const progress = Math.floor(group.reduce((n, c) => n + c.energyProgress * c.memberCount, 0) / members);
    merged.set(survivor!.id, { ...survivor!, memberCount: members, energyProgress: progress });
    for (const cohort of rest) absorbed.add(cohort.id);
  }
  return {
    cohorts: cohorts.filter((c) => !absorbed.has(c.id)).map((c) => merged.get(c.id) ?? c),
    absorbed: [...absorbed],
  };
}

/** Cohorts named by a stored reference keep their identity: a pending
 * initial departure, or the team a running workshop order continues with. */
async function referencedCohorts(tx: Transaction<Database>, worldId: string, villageId: string) {
  const [initial, teams] = await Promise.all([
    tx
      .selectFrom('exploitationOrders')
      .select('cohortId')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('cohortId', 'is not', null)
      .where('initialRemaining', '>', 0)
      .execute(),
    tx
      .selectFrom('processingOrders')
      .select('workerIds')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('status', 'not in', ['completed', 'cancelled'])
      .execute(),
  ]);
  return new Set([...initial.map((row) => row.cohortId!), ...teams.flatMap((row) => row.workerIds)]);
}

/** The same eligibility clock as departures, without assigning beds or writing cursors. */
export async function projectCohorts(tx: Transaction<Database>, worldId: string, villageId: string, through: Date) {
  const cohorts = await tx
    .selectFrom('populationCohorts')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .orderBy('id')
    .execute();
  // The same grouping as the next materialization: previewed IDs survive it.
  return mergeCohorts(
    cohorts.map((cohort) => projectCohort(cohort, through)),
    await referencedCohorts(tx, worldId, villageId),
  ).cohorts;
}

/** A successful replacement departure makes idle former members eligible again.
 * Source IDs identify an extraction site, processing order or research campus. */
export async function clearWorksiteRotation(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  sourceId: string,
) {
  await tx
    .updateTable('populationCohorts')
    .set({ avoidWorksiteId: null })
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .where('avoidWorksiteId', '=', sourceId)
    .where('activity', '=', 'idle')
    .where('pendingRelease', 'is', null)
    .execute();
}

export function withoutAssignment(
  cohort: Pick<Cohort, 'harvestId' | 'extractionId'> & {
    scienceActivityId?: string | null;
    processingLotId?: string | null;
    tradeJourneyId?: string | null;
    levelingJobId?: string | null;
  },
): boolean {
  return (
    cohort.harvestId === null &&
    cohort.extractionId === null &&
    !cohort.scienceActivityId &&
    !cohort.processingLotId &&
    !cohort.tradeJourneyId &&
    !cohort.levelingJobId
  );
}

/** The village lock and chronological reconciliation protect every cursor. */
export async function materializeCohorts(tx: Transaction<Database>, worldId: string, villageId: string, through: Date) {
  const locked = await tx
    .selectFrom('populationCohorts')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .orderBy('id')
    .forUpdate()
    .execute();
  for (const cohort of locked) {
    Object.assign(cohort, projectCohort(cohort, through));
  }
  const merge = mergeCohorts(locked, await referencedCohorts(tx, worldId, villageId)),
    cohorts = merge.cohorts;
  if (merge.absorbed.length)
    await tx
      .deleteFrom('populationCohorts')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('id', 'in', merge.absorbed)
      .execute();
  // All rows were locked in canonical order above. Persist the same per-cohort
  // projections together instead of one round trip per inhabitant group.
  if (cohorts.length)
    await sql`
    update population_cohorts c set member_count=v.member_count, energy=v.energy, energy_progress=v.energy_progress,
      activity=v.activity,
      resting_since=v.resting_since, food_used_since_rest=v.food_used_since_rest,
      energy_updated_at=v.energy_updated_at, rest_building_id=v.rest_building_id, avoid_worksite_id=v.avoid_worksite_id
    from jsonb_to_recordset(${JSON.stringify(
      cohorts.map((c) => ({
        id: c.id,
        member_count: c.memberCount,
        energy: c.energy,
        energy_progress: c.energyProgress,
        activity: c.activity,
        resting_since: c.restingSince,
        food_used_since_rest: c.foodUsedSinceRest,
        energy_updated_at: c.energyUpdatedAt,
        rest_building_id: c.restBuildingId,
        avoid_worksite_id: c.avoidWorksiteId,
      })),
    )}::jsonb)
      as v(id uuid,member_count integer,energy integer,energy_progress integer,activity text,resting_since timestamptz,
        food_used_since_rest integer,energy_updated_at timestamptz,rest_building_id uuid,avoid_worksite_id uuid)
    where c.world_id=${worldId} and c.village_id=${villageId} and c.id=v.id
      and (c.member_count,c.energy,c.energy_progress,c.activity,c.resting_since,c.food_used_since_rest,
        c.energy_updated_at,c.rest_building_id,c.avoid_worksite_id) is distinct from
        (v.member_count,v.energy,v.energy_progress,v.activity,v.resting_since,v.food_used_since_rest,
        v.energy_updated_at,v.rest_building_id,v.avoid_worksite_id)
  `.execute(tx);
  return allocateRestHousing(tx, worldId, villageId, cohorts);
}

/** Snapshots only persist activity transitions and bed changes, not every
 * cohort's energy cursor on each polling request. Full work materialization
 * remains in commands and chronological completions. */
export async function reconcileRestHousing(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  through: Date,
) {
  const cohorts = await tx
    .selectFrom('populationCohorts')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .orderBy('id')
    .forUpdate()
    .execute();
  for (const cohort of cohorts) {
    const e = advanceEnergy(energyState(cohort), through);
    if (e.activity === cohort.activity && (e.activity === 'resting' || cohort.restBuildingId === null)) continue;
    const values = {
      activity: e.activity,
      energy: e.energy,
      energyProgress: e.progress,
      restingSince: e.restingSince,
      foodUsedSinceRest: e.foodUsedSinceRest,
      energyUpdatedAt: e.updatedAt,
      restBuildingId: e.activity === 'resting' && withoutAssignment(cohort) ? cohort.restBuildingId : null,
    };
    await tx
      .updateTable('populationCohorts')
      .set(values)
      .where('worldId', '=', worldId)
      .where('id', '=', cohort.id)
      .execute();
    Object.assign(cohort, values);
  }
  return allocateRestHousing(tx, worldId, villageId, cohorts);
}

export function eligibleWorkers(cohorts: Cohort[], durationMs: number): Cohort[] {
  return cohorts
    .filter(
      (cohort) =>
        withoutAssignment(cohort) && cohort.activity === 'idle' && canWorkFor(energyState(cohort), durationMs),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Shared by previews and real departures; more workers can shorten the work. */
export function workingTeam(
  cohorts: Cohort[],
  cap: number,
  durationFor: (count: number) => number,
  preferredId?: string,
) {
  for (
    let count = Math.min(
      cap,
      cohorts.reduce((n, c) => n + c.memberCount, 0),
    );
    count >= 1;
    count--
  ) {
    const durationMs = durationFor(count);
    const eligible = eligibleWorkers(cohorts, durationMs).filter((c) => !preferredId || c.id === preferredId);
    if (eligible.reduce((n, c) => n + c.memberCount, 0) >= count) return { count, durationMs, cohorts: eligible };
  }
  return { count: 0, durationMs: 0, cohorts: [] as Cohort[] };
}

/** Caller has validated the complete count before inserting the work. */
export async function assignWorkers(
  tx: Transaction<Database>,
  cohorts: Cohort[],
  count: number,
  assignment: Assignment,
): Promise<void> {
  let needed = count;
  for (const cohort of cohorts) {
    if (needed === 0) break;
    const memberCount = Math.min(needed, cohort.memberCount);
    if (memberCount === cohort.memberCount) {
      await tx
        .updateTable('populationCohorts')
        .set({ activity: 'working', avoidWorksiteId: null, pendingRelease: null, ...assignment })
        .where('worldId', '=', cohort.worldId)
        .where('id', '=', cohort.id)
        .execute();
    } else {
      await tx
        .updateTable('populationCohorts')
        .set({ memberCount: cohort.memberCount - memberCount })
        .where('worldId', '=', cohort.worldId)
        .where('id', '=', cohort.id)
        .execute();
      await tx
        .insertInto('populationCohorts')
        .values({
          worldId: cohort.worldId,
          villageId: cohort.villageId,
          originVillageId: cohort.originVillageId,
          memberCount,
          activity: 'working',
          energy: cohort.energy,
          energyProgress: cohort.energyProgress,
          energyUpdatedAt: cohort.energyUpdatedAt,
          restingSince: null,
          foodUsedSinceRest: cohort.foodUsedSinceRest,
          cartographer: cohort.cartographer,
          ...assignment,
        })
        .execute();
    }
    needed -= memberCount;
  }
  if (needed !== 0) throw new Error('Workforce allocation invariant failed');
}

export async function releaseWorkers(
  tx: Transaction<Database>,
  workers: Cohort[],
  expectedCount: number,
  through: Date,
): Promise<void> {
  if (workers.reduce((total, cohort) => total + cohort.memberCount, 0) !== expectedCount)
    throw new Error('Workforce conservation invariant failed');
  for (const cohort of workers) {
    const empty = cohort.energy === 0 && cohort.energyProgress === 0;
    const rest = empty || cohort.pendingRelease === 'resting';
    await tx
      .updateTable('populationCohorts')
      .set({
        activity: rest ? 'resting' : 'idle',
        pendingRelease: null,
        avoidWorksiteId: rest ? null : cohort.avoidWorksiteId,
        restingSince: rest ? through : null,
        harvestId: null,
        extractionId: null,
        scienceActivityId: null,
        processingLotId: null,
        tradeJourneyId: null,
        levelingJobId: null,
        restBuildingId: null,
      })
      .where('worldId', '=', cohort.worldId)
      .where('id', '=', cohort.id)
      .execute();
  }
}
