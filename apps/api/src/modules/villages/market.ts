import { isDeepStrictEqual } from 'node:util';
import { sql, type Transaction } from 'kysely';
import { MARKET_DELIVERY_MS, oracleAmount, type MarketRequest, type MarketCommand, type MarketPreview, type MarketState } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { materializeVillageResource } from './economy.js';

export const COMPLETE_MARKET_TASK = 'market.deliver';
type Context = { worldId: string; villageId: string; through: Date };
async function unlocked(tx: Transaction<Database>, ctx: Context) {
  return !!await tx.selectFrom('buildings').select('id').where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('buildingType', '=', 'town-hall')
    .where('level', '>=', 2).where('status', '=', 'completed').executeTakeFirst();
}
async function prices(tx: Transaction<Database>) {
  return tx.selectFrom('oracleMarketResources').innerJoin('resourceTypes', 'resourceTypes.code', 'oracleMarketResources.resourceCode')
    .select(['resourceTypes.code', 'resourceTypes.displayName', 'resourceTypes.iconKey', 'oracleMarketResources.valueUnits'])
    .orderBy('resourceTypes.code').execute();
}
async function stockAt(tx: Transaction<Database>, ctx: Context, code: string, at = ctx.through) {
  await tx.insertInto('villageResources').values({ worldId: ctx.worldId, villageId: ctx.villageId, resourceCode: code, amount: 0 })
    .onConflict(c => c.columns(['worldId', 'villageId', 'resourceCode']).doNothing()).execute();
  return materializeVillageResource(tx, ctx.worldId, ctx.villageId, code, at);
}
export async function previewMarket(tx: Transaction<Database>, ctx: Context, request: MarketRequest): Promise<MarketPreview> {
  const resources = await prices(tx), offer = resources.find(r => r.code === request.offeredResource),
    wanted = resources.find(r => r.code === request.requestedResource);
  const receivedAmount = offer && wanted ? oracleAmount(request.amount, offer.valueUnits, wanted.valueUnits) : 0;
  let message: string | null = !offer || !wanted ? 'Cette ressource ne se négocie pas avec l’Oracle.'
    : offer.code === wanted.code ? 'Choisissez deux ressources différentes.'
    : receivedAmount < 1 ? 'La quantité offerte ne permet de recevoir aucune unité.' : null;
  if (!message && !await unlocked(tx, ctx)) message = 'Le marché ouvre à l’hôtel de ville niveau 2 achevé.';
  if (!message && await stockAt(tx, ctx, request.offeredResource) < request.amount)
    message = 'Stock insuffisant.';
  return { valid: !message, message, receivedAmount, deliveryMs: MARKET_DELIVERY_MS };
}
/** Caller owns the village lock and a post-lock economic timestamp. */
export async function commandMarket(tx: Transaction<Database>, ctx: Context, command: MarketCommand) {
  const receipt = await tx.selectFrom('marketExchanges').select('request').where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('commandId', '=', command.commandId).executeTakeFirst();
  if (receipt) {
    if (!isDeepStrictEqual(receipt.request, command)) throw new HttpError(409, 'COMMAND_REUSED', 'Identifiant de commande déjà utilisé.');
    return;
  }
  const preview = await previewMarket(tx, ctx, command);
  if (!preview.valid) throw new HttpError(409, 'MARKET_UNAVAILABLE', preview.message!);
  if (command.expectedReceivedAmount !== preview.receivedAmount)
    throw new HttpError(409, 'MARKET_QUOTE_CHANGED', 'Le devis a changé. Vérifiez la quantité reçue.');
  await tx.updateTable('villageResources').set({ amount: sql`amount - ${command.amount}` })
    .where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId).where('resourceCode', '=', command.offeredResource)
    .executeTakeFirstOrThrow();
  const completesAt = new Date(ctx.through.getTime() + MARKET_DELIVERY_MS);
  const exchange = await tx.insertInto('marketExchanges').values({ worldId: ctx.worldId, villageId: ctx.villageId,
    commandId: command.commandId, request: JSON.stringify(command), offeredResource: command.offeredResource,
    requestedResource: command.requestedResource, offeredAmount: command.amount, receivedAmount: preview.receivedAmount,
    startedAt: ctx.through, completesAt, completedAt: null }).returning('id').executeTakeFirstOrThrow();
  await tx.insertInto('scheduledTasks').values({ worldId: ctx.worldId, taskType: COMPLETE_MARKET_TASK, subjectId: exchange.id,
    payload: {}, dueAt: completesAt, availableAt: completesAt, completedAt: null, lastError: null }).execute();
}
export async function deliverMarketAt(tx: Transaction<Database>, ctx: Context, id: string, at: Date) {
  const exchange = await tx.selectFrom('marketExchanges').selectAll().where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('id', '=', id).where('completedAt', 'is', null).executeTakeFirst();
  if (!exchange || exchange.completesAt.getTime() !== at.getTime() || at > ctx.through) return;
  await stockAt(tx, ctx, exchange.requestedResource, at);
  await tx.insertInto('villageResources').values({ worldId: ctx.worldId, villageId: ctx.villageId,
    resourceCode: exchange.requestedResource, amount: exchange.receivedAmount })
    .onConflict(conflict => conflict.columns(['worldId', 'villageId', 'resourceCode'])
      .doUpdateSet({ amount: sql`village_resources.amount + ${exchange.receivedAmount}` })).execute();
  await tx.updateTable('marketExchanges').set({ completedAt: at }).where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('id', '=', id).execute();
}
export async function marketSnapshot(tx: Transaction<Database>, ctx: Context): Promise<MarketState> {
  const [resources, active, recent, enabled] = await Promise.all([
    prices(tx),
    tx.selectFrom('marketExchanges').selectAll().where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId)
      .where('completedAt', 'is', null).orderBy('startedAt', 'desc').orderBy('id').execute(),
    tx.selectFrom('marketExchanges').selectAll().where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId)
      .where('completedAt', 'is not', null).orderBy('startedAt', 'desc').orderBy('id').limit(20).execute(),
    unlocked(tx, ctx),
  ]);
  return { unlocked: enabled, deliveryMs: MARKET_DELIVERY_MS, commissionPercent: 30, resources,
    exchanges: [...active, ...recent].map(e => ({ id: e.id, offeredResource: e.offeredResource,
      requestedResource: e.requestedResource, offeredAmount: Number(e.offeredAmount), receivedAmount: Number(e.receivedAmount),
      startedAt: e.startedAt.toISOString(), completesAt: e.completesAt.toISOString(), completedAt: e.completedAt?.toISOString() ?? null })) };
}
