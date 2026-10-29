import { expect, it, vi } from 'vitest';
import {
  SYNC_V2_PRIVATE_COMPONENTS,
  SYNC_V2_KNOWLEDGE_COMPONENTS,
  visibleSyncV2Scope,
  type SyncV2Batch,
  type SyncV2ReadRequest,
  type SyncV2SnapshotPage,
  type SyncV2State,
} from '@arbestra/contracts';
import { SyncV2Transport } from './sync-v2-transport';
import { SyncV2SessionExpired } from './sync-v2-session';
const worldId = '11111111-1111-4111-8111-111111111111',
  villageId = '22222222-2222-4222-8222-222222222222';
const epoch = '33333333-3333-4333-8333-333333333333',
  owner = '44444444-4444-4444-8444-444444444444';
function memory(): Storage {
  const rows = new Map<string, string>();
  return {
    get length() {
      return rows.size;
    },
    clear() {
      rows.clear();
    },
    key(index) {
      return [...rows.keys()][index] ?? null;
    },
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      rows.set(key, value);
    },
    removeItem: (key) => {
      rows.delete(key);
    },
  };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'retry-after': '2' } });
function bootstrap(generation: number): SyncV2Batch {
  return {
    protocol: 2,
    worldId,
    villageId,
    generation,
    observedAt: '2026-10-22T00:00:00Z',
    coverage: 'scope-snapshot',
    groups: [
      {
        stream: { kind: 'village', key: villageId, epoch },
        fromRevision: '0',
        toRevision: '4',
        changes: SYNC_V2_PRIVATE_COMPONENTS.map((component) => ({ component, upsert: [], remove: [] })),
      },
      {
        stream: { kind: 'knowledge', key: owner, epoch },
        fromRevision: '0',
        toRevision: '1',
        changes: SYNC_V2_KNOWLEDGE_COMPONENTS.map((component) => ({ component, upsert: [], remove: [] })),
      },
    ],
  };
}
it('retains the identical UUID through catch-up and reload, persists no cursors and clears only an applied receipt', async () => {
  const storage = memory(),
    posts: unknown[] = [],
    reads: unknown[] = [],
    sockets: RequestInit[] = [],
    published: unknown[] = [];
  let fail = true;
  const request: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/sync/stream')) {
      sockets.push(init!);
      return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    }
    const generation = Number(new Headers(init?.headers).get('x-arbestra-generation'));
    if (String(url).endsWith('/sync/read')) {
      reads.push(JSON.parse(String(init?.body)));
      return json(bootstrap(generation));
    }
    const command = JSON.parse(String(init?.body));
    posts.push(command);
    if (fail) return json({ code: 'SCOPE_CATCHING_UP', message: 'Rattrapage en cours' }, 503);
    return json({
      protocol: 2,
      worldId,
      villageId,
      commandId: command.commandId,
      status: 'applied',
      commandTime: '2026-10-22T00:00:01Z',
      result: { orderId: epoch },
    });
  };
  const options = {
    storage,
    request,
    publish: (state: unknown) => published.push(state),
    expired: () => {
      throw Error('Unexpected expiration');
    },
  };
  const first = new SyncV2Transport('aube', worldId, villageId, options);
  const command = {
    commandId: '55555555-5555-4555-8555-555555555555',
    action: 'start' as const,
    buildingId: epoch,
    lots: 2,
    workerCount: 1,
  };
  await first.start(true);
  await expect(first.processing(command)).rejects.toMatchObject({ code: 'SCOPE_CATCHING_UP', retryAfterMs: 2000 });
  expect(first.pending()).toEqual([command]);
  expect(storage.length).toBe(1);
  expect(storage.getItem(storage.key(0)!)).not.toMatch(/revision|cursor|epoch/);
  first.close();
  const second = new SyncV2Transport('aube', worldId, villageId, options);
  try {
    await second.start(true);
    expect(second.pending()).toEqual([command]);
    fail = false;
    await second.processing(second.pending()[0]!);
    expect(posts).toEqual([command, command]);
    expect(second.pending()).toEqual([]);
    expect(storage.length).toBe(0);
    expect(reads).toMatchObject([{ cursors: [] }, { cursors: [] }]);
    expect(sockets.every((socket) => new Headers(socket.headers).get('x-arbestra-protocol') === '2')).toBe(true);
    expect(published).toHaveLength(2);
  } finally {
    second.close();
  }
});
it('recovers applied receipts after reload, keeps unknown ones and forgets a business refusal', async () => {
  const storage = memory(),
    receiptReads: unknown[] = [];
  const applied = { commandId: '66666666-6666-4666-8666-666666666666', action: 'pause' as const, orderId: epoch };
  const unknown = { commandId: '77777777-7777-4777-8777-777777777777', action: 'cancel' as const, orderId: epoch };
  const refused = {
    commandId: '88888888-8888-4888-8888-888888888888',
    action: 'resume' as const,
    orderId: epoch,
    workerCount: 1,
  };
  const request: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/sync/stream'))
      return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    const generation = Number(new Headers(init?.headers).get('x-arbestra-generation'));
    if (String(url).endsWith('/sync/read')) return json(bootstrap(generation));
    if (String(url).endsWith('/commands/receipts/read')) {
      receiptReads.push(JSON.parse(String(init?.body)));
      return json({
        worldId,
        villageId,
        receipts: [
          {
            family: 'processing',
            commandId: applied.commandId,
            status: 'applied',
            commandTime: '2026-10-22T00:00:01Z',
            result: { orderId: epoch },
          },
        ],
      });
    }
    return json({ code: 'PROCESSING_ORDER_NOT_RUNNING', message: 'Commande non active.' }, 409);
  };
  const transport = new SyncV2Transport('aube', worldId, villageId, {
    storage,
    request,
    publish: () => undefined,
    expired: () => {
      throw Error('Unexpected expiration');
    },
  });
  try {
    await transport.start(true);
    const key = `arbestra:pending-processing:aube:${villageId}`;
    storage.setItem(key, JSON.stringify([applied, unknown]));
    expect(await transport.recover()).toEqual([unknown]);
    expect(receiptReads).toEqual([
      {
        commands: [
          { family: 'processing', commandId: applied.commandId },
          { family: 'processing', commandId: unknown.commandId },
        ],
      },
    ]);
    await expect(transport.processing(refused)).rejects.toMatchObject({
      status: 409,
      code: 'PROCESSING_ORDER_NOT_RUNNING',
    });
    expect(transport.pending()).toEqual([unknown]);
    transport.forget(unknown.commandId);
    expect(transport.pending()).toEqual([]);
    expect(storage.length).toBe(0);
    expect(await transport.recover()).toEqual([]);
    expect(receiptReads).toHaveLength(1);
  } finally {
    transport.close();
  }
});
it('calls the browser fetch without rebinding it to the transport', async () => {
  // Browsers reject fetch invoked as a method of another object.
  const calls: string[] = [];
  vi.stubGlobal('fetch', function (this: unknown, url: RequestInfo | URL, init?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    calls.push(String(url));
    if (String(url).endsWith('/sync/stream'))
      return Promise.resolve(new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } }));
    return Promise.resolve(json(bootstrap(Number(new Headers(init?.headers).get('x-arbestra-generation')))));
  });
  const transport = new SyncV2Transport('aube', worldId, villageId, {
    storage: memory(),
    publish: () => undefined,
    expired: () => undefined,
  });
  try {
    await transport.start();
    await vi.waitFor(() => expect(calls.some((url) => url.endsWith('/sync/stream'))).toBe(true));
    expect(calls[0]).toMatch(/\/bootstrap\?generation=\d+$/);
  } finally {
    transport.close();
    vi.unstubAllGlobals();
  }
});
it('opens a world-level bootstrap with the village of the snapshot and hands the session to a new owner', async () => {
  const urls: string[] = [];
  const request: typeof fetch = async (url, init) => {
    urls.push(String(url));
    if (String(url).endsWith('/sync/stream'))
      return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    const generation = Number(new Headers(init?.headers).get('x-arbestra-generation'));
    if (String(url).endsWith('/sync/read'))
      return json({
        ...bootstrap(generation),
        coverage: 'delta',
        groups: [
          { stream: { kind: 'village', key: villageId, epoch }, fromRevision: '4', toRevision: '5', changes: [] },
        ],
      });
    return json(bootstrap(generation));
  };
  const first: unknown[] = [],
    second: unknown[] = [];
  const transport = await SyncV2Transport.bootstrapWorld('aube', {
    storage: memory(),
    request,
    include: ['knowledge'],
    publish: (state) => first.push(state),
    expired: () => undefined,
  });
  try {
    expect(urls[0]).toMatch(/^\/api\/worlds\/aube\/village\/bootstrap\?generation=\d+&include=knowledge$/);
    expect([transport.worldId, transport.villageId]).toEqual([worldId, villageId]);
    expect(first).toHaveLength(1);
    transport.rebind({ publish: (state) => second.push(state), expired: () => undefined });
    await transport.refresh();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  } finally {
    transport.close();
  }
});
it('applies a placement ACK through the session and refuses a foreign confirmation', async () => {
  const commandId = '99999999-9999-4999-8999-999999999999',
    buildingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let foreign = false;
  const request: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/sync/stream'))
      return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    const generation = Number(new Headers(init?.headers).get('x-arbestra-generation'));
    if (String(url).endsWith('/sync/read')) return json(bootstrap(generation));
    expect(new Headers(init?.headers).get('x-arbestra-protocol')).toBe('2');
    return json(
      {
        protocol: 2,
        worldId,
        villageId,
        commandId: foreign ? owner : commandId,
        status: 'applied',
        commandTime: '2026-10-22T00:00:01.000Z',
        result: { buildingId },
        effects: {
          protocol: 2,
          worldId,
          villageId,
          generation,
          observedAt: '2026-10-22T00:00:01.000Z',
          coverage: 'effects',
          groups: [
            {
              stream: { kind: 'village', key: villageId, epoch },
              fromRevision: '5',
              toRevision: '5',
              changes: [
                {
                  component: 'resources',
                  upsert: [
                    {
                      code: 'wood',
                      displayName: 'Bois',
                      iconKey: 'wood',
                      amount: 1900,
                      productionPerHour: 0,
                      productionUpdatedAt: null,
                    },
                  ],
                  remove: [],
                },
              ],
            },
          ],
        },
      },
      201,
    );
  };
  const published: Array<{ batch: SyncV2Batch }> = [];
  const transport = new SyncV2Transport('aube', worldId, villageId, {
    storage: memory(),
    request,
    publish: (_state, _at, batch) => published.push({ batch }),
    expired: () => undefined,
  });
  const body = {
    commandId,
    buildingType: 'dwelling',
    anchorCellX: 1,
    anchorCellY: 1,
    cells: [{ cellX: 1, cellY: 1 }],
    expectedCosts: [],
    quarterTurns: 0,
    houseVariant: 'logs' as const,
  };
  try {
    await transport.start(true);
    expect(await transport.construct(body)).toMatchObject({ result: { buildingId } });
    expect(published.at(-1)!.batch.coverage).toBe('effects');
    foreign = true;
    await expect(transport.construct(body)).rejects.toThrow('Confirmation de construction invalide.');
  } finally {
    transport.close();
  }
});

