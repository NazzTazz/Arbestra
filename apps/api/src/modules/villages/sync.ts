import {readExpeditionReceipts} from '../science/expeditions.js';
import type {ExpeditionWakeups} from '../science/expedition-wakeups.js';
import { sql, type Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { villageFrame, type VillageState } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { AppConfig } from '../../config.js';
import { authenticate } from '../auth/service.js';
import { reconcileVillageForRead, ownedVillage, readVillageProjection } from './service.js';
export { readVillageProjection } from './service.js';
import { VillageSyncProjections } from './sync-projections.js';
import { villageSyncRevision } from './sync-revision.js';
import { HttpError } from '../../errors.js';
import { advanceEnergy } from '../population/energy.js';
import { energyState } from '../population/work.js';
import { markHttpStream, operationsFor } from '../operations/telemetry.js';
import type {TravelNetworkExecutor} from '../navigation/network-job.js';

export const VILLAGE_SYNC_CHECK_MS = 2_000;

export function villageTransitionDue(snapshot: VillageState, at: Date) {
  const dates = [
    ...snapshot.cells.flatMap(c => [c.building?.status==='under-construction'?c.building.constructionCompletesAt:null,
      c.building?.garden?.harvest?.completesAt,...(c.building?.garden?.plots.map(p=>p.harvest?.completesAt)??[]),
      ...(c.building?.garden?.expansions?.map(e=>e.completesAt)??[])]),
    ...snapshot.village.extractions.filter(e=>e.status==='in-progress').map(e=>e.completesAt),
    ...snapshot.village.worksites.filter(w=>w.status==='running').map(w=>w.nextWakeAt),
    ...(snapshot.village.processingOrders?.map(o=>o.currentLot?.completesAt)??[]),
    ...(snapshot.village.market?.exchanges.filter(e=>!e.completedAt).map(e=>e.completesAt)??[]),
    ...(snapshot.village.market?.offers?.filter(o=>o.status==='open'&&o.oracleEligible).map(o=>o.oracleAt)??[]),
    ...(snapshot.village.market?.journeys?.flatMap(j=>[
      ...(j.destinationVillageId===snapshot.village.id&&Date.parse(j.arrivesAt)>Date.parse(snapshot.serverTime)?[j.arrivesAt]:[]),
      ...(j.villageId===snapshot.village.id?[j.returnsAt]:[]),
    ])??[]),
    ...(snapshot.village.exploitationOrders?.filter(o=>o.status!=='completed').map(o=>o.deadline)??[]),
    ...(snapshot.science?.activities.map(a=>a.completesAt)??[]),
  ];
  return dates.some(date=>date && Date.parse(date)<=at.getTime());
}

/** Preserve the lazy economy reconciliation previously woken by HTTP polling.
 * Idle ticks read only cursors; actual due transitions use the existing lock/bound. */
export async function reconcileSyncDeadline(db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string, snapshot: VillageState) {
  const at=(await db.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow()).at;
  const cohorts=await db.selectFrom('populationCohorts').selectAll().where('worldId','=',snapshot.world.id).where('villageId','=',villageId).execute();
  if (!villageTransitionDue(snapshot,at) && !cohorts.some(c=>advanceEnergy(energyState(c),at).activity!==c.activity)) return;
  await reconcileVillageForRead(db,accountId,worldSlug,villageId);
}

export type VillageSyncEvent = { event: 'snapshot'; data: VillageState }
  | { event: 'frame'; data: ReturnType<typeof villageFrame> }
  | { event: 'revision'; data: { worldId: string; villageId: string; revision: number } };

/** Each tick is single-flight; the first read is also the snapshot/stream join.
 * Revision polling is deliberately independent of ephemeral publication. */
export class VillageSyncSession {
  #previous: VillageState | null = null;
  #flight: Promise<VillageSyncEvent> | null = null;
  constructor(private readonly read: () => Promise<VillageState>, private readonly revision: () => Promise<number>,
    private readonly reconcileDue?: (snapshot:VillageState)=>Promise<void>) {}
  check(): Promise<VillageSyncEvent> {
    return this.#flight ??= this.#check().finally(() => { this.#flight = null; });
  }
  async #check(): Promise<VillageSyncEvent> {
    const previous = this.#previous;
    if(previous)await this.reconcileDue?.(previous);
    if (previous && await this.revision() === previous.syncRevision) return { event: 'revision', data: {
      worldId: previous.world.id, villageId: previous.village.id, revision: previous.syncRevision!,
    } };
    const next = await this.read();
    if (next.syncRevision === undefined) throw Error('Unversioned synchronization snapshot');
    this.#previous = next;
    if (!previous || next.syncRevision <= previous.syncRevision!) return { event: 'snapshot', data: next };
    return { event: 'frame', data: villageFrame(previous, next) };
  }
}

