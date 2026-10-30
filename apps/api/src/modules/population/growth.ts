import { sql, type SqlBool, type Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import { housingCapacity } from './housing.js';
import { ensurePopulationEnergyWake, nextPopulationEnergyAt } from './work.js';

export const POPULATION_ARRIVAL_TASK = 'population.arrive';
export const POPULATION_ARRIVAL_INTERVAL_MS = 60_000;

/** Caller holds the village lock. Reconcile before capacity changes and again
 * at their actual deadline: unused time at the target never buys future arrivals. */
export async function advancePopulationGrowth(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  through: Date,
  capacityChanged = false,
) {
  const row = await tx
    .selectFrom('villagePopulations')
    .select(['nextArrivalAt', 'growthStartedAt'])
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .executeTakeFirst();
  if (!row) return;
  if (!capacityChanged && (!row.nextArrivalAt || row.nextArrivalAt > through)) return;
  const [homes, population] = await Promise.all([
    tx
      .selectFrom('buildings')
      .select(['buildingType', 'level'])
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('buildingType', 'in', ['town-hall', 'dwelling'])
      .where((eb) => eb.or([eb('status', '=', 'completed'), eb('targetLevel', 'is not', null)]))
      .execute(),
    tx
      .selectFrom('populationCohorts')
      .select(sql<number>`coalesce(sum(member_count),0)::integer`.as('total'))
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .executeTakeFirstOrThrow(),
  ]);
  const target = Math.floor(homes.reduce((n, h) => n + housingCapacity(h.buildingType, h.level), 0) / 2);
  const missing = Math.max(0, target - population.total);
  let next = missing
    ? (row.nextArrivalAt ??
      new Date(Math.max(through.getTime(), row.growthStartedAt.getTime()) + POPULATION_ARRIVAL_INTERVAL_MS))
    : null;
  if (next && next <= through) {
    const count = Math.min(
      missing,
      1 + Math.floor((through.getTime() - next.getTime()) / POPULATION_ARRIVAL_INTERVAL_MS),
    );
    const first = next.getTime();
    // Each arrival retains its own energy clock, including offline catch-up.
    const arrivals = await tx
      .insertInto('populationCohorts')
      .values(
        Array.from({ length: count }, (_, i) => ({
          worldId,
          villageId,
          originVillageId: villageId,
          memberCount: 1,
          activity: 'idle' as const,
          energy: 10,
          energyProgress: 0,
          energyUpdatedAt: new Date(first + i * POPULATION_ARRIVAL_INTERVAL_MS),
          restingSince: null,
          foodUsedSinceRest: 0,
        })),
      )
      .returningAll()
      .execute();
    // The first arrival tires 22 hours after it came, offline as well.
    await ensurePopulationEnergyWake(tx, worldId, villageId, nextPopulationEnergyAt(arrivals, through));
    next = count === missing ? null : new Date(first + count * POPULATION_ARRIVAL_INTERVAL_MS);
  }
  if (row.nextArrivalAt?.getTime() !== next?.getTime())
    await tx
      .updateTable('villagePopulations')
      .set({ nextArrivalAt: next })
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .execute();
  if (next)
    await tx
      .insertInto('scheduledTasks')
      .values({
        worldId,
        taskType: POPULATION_ARRIVAL_TASK,
        subjectId: villageId,
        payload: {},
        dueAt: next,
        availableAt: next,
        completedAt: null,
        lastError: null,
      })
      .onConflict((oc) =>
        oc
          .columns(['worldId', 'subjectId', 'dueAt'])
          .where(sql<SqlBool>`task_type='population.arrive'`)
          .doNothing(),
      )
      .execute();
}
