/** One scripted bot: it plays its village through the real HTTP API with the
 * game client's own V2 transport (apps/world-web/src/api/sync-v2-transport.ts):
 * bootstrap, presentation, event stream, then one gesture every few seconds
 * chosen by actions.ts from the state it received. */
import { randomUUID } from 'node:crypto';
import {
  villageStateFromSyncV2,
  type HarvestReceipt,
  type ResolvedVillagePresentation,
  type SyncV2State,
  type TradePage,
  type VillageState,
} from '@arbestra/contracts';
import { SYNC_V2_VILLAGE_INCLUDE } from '../../world-web/src/api/sync-v2-initial.js';
import { SyncV2SessionExpired } from '../../world-web/src/api/sync-v2-session.js';
import { SyncV2Transport } from '../../world-web/src/api/sync-v2-transport.js';
import { acceptableOffers, chooseAction, type BotMemory, type Mix, type PlannedAction } from './actions.js';
import type { BotCredential } from './cli.js';
import { BotHttp, type HttpObserver } from './http.js';
import { rng } from './placement.js';

export interface BotObserver extends HttpObserver {
  action(kind: string): void;
  failure(bot: number, kind: string, error: unknown): void;
}
export interface BotOptions {
  base: string;
  world: string;
  cookieName: string;
  credential: BotCredential;
  mix: Mix;
  /** Mean think time between two gestures, milliseconds. */
  paceMs: number;
  serverTiming: boolean;
  observer: BotObserver;
}

/** Per-tab storage of the transport (pending processing intentions). */
class MemoryStorage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const PRESENTATION_MAX_AGE_MS = 120_000;

export class Bot {
  readonly http: BotHttp;
  private transport: SyncV2Transport | null = null;
  private latest: { state: SyncV2State; observedAt: string } | null = null;
  private presentation: ResolvedVillagePresentation | null = null;
  private presentationAt = 0;
  private dirty = true;
  private readonly memory: BotMemory = { terraformed: [] };
  private readonly random: () => number;
  private readonly storage = new MemoryStorage() as unknown as Storage;
  private running = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  expired = false;

  constructor(private readonly options: BotOptions) {
    this.random = rng(options.credential.index * 7919 + 17);
    this.http = new BotHttp(
      options.base,
      options.cookieName,
      options.credential.token ?? '',
      options.observer,
      options.serverTiming,
    );
  }
  get index() {
    return this.options.credential.index;
  }
  private get root() {
    if (!this.transport) throw Error('Village non chargé.');
    return `/api/worlds/${encodeURIComponent(this.options.world)}/villages/${encodeURIComponent(this.transport.villageId)}`;
  }

  /** The game's loading: bootstrap and stream (transport), presentation, terrain around the village. */
  async load(): Promise<void> {
    this.transport?.close();
    this.transport = null;
    this.presentation = null;
    this.latest = null;
    const transport = await SyncV2Transport.bootstrapWorld(this.options.world, {
      include: SYNC_V2_VILLAGE_INCLUDE,
      request: this.http.request,
      storage: this.storage,
      publish: (state, observedAt, batch) => {
        this.latest = { state, observedAt };
        // A snapshot was installed: the game rereads its presentation.
        if (batch.coverage === 'scope-snapshot') this.dirty = true;
      },
      expired: () => {
        this.expired = true;
      },
    });
    this.transport = transport;
    this.http.villageId = transport.villageId;
    this.dirty = true;
    const state = await this.state();
    const chunk = state.world.chunkSize,
      cx = Math.floor(state.village.anchorCellX / chunk),
      cy = Math.floor(state.village.anchorCellY / chunk),
      columns = Math.ceil(state.world.widthCells / chunk),
      rows = Math.ceil(state.world.heightCells / chunk);
    const chunks: string[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) chunks.push(`${(cx + dx + columns) % columns},${(cy + dy + rows) % rows}`);
    const response = await this.http.request(
      `/api/worlds/${encodeURIComponent(this.options.world)}/terrain?chunks=${encodeURIComponent(chunks.join(';'))}`,
      { credentials: 'same-origin', signal: AbortSignal.timeout(30_000) },
    );
    await response.arrayBuffer();
  }

  /** Village state as the game assembles it: stream projection + presentation. */
  private async state(): Promise<VillageState> {
    const transport = this.transport;
    if (!transport) throw Error('Village non chargé.');
    if (this.dirty || !this.presentation || Date.now() - this.presentationAt > PRESENTATION_MAX_AGE_MS) {
      const read = await transport.presentation(this.presentation?.version, this.presentation?.regionVersion);
      if (read) {
        const region = read.region ?? this.presentation?.region;
        if (!region) throw Error('Présentation sans région.');
        this.presentation = { ...read, region };
      }
      this.presentationAt = Date.now();
      this.dirty = false;
    }
    if (!this.latest || !this.presentation) throw Error('Projection V2 incomplète.');
    const state = villageStateFromSyncV2(this.latest.state, this.presentation, this.latest.observedAt);
    if (!state) throw Error('Projection V2 incomplète.');
    return state;
  }

