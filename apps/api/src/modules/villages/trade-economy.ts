import { sql, type Transaction } from 'kysely';
import type { TradeCommand, TradeOffer, MarketJourney, TradePage } from '@arbestra/contracts';
import { MARKET_PRIORITY_MS, oracleAmount, oracleCost } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { materializeVillageResource } from './economy.js';
import { materializeCohorts, releaseWorkers } from '../population/work.js';

export const TRADE_WAKE_TASK = 'trade.wake';
export type TradeContext = { worldId: string; villageId: string; through: Date };
export async function tradeStock(tx: Transaction<Database>, ctx: TradeContext, code: string) {
  await tx.insertInto('villageResources').values({ worldId: ctx.worldId, villageId: ctx.villageId, resourceCode: code, amount: 0 })
    .onConflict(c => c.columns(['worldId', 'villageId', 'resourceCode']).doNothing()).execute();
  return materializeVillageResource(tx, ctx.worldId, ctx.villageId, code, ctx.through);
}
export async function tradeCredit(tx: Transaction<Database>, ctx: TradeContext, code: string, amount: number) {
  await tradeStock(tx, ctx, code);
  await tx.updateTable('villageResources').set({ amount: sql`amount + ${amount}` })
    .where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId).where('resourceCode', '=', code).execute();
}
export async function tradeDebit(tx: Transaction<Database>, ctx: TradeContext, code: string, amount: number) {
  if (await tradeStock(tx, ctx, code) < amount) throw new HttpError(409, 'TRADE_STOCK', 'Stock disponible insuffisant.');
  await tx.updateTable('villageResources').set({ amount: sql`amount - ${amount}` })
    .where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId).where('resourceCode', '=', code).execute();
}
export async function assertMarket(tx: Transaction<Database>, ctx: TradeContext) {
  const hall = await tx.selectFrom('buildings').select('id').where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('buildingType', '=', 'town-hall').where('level', '>=', 2)
    .where('status', '=', 'completed').executeTakeFirst();
  if (!hall) throw new HttpError(409, 'MARKET_UNAVAILABLE', 'Le marché nécessite un hôtel de ville niveau 2 achevé.');
}
export async function tradePrices(tx: Transaction<Database>, offered: string, requested: string) {
  const rows = await tx.selectFrom('oracleMarketResources').selectAll().where('resourceCode', 'in', [offered, requested]).execute();
  const a = rows.find(r => r.resourceCode === offered), b = rows.find(r => r.resourceCode === requested);
  if (offered === requested || !a || !b) throw new HttpError(400, 'TRADE_RESOURCES', 'Choisissez deux ressources négociables différentes.');
  return { offered: a.valueUnits, requested: b.valueUnits };
}
export async function tradeWake(tx: Transaction<Database>, ctx: TradeContext, id: string, dueAt: Date, kind: 'offer' | 'delivery') {
  await tx.insertInto('scheduledTasks').values({ worldId: ctx.worldId, taskType: TRADE_WAKE_TASK, subjectId: id,
    payload: { villageId: ctx.villageId, kind }, dueAt, availableAt: dueAt, completedAt: null, lastError: null }).execute();
}
export async function publishTrade(tx: Transaction<Database>, ctx: TradeContext, command: Extract<TradeCommand, {action: 'publish'}>) {
  await assertMarket(tx, ctx);
  const prices = await tradePrices(tx, command.offeredResource, command.requestedResource);
  const count = await tx.selectFrom('tradeOffers').select(sql<string>`count(*)`.as('n'))
    .where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId).where('status', '=', 'open').executeTakeFirstOrThrow();
  if (Number(count.n) >= 20) throw new HttpError(409, 'TRADE_LIMIT', 'Vous pouvez publier au plus 20 annonces actives.');
  await tradeDebit(tx, ctx, command.offeredResource, command.offeredAmount);
  const oracleAt = new Date(ctx.through.getTime() + MARKET_PRIORITY_MS);
  const oracleEligible = oracleAmount(command.offeredAmount, prices.offered, prices.requested) >= command.requestedAmount;
  const offer = await tx.insertInto('tradeOffers').values({ worldId: ctx.worldId, villageId: ctx.villageId,
    requestedResource: command.requestedResource, requestedAmount: command.requestedAmount,
    offeredResource: command.offeredResource, offeredAmount: command.offeredAmount, maxTravelSeconds: command.maxTravelSeconds,
    status: 'open', createdAt: ctx.through, oracleAt, oracleEligible }).returning('id').executeTakeFirstOrThrow();
  if (oracleEligible) await tradeWake(tx, ctx, offer.id, oracleAt, 'offer');
}
export async function cancelTrade(tx: Transaction<Database>, ctx: TradeContext, id: string) {
  const offer = await tx.selectFrom('tradeOffers').selectAll().where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('id', '=', id).executeTakeFirst();
  if (!offer || offer.status !== 'open') throw new HttpError(409, 'TRADE_CLOSED', 'Cette annonce ne peut plus être annulée.');
  await tradeCredit(tx, ctx, offer.offeredResource, offer.offeredAmount);
  await tx.updateTable('tradeOffers').set({ status: 'cancelled' }).where('worldId', '=', ctx.worldId).where('id', '=', id).execute();
}
export async function directOracle(tx: Transaction<Database>, ctx: TradeContext, command: Extract<TradeCommand, {action: 'oracle'}>) {
  await assertMarket(tx, ctx);
  const prices = await tradePrices(tx, command.offeredResource, command.requestedResource);
  const cost = oracleCost(command.requestedAmount, prices.offered, prices.requested);
  if (cost !== command.expectedCost) throw new HttpError(409, 'MARKET_QUOTE_CHANGED', 'Le tarif Oracle a changé.');
  await tradeDebit(tx, ctx, command.offeredResource, cost);
  await tradeCredit(tx, ctx, command.requestedResource, command.requestedAmount);
  await tx.insertInto('tradeOffers').values({ worldId: ctx.worldId, villageId: ctx.villageId,
    requestedResource: command.requestedResource, requestedAmount: command.requestedAmount,
    offeredResource: command.offeredResource, offeredAmount: cost, maxTravelSeconds: 1,
    status: 'oracle', createdAt: ctx.through, oracleAt: ctx.through, oracleEligible: true }).execute();
}
/** Local transitions only: never acquire or mutate the other village. */
export async function completeTradeAt(tx: Transaction<Database>, ctx: TradeContext, id: string, at: Date, kind: 'offer' | 'delivery') {
  if (at > ctx.through) return;
  if (kind === 'offer') {
    const offer = await tx.selectFrom('tradeOffers').selectAll().where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId)
      .where('id', '=', id).where('status', '=', 'open').where('oracleEligible', '=', true).where('oracleAt', '=', at).executeTakeFirst();
    if (!offer) return;
    await tradeCredit(tx, { ...ctx, through: at }, offer.requestedResource, offer.requestedAmount);
    await tx.updateTable('tradeOffers').set({ status: 'oracle' }).where('worldId', '=', ctx.worldId).where('id', '=', id).execute();
    return;
  }
  const delivery = await tx.selectFrom('tradeDeliveries').selectAll().where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId)
    .where('id', '=', id).where('completedAt', 'is', null).where('dueAt', '=', at).executeTakeFirst();
  if (!delivery) return;
  await tradeCredit(tx, { ...ctx, through: at }, delivery.resourceCode, delivery.amount);
  if (delivery.releaseWorkers) {
    const journey = await tx.selectFrom('tradeJourneys').select('workerCount').where('worldId', '=', ctx.worldId)
      .where('villageId', '=', ctx.villageId).where('id', '=', delivery.journeyId).executeTakeFirstOrThrow();
    const cohorts = await materializeCohorts(tx, ctx.worldId, ctx.villageId, at);
    await releaseWorkers(tx, cohorts.filter(c => c.tradeJourneyId === delivery.journeyId), journey.workerCount, at);
  }
  await tx.updateTable('tradeDeliveries').set({ completedAt: at }).where('worldId', '=', ctx.worldId).where('id', '=', id).execute();
}
export async function readTradeOffers(tx: Transaction<Database>, ctx: TradeContext, mine: boolean, cursor?: string): Promise<TradePage> {
  let q = tx.selectFrom('tradeOffers as t').innerJoin('villages as v', j => j.onRef('v.worldId', '=', 't.worldId').onRef('v.id', '=', 't.villageId'))
    .selectAll('t').select('v.name as villageName').where('t.worldId', '=', ctx.worldId);
  q = mine ? q.where('t.villageId', '=', ctx.villageId) : q.where('t.status', '=', 'open');
  if (cursor) {
    let cursorQuery=tx.selectFrom('tradeOffers').select('createdAt').where('worldId','=',ctx.worldId).where('id','=',cursor);
    if(mine)cursorQuery=cursorQuery.where('villageId','=',ctx.villageId);
    const previous=await cursorQuery.executeTakeFirst();
    if(!previous)throw new HttpError(400,'TRADE_CURSOR','Curseur d’annonces invalide.');
    q=q.where(eb=>eb.or([eb('t.createdAt','<',previous.createdAt),eb.and([eb('t.createdAt','=',previous.createdAt),eb('t.id','<',cursor)])]));
  }
  const rows = await q.orderBy('t.createdAt','desc').orderBy('t.id','desc').limit(51).execute();
  return { offers: rows.slice(0, 50).map(r => ({ ...r, createdAt: r.createdAt.toISOString(), oracleAt: r.oracleAt.toISOString() })),
    nextCursor: rows.length > 50 ? rows[49]!.id : null };
}
export async function ownTradeOffers(tx: Transaction<Database>, ctx: TradeContext, selected?:readonly string[]): Promise<TradeOffer[]> {
  if(selected?.length===0)return [];
  if(selected&&selected.length>1024)throw new RangeError('Too many trade offer ids');
  const query = tx.selectFrom('tradeOffers as t').innerJoin('villages as v', j => j.onRef('v.worldId', '=', 't.worldId').onRef('v.id', '=', 't.villageId'))
    .selectAll('t').select('v.name as villageName').where('t.worldId', '=', ctx.worldId).where('t.villageId', '=', ctx.villageId)
    .where('t.status', '=', 'open').orderBy('t.createdAt', 'desc');
  const rows = await (selected?query.where('t.id','in',selected):query).execute();
  return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), oracleAt: r.oracleAt.toISOString() }));
}
export async function tradeJourneys(tx: Transaction<Database>, ctx: TradeContext): Promise<MarketJourney[]> {
  const rows = await tx.selectFrom('tradeJourneys').selectAll().where('worldId', '=', ctx.worldId).where('returnsAt', '>', ctx.through).execute();
  return rows.map(r => ({ ...r, startedAt: r.startedAt.toISOString(), arrivesAt: r.arrivesAt.toISOString(), returnsAt: r.returnsAt.toISOString() }));
}

/** Private V2 representation: only the sender and destination receive these
 * journeys. Expiry remains based on the persisted deadline, not a read write. */
export async function readPrivateTradeJourneys(tx: Transaction<Database>, ctx: TradeContext, ids:readonly string[]): Promise<MarketJourney[]> {
  if(!ids.length)return [];
  if(ids.length>1024)throw new RangeError('Too many journey ids');
  const rows=await tx.selectFrom('tradeJourneys').selectAll().where('worldId','=',ctx.worldId).where('id','in',ids)
    .where(eb=>eb.or([eb('villageId','=',ctx.villageId),eb('destinationVillageId','=',ctx.villageId)])).orderBy('id').execute();
  return rows.map(row=>({id:row.id,villageId:row.villageId,destinationVillageId:row.destinationVillageId,
    workerCount:row.workerCount,path:row.path,startedAt:row.startedAt.toISOString(),arrivesAt:row.arrivesAt.toISOString(),returnsAt:row.returnsAt.toISOString()}));
}
