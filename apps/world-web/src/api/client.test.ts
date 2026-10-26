import { afterEach, expect, it, vi } from 'vitest';
import { discoverOrRefreshSupplies } from './client';
import { getStoneDepositDetails } from './client';
import { buildBuilding, commandInfrastructure } from './client';
import { getVillage } from './client';

afterEach(() => vi.unstubAllGlobals());

it('bounds construction waiting and retransmits the same id after an uncertain timeout', async () => {
  const controller = new AbortController(),
    deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
    );
  vi.stubGlobal('fetch', fetchMock);
  try {
    const pending = buildBuilding('rc1', 'village', 'university', { cellX: 1, cellY: 2 }, [], 'same-command');
    controller.abort(new DOMException('Response deadline', 'TimeoutError'));
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(deadline).toHaveBeenCalledWith(15000);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ serverTime: '2026-10-10T20:00:00Z' })));
    await buildBuilding('rc1', 'village', 'university', { cellX: 1, cellY: 2 }, [], 'same-command');
    expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
  } finally {
    deadline.mockRestore();
  }
});

it('refreshes the village after another tab claimed the supplies, without repeating the claim', async () => {
  const snapshot = { serverTime: '2026-09-06T18:00:00Z', village: { carrots: 2050 } };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'SUPPLIES_ALREADY_DISCOVERED' }), { status: 409 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(snapshot)));
  vi.stubGlobal('fetch', fetchMock);
  const result = await discoverOrRefreshSupplies('aube', 'village', 'hall');
  expect(result).toMatchObject({ alreadyDiscovered: true, snapshot: { state: snapshot } });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1]).toEqual([
    '/api/worlds/aube/village',
    expect.objectContaining({ credentials: 'same-origin' }),
  ]);
});

it('preserves the server refusal code for the deposit menu', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'DEPOSIT_FULLY_COMMITTED', message: 'Engagé' }), { status: 409 }),
      ),
  );
  await expect(getStoneDepositDetails('aube', 'village', 'target')).rejects.toMatchObject({
    status: 409,
    code: 'DEPOSIT_FULLY_COMMITTED',
  });
});

const syncFixture = async () =>
  JSON.parse(
    (await import('node:fs')).readFileSync(
      new URL('../../../../tests/fixtures/village-sync-state.json', import.meta.url),
      'utf8',
    ),
  );
it('negotiates a construction confirmation and validates the command and village before acknowledging it', async () => {
  const state = await syncFixture(),
    commandId = crypto.randomUUID();
  const confirmation = {
    kind: 'construction',
    worldId: state.world.id,
    villageId: state.village.id,
    commandId,
    commandTime: state.serverTime,
    serverTime: state.serverTime,
    minimumRevision: 2,
    cells: state.cells,
    resources: state.village.resources,
  };
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(confirmation))));
  vi.stubGlobal('fetch', fetchMock);
  const send = () =>
    buildBuilding(
      state.world.slug,
      state.village.id,
      'dwelling',
      { cellX: 66, cellY: 64 },
      [{ cellX: 66, cellY: 64 }],
      commandId,
    );
  expect(await send()).toMatchObject({ construction: confirmation });
  expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ 'x-construction-confirmation': '1' });
  await send();
  expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
  confirmation.commandId = crypto.randomUUID();
  await expect(send()).rejects.toThrow('Confirmation de construction incohérente');
  confirmation.commandId = commandId;
  confirmation.villageId = crypto.randomUUID();
  await expect(send()).rejects.toThrow('Confirmation de construction incohérente');
});
it('requests and parses an authoritative construction frame without changing the command payload', async () => {
  const { villageFrame } = await import('@arbestra/contracts'),
    state = await syncFixture(),
    frame = villageFrame(state, { ...state, syncRevision: 2, village: { ...state.village, wood: 75 } });
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ kind: 'frame', commandTime: state.serverTime, serverTime: state.serverTime, frame }),
      ),
    );
  vi.stubGlobal('fetch', fetchMock);
  const base = { revision: state.syncRevision, serverTime: state.serverTime };
  const reply = await buildBuilding(
    state.world.slug,
    state.village.id,
    'dwelling',
    { cellX: 66, cellY: 64 },
    [{ cellX: 66, cellY: 64 }],
    'same-command',
    [],
    0,
    'logs',
    base,
  );
  expect(reply).toMatchObject({ frame });
  expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({
    'x-village-sync': '1',
    'x-village-revision': '1',
    'x-village-server-time': state.serverTime,
  });
  const body = fetchMock.mock.calls[0]![1].body;
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({ kind: 'snapshot', commandTime: state.serverTime, serverTime: state.serverTime, state }),
    ),
  );
  expect(
    await buildBuilding(
      state.world.slug,
      state.village.id,
      'dwelling',
      { cellX: 66, cellY: 64 },
      [{ cellX: 66, cellY: 64 }],
      'same-command',
      [],
      0,
      'logs',
      { ...base, revision: 2 },
    ),
  ).toMatchObject({ state });
  expect(fetchMock.mock.calls[1]![1].body).toBe(body);
});
it('rejects a malformed incremental response as uncertain rather than accepting a partial village', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ kind: 'frame', frame: { toRevision: 2 } }))),
  );
  await expect(buildBuilding('rc1', 'village', 'dwelling', { cellX: 1, cellY: 2 }, [], 'same-command')).rejects.toThrow(
    'Réponse de synchronisation invalide',
  );
});

