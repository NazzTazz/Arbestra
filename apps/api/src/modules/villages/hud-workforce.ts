import { spatialTransaction } from '../worlds/spatial-locks.js';
import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { HudWorkforceIntent, HudWorkforceConfirmationV2, HudWorkforceResult } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { ownedVillage } from './service.js';
import { beginVillageEconomy, type VillageEconomy } from './reconcile-economy.js';
import { changeExtractionPool, wakeExtractionPool } from '../deposits/extraction-pools.js';
import { populationGesture } from '../population/gestures.js';
import { reconcileRestHousing } from '../population/work.js';
import { publishPrivateEffects } from './sync-v2-effects.js';

export const conflict = () =>
  new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette commande a déjà été utilisée différemment.');

export function findReceipt(db: Kysely<Database>, worldId: string, villageId: string, commandId: string) {
  return db
    .selectFrom('hudWorkforceReceipts')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .where('commandId', '=', commandId)
    .executeTakeFirst();
}

/**
 * The gesture and its receipt, inside the command's economy transaction. An
 * identifier committed meanwhile by a concurrent first attempt applies nothing
 * and returns its receipt.
 */
export async function applyIntent(
  tx: Transaction<Database>,
  ctx: VillageEconomy,
  request: HudWorkforceIntent,
): Promise<HudWorkforceResult> {
  const previous = await findReceipt(tx, ctx.worldId, ctx.villageId, request.command.commandId);
  let result = { affected: 0, carrots: 0 };
  if (previous) {
    if (!isDeepStrictEqual(previous.request, request)) throw conflict();
    result = { affected: previous.affected, carrots: previous.carrots };
  } else {
    if (request.kind === 'pool') await changeExtractionPool(tx, ctx, request.command);
    else result = await populationGesture(tx, ctx, request.command);
    await tx
      .insertInto('hudWorkforceReceipts')
      .values({
        worldId: ctx.worldId,
        villageId: ctx.villageId,
        commandId: request.command.commandId,
        request: JSON.stringify(request),
        ...result,
      })
      .execute();
    if (request.kind === 'population' && request.command.action === 'feed' && request.command.group === 'idle') {
      await wakeExtractionPool(tx, ctx, 'wood');
      await wakeExtractionPool(tx, ctx, 'stone');
    }
  }
  // beginVillageEconomy already reconciled due work at H. Settings have a
  // durable wake; new route-dependent departures belong to that worker cycle,
  // not to the acknowledgement of the player's gesture.
  await reconcileRestHousing(tx, ctx.worldId, ctx.villageId, ctx.through);
  return result;
}

/**
 * V2 contract: the result and the private effects of the commit, read at H in
 * the same transaction (cohorts, resources, pools, worksites). No scoped state
 * and no COUNT revision: the client orders what it shows by the stream. An exact
 * replay answers from the receipt without lock, reconciliation or effects.
 */
export async function commandHudWorkforceV2(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  request: HudWorkforceIntent,
  generation: number,
): Promise<HudWorkforceConfirmationV2> {
  if (!Number.isSafeInteger(generation) || generation < 0) throw Error('Invalid synchronization generation');
  const { commandId } = request.command;
  const owner = await ownedVillage(db, accountId, slug, villageId);
  const known = await findReceipt(db, owner.worldId, villageId, commandId);
  if (known) {
    if (!isDeepStrictEqual(known.request, request)) throw conflict();
    // The receipt keeps no date: the replay carries the instant it answers.
    const { at } = await db.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow();
    return {
      protocol: 2,
      worldId: owner.worldId,
      villageId,
      commandId,
      status: 'applied',
      commandTime: at.toISOString(),
      result: { affected: known.affected, carrots: known.carrots },
    };
  }
  return spatialTransaction(db, async (tx) => {
    const village = await ownedVillage(tx, accountId, slug, villageId);
    const ctx = await beginVillageEconomy(tx, village.worldId, villageId);
    const result = await applyIntent(tx, ctx, request);
    // Terminal step: no business write after the publication.
    const effects = await publishPrivateEffects(tx, ctx, generation);
    return {
      protocol: 2 as const,
      worldId: ctx.worldId,
      villageId,
      commandId,
      status: 'applied' as const,
      commandTime: ctx.through.toISOString(),
      result,
      ...(effects ? { effects } : {}),
    };
  });
}
