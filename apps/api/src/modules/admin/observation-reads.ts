import type { Kysely } from 'kysely';
import type { ObservationLease, ObservationAction, VillageState } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { readVillageObservation } from '../villages/service.js';
import { villageSyncRevision } from '../villages/sync-revision.js';
import { HttpError } from '../../errors.js';
import type { ObservationHub } from './observation-hub.js';
import type { VillageSyncProjections } from '../villages/sync-projections.js';

export class ObservationReads {
  private cache = new Map<
    string,
    {
      state?: VillageState;
      flight?: Promise<VillageState> | undefined;
      checked: number;
      receiptAt: number;
      receipts?: Promise<void> | undefined;
    }
  >();
  constructor(
    private db: Kysely<Database>,
    private hub: ObservationHub,
    private projections?: VillageSyncProjections,
  ) {
    hub.onClose((l) => {
      if (!hub.active(l.worldId, l.villageId, l.accountId))
        this.cache.delete(l.worldId + ':' + l.villageId + ':' + l.accountId);
    });
  }
  async target(worldId: string, villageId: string) {
    const row = await this.db
      .selectFrom('villages as v')
      .innerJoin('worlds as w', 'w.id', 'v.worldId')
      .select(['v.ownerAccountId as accountId', 'w.slug as worldSlug', 'v.name as villageName'])
      .where('v.worldId', '=', worldId)
      .where('v.id', '=', villageId)
      .executeTakeFirst();
    if (!row) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable.');
    return { ...row, worldId, villageId };
  }
  async validate(l: ObservationLease) {
    const target = await this.target(l.worldId, l.villageId);
    if (target.accountId !== l.accountId) {
      this.hub.close(l.id, 'owner_changed');
      throw new HttpError(409, 'VILLAGE_OWNER_CHANGED', 'Le propriétaire a changé.');
    }
    return target;
  }
  private entry(l: ObservationLease) {
    const key = l.worldId + ':' + l.villageId + ':' + l.accountId;
    let e = this.cache.get(key);
    if (!e) {
      e = { checked: 0, receiptAt: 0 };
      this.cache.set(key, e);
    }
    return e;
  }
  async snapshot(l: ObservationLease) {
    const e = this.entry(l);
    if (e.flight) return e.flight;
    if (e.state && Date.now() - e.checked < 2000) return e.state;
    const flight = (async () => {
      try {
        await this.validate(l);
        const revision = (await villageSyncRevision(this.db, l.worldId)).revision;
        if (e.state?.syncRevision === revision) {
          e.checked = Date.now();
          this.hub.degrade(l, false);
          return e.state;
        }
        // Reuse only a completed fresh projection; a player's pending navigation
        // must never prevent an operator from opening the persisted village.
        const candidate = this.projections?.observedBase(l.accountId, l.worldId, l.villageId, revision);
        const state = candidate ?? (await readVillageObservation(this.db, l.accountId, l.worldSlug, l.villageId));
        e.state = state;
        e.checked = Date.now();
        this.hub.degrade(l, false);
        return state;
      } catch (error) {
        this.hub.degrade(l, true);
        if (error instanceof HttpError && [401, 403, 404, 409].includes(error.statusCode)) throw error;
        if (e.state) return e.state;
        throw error;
      }
    })().finally(() => {
      e.flight = undefined;
    });
    e.flight = flight;
    return flight;
  }
  async receipts(l: ObservationLease, actorId: string) {
    const e = this.entry(l);
    if (e.receipts) return e.receipts;
    if (Date.now() - e.receiptAt < 2000) return;
    e.receiptAt = Date.now();
    const flight = (async () => {
      const actions = this.hub
        .status(l.id, actorId)
        .actions.filter(
          (a) =>
            a.commandId &&
            (a.businessOutcome === 'pending' ||
              (a.activityId && a.activityStatus !== 'completed' && a.activityStatus !== 'recalled')),
        )
        .slice(-64);
      if (!actions.length) return;
      const ids = actions.map((a) => a.commandId!);
      const [harvests, expeditions] = await Promise.all([
        this.db
          .selectFrom('harvestSubmissions')
          .select(['commandId', 'receipt'])
          .where('worldId', '=', l.worldId)
          .where('villageId', '=', l.villageId)
          .where('accountId', '=', l.accountId)
          .where('commandId', 'in', ids)
          .execute(),
        this.db
          .selectFrom('expeditionSubmissions')
          .select(['commandId', 'receipt'])
          .where('worldId', '=', l.worldId)
          .where('villageId', '=', l.villageId)
          .where('accountId', '=', l.accountId)
          .where('commandId', 'in', ids)
          .execute(),
      ]);
      const activityIds = expeditions.flatMap((e) => ('activityId' in e.receipt ? [e.receipt.activityId] : []));
      const activities = activityIds.length
        ? await this.db
            .selectFrom('scienceActivities')
            .select(['id', 'status'])
            .where('worldId', '=', l.worldId)
            .where('villageId', '=', l.villageId)
            .where('id', 'in', activityIds)
            .execute()
        : [];
      for (const action of actions) {
        const h = harvests.find((r) => r.commandId === action.commandId)?.receipt,
          x = expeditions.find((r) => r.commandId === action.commandId)?.receipt;
        let next: ObservationAction | undefined;
        if (h && !h.pending)
          next = {
            ...action,
            businessOutcome: h.accepted.length ? (h.refused.length ? 'partial' : 'accepted') : 'rejected',
            accepted: h.accepted.map((a) => a.key),
            refused: h.refused.map((r) => ({ key: r.key, reason: 'Cible refusée par les règles métier.' })),
          };
        if (x && x.status !== 'pending') {
          next = {
            ...action,
            businessOutcome: x.status === 'admitted' ? 'accepted' : 'rejected',
            ...('code' in x ? { code: x.code } : {}),
            ...('activityId' in x ? { activityId: x.activityId } : {}),
          };
          const a = activities.find((a) => a.id === next?.activityId);
          if (a) next.activityStatus = a.status;
        }
        if (next) this.hub.record(next);
      }
    })().finally(() => {
      e.receipts = undefined;
    });
    e.receipts = flight;
    return flight;
  }
}
