import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import { ROUTE_POLICY_VERSION, marketWorkers, travelDuration, type TradeCommand, type TradePreview, type TravelCell, type RouteResult } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { ownedVillage, state } from './service.js';
import { beginVillageEconomy } from './reconcile-economy.js';
import { navigationRevision, loadNavigationContext } from '../navigation/context.js';
import {certificateValid, hallRouteKey, navigationVersions, publishHallRoute, readChunkMeshes, readCrossings, readHallRoute, routeDependencies, touchHallRoute, type NavigationVersions, type RouteCertificate} from '../navigation/route-cache.js';
import type { NavigationExecutor } from '../navigation/compute.js';
import {SharedCalculation} from '../navigation/shared-calculation.js';
import { assignWorkers, eligibleWorkers, materializeCohorts } from '../population/work.js';
import { assertMarket, cancelTrade, directOracle, publishTrade, readTradeOffers, tradeDebit, tradeWake, type TradeContext } from './trade-economy.js';

type PreparedTrade = { worldId: string; villageId: string; destinationVillageId: string; revision: string; path: TravelCell[]; travelMs: number; certificate?: RouteCertificate };
type Calculation={result:RouteResult;revision:string;certificate:RouteCertificate|undefined};
const calculations=new WeakMap<Kysely<Database>,WeakMap<NavigationExecutor,SharedCalculation<Calculation>>>();
function sharedCalculation(db:Kysely<Database>,compute:NavigationExecutor){
  let executors=calculations.get(db);if(!executors){executors=new WeakMap();calculations.set(db,executors);}
  let shared=executors.get(compute);if(!shared){shared=new SharedCalculation<Calculation>();executors.set(compute,shared);}return shared;
}
export async function prepareTrade(db: Kysely<Database>, accountId: string, slug: string, villageId: string, offerId: string, compute: NavigationExecutor): Promise<PreparedTrade> {
  villageId=villageId.toLowerCase();
  const { village, offer } = await db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, slug, villageId);
    const offer = await tx.selectFrom('tradeOffers').selectAll().where('worldId', '=', village.worldId).where('id', '=', offerId).executeTakeFirst();
    if (!offer || offer.status !== 'open') throw new HttpError(409, 'TRADE_CLOSED', 'Cette annonce n’est plus disponible.');
    if (offer.villageId === villageId) throw new HttpError(409, 'TRADE_SELF', 'Vous ne pouvez pas accepter votre propre annonce.');
    return { village, offer };
  });
  const halls = await db.selectFrom('buildings').select(['id', 'villageId']).where('worldId', '=', village.worldId)
    .where('villageId', 'in', [villageId, offer.villageId]).where('buildingType', '=', 'town-hall').execute();
  const persistent = process.env.NAVIGATION_HIERARCHICAL !== '0';
  const key = hallRouteKey(halls.find(h=>h.villageId===villageId)?.id??villageId,halls.find(h=>h.villageId===offer.villageId)?.id??offer.villageId);
  let previousPath:TravelCell[]|undefined;
  if(persistent){
    const {cached,valid}=await db.transaction().setIsolationLevel('repeatable read').execute(async tx=>{
      const manifest=await navigationVersions(tx,village.worldId),cached=await readHallRoute(tx,manifest,key,db,true);
      return{cached,valid:cached?certificateValid(manifest,cached.certificate):false};
    });
    if(cached){
      await touchHallRoute(db,village.worldId,key);
      const travelMs=Math.max(1,travelDuration(cached.path,village));
      if(valid&&travelMs<=offer.maxTravelSeconds*1000)return{worldId:village.worldId,villageId,destinationVillageId:offer.villageId,revision:'',path:cached.path,travelMs,certificate:cached.certificate};
      if(travelMs<=offer.maxTravelSeconds*1000)previousPath=cached.path;
    }
  }
  const began=performance.now();
  const calculate=(shortest=false,maxDurationMs=30000)=>sharedCalculation(db,compute).run(village.worldId+':'+key+':'+persistent+':'+shortest,async()=>{
   let revision = '';
   let manifest:NavigationVersions|undefined;
   const result = await compute.run(async known => {
    // Require an access manifest even when the CPU lane has a warm context.
    const context = await loadNavigationContext(db, village.worldId, known.sources, new Set(),persistent);
    revision = context.revision;
    manifest=context.manifest;
    const endpoints = (id: string) => context.data!.accesses.filter(a => a.buildingId === halls.find(h => h.villageId === id)?.id)
      .map(a => ({ kind: 'access' as const, accessId: a.id }));
    return { query: { worldId: village.worldId, contextId: context.contextId, policyVersion: ROUTE_POLICY_VERSION,
      movementProfileId: 'pedestrian-v1', traversalConstraintsId: 'none', coarseFirst: true, starts: endpoints(villageId), goals: endpoints(offer.villageId),
      ...(manifest&&!shortest?{hierarchy:{chunkSize:manifest.chunkSize,crossings:await readCrossings(db,manifest),meshes:await readChunkMeshes(db,manifest),...(previousPath?{previousPath}:{})}}:{}),preferShortest:shortest,
      limits: { maxNodes: 262144, maxDurationMs } }, data: context.data! };
   });
   const certificate=manifest&&result.kind==='found'?{namespace:manifest.namespace,dependencies:routeDependencies(manifest,result.path)}:undefined;
   if(manifest&&certificate&&result.kind==='found'&&!await publishHallRoute(db,manifest,key,{path:result.path,cost:result.cost,certificate},result.hierarchy?.crossings??[],result.hierarchy?.meshes??[]))
     throw new HttpError(409,'TRADE_ROUTE_CHANGED','Le terrain a changé. Vérifiez à nouveau le trajet.');
   return{result,revision,certificate};
  }).catch(error => {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'TRADE_PREPARATION_BUSY', 'La préparation du trajet est occupée. Réessayez.');
  });
  let {result,revision,certificate}=await calculate();
  if(result.kind==='found'&&travelDuration(result.path,village)>offer.maxTravelSeconds*1000){
    const remaining=30000-(performance.now()-began);
    if(remaining<=0)throw new HttpError(503,'TRADE_PREPARATION_BUSY','Le calcul du trajet est temporairement indisponible. Réessayez.');
    const improved=await calculate(true,remaining);
    if(improved.result.kind!=='found'||travelDuration(improved.result.path,village)<travelDuration(result.path,village))({result,revision,certificate}=improved);
  }
  if (result.kind === 'budget-exceeded' || result.kind === 'context-unavailable') throw new HttpError(503, 'TRADE_PREPARATION_BUSY', 'Le calcul du trajet est temporairement indisponible. Réessayez.');
  if (result.kind !== 'found' || !result.path.length) throw new HttpError(409, 'TRADE_ROUTE', 'Aucun trajet commercial praticable trouvé.');
  const travelMs = Math.max(1, travelDuration(result.path, village));
  if (travelMs > offer.maxTravelSeconds * 1000) throw new HttpError(409, 'TRADE_DISTANCE', 'Le trajet dépasse le maximum fixé par cette annonce.');
  return { worldId: village.worldId, villageId, destinationVillageId: offer.villageId, revision, path: result.path, travelMs, ...(certificate?{certificate}:{}) };
}

