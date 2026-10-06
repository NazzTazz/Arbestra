import { isDeepStrictEqual } from 'node:util';
import { sql, type Selectable, type Transaction } from 'kysely';
import type { ProcessingCommand, ProcessingOrder, ProcessingPreview } from '@arbestra/contracts';
import type { Database, ProcessingOrdersTable } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { assignWorkers, eligibleWorkers, materializeCohorts, releaseWorkers } from '../population/work.js';
import { materializeVillageResource } from './economy.js';

export const COMPLETE_PROCESSING_TASK = 'processing.complete';
const terminal = ['completed', 'cancelled'] as const;
type Order = Selectable<ProcessingOrdersTable>;
type Context = { worldId: string; villageId: string; through: Date };

async function workshop(tx: Transaction<Database>, ctx: Context, buildingId: string) {
  const row = await tx.selectFrom('buildings').innerJoin('processingRecipes', join => join
    .onRef('processingRecipes.buildingTypeCode', '=', 'buildings.buildingType').onRef('processingRecipes.level', '=', 'buildings.level'))
    .select(['processingRecipes.inputResource', 'processingRecipes.inputAmount', 'processingRecipes.outputResource',
      'processingRecipes.outputAmount', 'processingRecipes.workMs', 'processingRecipes.workerCap', 'processingRecipes.version', 'buildings.status'])
    .where('buildings.worldId', '=', ctx.worldId).where('buildings.villageId', '=', ctx.villageId).where('buildings.id', '=', buildingId).executeTakeFirst();
  if (!row) throw new HttpError(404, 'WORKSHOP_NOT_FOUND', 'Atelier introuvable.');
  if (row.status !== 'completed') throw new HttpError(409, 'BUILDING_BUSY', 'L’atelier est encore en chantier.');
  return row;
}

async function readiness(tx: Transaction<Database>, ctx: Context, buildingId: string, workerCount: number, preferredIds?: string[]) {
  const recipe = await workshop(tx, ctx, buildingId);
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > recipe.workerCap)
    throw new HttpError(409, 'WORKER_CAP', `Cet atelier dispose de ${recipe.workerCap} poste(s).`);
  const durationMs = Math.ceil(recipe.workMs / workerCount);
  const input = await materializeVillageResource(tx, ctx.worldId, ctx.villageId, recipe.inputResource, ctx.through);
  const cohorts = await materializeCohorts(tx, ctx.worldId, ctx.villageId, ctx.through);
  const workers = eligibleWorkers(cohorts, durationMs).filter(c => !preferredIds || preferredIds.includes(c.id));
  const reason = input < recipe.inputAmount ? 'missing-input' as const
    : workers.reduce((n, c) => n + c.memberCount, 0) < workerCount ? 'missing-workers' as const : null;
  return { recipe, workers, durationMs, reason };
}

export async function previewProcessing(tx: Transaction<Database>, ctx: Context, buildingId: string, workerCount: number, orderId?: string): Promise<ProcessingPreview> {
  const ready = await readiness(tx, ctx, buildingId, workerCount);
  const existing = await tx.selectFrom('processingOrders').select(['id','status']).where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('buildingId', '=', buildingId).where('status', 'not in', terminal).executeTakeFirst();
  const busy = existing && (existing.id !== orderId || !['paused','blocked'].includes(existing.status));
  if (orderId && existing?.id !== orderId) throw new HttpError(404,'ORDER_NOT_FOUND','Ordre introuvable dans cet atelier.');
  return { valid: !busy && !ready.reason,
    message: busy ? 'Un ordre est déjà ouvert dans cet atelier.' : ready.reason === 'missing-input' ? 'Matière brute insuffisante.'
      : ready.reason === 'missing-workers' ? 'Habitants disponibles et aptes insuffisants.' : null,
    durationMs: ready.durationMs, inputAmount: ready.recipe.inputAmount, outputAmount: ready.recipe.outputAmount };
}

