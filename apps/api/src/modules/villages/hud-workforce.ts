import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import type {
  HudWorkforceIntent,
  HudWorkforceConfirmation,
  HudWorkforceConfirmationV2,
  HudWorkforceResult,
  HudWorkforceState,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { ownedVillage, withVillageProjection } from './service.js';
import { beginVillageEconomy, type VillageEconomy } from './reconcile-economy.js';
import { changeExtractionPool, readExtractionPools, wakeExtractionPool } from '../deposits/extraction-pools.js';
import { populationGesture } from '../population/gestures.js';
import { advanceEnergy } from '../population/energy.js';
import { energyState, withoutAssignment, reconcileRestHousing } from '../population/work.js';
import { projectVillageResources } from './economy.js';
import { villageSyncRevision } from './sync-revision.js';
import { publishPrivateEffects } from './sync-v2-effects.js';

/** Scoped snapshot at the command bound. No geography, catalogue or display navigation. */
async function hudState(tx: Transaction<Database>, ctx: VillageEconomy): Promise<HudWorkforceState> {
  const [cohorts, resources, extractionPools, sites] = await Promise.all([
    tx
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', ctx.worldId)
      .where('villageId', '=', ctx.villageId)
      .execute(),
    projectVillageResources(tx, ctx.worldId, ctx.villageId, ctx.through),
    readExtractionPools(tx, ctx.worldId, ctx.villageId),
    tx
      .selectFrom('extractionWorksites')
      .select('poolResource')
      .where('worldId', '=', ctx.worldId)
      .where('villageId', '=', ctx.villageId)
      .where('status', 'in', ['running', 'paused', 'stopping'])
      .execute(),
  ]);
  const population = { available: 0, working: 0, resting: 0, pendingRelease: { idle: 0, resting: 0 } };
  for (const cohort of cohorts) {
    const energy = advanceEnergy(energyState(cohort), ctx.through);
    if (energy.activity === 'idle' && withoutAssignment(cohort)) population.available += cohort.memberCount;
    if (energy.activity === 'working') population.working += cohort.memberCount;
    if (energy.activity === 'resting') population.resting += cohort.memberCount;
    if (cohort.pendingRelease) population.pendingRelease[cohort.pendingRelease] += cohort.memberCount;
  }
  const openWorksites = { wood: 0, stone: 0, other: 0 };
  for (const site of sites) openWorksites[site.poolResource ?? 'other']++;
  return {
    worldId: ctx.worldId,
    villageId: ctx.villageId,
    serverTime: ctx.through.toISOString(),
    minimumRevision: (await villageSyncRevision(tx, ctx.worldId)).revision,
    population,
    carrots: resources.find((r) => r.code === 'carrot')?.amount ?? 0,
    extractionPools,
    openWorksites,
  };
}

const conflict = () => new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette commande a déjà été utilisée différemment.');

function findReceipt(db: Kysely<Database>, worldId: string, villageId: string, commandId: string) {
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
async function applyIntent(
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

/** Historical contract (no V2 protocol header): the result with a scoped state
 * fenced by the world's COUNT revision. Remains while the client can run
 * without V2; the V2 path is `commandHudWorkforceV2`. */
export async function commandHudWorkforce(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  request: HudWorkforceIntent,
): Promise<HudWorkforceConfirmation> {
  const owner = await ownedVillage(db, accountId, slug, villageId);
  const known = await findReceipt(db, owner.worldId, villageId, request.command.commandId);
  if (known) {
    if (!isDeepStrictEqual(known.request, request)) throw conflict();
    // Lost HTTP responses must not repeat reconciliation, admissions or the display projection.
    // Ownership is checked again inside this coherent read-only snapshot.
    const hud = await withVillageProjection(db, accountId, slug, villageId, (tx, ctx) => hudState(tx, ctx));
    return { commandId: request.command.commandId, affected: known.affected, carrots: known.carrots, hud };
  }
  const confirmed = await db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, slug, villageId);
    const ctx = await beginVillageEconomy(tx, village.worldId, villageId);
    const result = await applyIntent(tx, ctx, request);
    return { ...result, commandId: request.command.commandId, hud: await hudState(tx, ctx) };
  });
  // A projection can have started after H but before COMMIT. Its timestamp alone
  // cannot authorize replacing these confirmed counters.
  confirmed.hud.minimumRevision = (await villageSyncRevision(db, owner.worldId)).revision;
  return confirmed;
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
  return db.transaction().execute(async (tx) => {
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
