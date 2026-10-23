import { sql, type Transaction } from 'kysely';
import type { PopulationGesture } from '@arbestra/contracts';
import type { Database, PopulationCohortsTable } from '../../database/schema.js';
import type { Selectable } from 'kysely';
import type { VillageEconomy } from '../villages/reconcile-economy.js';
import { HttpError } from '../../errors.js';
import { materializeCohorts, withoutAssignment, energyState } from './work.js';
import { beginRest, feedEnergy } from './energy.js';

/** A partial gesture preserves every assignment and energy cursor on both pieces. */
async function part(tx: Transaction<Database>, cohort: Selectable<PopulationCohortsTable>, count: number) {
  if (count === cohort.memberCount) return cohort.id;
  await tx
    .updateTable('populationCohorts')
    .set({ memberCount: cohort.memberCount - count })
    .where('worldId', '=', cohort.worldId)
    .where('id', '=', cohort.id)
    .execute();
  return (
    await tx
      .insertInto('populationCohorts')
      .values({ ...cohort, id: undefined, createdAt: undefined, memberCount: count })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
}

export async function populationGesture(tx: Transaction<Database>, ctx: VillageEconomy, request: PopulationGesture) {
  const cohorts = await materializeCohorts(tx, ctx.worldId, ctx.villageId, ctx.through);
  if (request.action === 'feed') {
    const eligible = cohorts.filter((c) => c.activity === request.group && feedEnergy(energyState(c)) !== null);
    const count = eligible.reduce((n, c) => n + c.memberCount, 0);
    if (!count)
      throw new HttpError(
        409,
        'POPULATION_FOOD_UNAVAILABLE',
        'Ce groupe n’a pas besoin de repas, ou a déjà utilisé son quota.',
      );
    const debit = await tx
      .updateTable('villageResources')
      .set({ amount: sql`amount-${count}::bigint` })
      .where('worldId', '=', ctx.worldId)
      .where('villageId', '=', ctx.villageId)
      .where('resourceCode', '=', 'carrot')
      .where('amount', '>=', String(count))
      .executeTakeFirst();
    if (debit.numUpdatedRows !== 1n)
      throw new HttpError(409, 'CARROTS_INSUFFICIENT', `${count} carottes nécessaires pour nourrir ce groupe.`);
    for (const c of eligible) {
      const e = feedEnergy(energyState(c))!;
      await tx
        .updateTable('populationCohorts')
        .set({ energy: e.energy, energyProgress: e.progress, foodUsedSinceRest: e.foodUsedSinceRest })
        .where('worldId', '=', ctx.worldId)
        .where('id', '=', c.id)
        .execute();
    }
    return { affected: count, carrots: count };
  }
  const eligible = cohorts.filter((c) =>
    request.action === 'rest'
      ? c.activity === 'idle' && withoutAssignment(c) && beginRest(energyState(c)) !== null
      : !withoutAssignment(c) && c.pendingRelease === null,
  );
  let remaining = 10;
  for (const c of eligible) {
    if (!remaining) break;
    const count = Math.min(remaining, c.memberCount),
      id = await part(tx, c, count);
    if (request.action === 'rest')
      await tx
        .updateTable('populationCohorts')
        .set({ activity: 'resting', restingSince: ctx.through, avoidWorksiteId: null })
        .where('worldId', '=', ctx.worldId)
        .where('id', '=', id)
        .execute();
    else {
      const extraction = c.extractionId
        ? await tx
            .selectFrom('depositExtractions')
            .select('worksiteId')
            .where('worldId', '=', ctx.worldId)
            .where('villageId', '=', ctx.villageId)
            .where('id', '=', c.extractionId)
            .executeTakeFirst()
        : null;
      const processing = c.processingLotId
        ? await tx
            .selectFrom('processingLots')
            .select('orderId')
            .where('worldId', '=', ctx.worldId)
            .where('villageId', '=', ctx.villageId)
            .where('id', '=', c.processingLotId)
            .executeTakeFirst()
        : null;
      const science = c.scienceActivityId
        ? await tx
            .selectFrom('scienceActivities')
            .select('buildingId')
            .where('worldId', '=', ctx.worldId)
            .where('villageId', '=', ctx.villageId)
            .where('id', '=', c.scienceActivityId)
            .executeTakeFirst()
        : null;
      await tx
        .updateTable('populationCohorts')
        .set({
          pendingRelease: request.destination,
          avoidWorksiteId:
            request.destination === 'idle'
              ? (extraction?.worksiteId ?? processing?.orderId ?? science?.buildingId ?? null)
              : null,
        })
        .where('worldId', '=', ctx.worldId)
        .where('id', '=', id)
        .execute();
    }
    remaining -= count;
  }
  if (remaining === 10)
    throw new HttpError(
      409,
      'POPULATION_GESTURE_UNAVAILABLE',
      request.action === 'rest'
        ? 'Ces habitants sont déjà reposés.'
        : 'Tous les habitants actifs ont déjà une relève demandée.',
    );
  return { affected: 10 - remaining, carrots: 0 };
}
