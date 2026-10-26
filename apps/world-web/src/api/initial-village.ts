import { getVillage, type TimedVillageState } from './client';
import { SYNC_V2_VILLAGE, initialSyncV2Read } from './sync-v2-initial';
import { SyncV2HttpError } from './sync-v2-transport';
import { SyncV2SessionExpired } from './sync-v2-session';
import { addressedWorld } from './world-address';

export const requestedWorldSlug = addressedWorld ?? import.meta.env.VITE_DEFAULT_WORLD_SLUG ?? 'aube';
let initial: Promise<TimedVillageState> | undefined;
/** Start once alongside the lazy UI download; neither StrictMode nor App repeats it. */
// In V2 village mode, only a server without the V2 routes keeps the historical
// read (an expired session also goes there, for its 401). A busy or failing V2
// server is retried once: the historical read costs it far more than V2.
export const initialVillageRead = () =>
  (initial ??= SYNC_V2_VILLAGE
    ? initialSyncV2Read(requestedWorldSlug).catch(async (error: unknown) => {
        if (error instanceof SyncV2SessionExpired || (error instanceof SyncV2HttpError && error.status === 404))
          return getVillage(requestedWorldSlug);
        const wait = error instanceof SyncV2HttpError ? Math.min(error.retryAfterMs, 5000) : 1000;
        await new Promise((resolve) => setTimeout(resolve, wait));
        return initialSyncV2Read(requestedWorldSlug);
      })
    : getVillage(requestedWorldSlug));
let name: Promise<string | undefined> | undefined;
/** Presentation only; ownership and the snapshot still come from the village API. */
export const initialWorldName = () =>
  (name ??= fetch('/api/worlds', { credentials: 'same-origin', signal: AbortSignal.timeout(5000) })
    .then(async (response) => {
      if (!response.ok) return;
      const worlds: unknown = await response.json();
      if (!Array.isArray(worlds)) return;
      const world = worlds.find((w) => w?.slug === requestedWorldSlug);
      return typeof world?.name === 'string' ? world.name : undefined;
    })
    .catch(() => undefined));
