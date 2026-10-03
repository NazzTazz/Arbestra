import { sql, type Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';

/** All callers acquire stone rows first, then woodland UUIDs, before transitions. */
export async function materializeWoodland(tx: Transaction<Database>, worldId: string, featureId: string, through: Date) {
  const before = await tx.selectFrom('woodlandDeposits').selectAll().where('worldId', '=', worldId)
    .where('featureId', '=', featureId).forUpdate().executeTakeFirst();
  if (!before) return;
  const occupied = await tx.selectFrom('worldCellOccupancies').select(['buildingId', 'featureId'])
    .where('worldId', '=', worldId).where('cellX', '=', before.cellX).where('cellY', '=', before.cellY).executeTakeFirst();
  // Fold physical returns at their own deadlines. A crossing must survive regrowth
  // between the return and a late worker/read, including a foreign village's read.
  const due = await tx.selectFrom('depositExtractions').select(['id', 'completesAt', 'worksiteId'])
    .where('worldId', '=', worldId).where('featureId', '=', featureId).where('resourceCode', '=', 'wood')
    .where('woodDebitedAt', 'is', null).where('completesAt', '<=', through)
    .orderBy('completesAt').orderBy('id').execute();
  const deadlines = [...new Set(due.map(row => row.completesAt.getTime()))];
  for (const deadline of deadlines) {
    const at = new Date(deadline);
    await sql`
      update woodland_deposits w set remaining_amount=woodland_stock_at(w,${at}),
        reserved_amount=w.reserved_amount-coalesce((select sum(e.reserved_amount) from deposit_extractions e
          where e.world_id=w.world_id and e.feature_id=w.feature_id and e.resource_code='wood'
            and e.wood_debited_at is null and e.completes_at<=${at}),0),
        regrowth_updated_at=greatest(w.regrowth_updated_at,${at})
      where w.world_id=${worldId} and w.feature_id=${featureId}
    `.execute(tx);
    await tx.updateTable('depositExtractions').set({ woodDebitedAt: at })
      .where('worldId', '=', worldId).where('featureId', '=', featureId).where('resourceCode', '=', 'wood')
      .where('woodDebitedAt', 'is', null).where('completesAt', '<=', at).execute();
    const atStock = await tx.selectFrom('woodlandDeposits').select(['remainingAmount', 'initialAmount', 'reservedAmount', 'cleared'])
      .where('worldId', '=', worldId).where('featureId', '=', featureId).executeTakeFirstOrThrow();
    if (!atStock.cleared && Number(atStock.remainingAmount) <= Number(atStock.initialAmount) / 10) {
      const sites = await tx.selectFrom('extractionWorksiteTargets').innerJoin('extractionWorksites',
        'extractionWorksites.id', 'extractionWorksiteTargets.worksiteId')
        .select(['extractionWorksiteTargets.worksiteId', 'extractionWorksiteTargets.admittedAt',
          'extractionWorksites.status', 'extractionWorksites.mode'])
        .where('extractionWorksiteTargets.worldId', '=', worldId)
        .where('extractionWorksiteTargets.featureId', '=', featureId)
        .where('extractionWorksiteTargets.status', '=', 'pending')
        .where('extractionWorksiteTargets.thresholdReachedAt', 'is', null).execute();
      const committedIds = new Set(due.filter(row => row.completesAt.getTime() === deadline)
        .map(row => row.worksiteId).filter((id): id is string => id !== null));
      for (const site of sites) {
        if (!site.admittedAt || site.admittedAt > at || (site.status !== 'running' && !committedIds.has(site.worksiteId))) continue;
        await tx.updateTable('extractionWorksiteTargets').set({ thresholdReachedAt: at })
          .where('worksiteId', '=', site.worksiteId).where('featureId', '=', featureId).execute();
        if (site.mode === 'clear' && (site.status === 'running' || committedIds.has(site.worksiteId))) {
          await tx.updateTable('woodlandDeposits').set({ cleared: true, remainingAmount: sql`reserved_amount` })
            .where('worldId', '=', worldId).where('featureId', '=', featureId).execute();
        }
      }
    }
  }
  await sql`
    update woodland_deposits w set remaining_amount=woodland_stock_at(w,${through}),
      reserved_amount=w.reserved_amount-coalesce((select sum(e.reserved_amount) from deposit_extractions e
        where e.world_id=w.world_id and e.feature_id=w.feature_id and e.resource_code='wood'
          and e.wood_debited_at is null and e.completes_at<=${through}),0),
      regrowth_updated_at=greatest(w.regrowth_updated_at,${through})
    where w.world_id=${worldId} and w.feature_id=${featureId}
  `.execute(tx);
  if (occupied?.buildingId) await tx.updateTable('woodlandDeposits').set({ cleared: true,
    remainingAmount: sql`reserved_amount` }).where('worldId', '=', worldId).where('featureId', '=', featureId).execute();
  const after = await tx.selectFrom('woodlandDeposits').selectAll().where('worldId', '=', worldId)
    .where('featureId', '=', featureId).executeTakeFirstOrThrow();
  const blocked = !after.cleared && Number(after.remainingAmount) > Number(after.initialAmount) / 10;
  if (!blocked) await tx.deleteFrom('worldCellOccupancies').where('worldId', '=', worldId).where('featureId', '=', featureId).execute();
  else if (!occupied) await tx.insertInto('worldCellOccupancies').values({ worldId, featureId,
    cellX: after.cellX, cellY: after.cellY, buildingId: null, role: 'body' })
    .onConflict(oc => oc.columns(['worldId', 'cellX', 'cellY']).doNothing()).execute();
  if (Math.floor(Number(before.remainingAmount)) !== Math.floor(Number(after.remainingAmount)) || before.cleared !== after.cleared
    || before.reservedAmount !== after.reservedAmount) {
    await tx.updateTable('woodlandDeposits').set({ revision: sql`revision+1`, updatedAt: through })
      .where('worldId', '=', worldId).where('featureId', '=', featureId).execute();
  }
  await tx.updateTable('worldFeatures').set({ state: after.cleared ? 'depleted' : 'available', updatedAt: sql`${through}` })
    .where('worldId', '=', worldId).where('id', '=', featureId).execute();
}

/** Caller already holds village and woodland locks. Does not touch foreign villages. */
export async function clearWoodland(tx: Transaction<Database>, worldId: string, featureId: string, through: Date) {
  await materializeWoodland(tx, worldId, featureId, through);
  const wood = await tx.selectFrom('woodlandDeposits').selectAll().where('worldId', '=', worldId)
    .where('featureId', '=', featureId).executeTakeFirst();
  if (!wood) throw new HttpError(404, 'WOODLAND_NOT_FOUND', 'Bosquet introuvable.');
  if (wood.cleared) return;
  if (Number(wood.remainingAmount) > Number(wood.initialAmount) / 10)
    throw new HttpError(409, 'WOODLAND_NOT_CLEARABLE', 'Coupez au moins 90 % du bosquet avant de défricher.');
  await tx.updateTable('woodlandDeposits').set({ cleared: true, remainingAmount: sql`reserved_amount`,
    revision: sql`revision+1`, updatedAt: through }).where('worldId', '=', worldId).where('featureId', '=', featureId).execute();
  await tx.deleteFrom('worldCellOccupancies').where('worldId', '=', worldId).where('featureId', '=', featureId).execute();
  await tx.updateTable('worldFeatures').set({ state: 'depleted', updatedAt: sql`${through}` })
    .where('worldId', '=', worldId).where('id', '=', featureId).execute();
}

/** A validated construction claims a liberated woodland cell permanently. */
export async function claimWoodlandCell(tx: Transaction<Database>, worldId: string, cellX: number, cellY: number) {
  await tx.updateTable('woodlandDeposits').set({ cleared: true, remainingAmount: sql`reserved_amount`,
    revision: sql`revision+1`, updatedAt: sql`statement_timestamp()` })
    .where('worldId', '=', worldId).where('cellX', '=', cellX).where('cellY', '=', cellY).where('cleared', '=', false).execute();
}
