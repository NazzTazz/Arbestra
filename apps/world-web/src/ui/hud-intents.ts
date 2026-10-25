import {
  extractionPoolSettings,
  type ExtractionPool,
  type ExtractionPoolCommand,
  type HudWorkforceConfirmation,
  type HudWorkforceIntent,
  type HudWorkforceState,
  type VillageState,
} from '@arbestra/contracts';

export interface SavedHudIntents {
  confirmed: HudWorkforceState;
  items: HudWorkforceIntent[];
}

export function hudFromVillage(state: VillageState): HudWorkforceState {
  const population = state.village.population;
  const openWorksites = { wood: 0, stone: 0, other: 0 };
  for (const site of state.village.worksites) {
    if (['running', 'paused', 'stopping'].includes(site.status)) openWorksites[site.poolResource ?? 'other']++;
  }
  return {
    worldId: state.world.id,
    villageId: state.village.id,
    serverTime: state.serverTime,
    minimumRevision: state.syncRevision ?? 0,
    population: {
      available: population.available,
      resting: population.resting,
      working: population.working,
      pendingRelease: population.pendingRelease ?? { idle: 0, resting: 0 },
    },
    carrots: state.village.resources.find((r) => r.code === 'carrot')?.amount ?? 0,
    extractionPools:
      state.village.extractionPools ??
      (['wood', 'stone'] as const).map((resource) => ({
        resource,
        siteCount: 1,
        workerCap: 5,
        mobilized: 0,
        activeSites: 0,
        pendingTargets: 0,
      })),
    openWorksites,
  };
}

/** A frozen confirmed basis prevents double-counting when SSE includes an unacknowledged head. */
export function requestedPools(confirmed: HudWorkforceState, items: HudWorkforceIntent[]): ExtractionPool[] {
  const pools = confirmed.extractionPools.map((pool) => ({ ...pool }));
  for (const intent of items) {
    if (intent.kind !== 'pool') continue;
    const pool = pools.find((p) => p.resource === intent.command.resource);
    if (!pool) continue;
    try {
      Object.assign(pool, extractionPoolSettings(pool, intent.command.action));
    } catch {
      /* A changed server context may refuse this intention; only its receipt removes it. */
    }
  }
  return pools;
}

export function canAdjustPool(
  confirmed: HudWorkforceState,
  pools: ExtractionPool[],
  resource: ExtractionPool['resource'],
  action: ExtractionPoolCommand['action'],
  items: HudWorkforceIntent[] = [],
) {
  const pool = pools.find((p) => p.resource === resource);
  if (!pool) return false;
  try {
    const next = extractionPoolSettings(pool, action);
    if (next.siteCount === pool.siteCount && next.workerCap === pool.workerCap) return false;
    const otherSlots =
      confirmed.openWorksites.other +
      pools
        .filter((p) => p.resource !== resource)
        .reduce(
          (n, p) =>
            n +
            (items.some((i) => i.kind === 'pool' && i.command.resource === p.resource)
              ? Math.max(p.siteCount, p.activeSites)
              : confirmed.openWorksites[p.resource]),
          0,
        );
    return otherSlots + next.siteCount <= 8;
  } catch {
    return false;
  }
}

interface QueueIO {
  send: (intent: HudWorkforceIntent) => Promise<HudWorkforceConfirmation>;
  save: (pending: SavedHudIntents) => void;
  changed: () => void;
  settled: (intent: HudWorkforceIntent, result: HudWorkforceConfirmation) => void;
  failed: (error: unknown) => boolean;
}

/** One durable FIFO, with the confirmed basis saved alongside unresolved UUIDs. */
export class HudIntentQueue {
  items: HudWorkforceIntent[];
  running = false;
  stopped = false;
  blocked = false;
  retrying = false;
  #attempts = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    public confirmed: HudWorkforceState,
    initial: HudWorkforceIntent[],
    private io: QueueIO,
  ) {
    this.items = initial.slice(0, 64);
  }
  #save() {
    this.io.save({ confirmed: this.confirmed, items: this.items });
  }
  /**
   * `revisioned` is false for a V2 village state: it has no V1 revision to
   * compare with a confirmation's, so only its server time orders it. A batch
   * read just before a gesture's commit may then hide it until the next batch.
   */
  synchronize(next: HudWorkforceState, revisioned = true) {
    if (
      this.items.length ||
      next.worldId !== this.confirmed.worldId ||
      next.villageId !== this.confirmed.villageId ||
      (revisioned && next.minimumRevision < this.confirmed.minimumRevision) ||
      next.serverTime <= this.confirmed.serverTime
    )
      return;
    this.confirmed = next;
    this.#save();
    this.io.changed();
  }
  add(intent: HudWorkforceIntent) {
    if (this.items.length >= 64) throw Error('Patientez, 64 gestes sont déjà en attente.');
    this.items.push(intent);
    this.#save();
    this.io.changed();
    void this.pump();
  }
  retry() {
    if (this.#timer) clearTimeout(this.#timer);
    this.retrying = false;
    this.blocked = false;
    this.#attempts = 0;
    void this.pump();
  }
  stop() {
    this.stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
  }
  async pump() {
    if (this.running || this.blocked || this.stopped) return;
    this.running = true;
    try {
      while (this.items.length && !this.stopped) {
        const intent = this.items[0]!;
        try {
          const result = await this.io.send(intent);
          if (this.stopped) return;
          if (
            result.commandId !== intent.command.commandId ||
            result.hud.worldId !== this.confirmed.worldId ||
            result.hud.villageId !== this.confirmed.villageId
          )
            throw Error('Confirmation de geste incohérente.');
          this.confirmed = result.hud;
          this.items.shift();
          this.#attempts = 0;
          this.#save();
          this.io.settled(intent, result);
          this.io.changed();
        } catch (error) {
          if (this.stopped) return;
          if (this.io.failed(error)) {
            this.#attempts = 0;
            this.items.shift();
            this.#save();
            this.io.changed();
            continue;
          }
          this.blocked = true;
          // A lost response can already be committed. Always replay the same UUID.
          if (this.#attempts < 3) {
            const delay = [1000, 2000, 5000][this.#attempts++]!;
            this.retrying = true;
            this.#timer = setTimeout(() => {
              this.retrying = false;
              this.blocked = false;
              void this.pump();
            }, delay);
          }
          break;
        }
      }
    } finally {
      this.running = false;
      if (!this.stopped) this.io.changed();
    }
  }
}