it('requests an infrastructure frame using the shared base and preserves the receipt payload on retry', async () => {
  const { villageFrame, emptyInfrastructure } = await import('@arbestra/contracts'),
    state = await syncFixture(),
    frame = villageFrame(state, { ...state, syncRevision: 2, infrastructure: emptyInfrastructure() });
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ kind: 'frame', commandTime: state.serverTime, serverTime: state.serverTime, frame }),
        ),
      ),
    );
  vi.stubGlobal('fetch', fetchMock);
  const payload = {
    commandId: 'same-command',
    sessionId: 'same-session',
    revision: 0,
    operation: {
      kind: 'road' as const,
      stroke: {
        id: 'preview',
        points: [
          { x: 512, y: 528 },
          { x: 528, y: 528 },
        ],
        width: 4,
        material: 'earth',
        border: false,
        operation: 'paint' as const,
      },
    },
  };
  const base = { revision: state.syncRevision, serverTime: state.serverTime };
  expect(await commandInfrastructure(state.world.slug, state.village.id, payload, base)).toMatchObject({ frame });
  await commandInfrastructure(state.world.slug, state.village.id, payload, { ...base, revision: 2 });
  expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({
    'x-village-sync': '1',
    'x-village-revision': '1',
    'x-village-server-time': state.serverTime,
  });
  expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
});

it('receives a small authoritative infrastructure confirmation without a village snapshot and preserves retry identity', async () => {
  const { infrastructureConfirmation, emptyInfrastructure } = await import('@arbestra/contracts'),
    state = await syncFixture(),
    before = emptyInfrastructure();
  const commandId = '00000000-0000-4000-8000-000000000010',
    stroke = {
      id: commandId,
      points: [
        { x: 512, y: 528 },
        { x: 528, y: 528 },
      ],
      width: 4,
      material: 'earth' as const,
      border: false,
      operation: 'paint' as const,
    };
  const after = { ...before, revision: 1, roads: [stroke] },
    quote = { stoneUnits: 0, stoneDebit: 0, woodDebit: 0, reserveAfter: 0 };
  const confirmation = infrastructureConfirmation(
    { worldId: state.world.id, villageId: state.village.id, commandId, commandTime: state.serverTime },
    before,
    after,
    quote,
  );
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(confirmation)));
  vi.stubGlobal('fetch', fetchMock);
  const payload = {
    commandId,
    sessionId: '00000000-0000-4000-8000-000000000011',
    revision: 0,
    operation: { kind: 'road' as const, stroke: { ...stroke, id: 'preview' } },
    expected: quote,
  };
  const reply = await commandInfrastructure(state.world.slug, state.village.id, payload, {
    revision: state.syncRevision,
    serverTime: state.serverTime,
  });
  expect(reply).toMatchObject({ confirmation });
  expect('state' in reply || 'frame' in reply).toBe(false);
  expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({
    'x-infrastructure-confirmation': '1',
    'x-village-sync': '1',
    'x-village-revision': '1',
  });
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(confirmation)));
  await commandInfrastructure(state.world.slug, state.village.id, payload);
  expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...confirmation, changes: [{ kind: 'bad' }] })));
  await expect(commandInfrastructure(state.world.slug, state.village.id, payload)).rejects.toThrow(
    'Réponse de synchronisation invalide',
  );
});

it('names the caller of a legacy village read by file positions', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ serverTime: '2026-10-26T10:00:00Z' })));
  vi.stubGlobal('fetch', fetchMock);
  await getVillage('aube', 'village');
  const caller = new Headers(fetchMock.mock.calls[0]![1].headers).get('x-arbestra-caller')!;
  expect(caller.split(' ')[0]).toMatch(/^client\.ts:\d+:\d+$/);
  expect(caller).toMatch(/client\.test\.ts:\d+:\d+/);
  for (const frame of caller.split(' ')) expect(frame).toMatch(/^[\w.-]+:\d+:\d+$/);
});
