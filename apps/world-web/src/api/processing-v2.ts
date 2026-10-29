import { randomUUID } from '../random-uuid';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  visibleSyncV2Scope,
  villageStateFromSyncV2,
  VILLAGE_PRESENTATION_COMPONENTS,
  type ProcessingCommand,
  type ProcessingOrder,
  type ResolvedVillagePresentation,
  type SyncV2Batch,
  type SyncV2State,
} from '@arbestra/contracts';
import type { TimedVillageState } from './client';
import { SyncV2Transport } from './sync-v2-transport';
import { SyncV2SessionExpired } from './sync-v2-session';
import { adoptInitialSyncV2, SYNC_V2_VILLAGE_INCLUDE } from './sync-v2-initial';

/** Newest first, like the historical snapshot. The private stream keeps
 * terminal orders as values, so the latest outcome stays displayable. */
export function processingOrdersV2(state: SyncV2State): ProcessingOrder[] {
  const scope = state.scopes.get(`village:${state.villageId}`);
  if (!scope) return [];
  const orders: ProcessingOrder[] = [];
  for (const [key, value] of visibleSyncV2Scope(scope))
    if (key.startsWith('processingOrders:')) orders.push(value as ProcessingOrder);
  return orders.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}

export function processingCommandBuilding(
  command: ProcessingCommand,
  orders: readonly ProcessingOrder[],
): string | null {
  return 'buildingId' in command
    ? command.buildingId
    : (orders.find((order) => order.id === command.orderId)?.buildingId ?? null);
}

export interface ConfirmedPlacement {
  buildingId: string;
  buildingType: string;
  anchor: { cellX: number; cellY: number };
  cells: ReadonlyArray<{ cellX: number; cellY: number }>;
}
/** The footprint the server just confirmed, shown before the recomputed
 * presentation (whose travel network can take a few hundred ms) arrives.
 * Same roles and state as the server for a new building under construction.
 * Null when it cannot be shown faithfully: a garden may merge with others,
 * and an unknown cell means the client's window is stale. */
export function presentationWithPlacement(
  presentation: ResolvedVillagePresentation,
  placed: ConfirmedPlacement,
): ResolvedVillagePresentation | null {
  if (placed.buildingType === 'garden') return null;
  const key = (cell: { cellX: number; cellY: number }) => `${cell.cellX}:${cell.cellY}`,
    footprint = new Set(placed.cells.map(key));
  const anchor = key(placed.anchor);
  if (!footprint.has(anchor) || presentation.cells.filter((cell) => footprint.has(key(cell))).length !== footprint.size)
    return null;
  return {
    ...presentation,
    cells: presentation.cells.map((cell) =>
      !footprint.has(key(cell))
        ? cell
        : {
            ...cell,
            canBuild: false,
            displaysBuilding: key(cell) === anchor,
            footprint: {
              buildingId: placed.buildingId,
              buildingType: placed.buildingType as NonNullable<typeof cell.footprint>['buildingType'],
              role: key(cell) === anchor ? ('anchor' as const) : ('extension' as const),
              state: 'reserved' as const,
            },
          },
    ),
  };
}

/** Whether a batch changes the presentation beyond what an already
 * requested read covers. A read started after revision R reflects R: the
 * stream's later delivery of the same changes (after their ACK) is skipped.
 * A scope snapshot always rereads. */
/** Extractions only move woodland paths and deposit amounts: their reads can
 * wait. So does a building update (stock, buffer, supplies, upgrade) once its
 * footprint is known: `buildings` reports the building's economic rows too. */
export const PRESENTATION_EXTRACTION_DELAY_MS = 30_000;
export function presentationReadNeeded(
  batch: SyncV2Batch,
  covered: bigint | null,
): { needed: boolean; through: bigint | null; urgent: boolean; buildings: boolean } {
  if (batch.coverage === 'scope-snapshot') return { needed: true, through: null, urgent: true, buildings: false };
  let through: bigint | null = null,
    urgent = false,
    buildings = false;
  for (const group of batch.groups) {
    const structural = group.changes.filter(
      (change) =>
        (VILLAGE_PRESENTATION_COMPONENTS as readonly string[]).includes(change.component) &&
        (change.upsert.length > 0 || change.remove.length > 0),
    );
    if (!structural.length) continue;
    const revision = BigInt(group.toRevision);
    if (covered === null || revision > covered) {
      through = through === null || revision > through ? revision : through;
      // A removed building frees its cells at once.
      urgent ||= structural.some(
        (change) =>
          change.component !== 'extractions' && (change.component !== 'buildings' || change.remove.length > 0),
      );
      buildings ||= structural.some((change) => change.component === 'buildings');
    }
  }
  return { needed: through !== null, through, urgent, buildings };
}

/** Whether every building of the private stream already has its footprint
 * in the presentation, so the state can be shown before a reread. */
export function footprintsKnown(
  state: SyncV2State,
  villageId: string | undefined,
  presentation: ResolvedVillagePresentation,
): boolean {
  const scope = state.scopes.get(`village:${villageId}`);
  if (!scope) return false;
  const placed = new Set(presentation.cells.flatMap((cell) => (cell.footprint ? [cell.footprint.buildingId] : [])));
  for (const [key] of visibleSyncV2Scope(scope))
    if (key.startsWith('buildings:') && !placed.has(key.slice(10))) return false;
  return true;
}

