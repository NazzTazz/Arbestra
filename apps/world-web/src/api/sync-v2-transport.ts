import {
  processingCommandIsValid,
  processingConfirmationV2IsValid,
  syncV2BatchIsValid,
  commandReceiptReadResponseIsValid,
  villagePresentationIsValid,
  constructionConfirmationV2IsValid,
  villageCommandConfirmationV2IsValid,
  type ConstructionConfirmationV2,
  type ExploitationRequest,
  type ChangeExtractionWorksiteRequest,
  type LevelingCommand,
  type LevelingPreview,
  type ScienceCommand,
  type TerraformCommand,
  type TradeCommand,
  type VillageCommandConfirmationV2,
  type VillagePresentation,
  type ProcessingCommand,
  type ProcessingConfirmationV2,
  type SyncV2Batch,
  type SyncV2State,
  type SyncV2ReadRequest,
} from '@arbestra/contracts';
import { SyncV2Session, SyncV2ResyncRequired, SyncV2SessionExpired } from './sync-v2-session';

let nextGeneration = 0;

/** Opt-in server phases (Server-Timing) for diagnosing a gesture, production
 * included: localStorage arbestra:timing=1, then the browser's Network tab. */
const timingHeader = (): Record<string, string> => {
  try {
    return localStorage.getItem('arbestra:timing') === '1' ? { 'x-arbestra-dev-timing': '1' } : {};
  } catch {
    return {};
  }
};
export class SyncV2HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterMs = 1000,
    /** Whether the server actually sent a Retry-After header. */
    readonly hasRetryAfter = false,
  ) {
    super(message);
  }
}
type Options = {
  publish: (state: SyncV2State, observedAt: string, batch: SyncV2Batch) => void;
  expired: () => void;
  request?: typeof fetch;
  storage?: Storage;
  scopes?: SyncV2ReadRequest['scopes'];
  /** Shared scopes keyed by the server; the private stream is implicit. */
  include?: readonly ('knowledge' | 'manifest' | 'traffic')[];
  /** The private snapshot exceeds the server bound: rereads are spaced and
   * this receives the delay before the next attempt, then null once a read
   * succeeds again. */
  onScopeTooLarge?: (retryInMs: number | null) => void;
};

const SCOPE_TOO_LARGE = 'SYNC_SCOPE_TOO_LARGE';
const SCOPE_TOO_LARGE_FIRST_MS = 15_000;
const SCOPE_TOO_LARGE_MAX_MS = 60_000;
const isScopeTooLarge = (error: unknown): error is SyncV2HttpError =>
  error instanceof SyncV2HttpError && error.code === SCOPE_TOO_LARGE;

async function parse(response: Response): Promise<unknown> {
  const data: unknown = await response.json();
  if (response.status === 401) throw new SyncV2SessionExpired();
  if (!response.ok) {
    const error = data as { code?: string; message?: string };
    const header = response.headers.get('retry-after');
    const seconds = Number(header ?? '1');
    throw new SyncV2HttpError(
      response.status,
      error.code ?? 'HTTP_ERROR',
      error.message ?? 'Synchronisation indisponible.',
      Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, 60)) * 1000 : 1000,
      header !== null && Number.isFinite(seconds),
    );
  }
  return data;
}
const includeQuery = (options: Options) => (options.include?.length ? `&include=${options.include.join(',')}` : '');

/** One mounted village owns this transport. Only intentions are persisted:
 * every reload reacquires complete projection values with their cursors. */
