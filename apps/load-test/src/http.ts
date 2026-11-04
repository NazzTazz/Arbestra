/** The HTTP side of one bot: the `fetch` given to the client's own V2
 * transport (apps/world-web/src/api/sync-v2-transport.ts), so the bots send the
 * exact headers, bodies and stream requests of the game client. It adds the
 * session cookie and the base URL, times every request, reads its
 * Server-Timing phases, and copies the event stream to measure when an effect
 * arrives. */
import { readServerEvents } from '@arbestra/contracts';
import { classifyStatus, serverTimingPhases, type RequestEvent } from './stats.js';

/** Request kind from the method, path and body: one latency series each. */
export function requestKind(method: string, path: string, body?: string): string {
  const p = path.split('?')[0]!;
  if (p.endsWith('/village/bootstrap') || /\/villages\/[^/]+\/bootstrap$/.test(p)) return 'bootstrap';
  if (p.endsWith('/sync/read')) return 'sync-read';
  if (p.endsWith('/sync/stream')) return 'sse-open';
  if (p.endsWith('/presentation')) return 'presentation';
  if (/\/terrain$/.test(p)) return 'terrain';
  if (p.endsWith('/commands/receipts/read')) return 'receipts-read';
  if (/\/buildings\/[^/]+\/upgrade$/.test(p)) return 'upgrade';
  if (p.endsWith('/buildings')) return 'build';
  if (p.endsWith('/extraction-pools')) return 'hud-pool';
  if (p.endsWith('/population/gestures')) return 'hud-population';
  if (p.endsWith('/harvest-intents')) return 'harvest';
  if (p.endsWith('/terrain-edits')) return body?.includes('"terrain-restore"') ? 'terrain-restore' : 'terraform';
  if (p.endsWith('/market/trades')) {
    const action = /"action":"(publish|cancel|accept|oracle)"/.exec(body ?? '')?.[1];
    return 'market-' + (action ?? 'trade');
  }
  if (p.endsWith('/market/offers')) return 'market-browse';
  if (p.endsWith('/science')) return 'expedition';
  if (p === '/api/health') return 'health';
  if (p === '/api/auth/login') return 'login';
  return method.toLowerCase() + ':' + p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').slice(0, 80);
}

/** A command confirmed over HTTP whose effect is awaited on the stream. */
interface Expectation {
  kind: string;
  at: number;
  /** Private village stream revision carried by the confirmation's effects. */
  revision?: bigint;
  /** Asynchronous intents (harvest): the stream batch that mentions the command. */
  commandId?: string;
}

export interface HttpObserver {
  request(event: RequestEvent): void;
  effect(kind: string, ms: number): void;
  effectMissed(kind: string): void;
  streamOpened(reconnect: boolean): void;
  streamClosed(): void;
}

const EFFECT_TIMEOUT_MS = 60_000;

export class BotHttp {
  cookie: string;
  private streams = 0;
  private expectations: Expectation[] = [];
  private streamRevision: { revision: bigint; at: number } | null = null;
  private recentText: Array<{ at: number; text: string }> = [];
  villageId: string | null = null;
  constructor(
    private readonly base: string,
    cookieName: string,
    token: string,
    private readonly observer: HttpObserver,
    private readonly serverTiming: boolean,
  ) {
    this.cookie = `${cookieName}=${token}`;
  }