export type ProcessingV2Status = 'off' | 'starting' | 'ready' | 'unavailable';
type Options = {
  worldSlug: string;
  worldId: string | undefined;
  villageId: string | undefined;
  enabled: boolean;
  /** Whole village from V2 (streams + presentation), not only the workshop. */
  village: boolean;
  onState: (update: TimedVillageState) => void;
  onExpired: () => void;
  /** Sober, non-blocking message (e.g. village too large to synchronize). */
  onNotice?: (message: string) => void;
};

/** Message for a village whose snapshot exceeds the server bound. */
export function scopeTooLargeMessage(retryInMs: number): string {
  const seconds = Math.max(1, Math.round(retryInMs / 1000));
  const delay = seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
  return `Village trop grand pour être synchronisé ; nouvel essai dans ${delay}.`;
}

/** One V2 transport per mounted village. The workshop always uses it when
 * the server negotiates V2; the whole village only in village mode. A server
 * that does not negotiate V2 leaves both on their historical path. */
export function useVillageSyncV2({
  worldSlug,
  worldId,
  villageId,
  enabled,
  village,
  onState,
  onExpired,
  onNotice,
}: Options) {
  const [status, setStatus] = useState<ProcessingV2Status>('off');
  const [villageReady, setVillageReady] = useState(false);
  const [orders, setOrders] = useState<ProcessingOrder[]>([]);
  const [unresolved, setUnresolved] = useState<ProcessingCommand[]>([]);
  const transport = useRef<SyncV2Transport | null>(null);
  const expired = useRef(onExpired);
  expired.current = onExpired;
  const notice = useRef(onNotice);
  notice.current = onNotice;
  const accept = useRef(onState);
  accept.current = onState;
  const placed = useRef<(placement: ConfirmedPlacement) => void>(() => undefined);
  useEffect(() => {
    if (!enabled || !worldId || !villageId) {
      setStatus('off');
      return;
    }
    let presentation: ResolvedVillagePresentation | null = null,
      latest: { state: SyncV2State; observedAt: string } | null = null;
    // Highest private-stream revision a requested presentation read already
    // covers: the stream echo of an acknowledged command needs no second read.
    let covered: bigint | null = null;
    let loading = false,
      stale = false,
      lastRead = 0,
      // A provisional placement footprint: its real read never waits.
      placing = false,
      deferred: ReturnType<typeof setTimeout> | null = null;
    const emit = () => {
      if (!presentation || !latest || transport.current !== current) return;
      const projected = villageStateFromSyncV2(latest.state, presentation, latest.observedAt);
      if (!projected) return;
      accept.current({ state: projected, serverOffsetMs: Date.parse(latest.observedAt) - Date.now(), source: 'v2' });
      setVillageReady(true);
    };
    const fullPresentation = async (): Promise<ResolvedVillagePresentation> => {
      const full = await current.presentation();
      if (!full?.region) throw Error('Présentation incomplète.');
      return { ...full, region: full.region };
    };
    // Single flight; a structural change during a read triggers one more.
    const loadPresentation = async () => {
      if (loading) {
        stale = true;
        return;
      }
      loading = true;
      placing = false;
      if (deferred) clearTimeout(deferred);
      deferred = null;
      lastRead = Date.now();
      try {
        do {
          stale = false;
          const next = await current.presentation(presentation?.version, presentation?.regionVersion);
          // An omitted region means our copy of that exact version is current.
          if (next)
            presentation = next.region
              ? { ...next, region: next.region }
              : presentation && next.regionVersion === presentation.regionVersion
                ? { ...next, region: presentation.region }
                : await fullPresentation();
        } while (stale && transport.current === current);
      } catch (error) {
        if (error instanceof SyncV2SessionExpired && transport.current === current) {
          current.close();
          expired.current();
          return;
        }
      } finally {
        loading = false;
      }
      emit();
    };
    // A confirmed placement shows at once; the pending read replaces it.
    placed.current = (placement) => {
      const patched = presentation && presentationWithPlacement(presentation, placement);
      if (patched && transport.current === current) {
        presentation = patched;
        placing = true;
        emit();
      }
    };
    const handlers = {
      expired: () => expired.current(),
      onScopeTooLarge: (retryInMs: number | null) => {
        if (retryInMs !== null) notice.current?.(scopeTooLargeMessage(retryInMs));
      },
      publish: (state: SyncV2State, observedAt: string, batch: SyncV2Batch) => {
        setOrders(processingOrdersV2(state));
        if (!village) return;
        // An ACK carries its command time, possibly before the last delta.
        latest = { state, observedAt: latest && latest.observedAt > observedAt ? latest.observedAt : observedAt };
        const read = presentationReadNeeded(batch, covered);
        // Never show a building without its footprint: wait for the new read.
        if (read.needed || !presentation) {
          // A snapshot (possibly a new epoch) restarts the coverage.
          if (read.needed) covered = read.through;
          // On a big village, worksites start and end extractions continuously:
          // a full presentation read each time kept the server busy. Batch them.
          // A building without its footprint is never shown: read it now.
          const urgent =
            read.urgent ||
            placing ||
            (read.buildings && !!presentation && !footprintsKnown(state, villageId, presentation));
          if (presentation && read.needed && !urgent) {
            deferred ??= setTimeout(
              () => void loadPresentation(),
              Math.max(0, lastRead + PRESENTATION_EXTRACTION_DELAY_MS - Date.now()),
            );
          } else void loadPresentation();
          // An upgrade or a stock change keeps every footprint: show it now,
          // the read refreshes routes and cells. A new building still waits.
          if (presentation && footprintsKnown(state, villageId, presentation)) emit();
        } else emit();
      },
    };
    // The first village state may already come from V2: adopt that session.
    const adopted = village ? adoptInitialSyncV2(worldId, villageId) : null;
    // Convoys are public world entities: the traffic stream shows them all.
    const current =
      adopted?.transport ??
      new SyncV2Transport(worldSlug, worldId, villageId, {
        ...(village ? { include: SYNC_V2_VILLAGE_INCLUDE } : {}),
        ...handlers,
      });
    transport.current = current;
    setVillageReady(false);
    const recover = async () => {
      const list = await current.recover().catch(() => current.pending());
      if (transport.current === current) setUnresolved(list);
    };
    if (adopted) {
      current.rebind(handlers);
      presentation = adopted.presentation;
      const last = adopted.latest();
      latest = { state: last.state, observedAt: last.observedAt };
      setOrders(processingOrdersV2(last.state));
      setStatus('ready');
      emit();
      void recover();
    } else {
      setStatus('starting');
      void (async () => {
        try {
          await current.start();
        } catch (error) {
          if (transport.current !== current) return;
          current.close();
          transport.current = null;
          if (error instanceof SyncV2SessionExpired) {
            setStatus('off');
            expired.current();
          } else setStatus('unavailable');
          return;
        }
        if (transport.current !== current) return;
        setStatus('ready');
        void recover();
      })();
    }
    return () => {
      if (deferred) clearTimeout(deferred);
      current.close();
      if (transport.current === current) transport.current = null;
      setOrders([]);
      setUnresolved([]);
      setVillageReady(false);
    };
  }, [enabled, village, worldSlug, worldId, villageId]);
  const command = useCallback(async (command: ProcessingCommand) => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    try {
      await current.processing(command);
    } finally {
      if (transport.current === current) setUnresolved(current.pending());
    }
  }, []);
  const discard = useCallback((commandId: string) => {
    const current = transport.current;
    if (!current) return;
    current.forget(commandId);
    setUnresolved(current.pending());
  }, []);
  const construct = useCallback((body: Parameters<SyncV2Transport['construct']>[0]) => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    return current.construct(body).then((confirmation) => {
      if (confirmation.result.buildingId)
        placed.current({
          buildingId: confirmation.result.buildingId,
          buildingType: body.buildingType,
          anchor: { cellX: body.anchorCellX, cellY: body.anchorCellY },
          cells: body.cells,
        });
      return confirmation;
    });
  }, []);
  const upgrade = useCallback((buildingId: string, body: Parameters<SyncV2Transport['upgrade']>[1]) => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    return current.upgrade(buildingId, body);
  }, []);
  const expand = useCallback((buildingId: string, body: Parameters<SyncV2Transport['expand']>[1]) => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    return current.expand(buildingId, body);
  }, []);
  const science = useCallback((command: Parameters<SyncV2Transport['science']>[0]) => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    return current.science(command, randomUUID());
  }, []);
  const discoverSupplies = useCallback((buildingId: string) => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    return current.discoverSupplies(buildingId, randomUUID());
  }, []);
  const discoverCatEyes = useCallback(() => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    return current.discoverCatEyes(randomUUID());
  }, []);
  const exploit = useCallback((request: Parameters<SyncV2Transport['exploit']>[0]) => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    return current.exploit(request);
  }, []);
  const trade = useCallback((command: Parameters<SyncV2Transport['trade']>[0]) => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    return current.trade(command);
  }, []);
  const level = useCallback((command: Parameters<SyncV2Transport['level']>[0]) => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    return current.level(command);
  }, []);
  const terraform = useCallback((command: Parameters<SyncV2Transport['terraform']>[0]) => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    return current.terraform(command);
  }, []);
  const changeWorksite = useCallback((id: string, change: Parameters<SyncV2Transport['changeWorksite']>[1]) => {
    const current = transport.current;
    if (!current) throw Error('Synchronisation indisponible.');
    return current.changeWorksite(id, change);
  }, []);
  /** Immediate delta read, e.g. after a command still answered by V1. */
  const refresh = useCallback(() => {
    transport.current?.reconnect();
  }, []);
  return {
    status,
    villageReady,
    orders,
    unresolved,
    command,
    discard,
    refresh,
    construct,
    upgrade,
    expand,
    science,
    discoverSupplies,
    discoverCatEyes,
    exploit,
    trade,
    level,
    terraform,
    changeWorksite,
  };
}
