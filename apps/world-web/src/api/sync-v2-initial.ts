import {
  villageStateFromSyncV2,
  type ResolvedVillagePresentation,
  type SyncV2Batch,
  type SyncV2State,
} from '@arbestra/contracts';
import type { TimedVillageState } from './client';
import { SyncV2Transport } from './sync-v2-transport';

// The whole village is synchronized through V2 (streams + presentation); the
// shared scopes it reads besides its private stream:
export const SYNC_V2_VILLAGE_INCLUDE = ['knowledge', 'manifest', 'traffic'] as const;

type Latest = { state: SyncV2State; observedAt: string; batch: SyncV2Batch };
export interface InitialSyncV2 {
  transport: SyncV2Transport;
  presentation: ResolvedVillagePresentation;
  latest: () => Latest;
}
let handoff: InitialSyncV2 | null = null;

/** First village state from V2 (bootstrap + presentation). The open session is kept for the mounted village,
 * which adopts it instead of bootstrapping a second time. */
export function initialSyncV2Read(worldSlug: string): Promise<TimedVillageState> {
  return readSyncV2Village(worldSlug, true);
}
/** One village state from V2 whose session closes at once: the starter kit
 * rereads its village after each pose while the mounted village streams. */
export function readSyncV2VillageOnce(worldSlug: string): Promise<TimedVillageState> {
  return readSyncV2Village(worldSlug, false);
}
async function readSyncV2Village(worldSlug: string, keep: boolean): Promise<TimedVillageState> {
  let latest: Latest | null = null;
  const transport = await SyncV2Transport.bootstrapWorld(worldSlug, {
    include: SYNC_V2_VILLAGE_INCLUDE,
    listen: keep,
    // Until adoption, keep the newest applied state; nothing is rendered yet.
    publish: (state, observedAt, batch) => {
      latest = { state, observedAt, batch };
    },
    expired: () => undefined,
  });
  try {
    const read = await transport.presentation();
    const presentation = read?.region ? { ...read, region: read.region } : null;
    const current = latest as Latest | null;
    const state =
      presentation && current ? villageStateFromSyncV2(current.state, presentation, current.observedAt) : null;
    if (!presentation || !current || !state) throw Error('Projection V2 incomplète.');
    if (keep) handoff = { transport, presentation, latest: () => latest ?? current };
    else transport.close();
    return { state, serverOffsetMs: Date.parse(current.observedAt) - Date.now() };
  } catch (error) {
    transport.close();
    throw error;
  }
}

/** Single use, and only for the very village it was opened for. */
export function adoptInitialSyncV2(worldId: string, villageId: string): InitialSyncV2 | null {
  const adopted = handoff;
  if (!adopted || adopted.transport.worldId !== worldId || adopted.transport.villageId !== villageId) return null;
  handoff = null;
  return adopted;
}
