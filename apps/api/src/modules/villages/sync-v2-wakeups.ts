import pg from 'pg';

/** Channel of the wakes queued by game_sync_publish() (migration 080). */
export const SYNC_V2_WAKE_CHANNEL = 'arbestra_sync_v2';

/** Streams of one world (`scopes` as "kind:key"), a whole world (`scopes`
 * null), or every stream of the process (`null`: a (re)connection of the
 * listener, an unreadable payload). Identifiers only: a woken stream rereads
 * the journal through its own authorized reader. */
export type SyncWake = { worldId: string; scopes: readonly string[] | null } | null;

const scopeKey = (kind: string, key: string) => `${kind}:${key}`;

/** A malformed payload wakes everything rather than nothing. */
export function parseSyncWake(payload: string | undefined): SyncWake {
  try {
    const value = JSON.parse(payload ?? '') as { w?: unknown; s?: unknown };
    if (typeof value.w !== 'string') return null;
    if (value.s === undefined) return { worldId: value.w, scopes: null };
    if (!Array.isArray(value.s)) return null;
    const scopes: string[] = [];
    for (const item of value.s as unknown[]) {
      if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'string') return null;
      scopes.push(scopeKey(item[0], item[1]));
    }
    return { worldId: value.w, scopes };
  } catch {
    return null;
  }
}

/** One SSE stream's wake. Created before the stream's first capture, it keeps
 * what arrives until `watch()` names the streams that capture covers, so a
 * publication committed after the capture's snapshot is not lost. */
export interface SyncWakeSubscription {
  watch(worldId: string, scopes: ReadonlyArray<{ kind: string; key: string }>): void;
  /** Set by a wake, cleared by `clear()` right before each read: a wake
   * arriving during a read leaves it set, and the loop reads again. */
  readonly dirty: boolean;
  clear(): void;
  /** Called on each wake, at once if already dirty; `undefined` detaches. */
  listen(listener: (() => void) | undefined): void;
  close(): void;
}
export interface SyncWakeSource {
  subscribe(): SyncWakeSubscription;
}

/** Wakes kept by a subscription before `watch()`; beyond, it reads again. */
const EARLY_WAKES = 32;

class Subscription implements SyncWakeSubscription {
  dirty = false;
  private listener: (() => void) | undefined;
  private early: SyncWake[] | 'overflow' | null = [];
  private watched: { worldId: string; scopes: string[] } | null = null;
  constructor(private readonly hub: SyncV2Wakeups | null) {}

  receive(wake: SyncWake) {
    if (this.early === null) return;
    if (this.early === 'overflow' || this.early.length >= EARLY_WAKES) this.early = 'overflow';
    else this.early.push(wake);
  }
  watch(worldId: string, scopes: ReadonlyArray<{ kind: string; key: string }>) {
    const early = this.early;
    if (early === null) return;
    this.early = null;
    const keys = [...new Set(scopes.map((scope) => scopeKey(scope.kind, scope.key)))];
    this.watched = { worldId, scopes: keys };
    this.hub?.index(this, worldId, keys);
    if (
      early === 'overflow' ||
      early.some(
        (wake) =>
          wake === null ||
          (wake.worldId === worldId && (!wake.scopes || wake.scopes.some((key) => keys.includes(key)))),
      )
    )
      this.wake();
  }
  wake() {
    this.dirty = true;
    this.listener?.();
  }
  clear() {
    this.dirty = false;
  }
  listen(listener: (() => void) | undefined) {
    this.listener = listener;
    if (listener && this.dirty) listener();
  }
  close() {
    this.listener = undefined;
    this.early = null;
    this.hub?.remove(this, this.watched);
    this.watched = null;
  }
}

interface WakeupOptions {
  /** Wait before reconnecting a lost listener; tests hold it. */
  retryDelay?: () => Promise<void>;
}

/** One LISTEN connection per process, shared by every SSE stream (spec §8.4:
 * no SQL connection per browser). A notification wakes only the streams
 * indexed under its world and scope keys. A (re)connection wakes every
 * stream: notifications sent while nobody listened are lost, and a read
 * catches up what they announced. Works across processes: a worker outside
 * the API publishes through the same SQL function. */
