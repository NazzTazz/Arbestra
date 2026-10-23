import { applySyncV2Batch, readServerEvents, type SyncV2State, type SyncV2Batch } from '@arbestra/contracts';

export interface AppliedSyncCursor {
  kind: string;
  key: string;
  epoch: string;
  revision: string;
}
export class SyncV2ResyncRequired extends Error {
  constructor() {
    super('SYNC_V2_RESYNC_REQUIRED');
  }
}
export class SyncV2SessionExpired extends Error {
  constructor() {
    super('SYNC_V2_SESSION_EXPIRED');
  }
}

/** One subscription generation owns its socket and canonical cursors. HTTP
 * acknowledgements may update overlays, but reconnect always uses applied
 * complete state. The game adapter supplies the bootstrap and publication. */
export class SyncV2Session {
  private state: SyncV2State;
  private controller: AbortController | null = null;
  private closed = false;
  constructor(
    initial: SyncV2State,
    private readonly publish: (state: SyncV2State, observedAt: string, batch: SyncV2Batch) => void,
    private readonly request: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.state = initial;
  }

  get snapshot(): SyncV2State {
    return this.state;
  }
  get cursors(): AppliedSyncCursor[] {
    return [...this.state.scopes].map(([scope, value]) => {
      const separator = scope.indexOf(':');
      return {
        kind: scope.slice(0, separator),
        key: scope.slice(separator + 1),
        epoch: value.epoch,
        revision: value.revision,
      };
    });
  }
  apply(input: unknown): 'applied' | 'ignored' {
    if (this.closed) return 'ignored';
    const result = applySyncV2Batch(this.state, input);
    if (result.kind === 'resync') throw new SyncV2ResyncRequired();
    if (result.kind === 'applied') {
      this.state = result.state;
      this.publish(this.state, (input as SyncV2Batch).observedAt, input as SyncV2Batch);
    }
    return result.kind;
  }
  close(): void {
    this.closed = true;
    this.controller?.abort();
    this.controller = null;
  }

  /** A single attempt. Reconnect scheduling belongs to the lifecycle owner;
   * overlapping attempts abort the previous reader before opening another. */
  async connect(url: string): Promise<void> {
    if (this.closed) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const current = () => !this.closed && this.controller === controller && !controller.signal.aborted;
    try {
      const response = await this.request(url, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-arbestra-protocol': '2' },
        body: JSON.stringify({
          protocol: 2,
          generation: this.state.generation,
          scopes: this.cursors.map(({ kind, key }) => ({ kind, key })),
          cursors: this.cursors,
        }),
      });
      if (!current()) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 401) throw new SyncV2SessionExpired();
      if (!response.ok) throw new Error(`SYNC_V2_HTTP_${response.status}`);
      if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body)
        throw new Error('SYNC_V2_INVALID_STREAM');
      await readServerEvents(response.body, {
        signal: controller.signal,
        current,
        onEvent: (event) => {
          if (event.event === 'heartbeat') return;
          if (event.event === 'expired') throw new SyncV2SessionExpired();
          if (event.event === 'reset') throw new SyncV2ResyncRequired();
          if (event.event !== 'batch') throw new Error('SYNC_V2_UNKNOWN_EVENT');
          this.apply(JSON.parse(event.data));
        },
      });
    } catch (error) {
      if (current()) throw error;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
}