it('reopens a new generation when a stream epoch was replaced, instead of rereading the same snapshot forever', async () => {
  const replaced = '66666666-6666-4666-8666-666666666666';
  const withEpoch = (batch: SyncV2Batch, value: string): SyncV2Batch => ({
    ...batch,
    groups: batch.groups.map((group) =>
      group.stream.kind === 'village' ? { ...group, stream: { ...group.stream, epoch: value } } : group,
    ),
  });
  const bootstraps: number[] = [],
    reads: number[] = [],
    published: Array<{ epoch: string | undefined; generation: number }> = [];
  let streams = 0,
    current = epoch;
  const request: typeof fetch = async (url, init) => {
    const generation = Number(new Headers(init?.headers).get('x-arbestra-generation') ?? 0);
    if (String(url).endsWith('/sync/stream')) {
      // The first stream reports that its scope was replaced (new epoch).
      if (streams++ === 0) {
        current = replaced;
        return new Response('event: reset\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (String(url).endsWith('/sync/read')) {
      reads.push(body.generation);
      return json(withEpoch(bootstrap(body.generation), current));
    }
    const query = Number(new URL(String(url), 'http://x').searchParams.get('generation'));
    bootstraps.push(query || generation);
    return json(withEpoch(bootstrap(query || generation), current));
  };
  const transport = new SyncV2Transport('aube', worldId, villageId, {
    storage: memory(),
    request,
    publish: (state) =>
      published.push({
        epoch: state.scopes.get(`village:${villageId}`)?.epoch,
        generation: state.generation,
      }),
    expired: () => {
      throw Error('Unexpected expiration');
    },
  });
  try {
    await transport.start();
    await vi.waitFor(() => expect(published.at(-1)?.epoch).toBe(replaced), { timeout: 1000 });
    // One snapshot attempt in the old generation, then a full bootstrap in a new one.
    expect(bootstraps).toHaveLength(2);
    expect(bootstraps[1]).toBeGreaterThan(bootstraps[0]!);
    expect(reads).toHaveLength(1);
    expect(published.at(-1)?.generation).toBe(bootstraps[1]);
    expect(transport.generation).toBe(bootstraps[1]);
  } finally {
    transport.close();
  }
});

it('sends upgrades and expansions on the V2 contract to their building routes', async () => {
  const paths: string[] = [];
  const request: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/sync/stream'))
      return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    const generation = Number(new Headers(init?.headers).get('x-arbestra-generation'));
    if (String(url).endsWith('/sync/read')) return json(bootstrap(generation));
    paths.push(String(url).replace(/.*villages\/[^/]+/, ''));
    expect(new Headers(init?.headers).get('x-arbestra-protocol')).toBe('2');
    const body = JSON.parse(String(init?.body));
    return json({
      protocol: 2,
      worldId,
      villageId,
      commandId: body.commandId,
      status: 'applied',
      commandTime: '2026-10-23T00:00:00Z',
      result: { buildingId: epoch },
    });
  };
  const transport = new SyncV2Transport('aube', worldId, villageId, {
    storage: memory(),
    request,
    publish: () => undefined,
    expired: () => undefined,
  });
  try {
    await transport.start(true);
    const command = '77777777-7777-4777-8777-777777777777';
    await expect(
      transport.upgrade(epoch, { commandId: command, expectedCosts: [], expectedLevel: 2 }),
    ).resolves.toMatchObject({
      result: { buildingId: epoch },
    });
    await expect(
      transport.expand(epoch, { commandId: command, cells: [{ cellX: 1, cellY: 2 }], expectedCosts: [] }),
    ).resolves.toMatchObject({ commandId: command });
    expect(paths).toEqual([`/buildings/${epoch}/upgrade`, `/buildings/${epoch}/expansions`]);
  } finally {
    transport.close();
  }
});

it('sends bodyless gestures with their identity in a header and refuses a foreign confirmation', async () => {
  const sent: Array<{ path: string; command: string | null; body: unknown }> = [];
  let foreign = false;
  const request: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/sync/stream'))
      return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    const headers = new Headers(init?.headers);
    if (String(url).endsWith('/sync/read')) return json(bootstrap(Number(headers.get('x-arbestra-generation'))));
    const commandId = headers.get('x-arbestra-command');
    sent.push({
      path: String(url).replace(/.*villages\/[^/]+/, ''),
      command: commandId,
      body: JSON.parse(String(init?.body)),
    });
    return json({
      protocol: 2,
      worldId,
      villageId: foreign ? worldId : villageId,
      commandId,
      status: 'applied',
      commandTime: '2026-10-23T00:00:00Z',
    });
  };
  const transport = new SyncV2Transport('aube', worldId, villageId, {
    storage: memory(),
    request,
    publish: () => undefined,
    expired: () => undefined,
  });
  try {
    await transport.start(true);
    const command = '88888888-8888-4888-8888-888888888888';
    await expect(transport.discoverSupplies(epoch, command)).resolves.toMatchObject({ commandId: command });
    await expect(transport.discoverCatEyes(command)).resolves.toMatchObject({ status: 'applied' });
    await transport.science({ action: 'train', buildingId: epoch }, command);
    expect(sent).toEqual([
      { path: `/buildings/${epoch}/discover-supplies`, command, body: {} },
      { path: '/discover-cat-eyes', command, body: {} },
      { path: '/science', command, body: { action: 'train', buildingId: epoch } },
    ]);
    foreign = true;
    await expect(transport.discoverCatEyes(command)).rejects.toThrow('Confirmation de commande invalide.');
  } finally {
    transport.close();
  }
});

