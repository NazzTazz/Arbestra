import { sql, type Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { villageFrame, type VillageState } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { AppConfig } from '../../config.js';
import { authenticate } from '../auth/service.js';
import { getVillageState, ownedVillage, state } from './service.js';
import { villageSyncRevision } from './sync-revision.js';
import { HttpError } from '../../errors.js';
import { advanceEnergy } from '../population/energy.js';
import { energyState } from '../population/work.js';

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
  await getVillageState(db,accountId,worldSlug,villageId);
}

/** No economic writes/locks. Data and commit markers share one MVCC view. */
export function readVillageProjection(db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string) {
  return db.transaction().setIsolationLevel('repeatable read').execute(async tx => {
    await sql`set transaction read only`.execute(tx);
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const through = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow()).at;
    await sql`select set_config('arbestra.economy_through', ${through.toISOString()}, true)`.execute(tx);
    return state(tx, accountId, worldSlug, { worldId: village.worldId, villageId, through }, false, true);
  });
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

export async function registerVillageSync(app: FastifyInstance, db: Kysely<Database>, config: AppConfig) {
  // A command's commit can race another world commit after snapshot assembly.
  // Verify the revision after COMMIT, replacing only uncertain snapshots.
  app.addHook('preSerialization', async (request, _reply, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return payload;
    const wrapper = payload as { villageState?: VillageState }, candidate = wrapper.villageState ?? payload as VillageState;
    if (!candidate.world?.id || !candidate.village?.id || !Array.isArray(candidate.cells) || !candidate.serverTime) return payload;
    const current = await villageSyncRevision(db, candidate.world.id);
    if (candidate.syncRevision === current.revision) return payload;
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const coherent = await readVillageProjection(db, account.id, candidate.world.slug, candidate.village.id);
    return wrapper.villageState ? { ...wrapper, villageState: coherent } : coherent;
  });

  // Share only in-flight reads, never a stale dynamic snapshot or another owner's data.
  const flights = new Map<string, Promise<VillageState>>();
  const streams = new Set<()=>void>();
  app.addHook('preClose',async()=>{for(const close of streams)close();});
  app.get('/api/worlds/:worldSlug/villages/:villageId/events', {
    schema: { params: Type.Object({ worldSlug: Type.String({ minLength: 1, maxLength: 64 }), villageId: Type.String({ format: 'uuid' }) }),
      querystring: Type.Object({ revision: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })) }) },
  }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    const village = await db.transaction().execute(tx => ownedVillage(tx, account.id, worldSlug, villageId));
    const key = `${account.id}:${village.worldId}:${villageId}`;
    const read = () => {
      let flight = flights.get(key);
      if (!flight) {
        flight = readVillageProjection(db, account.id, worldSlug, villageId).finally(() => flights.delete(key));
        flights.set(key, flight);
      }
      return flight;
    };
    const session = new VillageSyncSession(read, async () => (await villageSyncRevision(db, village.worldId)).revision,
      snapshot=>reconcileSyncDeadline(db,account.id,worldSlug,villageId,snapshot));
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    reply.raw.write('retry: 2000\n\n');
    let closed = false, timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => { if(closed)return;closed = true; if (timer) clearTimeout(timer);streams.delete(close);reply.raw.end(); };
    streams.add(close);
    reply.raw.once('close', close);
    // No trust in Last-Event-ID: browser receipt does not attest application.
    // Opening/reopening always joins with a current coherent snapshot.
    const poll = async () => {
      try {
        await authenticate(db, request.cookies[config.cookieName]);
        await db.transaction().execute(tx => ownedVillage(tx, account.id, worldSlug, villageId));
        const event = await session.check();
        if (closed) return;
        const revision = event.event === 'snapshot' ? event.data.syncRevision : event.event === 'frame' ? event.data.toRevision : event.data.revision;
        if (reply.raw.writableLength > 1_048_576) { close(); return; }
        reply.raw.write(`id: ${revision}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
        timer = setTimeout(() => void poll(), VILLAGE_SYNC_CHECK_MS); timer.unref();
      } catch (error) {
        if (!closed && error instanceof HttpError && error.statusCode === 401) reply.raw.write('event: expired\ndata: {}\n\n');
        app.log.warn(error, 'Village synchronization interrupted'); close();
      }
    };
    void poll();
  });
}