  /** `fetch` for the transport: relative URLs, as in the browser. */
  readonly request: typeof fetch = async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const kind = requestKind(method, path, body);
    const headers = new Headers(init?.headers);
    headers.set('cookie', this.cookie);
    if (this.serverTiming) headers.set('x-arbestra-dev-timing', '1');
    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(this.base + path, { ...init, headers });
    } catch (error) {
      if (init?.signal?.aborted && kind === 'sse-open') throw error;
      this.observer.request({
        t: Date.now(),
        kind,
        outcome: 'error',
        status: 0,
        ms: performance.now() - started,
        code: (error as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK',
      });
      throw error;
    }
    if (kind === 'sse-open') return this.stream(response, started);
    const buffer = await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    const ms = performance.now() - started;
    const text = new TextDecoder().decode(buffer);
    let code: string | undefined;
    let json: unknown = null;
    // V2 confirmations go through a custom serializer: parse any JSON-looking body.
    if (text && (text.startsWith('{') || text.startsWith('[')))
      try {
        json = JSON.parse(text);
      } catch {
        /* reported by the caller's parser */
      }
    if (!response.ok) code = (json as { code?: string } | null)?.code;
    const phases = serverTimingPhases(response.headers.get('server-timing'));
    this.observer.request({
      t: Date.now(),
      kind,
      outcome: classifyStatus(response.status),
      status: response.status,
      ms,
      ...(code ? { code } : {}),
      ...(phases ? { phases } : {}),
    });
    if (response.ok && json) this.expect(kind, json);
    return new Response(response.status === 204 || response.status === 304 ? null : buffer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  /** Registers the effect a confirmed command should bring on the stream. */
  private expect(kind: string, json: unknown) {
    const ack = json as {
      commandId?: string;
      pending?: boolean;
      effects?: { groups?: Array<{ stream: { kind: string; key: string }; toRevision: string }> };
    };
    if (!ack.commandId) return;
    const at = Date.now();
    if (kind === 'harvest' || kind === 'expedition') {
      // Asynchronous intents: the worker processes them, the stream brings their receipt.
      if (this.recentText.some((r) => r.text.includes(ack.commandId!))) return this.observer.effect(kind, 0);
      this.expectations.push({ kind, at, commandId: ack.commandId });
      return;
    }
    const group = ack.effects?.groups?.find((g) => g.stream.kind === 'village' && g.stream.key === this.villageId);
    if (!group) return;
    const revision = BigInt(group.toRevision);
    if (this.streamRevision && this.streamRevision.revision >= revision)
      return this.observer.effect(kind, Math.max(0, this.streamRevision.at - at));
    this.expectations.push({ kind, at, revision });
  }

  /** Copies the event stream: the transport reads one branch, we time the other. */
  private stream(response: Response, started: number): Response {
    this.observer.request({
      t: Date.now(),
      kind: 'sse-open',
      outcome: classifyStatus(response.status),
      status: response.status,
      ms: performance.now() - started,
    });
    if (!response.ok || !response.body) return response;
    this.observer.streamOpened(this.streams++ > 0);
    const [game, probe] = response.body.tee();
    const controller = new AbortController();
    void readServerEvents(probe, {
      signal: controller.signal,
      current: () => true,
      onEvent: (event) => this.onEvent(event.event, event.data),
    })
      .catch(() => undefined)
      .finally(() => this.observer.streamClosed());
    return new Response(game, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  private onEvent(event: string, data: string) {
    if (event !== 'batch') return;
    const at = Date.now();
    this.recentText.push({ at, text: data });
    while (this.recentText.length && (this.recentText.length > 64 || at - this.recentText[0]!.at > 30_000))
      this.recentText.shift();
    let revision: bigint | null = null;
    try {
      const batch = JSON.parse(data) as {
        groups?: Array<{ stream: { kind: string; key: string }; toRevision: string }>;
      };
      const group = batch.groups?.find((g) => g.stream.kind === 'village' && g.stream.key === this.villageId);
      if (group) revision = BigInt(group.toRevision);
    } catch {
      return;
    }
    if (revision !== null && (!this.streamRevision || revision > this.streamRevision.revision))
      this.streamRevision = { revision, at };
    this.expectations = this.expectations.filter((e) => {
      const met =
        (e.revision !== undefined && revision !== null && revision >= e.revision) ||
        (e.commandId !== undefined && data.includes(e.commandId));
      if (met) this.observer.effect(e.kind, at - e.at);
      else if (at - e.at > EFFECT_TIMEOUT_MS) this.observer.effectMissed(e.kind);
      return !met && at - e.at <= EFFECT_TIMEOUT_MS;
    });
  }

  /** Expectations older than the timeout, reported as missed (end of a run). */
  sweep(now = Date.now()) {
    this.expectations = this.expectations.filter((e) => {
      if (now - e.at <= EFFECT_TIMEOUT_MS) return true;
      this.observer.effectMissed(e.kind);
      return false;
    });
  }
}
