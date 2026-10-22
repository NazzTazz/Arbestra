import {villageStateFromSyncV2,type SyncV2Batch,type SyncV2State,type VillagePresentation} from '@arbestra/contracts';
import type {TimedVillageState} from './client';
import {SyncV2Transport} from './sync-v2-transport';

// Whole-village V2 synchronization is opt-in until its browser validation:
// localStorage arbestra:sync-v2=1 or VITE_SYNC_V2=1. The workshop already
// negotiates V2 on its own whenever the server offers it.
export const SYNC_V2_VILLAGE = (() => { try { return localStorage.getItem('arbestra:sync-v2') === '1'; } catch { return false; } })()
  || import.meta.env.VITE_SYNC_V2 === '1';
export const SYNC_V2_VILLAGE_INCLUDE = ['knowledge', 'manifest', 'traffic'] as const;

type Latest = { state: SyncV2State; observedAt: string; batch: SyncV2Batch };
export interface InitialSyncV2 { transport: SyncV2Transport; presentation: VillagePresentation; latest: () => Latest }
let handoff: InitialSyncV2 | null = null;

/** First village state from V2 (bootstrap + presentation), without the
 * historical village read. The open session is kept for the mounted village,
 * which adopts it instead of bootstrapping a second time. */
export async function initialSyncV2Read(worldSlug: string): Promise<TimedVillageState> {
  let latest: Latest | null = null;
  const transport = await SyncV2Transport.bootstrapWorld(worldSlug, { include: SYNC_V2_VILLAGE_INCLUDE,
    // Until adoption, keep the newest applied state; nothing is rendered yet.
    publish: (state, observedAt, batch) => { latest = { state, observedAt, batch }; }, expired: () => undefined });
  try {
    const presentation = await transport.presentation();
    const current = latest as Latest | null;
    const state = presentation && current ? villageStateFromSyncV2(current.state, presentation, current.observedAt) : null;
    if (!presentation || !current || !state) throw Error('Projection V2 incomplète.');
    handoff = { transport, presentation, latest: () => latest ?? current };
    return { state, serverOffsetMs: Date.parse(current.observedAt) - Date.now(), source: 'v2' };
  } catch (error) { transport.close(); throw error; }
}

/** Single use, and only for the very village it was opened for. */
export function adoptInitialSyncV2(worldId: string, villageId: string): InitialSyncV2 | null {
  const adopted = handoff;
  if (!adopted || adopted.transport.worldId !== worldId || adopted.transport.villageId !== villageId) return null;
  handoff = null;
  return adopted;
}
