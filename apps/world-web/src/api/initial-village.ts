import type { TimedVillageState } from './client';
import { reconnectDelayMs } from './reconnect';
import { initialSyncV2Read } from './sync-v2-initial';
import { SyncV2HttpError } from './sync-v2-transport';
import { SyncV2SessionExpired } from './sync-v2-session';
import { addressedWorld } from './world-address';

export const requestedWorldSlug = addressedWorld ?? import.meta.env.VITE_DEFAULT_WORLD_SLUG ?? 'aube';
/** Beyond this the loading screen gives way to the "connection impossible"
 * screen, whose own retries then continue at the capped cadence. Seven
 * attempts wait 1+2+5+10+20+30 s: about one minute (Tristan, 1 November). */
export const INITIAL_READ_ATTEMPTS = 7;
let initial: Promise<TimedVillageState> | undefined;
// The first state of the village comes from V2 alone. A busy or failing server
// is retried behind the loading screen with a capped back-off (a presentation
// that is still being captured is shared by the retry instead of queued
// again). Two answers are final and end the sequence at once:
// - an expired session (401) rejects with `SyncV2SessionExpired`: the game goes
//   straight to its login screen;
// - no village or no world (404) rejects with the `SyncV2HttpError`: the player
//   reads the server's refusal, retrying cannot change it.
async function retriedSyncV2Read(worldSlug: string, attempts: number): Promise<TimedVillageState> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await initialSyncV2Read(worldSlug);
    } catch (error: unknown) {
      if (error instanceof SyncV2SessionExpired || (error instanceof SyncV2HttpError && error.status === 404))
        throw error;
      if (attempt >= attempts) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, reconnectDelayMs(attempt, error instanceof SyncV2HttpError ? error.retryAfterMs : 0)),
      );
    }
  }
}
/** Start once alongside the lazy UI download; neither StrictMode nor App repeats it. */
export const initialVillageRead = () => (initial ??= retriedSyncV2Read(requestedWorldSlug, INITIAL_READ_ATTEMPTS));
/** One more attempt after the sequence above gave up (the player's retry or
 * the screen's scheduled one). It replaces the failed read for later callers. */
export const retryInitialVillageRead = () => (initial = retriedSyncV2Read(requestedWorldSlug, 1));
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