it('routes leveling, worksite changes and terraforming, passing an adjusted terraform quote through', async () => {
  const paths: string[] = [];
  let changed = false;
  const request: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/sync/stream'))
      return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    const headers = new Headers(init?.headers);
    if (String(url).endsWith('/sync/read')) return json(bootstrap(Number(headers.get('x-arbestra-generation'))));
    paths.push(String(url).replace(/.*villages\/[^/]+/, ''));
    if (changed) return json({ status: 'changed', preview: { valid: true, message: null, quote: {} } });
    return json({
      protocol: 2,
      worldId,
      villageId,
      commandId: headers.get('x-arbestra-command'),
      status: 'applied',
      commandTime: '2026-10-24T00:00:00Z',
    });
  };
  const transport = new SyncV2Transport('aube', worldId, villageId, {
    storage: memory(),
    request,
    publish: () => undefined,
    expired: () => undefined,
  });
  try {
    await transport.start(true);
    const commandId = '99999999-9999-4999-8999-999999999999';
    await transport.level({ commandId } as never);
    await transport.changeWorksite(epoch, { commandId, action: 'pause' });
    await expect(transport.terraform({ commandId } as never)).resolves.toEqual({ status: 'started' });
    changed = true;
    await expect(transport.terraform({ commandId } as never)).resolves.toMatchObject({ status: 'changed' });
    expect(paths).toEqual(['/leveling', `/worksites/${epoch}`, '/terraform', '/terraform']);
  } finally {
    transport.close();
  }
});

