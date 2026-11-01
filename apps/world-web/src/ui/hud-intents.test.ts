import { expect, it, vi } from 'vitest';
import {
  HudIntentQueue,
  hudFromVillage,
  requestedPools,
  canAdjustPool,
  type HudSettlement,
  type SavedHudIntents,
} from './hud-intents';
import {
  applySyncV2Batch,
  villageStateFromSyncV2,
  type HudWorkforceIntent,
  type HudWorkforceState,
  type HudWorkforceConfirmation,
  type ResolvedVillagePresentation,
  type SyncV2Batch,
  type SyncV2Scope,
  type SyncV2State,
} from '@arbestra/contracts';

const intent = (id: string): HudWorkforceIntent => ({
  kind: 'pool',
  command: { commandId: id, resource: 'wood', action: 'sites-up' },
});
const state = (sites = 1, time = 0): HudWorkforceState => ({
  worldId: 'world',
  villageId: 'village',
  serverTime: new Date(time).toISOString(),
  carrots: 100,
  minimumRevision: 0,
  population: { available: 30, resting: 0, working: 0, pendingRelease: { idle: 0, resting: 0 } },
  extractionPools: (['wood', 'stone'] as const).map((resource) => ({
    resource,
    siteCount: resource === 'wood' ? sites : 1,
    workerCap: 5,
    mobilized: 0,
    activeSites: 0,
    pendingTargets: 0,
  })),
  openWorksites: { wood: sites, stone: 1, other: 0 },
});
const reply = (commandId: string, sites: number): HudWorkforceConfirmation => ({
  commandId,
  affected: 0,
  carrots: 0,
  hud: state(sites, sites),
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

it('retains the requested count through navigation/reload and an SSE snapshot arriving before the HTTP acknowledgement', async () => {
  let saved: SavedHudIntents = { confirmed: state(), items: [] };
  const releases: Array<(r: HudWorkforceConfirmation) => void> = [];
  const q = new HudIntentQueue(state(), [], {
    send: () => new Promise((r) => releases.push(r)),
    save: (s) => {
      saved = structuredClone(s);
    },
    changed: () => {},
    settled: () => {},
    failed: () => false,
  });
  try {
    q.add(intent('first'));
    q.add(intent('second'));
    q.add(intent('third'));
    expect(requestedPools(q.confirmed, q.items)[0]?.siteCount).toBe(4);
    q.synchronize(state(2, 10)); // SSE has already observed the first command.
    expect(requestedPools(q.confirmed, q.items)[0]?.siteCount).toBe(4);
    const restored = new HudIntentQueue(saved.confirmed, saved.items, {
      send: async () => {
        throw Error('Not sent');
      },
      save: () => {},
      changed: () => {},
      settled: () => {},
      failed: () => false,
    });
    expect(requestedPools(restored.confirmed, restored.items)[0]?.siteCount).toBe(4);
    expect(restored.items.map((i) => i.command.commandId)).toEqual(['first', 'second', 'third']);
    releases.shift()!(reply('first', 2));
    await tick();
    expect(q.items.map((i) => i.command.commandId)).toEqual(['second', 'third']);
    expect(requestedPools(q.confirmed, q.items)[0]?.siteCount).toBe(4);
    releases.shift()!(reply('second', 3));
    await tick();
    releases.shift()!(reply('third', 4));
    await tick();
    expect(q.items).toEqual([]);
    expect(q.confirmed.extractionPools[0]?.siteCount).toBe(4);
    q.synchronize(state(1, 0));
    expect(q.confirmed.extractionPools[0]?.siteCount).toBe(4);
    q.synchronize(state(3, 20));
    expect(q.confirmed.extractionPools[0]?.siteCount).toBe(3);
  } finally {
    q.stop();
  }
});

it('automatically resolves a lost response with the original UUID and drains later gestures only once', async () => {
  vi.useFakeTimers();
  const seen: string[] = [],
    committed = new Set<string>();
  let sites = 1,
    lost = true;
  const q = new HudIntentQueue(state(), [], {
    send: async (i) => {
      seen.push(i.command.commandId);
      if (!committed.has(i.command.commandId)) {
        committed.add(i.command.commandId);
        sites++;
      }
      if (lost) {
        lost = false;
        throw Error('Response lost after commit');
      }
      return reply(i.command.commandId, sites);
    },
    save: () => {},
    changed: () => {},
    settled: () => {},
    failed: () => false,
  });
  try {
    q.add(intent('first'));
    q.add(intent('second'));
    q.add(intent('third'));
    await vi.advanceTimersByTimeAsync(0);
    expect(q.blocked).toBe(true);
    expect(q.retrying).toBe(true);
    expect(q.items).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual(['first', 'first', 'second', 'third']);
    expect(sites).toBe(4);
    expect(q.items).toEqual([]);
    expect(q.blocked).toBe(false);
  } finally {
    q.stop();
    vi.useRealTimers();
  }
});

it('removes a definite refusal without dropping the next gesture or inventing its effect', async () => {
  const q = new HudIntentQueue(state(), [], {
    send: async (i) => {
      if (i.command.commandId === 'refused') throw Error('409');
      return reply(i.command.commandId, 2);
    },
    save: () => {},
    changed: () => {},
    settled: () => {},
    failed: () => true,
  });
  try {
    q.add(intent('refused'));
    q.add(intent('accepted'));
    await tick();
    expect(q.items).toEqual([]);
    expect(q.confirmed.extractionPools[0]?.siteCount).toBe(2);
  } finally {
    q.stop();
  }
});

it('bounds the next gesture against all requested settings while leaving real missions unchanged', () => {
  const confirmed = state(),
    items = ['1', '2', '3', '4'].map(intent),
    pools = requestedPools(confirmed, items);
  expect(pools[0]).toMatchObject({ siteCount: 5, workerCap: 5, mobilized: 0 });
  expect(canAdjustPool(confirmed, pools, 'wood', 'sites-up')).toBe(false);
  expect(canAdjustPool(confirmed, pools, 'wood', 'people-up')).toBe(true);
  const full = { ...confirmed, openWorksites: { wood: 1, stone: 1, other: 6 } };
  expect(canAdjustPool(full, full.extractionPools, 'wood', 'sites-up')).toBe(false);
  expect(canAdjustPool(full, full.extractionPools, 'wood', 'sites-down')).toBe(true);
});

it('follows a later village state after a gesture, ordered by its instant alone', () => {
  const q = new HudIntentQueue(state(1, 30), [], {
    send: async () => reply('unused', 1),
    save: () => {},
    changed: () => {},
    settled: () => {},
    failed: () => false,
  });
  try {
    const v2 = (time: number, working: number): HudWorkforceState => ({
      ...state(1, time),
      population: { ...state().population, working },
    });
    q.synchronize(v2(40, 1));
    expect(q.confirmed.population.working).toBe(1);
    q.synchronize(v2(35, 0));
    expect(q.confirmed.population.working).toBe(1);
  } finally {
    q.stop();
  }
});

// A V2 session as the village hook holds it: the HUD basis of a settled gesture is
// read from the state its effects reached, at the session's latest instant.
const worldId = '11111111-1111-4111-8111-111111111111',
  villageId = '22222222-2222-4222-8222-222222222222',
  epoch = '33333333-3333-4333-8333-333333333333';
const at = (second: number) => new Date(Date.UTC(2026, 10, 1, 12, 0, second)).toISOString();
const sessionScope = (entries: Array<[string, unknown]>): SyncV2Scope => ({
  epoch,
  revision: '4',
  base: new Map(entries) as SyncV2Scope['base'],
  effects: new Map(),
});
const poolRow = (resource: 'wood' | 'stone', siteCount: number) => ({
  resource,
  siteCount,
  workerCap: 5,
  mobilized: 0,
  activeSites: 0,
  pendingTargets: 0,
});
const summaryRow = (resting: number) => ({
  id: '*' as const,
  total: 30,
  housingCapacity: 30,
  available: 30 - resting,
  working: 0,
  resting,
  energyCounts: [],
});
function openSession(): SyncV2State {
  return {
    worldId,
    villageId,
    generation: 1,
    scopes: new Map([
      [
        `village:${villageId}`,
        sessionScope([
          [`identity:${villageId}`, { id: villageId, name: 'Fixture', anchorCellX: 0, anchorCellY: 0 }],
          ['populationSummary:*', summaryRow(0)],
          ['resources:wood', { code: 'wood', amount: 0, productionPerHour: 0, productionUpdatedAt: at(0) }],
          ['resources:carrot', { code: 'carrot', amount: 100, productionPerHour: 0, productionUpdatedAt: null }],
          ['extractionPools:wood', poolRow('wood', 1)],
          ['extractionPools:stone', poolRow('stone', 1)],
        ]),
      ],
      ['knowledge:account', sessionScope([['knowledgeScience:*', { id: '*', state: {} }]])],
      [
        `manifest:${worldId}`,
        sessionScope([
          [
            'gameManifest:*',
            { id: '*', world: { widthCells: 64, heightCells: 64 }, buildingTypes: [], factoryEnabled: false },
          ],
        ]),
      ],
    ]),
  };
}
const presentation = {
  protocol: 2,
  worldId,
  villageId,
  version: '0'.repeat(64),
  observedAt: at(0),
  cells: [],
  travelRoutes: [],
  region: {},
  market: { unlocked: false, deliveryMs: 0, commissionPercent: 30, resources: [] },
} as unknown as ResolvedVillagePresentation;
/** The confirmation of a gesture, as its HTTP answer carries it (and a stream batch can too). */
const effects = (revision: number, second: number, woodSites: number, resting = 0): SyncV2Batch => ({
  protocol: 2,
  worldId,
  villageId,
  generation: 1,
  observedAt: at(second),
  coverage: 'effects',
  groups: [
    {
      stream: { kind: 'village', key: villageId, epoch },
      fromRevision: String(revision),
      toRevision: String(revision),
      changes: [
        { component: 'extractionPools', upsert: [poolRow('wood', woodSites)], remove: [] },
        { component: 'populationSummary', upsert: [summaryRow(resting)], remove: [] },
      ],
    },
  ],
});
/** What the hook reads from its session: the village projected at its latest instant, then the HUD. */
function basisOf(sync: SyncV2State, second: number): HudWorkforceState {
  return hudFromVillage(villageStateFromSyncV2(sync, presentation, at(second))!);
}
function receive(sync: SyncV2State, batch: SyncV2Batch): SyncV2State {
  const result = applySyncV2Batch(sync, batch);
  if (result.kind !== 'applied') throw Error('Expected an applied batch');
  return result.state;
}
const poolsOf = (q: HudIntentQueue) => requestedPools(q.confirmed, q.items)[0]!.siteCount;
const settlement = (commandId: string, hud?: HudWorkforceState): HudSettlement => ({
  commandId,
  affected: 0,
  carrots: 0,
  ...(hud ? { hud } : {}),
});

it('orders V2 gestures by the session: a lost response replayed after its effects were streamed neither resets nor double-counts', async () => {
  vi.useFakeTimers();
  let session = openSession();
  const sent: string[] = [];
  let lost = true;
  const answers: Record<string, { revision?: number; second: number; sites: number }> = {
    first: { second: 4, sites: 2 },
    second: { revision: 6, second: 5, sites: 3 },
    third: { revision: 7, second: 6, sites: 4 },
  };
  const q = new HudIntentQueue(basisOf(session, 1), [], {
    send: async (i) => {
      const id = i.command.commandId;
      sent.push(id);
      if (lost) {
        // The first gesture commits, its ACK is lost, and the stream delivers its effects.
        lost = false;
        session = receive(session, effects(5, 3, 2));
        throw Error('Response lost after commit');
      }
      // A replay answers without effects; the next gestures answer with theirs.
      const step = answers[id]!;
      if (step.revision) session = receive(session, effects(step.revision, step.second, step.sites));
      return settlement(id, basisOf(session, step.second));
    },
    save: () => {},
    changed: () => {},
    settled: () => {},
    failed: () => false,
  });
  try {
    for (const id of ['first', 'second', 'third']) q.add(intent(id));
    await vi.advanceTimersByTimeAsync(0);
    expect(q.retrying).toBe(true);
    expect(poolsOf(q)).toBe(4);
    // The state the stream produced meanwhile is refused while gestures are pending.
    q.synchronize(basisOf(session, 3));
    expect(poolsOf(q)).toBe(4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual(['first', 'first', 'second', 'third']);
    expect(q.items).toEqual([]);
    expect(q.confirmed.extractionPools[0]?.siteCount).toBe(4);
    // States the session observed before the last confirmation never replace its basis...
    q.synchronize(basisOf(session, 5));
    q.synchronize(basisOf(session, 6));
    expect(q.confirmed.extractionPools[0]?.siteCount).toBe(4);
    // ...and a later one does, whatever it carries and with no COUNT revision involved.
    session = receive(session, effects(8, 9, 4, 7));
    q.synchronize(basisOf(session, 9));
    expect(q.confirmed.population.resting).toBe(7);
    expect(q.confirmed.minimumRevision).toBe(0);
  } finally {
    q.stop();
    vi.useRealTimers();
  }
});

it('keeps the previous basis when the session cannot yet project the confirmed state, then follows the next one', async () => {
  const session = openSession();
  const q = new HudIntentQueue(basisOf(session, 1), [], {
    send: async (i) => settlement(i.command.commandId),
    save: () => {},
    changed: () => {},
    settled: () => {},
    failed: () => false,
  });
  try {
    q.add(intent('first'));
    await tick();
    expect(q.items).toEqual([]);
    expect(q.confirmed.extractionPools[0]?.siteCount).toBe(1);
    q.synchronize(basisOf(receive(session, effects(5, 4, 2)), 4));
    expect(q.confirmed.extractionPools[0]?.siteCount).toBe(2);
  } finally {
    q.stop();
  }
});

it('replays a gesture saved before a reload once with its UUID, after the synchronization is ready', async () => {
  vi.useFakeTimers();
  let saved: SavedHudIntents | undefined;
  let session = openSession();
  const sent: string[] = [];
  let ready = false;
  const restored: SavedHudIntents = { confirmed: basisOf(session, 1), items: [intent('saved-before-reload')] };
  const q = new HudIntentQueue(restored.confirmed, restored.items, {
    send: async (i) => {
      sent.push(i.command.commandId);
      if (!ready) throw Error('Synchronisation indisponible.');
      session = receive(session, effects(5, 3, 2));
      return settlement(i.command.commandId, basisOf(session, 3));
    },
    save: (s) => {
      saved = structuredClone(s);
    },
    changed: () => {},
    settled: () => {},
    failed: () => false,
  });
  try {
    await q.pump();
    expect(q.blocked).toBe(true);
    expect(saved).toBeUndefined();
    ready = true;
    q.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(['saved-before-reload', 'saved-before-reload']);
    expect(q.items).toEqual([]);
    expect(saved).toMatchObject({ items: [] });
    expect(q.confirmed.extractionPools[0]?.siteCount).toBe(2);
    // Nothing is sent again once it settled.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(2);
  } finally {
    q.stop();
    vi.useRealTimers();
  }
});