/** Both village rows are already owned in canonical order. All shared deposits
 * for the pair are prelocked by the first begin, before either reconciliation. */
export async function beginTradePair(tx: Transaction<Database>, worldId: string, ids: string[]) {
  const sorted = [...new Set(ids.map(id => id.toLowerCase()))].sort();
  for (const id of sorted) await tx.selectFrom('villages').select('id').where('worldId', '=', worldId).where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
  await sql`select pg_advisory_xact_lock_shared(hashtextextended(${'infrastructure:' + worldId},0))`.execute(tx);
  const through = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow()).at;
  for (const id of sorted) await beginVillageEconomy(tx, worldId, id, undefined, [], [], false, sorted, through);
  return through;
}

export async function acceptTrade(tx: Transaction<Database>, ctx: TradeContext, offerId: string, prepared: PreparedTrade) {
  await assertMarket(tx, ctx);
  const offer = await tx.selectFrom('tradeOffers').selectAll().where('worldId', '=', ctx.worldId).where('id', '=', offerId).executeTakeFirst();
  if (!offer || offer.status !== 'open') throw new HttpError(409, 'TRADE_CLOSED', 'Cette annonce a déjà été acceptée ou annulée.');
  if (offer.villageId !== prepared.destinationVillageId || prepared.worldId !== ctx.worldId || prepared.villageId !== ctx.villageId || offer.villageId === ctx.villageId)
    throw new HttpError(409, 'TRADE_CHANGED', 'L’annonce a changé.');
  if (prepared.certificate?!certificateValid(await navigationVersions(tx,ctx.worldId),prepared.certificate):await navigationRevision(tx, ctx.worldId) !== prepared.revision) throw new HttpError(409, 'TRADE_ROUTE_CHANGED', 'Le terrain a changé. Vérifiez à nouveau le trajet.');
  if (prepared.travelMs > offer.maxTravelSeconds * 1000) throw new HttpError(409, 'TRADE_DISTANCE', 'Trajet trop long.');
  const workerCount = marketWorkers(offer.requestedAmount, offer.offeredAmount);
  const cohorts = eligibleWorkers(await materializeCohorts(tx, ctx.worldId, ctx.villageId, ctx.through), prepared.travelMs * 2);
  if (cohorts.reduce((n, c) => n + c.memberCount, 0) < workerCount) throw new HttpError(409, 'TRADE_WORKERS', `${workerCount} habitants disponibles et reposés sont nécessaires pour l’aller-retour.`);
  await tradeDebit(tx, ctx, offer.requestedResource, offer.requestedAmount);
  const arrivesAt = new Date(ctx.through.getTime() + prepared.travelMs), returnsAt = new Date(ctx.through.getTime() + prepared.travelMs * 2);
  const journey = await tx.insertInto('tradeJourneys').values({ worldId: ctx.worldId, villageId: ctx.villageId,
    destinationVillageId: offer.villageId, offerId, workerCount, path: JSON.stringify(prepared.path), startedAt: ctx.through, arrivesAt, returnsAt }).returning('id').executeTakeFirstOrThrow();
  await assignWorkers(tx, cohorts, workerCount, { harvestId: null, extractionId: null, scienceActivityId: null, processingLotId: null, tradeJourneyId: journey.id });
  await tx.updateTable('tradeOffers').set({ status: 'accepted' }).where('worldId', '=', ctx.worldId).where('id', '=', offerId).execute();
  for (const delivery of [
    { villageId: offer.villageId, resourceCode: offer.requestedResource, amount: offer.requestedAmount, dueAt: arrivesAt, releaseWorkers: false },
    { villageId: ctx.villageId, resourceCode: offer.offeredResource, amount: offer.offeredAmount, dueAt: returnsAt, releaseWorkers: true },
  ]) {
    const row = await tx.insertInto('tradeDeliveries').values({ ...delivery, worldId: ctx.worldId, journeyId: journey.id, completedAt: null }).returning('id').executeTakeFirstOrThrow();
    await tradeWake(tx, { ...ctx, villageId: delivery.villageId }, row.id, delivery.dueAt, 'delivery');
  }
}