async function startLot(tx: Transaction<Database>, ctx: Context, order: Order, sameTeam = false) {
  const ready = await readiness(tx, ctx, order.buildingId, order.workerCount, sameTeam ? order.workerIds : undefined);
  if (ready.reason) {
    await tx.updateTable('processingOrders').set({ status: 'blocked', blockedReason: ready.reason })
      .where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId).where('id', '=', order.id).execute();
    return false;
  }
  const recipe = ready.recipe;
  await tx.updateTable('villageResources').set({ amount: sql`amount - ${recipe.inputAmount}` })
    .where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId).where('resourceCode', '=', recipe.inputResource).executeTakeFirstOrThrow();
  const completesAt = new Date(ctx.through.getTime() + ready.durationMs);
  const lot = await tx.insertInto('processingLots').values({ worldId: ctx.worldId, villageId: ctx.villageId, orderId: order.id,
    lotNumber: order.completedLots + 1, recipeVersion: recipe.version, inputResource: recipe.inputResource, inputAmount: recipe.inputAmount,
    outputResource: recipe.outputResource, outputAmount: recipe.outputAmount, workerCount: order.workerCount,
    startedAt: ctx.through, completesAt, completedAt: null }).returning('id').executeTakeFirstOrThrow();
  await assignWorkers(tx, ready.workers, order.workerCount, { harvestId: null, extractionId: null, scienceActivityId: null, processingLotId: lot.id });
  const team = await tx.selectFrom('populationCohorts').select('id').where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('processingLotId', '=', lot.id).orderBy('id').execute();
  await tx.updateTable('processingOrders').set({ status: 'running', blockedReason: null, workerIds: JSON.stringify(team.map(c => c.id)) })
    .where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId).where('id', '=', order.id).execute();
  await tx.insertInto('scheduledTasks').values({ worldId: ctx.worldId, taskType: COMPLETE_PROCESSING_TASK, subjectId: lot.id,
    payload: {}, dueAt: completesAt, availableAt: completesAt, lastError: null, completedAt: null }).execute();
  return true;
}

/** Caller holds the village lock; only new notifications are written here. */
export async function commandProcessing(tx: Transaction<Database>, ctx: Context, command: ProcessingCommand) {
  const receipt = await tx.selectFrom('processingCommandReceipts').select('request').where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('commandId', '=', command.commandId).executeTakeFirst();
  if (receipt) {
    if (!isDeepStrictEqual(receipt.request, command)) throw new HttpError(409, 'COMMAND_REUSED', 'Identifiant de commande déjà utilisé.');
    return;
  }
  if (command.action === 'start') {
    if (!Number.isInteger(command.lots) || command.lots < 1 || command.lots > 20)
      throw new HttpError(400, 'INVALID_LOTS', 'Choisissez entre 1 et 20 lots.');
    const preview = await previewProcessing(tx, ctx, command.buildingId, command.workerCount);
    if (!preview.valid) throw new HttpError(409, 'PROCESSING_UNAVAILABLE', preview.message!);
    const order = await tx.insertInto('processingOrders').values({ worldId: ctx.worldId, villageId: ctx.villageId,
      buildingId: command.buildingId, status: 'running', blockedReason: null, requestedLots: command.lots,
      workerCount: command.workerCount, workerIds: '[]', createdAt: ctx.through, finishedAt: null }).returningAll().executeTakeFirstOrThrow();
    if (!await startLot(tx, ctx, order)) throw new Error('Processing admission changed under village lock');
  } else {
    const order = await tx.selectFrom('processingOrders').selectAll().where('worldId', '=', ctx.worldId)
      .where('villageId', '=', ctx.villageId).where('id', '=', command.orderId).executeTakeFirst();
    if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Ordre introuvable.');
    if (order.status === 'completed' || order.status === 'cancelled') throw new HttpError(409, 'ORDER_FINISHED', 'Cet ordre est terminé.');
    const running = ['running','pause-requested','cancel-requested'].includes(order.status);
    if (command.action === 'resume') {
      if (running) throw new HttpError(409, 'ORDER_BUSY', 'Le lot en cours doit se terminer.');
      // Validate the cap before persisting the new request, even if the stock is empty.
      await workshop(tx, ctx, order.buildingId);
      order.workerCount = command.workerCount;
      await readiness(tx, ctx, order.buildingId, order.workerCount);
      await tx.updateTable('processingOrders').set({ workerCount: order.workerCount }).where('worldId', '=', ctx.worldId)
        .where('villageId', '=', ctx.villageId).where('id', '=', order.id).execute();
      await startLot(tx, ctx, order);
    } else {
      if (order.status === 'cancel-requested' && command.action === 'pause')
        throw new HttpError(409, 'CANCEL_PENDING', 'L’annulation après ce lot est déjà demandée.');
      const status = command.action === 'cancel' ? (running ? 'cancel-requested' : 'cancelled') : (running ? 'pause-requested' : 'paused');
      await tx.updateTable('processingOrders').set({ status, blockedReason: null, finishedAt: status === 'cancelled' ? ctx.through : null })
        .where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId).where('id', '=', order.id).execute();
    }
  }
  await tx.insertInto('processingCommandReceipts').values({ worldId: ctx.worldId, villageId: ctx.villageId,
    commandId: command.commandId, request: JSON.stringify(command) }).execute();
}