  start(): Promise<void> {
    this.running = true;
    this.loop = (async () => {
      // Players do not all arrive on the same millisecond.
      await this.pause(this.random() * this.options.paceMs);
      while (this.running) {
        try {
          if (!this.transport || this.expired) {
            this.expired = false;
            await this.load();
          }
          await this.step();
        } catch (error) {
          this.options.observer.failure(this.index, 'step', error);
          if (error instanceof SyncV2SessionExpired) this.expired = true;
          await this.pause(2000 + this.random() * 3000);
        }
        // Exponential think time around the mean, bounded.
        const think = -Math.log(1 - this.random()) * this.options.paceMs;
        await this.pause(Math.min(this.options.paceMs * 5, Math.max(this.options.paceMs * 0.2, think)));
        this.http.sweep();
      }
    })();
    return this.loop;
  }
  private pause(ms: number) {
    return new Promise<void>((done) => {
      const timer = setTimeout(() => {
        this.wake = null;
        done();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        done();
      };
    });
  }
  async stop() {
    this.running = false;
    this.wake?.();
    await this.loop?.catch(() => undefined);
    this.transport?.close();
    this.transport = null;
  }

  private async step() {
    const state = await this.state();
    const planned = chooseAction(this.options.mix, {
      state,
      memory: this.memory,
      random: this.random,
      uuid: randomUUID,
      now: Date.now(),
    });
    this.options.observer.action(planned?.kind ?? 'none');
    if (planned) await this.execute(planned, state);
  }

  private async execute(planned: PlannedAction, state: VillageState) {
    const transport = this.transport!;
    switch (planned.kind) {
      case 'reload':
        return this.load();
      case 'harvest': {
        // As apps/world-web/src/api/client.ts sendHarvestIntent.
        const response = await this.http.request(this.root + '/harvest-intents', {
          signal: AbortSignal.timeout(15000),
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(planned.body),
        });
        if (response.ok) {
          (await response.json()) as HarvestReceipt;
          this.dirty = true;
        }
        return;
      }
      case 'hud-pool':
        await this.refused(transport.hudWorkforce({ kind: 'pool', command: planned.body }));
        return;
      case 'hud-population':
        await this.refused(transport.hudWorkforce({ kind: 'population', command: planned.body }));
        return;
      case 'build':
        await this.refused(transport.construct(planned.body));
        this.dirty = true;
        return;
      case 'upgrade':
        await this.refused(transport.upgrade(planned.buildingId, planned.body));
        this.dirty = true;
        return;
      case 'terraform':
        if (await this.refused(transport.terrainEdits(planned.body)).then((r) => r && !r.refused?.length))
          this.memory.terraformed.push(planned.record);
        this.dirty = true;
        return;
      case 'terrain-restore':
        // The undo is spent whatever the answer, as the game's « Annuler ».
        this.memory.terraformed = this.memory.terraformed.filter((r) => r !== planned.record);
        await this.refused(transport.terrainEdits(planned.body));
        this.dirty = true;
        return;
      case 'market-publish':
      case 'market-cancel':
        await this.refused(transport.trade(planned.body));
        return;
      case 'market-accept': {
        // As the market panel: browse others' offers, preview the trip, accept.
        const page = (await (
          await this.http.request(this.root + '/market/offers?mine=false', { credentials: 'same-origin' })
        ).json()) as TradePage;
        const offer = acceptableOffers(page.offers ?? [], state)[0];
        if (!offer) return;
        const preview = await this.http.request(this.root + '/market/trade-preview', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ offerId: offer.id }),
        });
        if (!preview.ok) return;
        await this.refused(transport.trade({ action: 'accept', commandId: randomUUID(), offerId: offer.id }));
        return;
      }
      case 'expedition': {
        // As apps/world-web/src/api/client.ts sendExpedition.
        const response = await this.http.request(this.root + '/science', {
          method: 'POST',
          credentials: 'same-origin',
          signal: AbortSignal.timeout(10000),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(planned.body),
        });
        await response.arrayBuffer();
        return;
      }
    }
  }

  /** A business refusal was already counted by the HTTP layer: it is not a bot failure. */
  private async refused<T>(promise: Promise<T>): Promise<T | null> {
    try {
      return await promise;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 409 || status === 422) return null;
      throw error;
    }
  }
}