it('rereads the other streams right after a gesture confirmation (science lives in knowledge)', async () => {
  let reads = 0;
  const request: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/sync/stream'))
      return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    const headers = new Headers(init?.headers);
    if (String(url).endsWith('/sync/read')) {
      reads++;
      return json(bootstrap(Number(headers.get('x-arbestra-generation'))));
    }
    return json({
      protocol: 2,
      worldId,
      villageId,
      commandId: headers.get('x-arbestra-command'),
      status: 'applied',
      commandTime: '2026-10-24T00:00:00Z',
    });
  };
  const transport = new SyncV2Transport('aube', worldId, villageId, {
    storage: memory(),
    request,
    publish: () => undefined,
    expired: () => undefined,
  });
  try {
    await transport.start(true);
    const before = reads;
    await transport.science({ action: 'train', buildingId: epoch }, '12121212-1212-4212-8212-121212121212');
    await vi.waitFor(() => expect(reads).toBe(before + 1));
  } finally {
    transport.close();
  }
});

function tooLargeTransport(retryAfter: string | null) {
  const readTimes: number[] = [],
    notices: Array<number | null> = [];
  let large = true;
  const request: typeof fetch = async (url, init) => {
    const generation = Number(new Headers(init?.headers).get('x-arbestra-generation') ?? 0);
    if (String(url).endsWith('/sync/stream'))
      return new Response('event: reset\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    if (String(url).endsWith('/sync/read')) {
      readTimes.push(Date.now());
      if (large)
        return new Response(JSON.stringify({ code: 'SYNC_SCOPE_TOO_LARGE', message: 'Trop grand' }), {
          status: 503,
          headers: { 'content-type': 'application/json', ...(retryAfter ? { 'retry-after': retryAfter } : {}) },
        });
    }
    return json(bootstrap(generation));
  };
  const transport = new SyncV2Transport('aube', worldId, villageId, {
    storage: memory(),
    request,
    publish: () => undefined,
    expired: () => undefined,
    onScopeTooLarge: (retryInMs: number | null) => notices.push(retryInMs),
  } as ConstructorParameters<typeof SyncV2Transport>[3]);
  return { transport, readTimes, notices, recover: () => (large = false) };
}