export async function commandPlayerMarket(db: Kysely<Database>, accountId: string, slug: string, villageId: string, command: TradeCommand, compute?: NavigationExecutor) {
  villageId=villageId.toLowerCase();
  // Retry receipts are checked before route preparation; a completed exchange
  // can be recovered even if its announcement is no longer open.
  const previous = await db.transaction().execute(async tx => {
    const v = await ownedVillage(tx, accountId, slug, villageId);
    const receipt = await tx.selectFrom('tradeReceipts').select('request').where('worldId', '=', v.worldId).where('villageId', '=', villageId).where('commandId', '=', command.commandId).executeTakeFirst();
    if (receipt && !isDeepStrictEqual(receipt.request, command)) throw new HttpError(409, 'COMMAND_REUSED', 'Identifiant utilisé pour une autre commande.');
    return receipt;
  });
  let prepared: PreparedTrade | undefined;
  if (command.action === 'accept' && !previous) {
    if (!compute) throw new HttpError(503, 'NAVIGATION_UNAVAILABLE', 'Calcul du trajet indisponible.');
    prepared = await prepareTrade(db, accountId, slug, villageId, command.offerId, compute);
  }
  return db.transaction().execute(async tx => {
    const village = await ownedVillage(tx, accountId, slug, villageId);
    const through = await beginTradePair(tx, village.worldId, [villageId, ...(prepared ? [prepared.destinationVillageId] : [])]);
    const current = await ownedVillage(tx, accountId, slug, villageId);
    if (current.worldId !== village.worldId) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    const ctx = { worldId: village.worldId, villageId, through };
    const receipt = await tx.selectFrom('tradeReceipts').select('request').where('worldId', '=', ctx.worldId).where('villageId', '=', villageId).where('commandId', '=', command.commandId).executeTakeFirst();
    if (receipt) {
      if (!isDeepStrictEqual(receipt.request, command)) throw new HttpError(409, 'COMMAND_REUSED', 'Identifiant utilisé pour une autre commande.');
    } else {
      if (command.action === 'publish') await publishTrade(tx, ctx, command);
      else if (command.action === 'cancel') await cancelTrade(tx, ctx, command.offerId);
      else if (command.action === 'oracle') await directOracle(tx, ctx, command);
      else if (prepared) await acceptTrade(tx, ctx, command.offerId, prepared);
      else throw new HttpError(409, 'TRADE_CHANGED', 'Vérifiez de nouveau cette annonce.');
      await tx.insertInto('tradeReceipts').values({ worldId: ctx.worldId, villageId, commandId: command.commandId, request: JSON.stringify(command) }).execute();
    }
    return state(tx, accountId, slug, ctx);
  });
}
export async function browsePlayerMarket(db: Kysely<Database>, accountId: string, slug: string, villageId: string, mine: boolean, cursor?: string) {
  villageId=villageId.toLowerCase();
  return db.transaction().execute(async tx => {
    const v = await ownedVillage(tx, accountId, slug, villageId);
    const ctx = await beginVillageEconomy(tx, v.worldId, villageId);
    await assertMarket(tx, ctx);
    return readTradeOffers(tx, ctx, mine, cursor);
  });
}
export async function previewPlayerTrade(db: Kysely<Database>, accountId: string, slug: string, villageId: string, offerId: string, compute: NavigationExecutor): Promise<TradePreview> {
  villageId=villageId.toLowerCase();
  const prepared = await prepareTrade(db, accountId, slug, villageId, offerId, compute);
  return db.transaction().execute(async tx => {
    const v = await ownedVillage(tx, accountId, slug, villageId);
    const ctx = await beginVillageEconomy(tx, v.worldId, villageId);
    await assertMarket(tx, ctx);
    const offer = await tx.selectFrom('tradeOffers').selectAll().where('worldId', '=', v.worldId).where('id', '=', offerId).where('status', '=', 'open').executeTakeFirst();
    if (!offer) throw new HttpError(409, 'TRADE_CLOSED', 'Cette annonce n’est plus disponible.');
    const cohorts = eligibleWorkers(await materializeCohorts(tx, v.worldId, villageId, ctx.through), prepared.travelMs * 2);
    return { travelMs: prepared.travelMs, workerCount: marketWorkers(offer.requestedAmount, offer.offeredAmount), availableWorkers: cohorts.reduce((n, c) => n + c.memberCount, 0) };
  });
}