export async function completeProcessingAt(tx: Transaction<Database>, ctx: Context, lotId: string, at: Date) {
  const lot = await tx.selectFrom('processingLots').selectAll().where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('id', '=', lotId).where('completedAt', 'is', null).executeTakeFirst();
  if (!lot || lot.completesAt.getTime() !== at.getTime() || at > ctx.through) return;
  const order = await tx.selectFrom('processingOrders').selectAll().where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('id', '=', lot.orderId).executeTakeFirstOrThrow();
  const cohorts = await materializeCohorts(tx, ctx.worldId, ctx.villageId, at);
  const workers = cohorts.filter(c => c.processingLotId === lot.id);
  await releaseWorkers(tx, workers, lot.workerCount, at);
  await tx.updateTable('villageResources').set({ amount: sql`amount + ${lot.outputAmount}` }).where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('resourceCode', '=', lot.outputResource).executeTakeFirstOrThrow();
  await tx.updateTable('processingLots').set({ completedAt: at }).where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('id', '=', lot.id).execute();
  order.completedLots++;
  const status = order.completedLots === order.requestedLots ? 'completed' : order.status === 'cancel-requested' ? 'cancelled'
    : order.status === 'pause-requested' ? 'paused' : 'running';
  await tx.updateTable('processingOrders').set({ completedLots: order.completedLots, status,
    finishedAt: status === 'completed' || status === 'cancelled' ? at : null }).where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('id', '=', order.id).execute();
  if (status === 'running') await startLot(tx, { ...ctx, through: at }, order, true);
}

export async function processingSnapshot(tx: Transaction<Database>, ctx: Context): Promise<ProcessingOrder[]> {
  const [open,recent] = await Promise.all([
    tx.selectFrom('processingOrders').selectAll().where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId)
      .where('status','not in',terminal).execute(),
    tx.selectFrom('processingOrders').selectAll().where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId)
      .where('status','in',terminal).orderBy('createdAt','desc').limit(20).execute(),
  ]);
  const orders=[...open,...recent].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||a.id.localeCompare(b.id));
  const lots = await tx.selectFrom('processingLots').selectAll().where('worldId', '=', ctx.worldId)
    .where('villageId', '=', ctx.villageId).where('completedAt', 'is', null).execute();
  return orders.map(order => {
    const lot = lots.find(l => l.orderId === order.id);
    return { id: order.id, buildingId: order.buildingId, status: order.status, blockedReason: order.blockedReason,
      requestedLots: order.requestedLots, completedLots: order.completedLots, workerCount: order.workerCount,
      createdAt: order.createdAt.toISOString(), finishedAt: order.finishedAt?.toISOString() ?? null,
      currentLot: lot ? { id: lot.id, inputResource: lot.inputResource, inputAmount: lot.inputAmount,
        outputResource: lot.outputResource, outputAmount: lot.outputAmount, startedAt: lot.startedAt.toISOString(), completesAt: lot.completesAt.toISOString() } : null };
  });
}
