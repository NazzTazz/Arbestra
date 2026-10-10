import { applyVillageFrame, reconcileVillageSnapshot, villageSnapshotIsValid, type VillageState } from '@arbestra/contracts';
import type { TimedVillageState } from './client';

let generation = 0;
export const villageRequestGeneration = () => generation;
export interface VillageEventSource {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
  onerror: ((event: Event) => void) | null;
}
export interface VillageSyncOptions {
  current: () => VillageState | null;
  accept: (snapshot: TimedVillageState) => void;
  offset: () => number;
  source?: (url: string) => VillageEventSource;
  onExpired?: () => void;
}
export class VillageSynchronization {
  #source: VillageEventSource | null = null;
  #closed = false;
  #epoch = 0;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #watchdog: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly worldSlug: string, private readonly worldId: string,
    private readonly villageId: string, private readonly options: VillageSyncOptions) { this.reconnect(); }
  #alive(epoch: number): boolean { return !this.#closed && epoch === this.#epoch; }
  #touch() {
    if (this.#watchdog) clearTimeout(this.#watchdog);
    this.#watchdog = setTimeout(() => this.reconnect(), 30_000);
  }
  reconnect() {
    if (this.#closed) return;
    this.#source?.close(); if (this.#retry) clearTimeout(this.#retry);
    const epoch = this.#epoch = ++generation;
    const revision = this.options.current()?.syncRevision;
    const url = `/api/worlds/${encodeURIComponent(this.worldSlug)}/villages/${this.villageId}/events${revision === undefined ? '' : `?revision=${revision}`}`;
    const source = this.#source = (this.options.source ?? (url => new EventSource(url)))(url);
    this.#touch();
    const receive = (kind: 'snapshot' | 'frame' | 'revision', event: MessageEvent<string>) => {
      if (!this.#alive(epoch)) return;
      this.#touch();
      const current = this.options.current();
      if (!current || current.world.id !== this.worldId || current.village.id !== this.villageId) return;
      try {
        const data = JSON.parse(event.data);
        if (kind === 'snapshot') {
          if (!villageSnapshotIsValid(data)) throw Error('Invalid snapshot');
          const next = data;
          if (next.world.id !== this.worldId || next.village.id !== this.villageId || !Number.isSafeInteger(next.syncRevision)) throw Error('Invalid snapshot');
          if (current.syncRevision !== undefined && (next.syncRevision! < current.syncRevision
            || next.syncRevision===current.syncRevision&&next.serverTime<=current.serverTime)) return;
          this.options.accept({ state: reconcileVillageSnapshot(current, next), serverOffsetMs: this.options.offset() });
        } else if (kind === 'frame') {
          const result = applyVillageFrame(current, data);
          if (result.kind === 'resync') this.#recover();
          else if (result.kind === 'applied') this.options.accept({ state: result.state, serverOffsetMs: this.options.offset() });
        } else if (data.worldId === this.worldId && data.villageId === this.villageId) {
          if (!Number.isSafeInteger(data.revision) || data.revision !== current.syncRevision) this.#recover();
        }
      } catch { this.#recover(); }
    };
    for (const kind of ['snapshot', 'frame', 'revision'] as const) source.addEventListener(kind, event => receive(kind, event));
    source.addEventListener('expired', () => { if (this.#alive(epoch)) { this.close(); this.options.onExpired?.(); } });
    source.onerror = () => { if (this.#alive(epoch)) this.#recover(2_000); };
  }
  #recover(delay = 100) {
    // Immediately neutralize this subscription, including already queued events.
    this.#epoch = ++generation;
    this.#source?.close(); if (this.#retry) clearTimeout(this.#retry);
    this.#retry = setTimeout(() => this.reconnect(), delay);
  }
  close() {
    this.#closed = true; this.#epoch = ++generation; this.#source?.close();
    if (this.#retry) clearTimeout(this.#retry); if (this.#watchdog) clearTimeout(this.#watchdog);
  }
}