it('spaces snapshot rereads by Retry-After when the village is too large, flags it and recovers', async () => {
  vi.useFakeTimers();
  const { transport, readTimes, notices, recover } = tooLargeTransport('60');
  try {
    await transport.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    // A 2 s loop would make about 150 reads; Retry-After 60 allows about 5.
    expect(readTimes.length).toBeGreaterThanOrEqual(2);
    expect(readTimes.length).toBeLessThanOrEqual(6);
    for (let index = 1; index < readTimes.length; index++)
      expect(readTimes[index]! - readTimes[index - 1]!).toBeGreaterThanOrEqual(60_000);
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.every((value) => value === 60_000)).toBe(true);
    recover();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(notices.at(-1)).toBeNull();
    const settled = readTimes.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(readTimes.length).toBeLessThanOrEqual(settled + 5);
  } finally {
    transport.close();
    vi.useRealTimers();
  }
});

it('backs off with a growing bounded delay when Retry-After is missing on a too large village', async () => {
  vi.useFakeTimers();
  const { transport, readTimes, notices } = tooLargeTransport(null);
  try {
    await transport.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(readTimes.length).toBeLessThanOrEqual(10);
    const gaps = readTimes.slice(1).map((time, index) => time - readTimes[index]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(15_000);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(60_000);
    expect(gaps.at(-1)).toBe(60_000);
    expect(notices.every((value) => value !== null && value >= 15_000 && value <= 60_000)).toBe(true);
  } finally {
    transport.close();
    vi.useRealTimers();
  }
});

it('spaces stream reopenings by Retry-After when the stream itself is refused as too large', async () => {
  vi.useFakeTimers();
  const opens: number[] = [],
    notices: Array<number | null> = [];
  const request: typeof fetch = async (url, init) => {
    const generation = Number(new Headers(init?.headers).get('x-arbestra-generation') ?? 0);
    if (String(url).endsWith('/sync/stream')) {
      opens.push(Date.now());
      return new Response(JSON.stringify({ code: 'SYNC_SCOPE_TOO_LARGE', message: 'Trop grand' }), {
        status: 503,
        headers: { 'content-type': 'application/json', 'retry-after': '60' },
      });
    }
    return json(bootstrap(generation));
  };
  const transport = new SyncV2Transport('aube', worldId, villageId, {
    storage: memory(),
    request,
    publish: () => undefined,
    expired: () => undefined,
    onScopeTooLarge: (retryInMs: number | null) => notices.push(retryInMs),
  } as ConstructorParameters<typeof SyncV2Transport>[3]);
  try {
    await transport.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    // Opening the stream every 2 s would make about 150 attempts.
    expect(opens.length).toBeLessThanOrEqual(6);
    for (let index = 1; index < opens.length; index++)
      expect(opens[index]! - opens[index - 1]!).toBeGreaterThanOrEqual(60_000);
    expect(notices).toContain(60_000);
  } finally {
    transport.close();
    vi.useRealTimers();
  }
});

const epochB = '99999999-9999-4999-8999-999999999999';
const plot = (x: number) => ({
  id: `${x},0`,
  buildingId: epoch,
  cellX: x,
  cellY: 0,
  amount: x,
  capacity: 600,
  productionPerHour: 60,
  productionUpdatedAt: '2026-10-22T00:00:00.000Z',
});
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => plot(from + index));
/** One page of a paged private snapshot; the first one also lists the
 * whole registry and the complete knowledge scope. */
