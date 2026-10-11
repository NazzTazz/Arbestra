import { villageFrame, type VillageCommandResponse, type VillageState, type VillageSyncBase } from '@arbestra/contracts';
import type { ConstructionCommit } from './service.js';
type Reader = (accountId: string, worldSlug: string, villageId: string) => Promise<VillageState>;
type Entry = { state: VillageState; bytes: number };

/** Exact, bounded transport bases. They never authorize a mutation or replace a fresh read. */
export class VillageSyncProjections {
  #bases = new Map<string, Entry[]>();
  #flights = new Map<string, Promise<VillageState>>();
  #bytes = 0;
  constructor(private readonly load: Reader, private readonly limits = {
    snapshots: 8, contexts: 32, bytes: 16 * 1024 * 1024,
  }) {}
  #key(accountId: string, state: VillageState) { return accountId + ':' + state.world.id + ':' + state.village.id; }
  remember(accountId: string, state: VillageState) {
    if (state.syncRevision === undefined) throw Error('Unversioned projection');
    const key = this.#key(accountId, state), entries = this.#bases.get(key) ?? [];
    const duplicate = entries.findIndex(e => e.state.syncRevision === state.syncRevision && e.state.serverTime === state.serverTime);
    if (duplicate >= 0) { this.#bytes -= entries[duplicate]!.bytes; entries.splice(duplicate, 1); }
    const entry = { state, bytes: Buffer.byteLength(JSON.stringify(state)) };
    entries.push(entry); this.#bytes += entry.bytes;
    while (entries.length > this.limits.snapshots) this.#bytes -= entries.shift()!.bytes;
    this.#bases.delete(key); this.#bases.set(key, entries);
    while (this.#bases.size > this.limits.contexts || this.#bytes > this.limits.bytes) {
      const oldest = this.#bases.keys().next().value!;
      for (const e of this.#bases.get(oldest)!) this.#bytes -= e.bytes;
      this.#bases.delete(oldest);
    }
  }
  #base(accountId: string, worldId: string, villageId: string, base: VillageSyncBase) {
    return this.#bases.get(accountId + ':' + worldId + ':' + villageId)
      ?.find(e => e.state.syncRevision === base.revision && e.state.serverTime === base.serverTime)?.state;
  }
  #project(accountId: string, worldSlug: string, villageId: string) {
    const key = accountId + ':' + worldSlug + ':' + villageId;
    let flight = this.#flights.get(key);
    if (!flight) {
      flight = this.load(accountId, worldSlug, villageId).then(state => { this.remember(accountId, state); return state; })
        .finally(() => this.#flights.delete(key));
      this.#flights.set(key, flight);
    }
    return flight;
  }
  async read(accountId: string, worldSlug: string, villageId: string, minimumRevision = 0) {
    let next = await this.#project(accountId, worldSlug, villageId);
    // A shared read may have acquired its MVCC view before this command committed.
    if (next.syncRevision! < minimumRevision) next = await this.#project(accountId, worldSlug, villageId);
    if (next.syncRevision! < minimumRevision) throw Error('Projection predates committed command');
    return next;
  }
  async commandResponse(accountId: string, worldSlug: string, commit: ConstructionCommit,
    base: VillageSyncBase | undefined, minimumRevision: number): Promise<VillageCommandResponse> {
    const before = base ? this.#base(accountId, commit.worldId, commit.villageId, base) : undefined;
    const after = await this.read(accountId, worldSlug, commit.villageId, minimumRevision);
    const metadata = { ...(commit.commandId ? { commandId: commit.commandId } : {}),
      commandTime: commit.through.toISOString(), serverTime: after.serverTime };
    if (before && after.syncRevision! > before.syncRevision!) return { ...metadata, kind: 'frame', frame: villageFrame(before, after) };
    return { ...metadata, kind: 'snapshot', state: after };
  }
}