export class SyncV2Wakeups implements SyncWakeSource {
  private client: pg.Client | undefined;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private listening = false;
  private pid: number | null = null;
  private received = 0;
  private lastSuccessAt: string | null = null;
  private lastErrorAt: string | null = null;
  private readonly pending = new Set<Subscription>();
  private readonly worlds = new Map<string, Map<string, Set<Subscription>>>();

  constructor(
    private readonly url: string,
    private readonly onError: (error: unknown) => void = () => {},
    private readonly options: WakeupOptions = {},
  ) {}

  get observation() {
    let watched = 0;
    for (const world of this.worlds.values()) for (const set of world.values()) watched += set.size;
    return {
      connected: this.listening,
      closed: this.closed,
      backendPid: this.pid,
      notifications: this.received,
      pending: this.pending.size,
      watched,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
    };
  }

  subscribe(): SyncWakeSubscription {
    if (this.closed) return new Subscription(null);
    const subscription = new Subscription(this);
    this.pending.add(subscription);
    return subscription;
  }

  /** Never rejects: a failed connection is retried. */
  async start(): Promise<void> {
    if (this.closed || this.client) return;
    const client = new pg.Client({
      connectionString: this.url,
      application_name: 'arbestra-sync-v2-listener',
      keepAlive: true,
    });
    this.client = client;
    client.on('notification', (message) => {
      if (this.client === client && message.channel === SYNC_V2_WAKE_CHANNEL) this.receive(message.payload);
    });
    client.on('error', (error) => {
      this.failed(error);
      void this.reconnect(client);
    });
    client.on('end', () => {
      // An end without a prior error is still a loss of the listener.
      if (this.client === client && !this.closed) this.failed(Error('SYNC_V2_LISTENER_ENDED'));
      void this.reconnect(client);
    });
    try {
      await client.connect();
      const { rows } = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
      await client.query(`listen ${SYNC_V2_WAKE_CHANNEL}`);
      if (this.client !== client) return;
      this.pid = rows[0]!.pid;
      this.listening = true;
      this.lastSuccessAt = new Date().toISOString();
      // Whatever committed while this process did not listen.
      this.dispatch(null);
    } catch (error) {
      this.failed(error);
      // In the background: the caller (buildApp) does not wait for the database.
      void this.reconnect(client);
    }
  }

  /** A raw payload of the channel (the listener's handler). */
  receive(payload: string | undefined): void {
    this.received++;
    this.dispatch(parseSyncWake(payload));
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listening = false;
    if (this.retry) clearTimeout(this.retry);
    this.pending.clear();
    this.worlds.clear();
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => {});
  }

  /** @internal */
  index(subscription: Subscription, worldId: string, keys: readonly string[]) {
    this.pending.delete(subscription);
    if (this.closed) return;
    let world = this.worlds.get(worldId);
    if (!world) this.worlds.set(worldId, (world = new Map()));
    for (const key of keys) {
      let set = world.get(key);
      if (!set) world.set(key, (set = new Set()));
      set.add(subscription);
    }
  }

  /** @internal */
  remove(subscription: Subscription, watched: { worldId: string; scopes: readonly string[] } | null) {
    this.pending.delete(subscription);
    if (!watched) return;
    const world = this.worlds.get(watched.worldId);
    if (!world) return;
    for (const key of watched.scopes) {
      const set = world.get(key);
      set?.delete(subscription);
      if (set?.size === 0) world.delete(key);
    }
    if (world.size === 0) this.worlds.delete(watched.worldId);
  }

  private dispatch(wake: SyncWake) {
    for (const subscription of this.pending) subscription.receive(wake);
    const worlds = wake === null ? [...this.worlds.values()] : [this.worlds.get(wake.worldId)];
    for (const world of worlds) {
      if (!world) continue;
      if (wake === null || wake.scopes === null) {
        for (const set of world.values()) for (const subscription of set) subscription.wake();
      } else for (const key of wake.scopes) for (const subscription of world.get(key) ?? []) subscription.wake();
    }
  }

  private failed(error: unknown) {
    this.lastErrorAt = new Date().toISOString();
    this.onError(error);
  }

  private async reconnect(client: pg.Client) {
    if (this.client !== client) return;
    this.listening = false;
    this.pid = null;
    this.client = undefined;
    await client.end().catch(() => {});
    if (this.closed) return;
    await (this.options.retryDelay?.() ??
      new Promise<void>((resolve) => {
        this.retry = setTimeout(resolve, 1000);
      }));
    if (!this.closed) await this.start();
  }
}
