import {getVillage, type TimedVillageState} from './client';
import {SYNC_V2_VILLAGE, initialSyncV2Read} from './sync-v2-initial';

export const requestedWorldSlug = new URLSearchParams(location.search).get('world') ?? import.meta.env.VITE_DEFAULT_WORLD_SLUG ?? 'aube';
let initial: Promise<TimedVillageState> | undefined;
/** Start once alongside the lazy UI download; neither StrictMode nor App repeats it. */
// In V2 village mode, a server that does not negotiate V2 keeps the historical read.
export const initialVillageRead = () => initial ??= SYNC_V2_VILLAGE
  ? initialSyncV2Read(requestedWorldSlug).catch(() => getVillage(requestedWorldSlug)) : getVillage(requestedWorldSlug);
let name: Promise<string | undefined> | undefined;
/** Presentation only; ownership and the snapshot still come from the village API. */
export const initialWorldName = () => name ??= fetch('/api/worlds', {credentials: 'same-origin', signal: AbortSignal.timeout(5000)})
  .then(async response => {
    if (!response.ok) return;
    const worlds: unknown = await response.json();
    if (!Array.isArray(worlds)) return;
    const world = worlds.find(w => w?.slug === requestedWorldSlug);
    return typeof world?.name === 'string' ? world.name : undefined;
  }).catch(() => undefined);