function snapshotPage(
  generation: number,
  options: { epoch?: string; revision?: string; first?: boolean; plots: ReturnType<typeof range>; next: string | null },
): SyncV2SnapshotPage {
  const village = {
    stream: { kind: 'village' as const, key: villageId, epoch: options.epoch ?? epoch },
    fromRevision: '0',
    toRevision: options.revision ?? '4',
    changes: options.first
      ? SYNC_V2_PRIVATE_COMPONENTS.map((component) => ({
          component,
          upsert: component === 'gardenPlots' ? options.plots : [],
          remove: [],
        }))
      : [{ component: 'gardenPlots' as const, upsert: options.plots, remove: [] }],
  } as SyncV2SnapshotPage['groups'][number];
  return {
    protocol: 2,
    worldId,
    villageId,
    generation,
    observedAt: '2026-10-22T00:00:00Z',
    coverage: 'scope-snapshot-page',
    next: options.next,
    groups: options.first ? [village, bootstrap(generation).groups[1]!] : [village],
  };
}
function catchUp(generation: number, from: string, to: string, epochValue = epoch): SyncV2Batch {
  return {
    protocol: 2,
    worldId,
    villageId,
    generation,
    observedAt: '2026-10-22T00:00:05Z',
    coverage: 'delta',
    groups: [
      {
        stream: { kind: 'village', key: villageId, epoch: epochValue },
        fromRevision: from,
        toRevision: to,
        changes:
          from === to
            ? []
            : [
                {
                  component: 'identity',
                  upsert: [{ id: villageId, name: 'Après les pages', anchorCellX: 1, anchorCellY: 2 }],
                  remove: [],
                },
                { component: 'gardenPlots', upsert: [], remove: ['0,0'] },
              ],
      },
      { stream: { kind: 'knowledge', key: owner, epoch }, fromRevision: '1', toRevision: '1', changes: [] },
    ],
  };
}
type Read = { url: string; body: SyncV2ReadRequest | null; pages: boolean };
/** Serves the bootstrap, sync reads and an idle stream from `answer`. */
function pagingTransport(answer: (read: Read, generation: number) => Promise<Response> | Response) {
  const reads: Read[] = [],
    published: Array<{ state: SyncV2State; batch: SyncV2Batch }> = [];
  const request: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/sync/stream'))
      return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    const headers = new Headers(init?.headers);
    const read = {
      url: String(url),
      body: init?.body ? (JSON.parse(String(init.body)) as SyncV2ReadRequest) : null,
      pages: headers.get('x-arbestra-sync-pages') === '1',
    };
    reads.push(read);
    return answer(read, Number(headers.get('x-arbestra-generation')));
  };
  const transport = new SyncV2Transport('aube', worldId, villageId, {
    storage: memory(),
    request,
    publish: (state, _observedAt, batch) => published.push({ state, batch }),
    expired: () => undefined,
  });
  return { transport, reads, published };
}
const plotsOf = (state: SyncV2State) =>
  [...visibleSyncV2Scope(state.scopes.get(`village:${villageId}`)!).keys()]
    .filter((key) => key.startsWith('gardenPlots:'))
    .map((key) => key.slice('gardenPlots:'.length))
    .sort((a, b) => Number(a.split(',')[0]) - Number(b.split(',')[0]));

