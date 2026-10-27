import { getVillage, type TimedVillageState } from './client';
import { SYNC_V2_VILLAGE, initialSyncV2Read } from './sync-v2-initial';
import { SyncV2HttpError } from './sync-v2-transport';
import { SyncV2SessionExpired } from './sync-v2-session';
import { addressedWorld } from './world-address';

export const requestedWorldSlug = addressedWorld ?? import.meta.env.VITE_DEFAULT_WORLD_SLUG ?? 'aube';
/** Bounded back-off of the first V2 read; the last delay repeats. A busy
 * server's `Retry-After` lengthens a step, never shortens it. */
export const INITIAL_READ_BACKOFF_MS = [1000, 2000, 5000, 10000, 20000, 30000] as const;
/** Beyond this the loading screen gives way to the error screen and its reload. */
export const INITIAL_READ_ATTEMPTS = 30;
let initial: Promise<TimedVillageState> | undefined;
// In V2 village mode, only a server without the V2 routes keeps the historical
// read (an expired session also goes there, for its 401). A busy or failing V2
// server is retried behind the loading screen with a capped back-off: the
// historical read would cost it far more than V2, and a presentation that is
// still being captured is shared by the retry instead of queued again.
async function retriedSyncV2Read(worldSlug: string): Promise<TimedVillageState> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await initialSyncV2Read(worldSlug);
    } catch (error: unknown) {
      if (error instanceof SyncV2SessionExpired || (error instanceof SyncV2HttpError && error.status === 404))
        return getVillage(worldSlug);
      if (attempt >= INITIAL_READ_ATTEMPTS) throw error;
      const step = INITIAL_READ_BACKOFF_MS[Math.min(attempt, INITIAL_READ_BACKOFF_MS.length) - 1]!;
      const wait = error instanceof SyncV2HttpError ? Math.max(step, Math.min(error.retryAfterMs, step * 2)) : step;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}
/** Start once alongside the lazy UI download; neither StrictMode nor App repeats it. */
export const initialVillageRead = () =>
  (initial ??= SYNC_V2_VILLAGE ? retriedSyncV2Read(requestedWorldSlug) : getVillage(requestedWorldSlug));
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
