import { sql, type Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';

/** Caller has already locked these woodland rows in UUID order. Full, correctly
 * occupied deposits without physical returns have nothing to reconcile. */
export async function materializeWoodlands(tx:Transaction<Database>,worldId:string,ids:string[],through:Date) {
  if(!ids.length)return;
  const full=await tx.selectFrom('woodlandDeposits').select(['featureId','cellX','cellY'])
    .where('worldId','=',worldId).where('featureId','in',ids).where('cleared','=',false)
    .whereRef('remainingAmount','=','initialAmount').where('reservedAmount','=','0').execute();
  // Read each world-scoped relation once. Correlated EXISTS became quadratic on
  // RC1's natural aggregates; these sets express the same settled predicate.
  const occupancies=await tx.selectFrom('worldCellOccupancies').select(['featureId','cellX','cellY'])
    .where('worldId','=',worldId).where('featureId','in',ids).where('buildingId','is',null).execute();
  const available=await tx.selectFrom('worldFeatures').select('id').where('worldId','=',worldId)
    .where('id','in',ids).where('state','=','available').execute();
  const due=await tx.selectFrom('depositExtractions').select('featureId').where('worldId','=',worldId)
    .where('featureId','in',ids).where('resourceCode','=','wood').where('woodDebitedAt','is',null).where('completesAt','<=',through).execute();
  const occupied=new Set(occupancies.map(o=>o.featureId+':'+o.cellX+':'+o.cellY)),active=new Set(available.map(f=>f.id)),pending=new Set(due.map(e=>e.featureId));
  const skip=new Set(full.filter(w=>occupied.has(w.featureId+':'+w.cellX+':'+w.cellY)&&active.has(w.featureId)&&!pending.has(w.featureId)).map(w=>w.featureId));
  const withoutReturns=ids.filter(id=>!skip.has(id)&&!pending.has(id));
  if(withoutReturns.length)await materializeWoodlandsWithoutReturns(tx,worldId,withoutReturns,through);
  // Physical returns retain their historical deadline order, including the
  // threshold remembered before later regrowth and other villages' credits.
  for(const id of ids)if(!skip.has(id)&&pending.has(id))await materializeWoodland(tx,worldId,id,through);
}

/** Rows are already locked; only stock/cell projections with no due physical cut. */
async function materializeWoodlandsWithoutReturns(tx:Transaction<Database>,worldId:string,ids:string[],through:Date){
  type Result={featureId:string;cellX:number;cellY:number;remainingAmount:string;initialAmount:string;cleared:boolean;occupied:boolean};
  const result=await sql<Result>`
    with current as materialized (
      select w as deposit, o.building_id is not null as building_occupied,
        o.world_id is not null as occupied
      from woodland_deposits w left join world_cell_occupancies o
        on o.world_id=w.world_id and o.cell_x=w.cell_x and o.cell_y=w.cell_y
      where w.world_id=${worldId} and w.feature_id in (${sql.join(ids)})
    ), projected as materialized (
      select deposit,occupied,(deposit).cleared or building_occupied as cleared,
        case when building_occupied then (deposit).reserved_amount::numeric
          else woodland_stock_at(deposit,${through}) end as stock
      from current
    )
    update woodland_deposits w set remaining_amount=p.stock,cleared=p.cleared,
      regrowth_updated_at=greatest(w.regrowth_updated_at,${through}),
      revision=w.revision+case when floor((p.deposit).remaining_amount)<>floor(p.stock)
        or (p.deposit).cleared<>p.cleared then 1 else 0 end,
      updated_at=case when floor((p.deposit).remaining_amount)<>floor(p.stock)
        or (p.deposit).cleared<>p.cleared then ${through} else w.updated_at end
    from projected p where w.world_id=${worldId} and w.feature_id=(p.deposit).feature_id
    returning w.feature_id,w.cell_x,w.cell_y,w.remaining_amount,w.initial_amount,w.cleared,p.occupied
  `.execute(tx);
  const after=result.rows,blocked=(wood:Result)=>!wood.cleared&&Number(wood.remainingAmount)>Number(wood.initialAmount)/10;
  const liberated=after.filter(w=>!blocked(w)).map(w=>w.featureId);
  if(liberated.length)await tx.deleteFrom('worldCellOccupancies').where('worldId','=',worldId).where('featureId','in',liberated).execute();
  const reclaimed=after.filter(w=>blocked(w)&&!w.occupied).map(w=>({worldId,featureId:w.featureId,cellX:w.cellX,cellY:w.cellY,buildingId:null,role:'body' as const}));
  if(reclaimed.length)await tx.insertInto('worldCellOccupancies').values(reclaimed).onConflict(oc=>oc.columns(['worldId','cellX','cellY']).doNothing()).execute();
  if(after.length)await sql`
    update world_features f set state=case when p.cleared then 'depleted' else 'available' end,
      updated_at=${through}
    from jsonb_to_recordset(${JSON.stringify(after.map(w=>({feature_id:w.featureId,cleared:w.cleared})))}::jsonb)
      as p(feature_id uuid,cleared boolean)
    where f.world_id=${worldId} and f.id=p.feature_id
  `.execute(tx);
}

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
