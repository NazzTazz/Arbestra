import { expect, it, vi } from 'vitest';
import { HudIntentQueue, requestedPools, canAdjustPool, type SavedHudIntents } from './hud-intents';
import type { HudWorkforceIntent, HudWorkforceState, HudWorkforceConfirmation } from '@arbestra/contracts';

const intent = (id: string): HudWorkforceIntent => ({
  kind: 'pool',
  command: { commandId: id, resource: 'wood', action: 'sites-up' },
});
const state = (sites = 1, time = 0): HudWorkforceState => ({
  worldId: 'world',
  villageId: 'village',
  serverTime: new Date(time).toISOString(),
  carrots: 100,
  minimumRevision: time,
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
    q.synchronize({ ...state(1, 10), minimumRevision: 0 }); // Newer clock, but captured before COMMIT.
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

it('follows a later V2 village state after a gesture, although it carries no V1 revision', () => {
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
      minimumRevision: 0,
      population: { ...state().population, working },
    });
    // A V1 snapshot keeps its revision guard against the confirmation's revision 30.
    q.synchronize(v2(40, 2));
    expect(q.confirmed.population.working).toBe(0);
    q.synchronize(v2(40, 1), false);
    expect(q.confirmed.population.working).toBe(1);
    q.synchronize(v2(35, 0), false);
    expect(q.confirmed.population.working).toBe(1);
  } finally {
    q.stop();
  }
});