export async function registerVillageSync(app: FastifyInstance, db: Kysely<Database>, config: AppConfig,compute:TravelNetworkExecutor,wakeups?:ExpeditionWakeups) {
  const projections = new VillageSyncProjections((accountId, worldSlug, villageId) => readVillageProjection(db, accountId, worldSlug, villageId,compute));
  // A command's commit can race another world commit after snapshot assembly.
  // Verify the revision after COMMIT, replacing only uncertain snapshots.
  app.addHook('preSerialization', async (request, _reply, payload: unknown) => {
    // Observation owns its read-only transport and independent admin session.
    if(request.routeOptions.url?.startsWith('/api/admin/observations')||request.routeOptions.url?.startsWith('/api/observation/'))return payload;
    if (!payload || typeof payload !== 'object') return payload;
    const wrapper = payload as { villageState?: VillageState }, candidate = wrapper.villageState ?? payload as VillageState;
    if (!candidate.world?.id || !candidate.village?.id || !Array.isArray(candidate.cells) || !candidate.serverTime) return payload;
    return devTime('sync', async () => {
    const current = await villageSyncRevision(db, candidate.world.id);
    const account = await authenticate(db, request.cookies[config.cookieName]);
    if (candidate.syncRevision === current.revision) { projections.remember(account.id, candidate); return payload; }
    const coherent = await projections.read(account.id, candidate.world.slug, candidate.village.id, current.revision);
    return wrapper.villageState ? { ...wrapper, villageState: coherent } : coherent;
    });
  });

  // Share only in-flight reads, never a stale dynamic snapshot or another owner's data.
  const streams = new Set<()=>void>();
  app.addHook('preClose',async()=>{for(const close of streams)close();});
  app.get('/api/worlds/:worldSlug/villages/:villageId/events', {
    schema: { params: Type.Object({ worldSlug: Type.String({ minLength: 1, maxLength: 64 }), villageId: Type.String({ format: 'uuid' }) }),
      querystring: Type.Object({ revision: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })) }) },
  }, async (request, reply) => {
    // A slow pool/authentication can outlive the browser's SSE watchdog. The
    // response close event may already have fired before we install its listener;
    // never create an orphan subscription after that point.
    const disconnected = () => reply.raw.destroyed || reply.raw.writableEnded;
    if (disconnected()) return;
    const account = await authenticate(db, request.cookies[config.cookieName]);
    if (disconnected()) return;
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    const village = await db.transaction().execute(tx => ownedVillage(tx, account.id, worldSlug, villageId));
    if (disconnected()) return;
    const operations = operationsFor(app);
    const closeObservation = operations?.openStream(request, account.id, village.worldId);
    markHttpStream(request);
    const read = () => projections.read(account.id, worldSlug, villageId);
    const session = new VillageSyncSession(read, async () => (await villageSyncRevision(db, village.worldId)).revision,
      snapshot=>reconcileSyncDeadline(db,account.id,worldSlug,villageId,snapshot));
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no', 'X-Request-Id': request.id, Connection: 'keep-alive' });
    reply.raw.write('retry: 2000\n\n');
    const deliveredReceipts=new Map<string,number>();
    let dirty=false,checking=false,receiptDirty=false;
    let receiptFlight:Promise<void>|undefined;
    let closed = false, timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => { if(closed)return;closed = true; closeObservation?.(); if (timer) clearTimeout(timer);unsubscribe?.();streams.delete(close);reply.raw.end(); };
    streams.add(close);
    reply.raw.once('close', close);
    // No trust in Last-Event-ID: browser receipt does not attest application.
    // Opening/reopening always joins with a current coherent snapshot.
    // Compact receipt reads have their own bounded single flight. A projection
    // awaiting SQL must not hold a committed refusal behind its completion.
    const flushReceipts=():Promise<void>=>{
      if(closed)return Promise.resolve();
      if(receiptFlight){receiptDirty=true;return receiptFlight;}
      receiptDirty=false;
      const flight=(async()=>{
        try{
          const current=await authenticate(db,request.cookies[config.cookieName]);
          if(closed)return;
          if(current.id!==account.id)throw new HttpError(401,'SESSION_EXPIRED','Session expirée.');
          const receipts=await readExpeditionReceipts(db,account.id,worldSlug,villageId);
          if(closed)return;
          for(const receipt of receipts)if((deliveredReceipts.get(receipt.commandId)??0)<receipt.version){
            if(reply.raw.writableLength>1_048_576){close();return;}
            reply.raw.write('event: expedition-receipt\ndata: '+JSON.stringify(receipt)+'\n\n');deliveredReceipts.set(receipt.commandId,receipt.version);
            operations?.sseEvent();
          }
          while(deliveredReceipts.size>128)deliveredReceipts.delete(deliveredReceipts.keys().next().value!);
        }catch(error){
          if(closed)return;
          if(!closed&&error instanceof HttpError&&error.statusCode===401)reply.raw.write('event: expired\ndata: {}\n\n');
          request.log.warn({ code: 'SSE_RECEIPTS_INTERRUPTED' }, 'Expedition receipt synchronization interrupted');close();
          operations?.sseFailure(village.worldId, villageId);
        }
      })().finally(()=>{receiptFlight=undefined;if(receiptDirty&&!closed)void flushReceipts();});
      receiptFlight=flight;return flight;
    };
    const poll = async () => {
      if(closed)return;if(checking){dirty=true;return;}checking=true;dirty=false;
      if(timer)clearTimeout(timer);
      try {
        await flushReceipts();if(closed)return;
        const event = await session.check();
        if (closed) return;
        const revision = event.event === 'snapshot' ? event.data.syncRevision : event.event === 'frame' ? event.data.toRevision : event.data.revision;
        if (reply.raw.writableLength > 1_048_576) { close(); return; }
        reply.raw.write(`id: ${revision}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
        operations?.sseEvent();
        timer = setTimeout(() => void poll(), dirty?0:VILLAGE_SYNC_CHECK_MS); timer.unref();
      } catch (error) {
        if (closed) return;
        if (!closed && error instanceof HttpError && error.statusCode === 401) reply.raw.write('event: expired\ndata: {}\n\n');
        request.log.warn({ code: 'SSE_INTERRUPTED' }, 'Village synchronization interrupted'); close();
        operations?.sseFailure(village.worldId, villageId);
      }finally{checking=false;if(dirty&&!closed){if(timer)clearTimeout(timer);timer=setTimeout(()=>void poll(),0);}}
    };
    const unsubscribe=wakeups?.subscribe((wid,vid)=>{if(wid===village.worldId&&vid===villageId){void flushReceipts();void poll();}});
    void poll();
  });
  return projections;
}
import { devTime } from '../operations/dev-timing.js';