it('publishes a paged snapshot once, after its last page and catch-up delta, retrying a failed page', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let failures = 0,
    caughtUp = false;
  const { transport, reads, published } = pagingTransport(async (read, generation) => {
    if (read.url.includes('/bootstrap'))
      return json(snapshotPage(generation, { first: true, plots: range(0, 2), next: 'cursor-1' }));
    const after = read.body?.page?.after;
    if (after === 'cursor-1') return json(snapshotPage(generation, { plots: range(3, 5), next: 'cursor-2' }));
    if (after === 'cursor-2') {
      // The third page fails once, then succeeds with the same cursor.
      if (failures++ === 0) return json({ code: 'SYNC_BUSY', message: 'Occupé' }, 503);
      return json(snapshotPage(generation, { revision: '5', plots: range(6, 8), next: null }));
    }
    // The catch-up delta, held until the test has checked nothing was published.
    caughtUp = true;
    await gate;
    return json(catchUp(generation, '4', '6'));
  });
  try {
    const starting = transport.start();
    await vi.waitFor(() => expect(caughtUp).toBe(true), { timeout: 3000 });
    // Every page is read, and nothing is published yet.
    expect(published).toHaveLength(0);
    expect(transport.snapshot?.scopes.size ?? 0).toBe(0);
    release();
    await starting;
    expect(published).toHaveLength(1);
    const [{ state, batch }] = published as [(typeof published)[number]];
    // All pages, then the delta: a plot of page 1 removed, the name changed.
    expect(plotsOf(state)).toEqual(range(1, 8).map((row) => row.id));
    expect(visibleSyncV2Scope(state.scopes.get(`village:${villageId}`)!).get(`identity:${villageId}`)).toMatchObject({
      name: 'Après les pages',
    });
    expect(state.scopes.get(`village:${villageId}`)?.revision).toBe('6');
    expect(batch.coverage).toBe('scope-snapshot');
    expect(reads.map((read) => read.body?.page?.after ?? (read.body ? 'delta' : 'bootstrap'))).toEqual([
      'bootstrap',
      'cursor-1',
      'cursor-2',
      'cursor-2',
      'delta',
    ]);
    expect(reads.every((read) => read.pages)).toBe(true);
    // Later pages read the private scope only; the delta starts at page 1's cursors.
    expect(reads[1]!.body).toMatchObject({ scopes: [{ kind: 'village', key: villageId }], cursors: [] });
    expect(reads[4]!.body?.cursors).toEqual([
      { kind: 'village', key: villageId, epoch, revision: '4' },
      { kind: 'knowledge', key: owner, epoch, revision: '1' },
    ]);
  } finally {
    transport.close();
  }
});

