import type { Selectable, Transaction } from 'kysely';
import type { VillageState } from '@arbestra/contracts';
import type { Database, PopulationCohortsTable } from '../../database/schema.js';
import { advanceEnergy, displayedEnergy } from './energy.js';
import { energyState, withoutAssignment } from './work.js';
import { housingCapacity } from './housing.js';
import { POPULATION_ARRIVAL_INTERVAL_MS } from './growth.js';

type Cohort = Selectable<PopulationCohortsTable>;
type Home = { id: string; buildingType: string; level: number };
export function projectPopulation(
  cohorts: Cohort[],
  homes: Home[],
  growth: { nextArrivalAt: Date | null } | undefined,
  at: Date,
): VillageState['village']['population'] {
  const projected = cohorts.map((cohort) => ({ ...cohort, energy: advanceEnergy(energyState(cohort), at) }));
  const capacity = homes.reduce((total, home) => total + housingCapacity(home.buildingType, home.level), 0);
  return {
    pendingRelease: {
      idle: cohorts.filter((c) => c.pendingRelease === 'idle').reduce((n, c) => n + c.memberCount, 0),
      resting: cohorts.filter((c) => c.pendingRelease === 'resting').reduce((n, c) => n + c.memberCount, 0),
    },
    total: projected.reduce((total, cohort) => total + cohort.memberCount, 0),
    housingCapacity: capacity,
    growth: {
      target: Math.floor(capacity / 2),
      arrivalIntervalMs: POPULATION_ARRIVAL_INTERVAL_MS,
      nextArrivalAt: growth?.nextArrivalAt?.toISOString() ?? null,
    },
    cohorts: projected.map((c) => ({
      id: c.id,
      memberCount: c.memberCount,
      activity: c.energy.activity,
      restBuildingId: c.restBuildingId,
      restingSince: c.energy.restingSince?.toISOString() ?? null,
      energy: displayedEnergy(c.energy),
      cartographer: c.cartographer,
      assignmentId:
        c.harvestId ??
        c.extractionId ??
        c.scienceActivityId ??
        c.processingLotId ??
        c.tradeJourneyId ??
        c.levelingJobId,
      assignmentKind: c.harvestId
        ? 'garden'
        : c.extractionId
          ? 'extraction'
          : c.scienceActivityId
            ? 'science'
            : c.processingLotId
              ? 'processing'
              : c.tradeJourneyId
                ? 'trade'
                : c.levelingJobId
                  ? 'leveling'
                  : null,
    })),
    restHousing: homes
      .filter((home) => housingCapacity(home.buildingType, home.level) > 0)
      .map((home) => ({
        buildingId: home.id,
        capacity: housingCapacity(home.buildingType, home.level),
        restingCount: projected.filter((c) => c.restBuildingId === home.id).reduce((n, c) => n + c.memberCount, 0),
      })),
    restingWithoutHousing: projected
      .filter((c) => c.energy.activity === 'resting' && withoutAssignment(c) && c.restBuildingId === null)
      .reduce((n, c) => n + c.memberCount, 0),
    available: projected
      .filter((c) => c.energy.activity === 'idle' && withoutAssignment(c))
      .reduce((n, c) => n + c.memberCount, 0),
    working: projected.filter((c) => c.energy.activity === 'working').reduce((n, c) => n + c.memberCount, 0),
    resting: projected.filter((c) => c.energy.activity === 'resting').reduce((n, c) => n + c.memberCount, 0),
    energyCounts: Array.from({ length: 11 }, (_, energy) =>
      projected.filter((c) => displayedEnergy(c.energy) === energy).reduce((n, c) => n + c.memberCount, 0),
    ),
  };
}

/** Aggregate reads are only for this explicitly derived summary. Selected
 * cohort entities use the separate reader below and never load buildings. */
export async function readPopulationProjection(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  at: Date,
) {
  const [cohorts, homes, growth] = await Promise.all([
    tx
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .orderBy('id')
      .execute(),
    tx
      .selectFrom('buildings')
      .select(['id', 'buildingType', 'level'])
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where((eb) => eb.or([eb('status', '=', 'completed'), eb('targetLevel', 'is not', null)]))
      .execute(),
    tx
      .selectFrom('villagePopulations')
      .select('nextArrivalAt')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .executeTakeFirst(),
  ]);
  return projectPopulation(cohorts, homes, growth, at);
}

export async function readCohortProjection(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  at: Date,
  ids: readonly string[],
) {
  if (!ids.length) return [];
  // Every arrival is its own cohort: a large village exceeds 1 024 cohorts.
  // The private snapshot already bounds the whole scope to 4 096 references.
  if (ids.length > 4096) throw new RangeError('Too many cohort ids');
  const cohorts = await tx
    .selectFrom('populationCohorts')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .where('id', 'in', [...new Set(ids)])
    .orderBy('id')
    .execute();
  return projectPopulation(cohorts, [], undefined, at).cohorts!.map((view, index) => {
    const clock = energyState(cohorts[index]!);
    return {
      ...view,
      clock: {
        ...clock,
        updatedAt: clock.updatedAt.toISOString(),
        restingSince: clock.restingSince?.toISOString() ?? null,
      },
    };
  });
}
