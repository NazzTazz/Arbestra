import { expect, it, vi } from 'vitest';
import { SYNC_V2_PRIVATE_COMPONENTS, SYNC_V2_KNOWLEDGE_COMPONENTS, type SyncV2Batch } from '@arbestra/contracts';
import { SyncV2Transport } from './sync-v2-transport';
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