export class SyncV2Transport {
  /** First load without the historical village read: the server resolves
   * the default village, whose id then comes from the snapshot itself. */
  static async bootstrapWorld(worldSlug: string, options: Options): Promise<SyncV2Transport> {
    const generation = ++nextGeneration,
      request = options.request ?? ((input, init) => fetch(input, init));
    const input = await parse(
      await request(
        `/api/worlds/${encodeURIComponent(worldSlug)}/village/bootstrap?generation=${generation}${includeQuery(options)}`,
        {
          credentials: 'same-origin',
          headers: { 'x-arbestra-protocol': '2', 'x-arbestra-generation': String(generation), ...timingHeader() },
        },
      ),
    );
    if (!syncV2BatchIsValid(input) || input.coverage !== 'scope-snapshot' || input.generation !== generation)
      throw new SyncV2ResyncRequired();
    const transport = new SyncV2Transport(worldSlug, input.worldId, input.villageId, options, generation);
    transport.open(input);
    return transport;
  }
  generation: number;
  private session: SyncV2Session | null = null;
  private closed = false;
  private readonly controller = new AbortController();
  private retry: ReturnType<typeof setTimeout> | undefined;
  private refreshFlight: Promise<void> | null = null;
  private pendingKey: string | null = null;
  private tooLargeFailures = 0;
  private holdUntil = 0;
  private tooLargeDelay = 2000;
  private readonly request: typeof fetch;
  private readonly storage: Storage | undefined;
  private readonly root: string;
  constructor(
    private readonly worldSlug: string,
    readonly worldId: string,
    readonly villageId: string,
    private options: Options,
    generation?: number,
  ) {
    this.generation = generation ?? ++nextGeneration;
    // Never store the global fetch as a method: browsers reject that receiver.
    this.request = options.request ?? ((input, init) => fetch(input, init));
    this.storage = options.storage ?? globalThis.sessionStorage;
    this.root = `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}`;
  }
  get snapshot() {
    return this.session?.snapshot;
  }
  private async json(path: string, init: RequestInit = {}): Promise<unknown> {
    return parse(
      await this.request(this.root + path, {
        credentials: 'same-origin',
        ...init,
        signal: this.controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-arbestra-protocol': '2',
          'x-arbestra-generation': String(this.generation),
          ...timingHeader(),
          ...init.headers,
        },
      }),
    );
  }
  /** A new owner (the mounted village) takes over an already open session. */
  rebind(handlers: Pick<Options, 'publish' | 'expired' | 'onScopeTooLarge'>) {
    this.options = { ...this.options, ...handlers };
  }
  /** A refused snapshot because the village is too large: records the next
   * delay (Retry-After, else a growing bounded backoff) and flags it. */
  private noteScopeTooLarge(error: unknown) {
    if (!isScopeTooLarge(error)) return;
    this.tooLargeFailures++;
    this.tooLargeDelay = error.hasRetryAfter
      ? Math.max(1000, error.retryAfterMs)
      : Math.min(SCOPE_TOO_LARGE_FIRST_MS * 2 ** (this.tooLargeFailures - 1), SCOPE_TOO_LARGE_MAX_MS);
    this.holdUntil = Date.now() + this.tooLargeDelay;
    this.options.onScopeTooLarge?.(this.tooLargeDelay);
  }
  private clearScopeTooLarge() {
    if (!this.tooLargeFailures) return;
    this.tooLargeFailures = 0;
    this.holdUntil = 0;
    this.options.onScopeTooLarge?.(null);
  }
  /** Delay before retrying after a failure: spaced when the village is too large. */
  private retryDelay(error: unknown): number {
    return isScopeTooLarge(error) ? this.tooLargeDelay : 2000;
  }
  async start(alreadyWoken = false): Promise<void> {
    let input: unknown;
    try {
      input = await this.startRead(alreadyWoken);
    } catch (error) {
      this.noteScopeTooLarge(error);
      throw error;
    }
    this.clearScopeTooLarge();
    this.finishStart(input);
  }
  private startRead(alreadyWoken: boolean): Promise<unknown> {
    return this.json(
      alreadyWoken ? '/sync/read' : `/bootstrap?generation=${this.generation}${includeQuery(this.options)}`,
      alreadyWoken
        ? {
            method: 'POST',
            body: JSON.stringify({
              protocol: 2,
              generation: this.generation,
              scopes: this.options.scopes ?? [],
              cursors: [],
            }),
          }
        : {},
    );
  }
  private finishStart(input: unknown) {
    if (this.closed) return;
    if (
      !syncV2BatchIsValid(input) ||
      input.coverage !== 'scope-snapshot' ||
      input.worldId !== this.worldId ||
      input.villageId !== this.villageId ||
      input.generation !== this.generation
    )
      throw new SyncV2ResyncRequired();
    this.open(input);
  }
  private open(input: SyncV2Batch) {
    // Same per-tab convention as pending constructions: world and village.
    this.pendingKey = `arbestra:pending-processing:${this.worldSlug}:${this.villageId}`;
    this.session = new SyncV2Session(
      {
        worldId: this.worldId,
        villageId: this.villageId,
        generation: this.generation,
        scopes: new Map(),
        subscribedScopes: new Set(input.groups.map((group) => `${group.stream.kind}:${group.stream.key}`)),
      },
      (state, observedAt, batch) => this.options.publish(state, observedAt, batch),
      this.request,
    );
    this.session.apply(input);
    void this.listen();
  }
  private async listen(): Promise<void> {
    if (this.closed || !this.session) return;
    try {
      await this.session.connect(this.root + '/sync/stream');
    } catch (error) {
      if (this.closed) return;
      if (error instanceof SyncV2SessionExpired) {
        this.close();
        this.options.expired();
        return;
      }
      let failure: unknown = error;
      if (error instanceof SyncV2ResyncRequired) {
        try {
          await this.refresh(true);
        } catch (refreshError) {
          if (refreshError instanceof SyncV2SessionExpired) {
            this.close();
            this.options.expired();
            return;
          }
          // Even a snapshot is refused: a stream epoch was replaced, which a
          // subscription generation never accepts. Reopen a new one.
          if (refreshError instanceof SyncV2ResyncRequired) return this.reopen();
          failure = refreshError;
        }
      }
      if (!this.closed) this.retry = setTimeout(() => void this.listen(), this.retryDelay(failure));
      return;
    }
    if (!this.closed) this.retry = setTimeout(() => void this.listen(), 2000);
  }
  /** New subscription generation from a full bootstrap; its stream starts
   * with it. Retried until it succeeds, the session expires or we close. */
  private async reopen(): Promise<void> {
    if (this.closed) return;
    this.session?.close();
    this.session = null;
    this.generation = ++nextGeneration;
    try {
      await this.start();
    } catch (error) {
      if (this.closed) return;
      if (error instanceof SyncV2SessionExpired) {
        this.close();
        this.options.expired();
        return;
      }
      this.retry = setTimeout(() => void this.reopen(), this.retryDelay(error));
    }
  }
  refresh(snapshot = false): Promise<void> {
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = (async () => {
      const session = this.session;
      if (this.closed || !session) return;
      const cursors = session.cursors;
      let input: unknown;
      try {
        input = await this.json('/sync/read', {
          method: 'POST',
          body: JSON.stringify({
            protocol: 2,
            generation: this.generation,
            scopes: cursors.map(({ kind, key }) => ({ kind, key })),
            cursors: snapshot ? [] : cursors,
          }),
        });
      } catch (error) {
        this.noteScopeTooLarge(error);
        throw error;
      }
      this.clearScopeTooLarge();
      if (!this.closed && this.session === session) session.apply(input);
    })().finally(() => {
      this.refreshFlight = null;
    });
    return this.refreshFlight;
  }
  reconnect() {
    // A too large village is not reread on every gesture: wait for the delay.
    if (Date.now() < this.holdUntil) return;
    void this.refresh().catch((error) => {
      if (error instanceof SyncV2SessionExpired) {
        this.close();
        this.options.expired();
      }
    });
  }
  pending(): ProcessingCommand[] {
    if (!this.pendingKey) return [];
    try {
      const data: unknown = JSON.parse(this.storage?.getItem(this.pendingKey) ?? '[]');
      return Array.isArray(data) ? data.filter(processingCommandIsValid).slice(0, 32) : [];
    } catch {
      return [];
    }
  }
  private remember(command: ProcessingCommand, remove = false) {
    if (!this.pendingKey) throw Error('Synchronisation non initialisée.');
    const pending = this.pending().filter((row) => row.commandId !== command.commandId);
    if (!remove) {
      if (pending.length >= 32) throw Error('Trop de commandes à vérifier.');
      pending.push(command);
    }
    if (pending.length) this.storage?.setItem(this.pendingKey, JSON.stringify(pending));
    else this.storage?.removeItem(this.pendingKey);
  }
  /** Drops the intention locally only; an already committed command is not
   * undone and its effects still arrive through the private stream. */
  forget(commandId: string) {
    const command = this.pending().find((row) => row.commandId === commandId);
    if (command) this.remember(command, true);
  }
  /** After a reload or a lost response: applied receipts are final and
   * their effects are already in the fresh projection. Absent receipts stay
   * unknown and are returned for an explicit retry with the same UUID. */
  async recover(): Promise<ProcessingCommand[]> {
    const pending = this.pending();
    if (this.closed || !pending.length) return pending;
    const input = await this.json('/commands/receipts/read', {
      method: 'POST',
      body: JSON.stringify({ commands: pending.map(({ commandId }) => ({ family: 'processing', commandId })) }),
    });
    if (
      !commandReceiptReadResponseIsValid(input) ||
      input.worldId !== this.worldId ||
      input.villageId !== this.villageId
    )
      throw Error('Reçus de commande invalides.');
    const applied = new Set(
      input.receipts.filter((receipt) => receipt.family === 'processing').map((receipt) => receipt.commandId),
    );
    for (const command of pending) if (applied.has(command.commandId)) this.remember(command, true);
    return this.pending();
  }
  async processing(command: ProcessingCommand): Promise<ProcessingConfirmationV2> {
    if (this.closed || !this.session) throw Error('Synchronisation indisponible.');
    this.remember(command);
    let input: unknown;
    try {
      input = await this.json('/processing', { method: 'POST', body: JSON.stringify(command) });
    } catch (error) {
      // A business refusal rolled back without mutation: nothing to verify.
      if (error instanceof SyncV2HttpError && error.status >= 400 && error.status < 500) this.remember(command, true);
      throw error;
    }
    if (
      !processingConfirmationV2IsValid(input) ||
      input.commandId !== command.commandId ||
      input.worldId !== this.worldId ||
      input.villageId !== this.villageId
    )
      throw Error('Confirmation de fabrication invalide.');
    // An applied receipt is final even if its effects need a fresh projection.
    this.remember(command, true);
    if (!this.closed && input.effects) {
      try {
        this.session.apply(input.effects);
      } catch (error) {
        if (!(error instanceof SyncV2ResyncRequired)) throw error;
        this.reconnect();
      }
    }
    return input;
  }
  /** Building placement on the V2 contract. Uncertain outcomes are kept by
   * the caller's existing construction intent (same UUID on retry). */
  async construct(body: {
    commandId: string;
    buildingType: string;
    anchorCellX: number;
    anchorCellY: number;
    cells: Array<{ cellX: number; cellY: number }>;
    expectedCosts: Array<{ resourceCode: string; amount: number }>;
    quarterTurns: number;
    houseVariant: 'stone' | 'logs' | 'beams';
  }): Promise<ConstructionConfirmationV2> {
    return this.confirmConstruction('/buildings', body);
  }
  /** Upgrade of a building on the V2 contract (same confirmation as placement). */
  upgrade(
    buildingId: string,
    body: {
      commandId: string;
      expectedCosts: Array<{ resourceCode: string; amount: number }>;
      expectedLevel?: number | undefined;
    },
  ): Promise<ConstructionConfirmationV2> {
    return this.confirmConstruction(`/buildings/${encodeURIComponent(buildingId)}/upgrade`, body);
  }
  /** Garden expansion on the V2 contract. */
  expand(
    buildingId: string,
    body: {
      commandId: string;
      cells: Array<{ cellX: number; cellY: number }>;
      expectedCosts: Array<{ resourceCode: string; amount: number }>;
    },
  ): Promise<ConstructionConfirmationV2> {
    return this.confirmConstruction(`/buildings/${encodeURIComponent(buildingId)}/expansions`, body);
  }
  private async confirmConstruction(path: string, body: { commandId: string }): Promise<ConstructionConfirmationV2> {
    if (this.closed || !this.session) throw Error('Synchronisation indisponible.');
    const input = await this.json(path, { method: 'POST', body: JSON.stringify(body) });
    if (
      !constructionConfirmationV2IsValid(input) ||
      input.commandId !== body.commandId ||
      input.worldId !== this.worldId ||
      input.villageId !== this.villageId
    )
      throw Error('Confirmation de construction invalide.');
    this.applyEffects(input.effects);
    return input;
  }
  /** University command (programs, training, pause, recall) on the V2 contract. */
  science(command: ScienceCommand, commandId: string): Promise<VillageCommandConfirmationV2> {
    return this.gesture('/science', commandId, command);
  }
  /** Town-hall supplies discovery; a retry is idempotent on the server. */
  discoverSupplies(buildingId: string, commandId: string): Promise<VillageCommandConfirmationV2> {
    return this.gesture(`/buildings/${encodeURIComponent(buildingId)}/discover-supplies`, commandId);
  }
  discoverCatEyes(commandId: string): Promise<VillageCommandConfirmationV2> {
    return this.gesture('/discover-cat-eyes', commandId);
  }
  /** Player market (publish, cancel, accept, oracle) with its receipt UUID. */
  trade(command: TradeCommand): Promise<VillageCommandConfirmationV2> {
    return this.gesture('/market/trades', command.commandId, command);
  }
  /** Leveling site with its receipt UUID. */
  level(command: LevelingCommand): Promise<VillageCommandConfirmationV2> {
    return this.gesture('/leveling', command.commandId, command);
  }
  /** Pause, resume, stop or cap change of an extraction worksite. */
  changeWorksite(worksiteId: string, change: ChangeExtractionWorksiteRequest): Promise<VillageCommandConfirmationV2> {
    return this.gesture(`/worksites/${encodeURIComponent(worksiteId)}`, change.commandId, change);
  }
  /** Terraforming: either started (V2 confirmation and effects) or an
   * adjusted quote, rolled back without effects, for the player to confirm. */
  async terraform(
    command: TerraformCommand,
  ): Promise<{ status: 'started' } | { status: 'changed'; preview: LevelingPreview }> {
    if (this.closed || !this.session) throw Error('Synchronisation indisponible.');
    const input = await this.json('/terraform', {
      method: 'POST',
      headers: { 'x-arbestra-command': command.commandId },
      body: JSON.stringify(command),
    });
    if (input && typeof input === 'object' && (input as { status?: unknown }).status === 'changed')
      return input as { status: 'changed'; preview: LevelingPreview };
    this.confirmed(input, command.commandId);
    return { status: 'started' };
  }
  /** Mixed exploitation order; its own UUID identifies the gesture. */
  exploit(request: ExploitationRequest): Promise<VillageCommandConfirmationV2> {
    return this.gesture('/exploitation', request.commandId, request);
  }
  /** A gesture without a domain result: the UUID travels in a header, the
   * commit's effects update the session at once. */
  private async gesture(path: string, commandId: string, body?: object): Promise<VillageCommandConfirmationV2> {
    if (this.closed || !this.session) throw Error('Synchronisation indisponible.');
    // A JSON request needs a body; bodyless gestures send an empty object.
    const input = await this.json(path, {
      method: 'POST',
      headers: { 'x-arbestra-command': commandId },
      body: JSON.stringify(body ?? {}),
    });
    return this.confirmed(input, commandId);
  }
  private confirmed(input: unknown, commandId: string): VillageCommandConfirmationV2 {
    if (
      !villageCommandConfirmationV2IsValid(input) ||
      input.commandId !== commandId ||
      input.worldId !== this.worldId ||
      input.villageId !== this.villageId
    )
      throw Error('Confirmation de commande invalide.');
    this.applyEffects(input.effects);
    // The ACK carries only private effects. Science programs (knowledge),
    // the other village of a trade or public convoys change in other streams:
    // read their deltas now rather than at the next stream poll.
    this.reconnect();
    return input;
  }
  private applyEffects(effects: SyncV2Batch | undefined) {
    if (this.closed || !effects || !this.session) return;
    try {
      this.session.apply(effects);
    } catch (error) {
      if (!(error instanceof SyncV2ResyncRequired)) throw error;
      this.reconnect();
    }
  }
  /** Versioned presentation read; null when the given version is current.
   * With `knownRegion`, an unchanged terrain window comes back as null. */
  async presentation(version?: string, knownRegion?: string): Promise<VillagePresentation | null> {
    const response = await this.request(
      this.root + '/presentation' + (knownRegion ? `?knownRegion=${knownRegion}` : ''),
      {
        credentials: 'same-origin',
        signal: this.controller.signal,
        headers: {
          'x-arbestra-protocol': '2',
          ...timingHeader(),
          ...(version ? { 'if-none-match': `"${version}"` } : {}),
        },
      },
    );
    if (response.status === 304) return null;
    if (response.status === 401) throw new SyncV2SessionExpired();
    const data: unknown = await response.json();
    if (!response.ok)
      throw new SyncV2HttpError(
        response.status,
        (data as { code?: string }).code ?? 'HTTP_ERROR',
        'Présentation indisponible.',
      );
    if (!villagePresentationIsValid(data) || data.worldId !== this.worldId || data.villageId !== this.villageId)
      throw Error('Présentation invalide.');
    return data;
  }
  close() {
    this.closed = true;
    this.controller.abort();
    this.session?.close();
    if (this.retry) clearTimeout(this.retry);
  }
}