it('starts over from the first page when the epoch changes mid-way, publishing only the coherent state', async () => {
  let restarts = 0,
    expired = false;
  const { transport, reads, published } = pagingTransport((read, generation) => {
    if (read.url.includes('/bootstrap'))
      return json(snapshotPage(generation, { first: true, plots: range(0, 2), next: 'old-1' }));
    const after = read.body?.page?.after;
    // The second page was read after the epoch was replaced.
    if (after === 'old-1') return json(snapshotPage(generation, { epoch: epochB, plots: range(3, 5), next: null }));
    if (after === 'new-1') {
      // The server notices it too, once: start over again.
      if (!expired) {
        expired = true;
        return json({ code: 'SYNC_SNAPSHOT_PAGE_EXPIRED', message: 'À relire' }, 409);
      }
      return json(snapshotPage(generation, { epoch: epochB, revision: '9', plots: range(13, 15), next: null }));
    }
    if (read.body?.cursors.length === 0) {
      restarts++;
      return json(
        snapshotPage(generation, { epoch: epochB, revision: '9', first: true, plots: range(10, 12), next: 'new-1' }),
      );
    }
    const village = read.body?.cursors.find((cursor) => cursor.kind === 'village');
    return json(catchUp(generation, village!.revision, village!.revision, village!.epoch));
  });
  try {
    await transport.start();
    expect(restarts).toBe(2);
    expect(published).toHaveLength(1);
    const [{ state }] = published as [(typeof published)[number]];
    expect(state.scopes.get(`village:${villageId}`)).toMatchObject({ epoch: epochB, revision: '9' });
    // No plot of the first epoch survives in the published state.
    expect(plotsOf(state)).toEqual(range(10, 15).map((row) => row.id));
    expect(reads.filter((read) => read.body?.page?.after === 'new-1')).toHaveLength(2);
  } finally {
    transport.close();
  }
});

it('publishes nothing when the session expires in the middle of a paged snapshot', async () => {
  const { transport, published } = pagingTransport((read, generation) => {
    if (read.url.includes('/bootstrap'))
      return json(snapshotPage(generation, { first: true, plots: range(0, 2), next: 'cursor-1' }));
    return json({ code: 'UNAUTHENTICATED', message: 'Session expirée' }, 401);
  });
  try {
    await expect(transport.start()).rejects.toBeInstanceOf(SyncV2SessionExpired);
    expect(published).toHaveLength(0);
    expect(transport.snapshot).toBeUndefined();
  } finally {
    transport.close();
  }
});

it('keeps a village within one page on a single complete snapshot, asking for pages without reading any', async () => {
  const { transport, reads, published } = pagingTransport((_read, generation) => json(bootstrap(generation)));
  try {
    await transport.start();
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ pages: true, body: null });
    expect(reads[0]!.url).toMatch(/\/bootstrap\?generation=\d+$/);
    expect(published).toHaveLength(1);
    expect(published[0]!.batch.coverage).toBe('scope-snapshot');
  } finally {
    transport.close();
  }
});
