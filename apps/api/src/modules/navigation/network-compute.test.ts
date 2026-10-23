import { expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import {
  buildTravelNetwork,
  refineTravelRoute,
  emptyInfrastructure,
  ROUTE_POLICY_VERSION,
  type TravelNetworkState,
  type RouteQuery,
  type TravelRoute,
} from '@arbestra/contracts';
import { NavigationCompute } from './compute.js';
import { networkState } from './network-job.js';

const state: TravelNetworkState = {
  world: { id: 'world', widthCells: 16, heightCells: 16 },
  village: { anchorCellX: 2, anchorCellY: 3, townHallBuildingId: 'hall' },
  region: { originCellX: 0, originCellY: 0, width: 16, height: 16, terrainCodes: Array(256).fill(1), features: [] },
  cells: [
    { cellX: 3, cellY: 3, footprint: { buildingId: 'obstacle' }, building: null },
    {
      cellX: 4,
      cellY: 3,
      footprint: { buildingId: 'house' },
      building: { id: 'house', type: 'dwelling', quarterTurns: 0, visualLayout: null, accesses: [] },
    },
  ],
};
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}

it('refuses diagnostic work before its SQL loader when an expedition is ready', async () => {
  const compute = new NavigationCompute(),
    load = vi.fn(async () => ({ state }));
  try {
    await compute.start();
    await expect(compute.observationNetwork(load, async () => true)).rejects.toMatchObject({
      code: 'OBSERVATION_BUSY',
    });
    expect(load).not.toHaveBeenCalled();
  } finally {
    await compute.close();
  }
});
it('preempts diagnostic work at a bounded barrier without terminating the shared worker', async () => {
  const compute = new NavigationCompute(),
    entered = gate(),
    release = gate();
  const jobs: Promise<unknown>[] = [];
  try {
    await compute.start();
    const diagnostic = compute.observationNetwork(
      async () => {
        entered.release();
        await release.promise;
        return { state };
      },
      async () => false,
    );
    jobs.push(diagnostic);
    const rejected = expect(diagnostic).rejects.toMatchObject({ code: 'OBSERVATION_BUSY' });
    await bounded(entered.promise);
    const player = compute.network(async () => ({ state }));
    jobs.push(player);
    release.release();
    await rejected;
    expect(await player).toEqual(buildTravelNetwork(state));
    expect(compute.observation.ready).toBe(1);
  } finally {
    release.release();
    await Promise.allSettled(jobs);
    await compute.close();
  }
});
it('refuses cold observation geography without parsing it or interrupting a later player', async () => {
  const compute = new NavigationCompute();
  try {
    await compute.start();
    await expect(
      compute.observationNetwork(
        async () => ({
          state,
          ground: {
            sourceId: 'cold',
            artifact: '{not JSON',
            edits: { worldId: 'world', width: 16, height: 16, terraces: [], absent: [], groves: [] },
          },
        }),
        async () => false,
      ),
    ).rejects.toMatchObject({ code: 'OBSERVATION_BUSY' });
    expect(compute.observation.lastErrorAt).toBeNull();
    expect(await compute.network(async () => ({ state }))).toEqual(buildTravelNetwork(state));
  } finally {
    await compute.close();
  }
});
it('cancels a diagnostic search through the shared atomic flag and keeps the lane for a player', async () => {
  const compute = new NavigationCompute();
  let player: Promise<unknown> | undefined;
  const entered = gate();
  const original = Worker.prototype.emit;
  const slow = {
    ...state,
    world: { id: 'observation-heavy-search', widthCells: 128, heightCells: 128 },
    region: { ...state.region, width: 128, height: 128, terrainCodes: Array(128 * 128).fill(1) },
    cells: Array.from({ length: 200 }, (_, i) => ({
      cellX: 50 + (i % 20),
      cellY: 50 + Math.floor(i / 20),
      footprint: { buildingId: 'goal-' + i },
      building: { id: 'goal-' + i, type: 'dwelling' as const, quarterTurns: 0, visualLayout: null, accesses: [] },
    })),
  };
  await compute.start();
  const emit = vi.spyOn(Worker.prototype, 'emit').mockImplementation(function (this: Worker, event, ...args) {
    const message = args[0] as { stage?: string } | undefined;
    if (event === 'message' && message?.stage === 'network-search' && !player) {
      player = compute.network(async () => ({ state }));
      entered.release();
    }
    return Reflect.apply(original, this, [event, ...args]) as boolean;
  });
  const diagnostic = compute.observationNetwork(
    async () => ({ state: slow }),
    async () => false,
  );
  const rejected = expect(diagnostic).rejects.toMatchObject({ code: 'OBSERVATION_BUSY' });
  try {
    await bounded(entered.promise);
    await rejected;
    expect(await player).toEqual(buildTravelNetwork(state));
    expect(compute.observation.ready).toBe(1);
    expect(compute.observation.lastErrorAt).toBeNull();
  } finally {
    emit.mockRestore();
    await Promise.allSettled([diagnostic, ...(player ? [player] : [])]);
    await compute.close();
  }
});
async function bounded<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('Test barrier expired')), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const routeQuery: RouteQuery = {
  worldId: 'world',
  contextId: 'legacy',
  policyVersion: ROUTE_POLICY_VERSION,
  movementProfileId: 'pedestrian-v1',
  traversalConstraintsId: 'none',
  starts: [{ kind: 'point', cellX: 2, cellY: 2 }],
  goals: [{ kind: 'point', cellX: 4, cellY: 2 }],
  limits: { maxNodes: 1000, maxDurationMs: 1000 },
};
const routeJob = {
  query: routeQuery,
  data: {
    worldId: 'world',
    contextId: 'legacy',
    traversalConstraintsId: 'none',
    width: 16,
    height: 16,
    sourceId: 'legacy',
    terraces: [],
    treeEdits: [],
    occupancies: [],
    accesses: [],
    plans: [],
    legacy: {
      chunkSize: 16,
      chunks: [{ chunkX: 0, chunkY: 0, terrainCodes: Array(256).fill(1), elevations: Array(256).fill(1) }],
    },
  },
};

it('keeps completed gardens walkable through the worker projection and invalidates a reserved ring', async () => {
  const compute = new NavigationCompute();
  const plots = Array.from({ length: 9 }, (_, i) => ({ cellX: 5 + (i % 3), cellY: 2 + Math.floor(i / 3) }));
  const geometry: TravelNetworkState = {
    ...state,
    infrastructure: emptyInfrastructure(),
    cells: [
      {
        cellX: 2,
        cellY: 3,
        footprint: { buildingId: 'hall' },
        building: { id: 'hall', type: 'town-hall', quarterTurns: 0 },
      },
      ...plots.map((p, i) => ({
        ...p,
        footprint: { buildingId: 'garden', buildingType: 'garden' as const, state: 'active' as const },
        building: i === 0 ? { id: 'garden', type: 'garden' as const, quarterTurns: 0, garden: { plots } } : null,
      })),
    ],
  };
  const refinement: TravelRoute = {
    id: 'centre',
    kind: 'garden',
    destination: plots[4]!,
    cells: [{ cellX: 2, cellY: 3 }, plots[4]!],
  };
  try {
    const load = async () => ({ state: networkState(geometry), refinement });
    const expected = refineTravelRoute(geometry, refinement);
    expect(expected).not.toBeNull();
    expect(await compute.refine(load)).toEqual([expected]);
    expect(
      (await compute.network(async () => ({ state: networkState(geometry) }))).some(
        (r) => r.kind === 'garden' && r.destination.cellX === 6 && r.destination.cellY === 3,
      ),
    ).toBe(true);
    for (const c of geometry.cells)
      if (c.footprint?.buildingId === 'garden' && (c.cellX !== 6 || c.cellY !== 3)) c.footprint.state = 'reserved';
    expect(await compute.refine(load)).toEqual([]);
  } finally {
    await compute.close();
  }
});

it('refines an individual route in the worker with identical geometry and fresh cached outputs', async () => {
  const compute = new NavigationCompute();
  const geometry: TravelNetworkState = {
    ...state,
    infrastructure: emptyInfrastructure(),
    cells: [
      ...state.cells,
      {
        cellX: 2,
        cellY: 3,
        footprint: { buildingId: 'hall' },
        building: { id: 'hall', type: 'town-hall', quarterTurns: 0 },
      },
    ],
  };
  const refinement: TravelRoute = {
    id: 'target',
    kind: 'stone',
    cells: [
      { cellX: 2, cellY: 3 },
      { cellX: 5, cellY: 3 },
    ],
    destination: { cellX: 5, cellY: 3 },
  };
  try {
    const expected = refineTravelRoute(geometry, refinement, new Set());
    expect(expected?.cells.length).toBeGreaterThan(2);
    expect(expected?.version).toBe(2);
    const first = await compute.refine(async () => ({ state: geometry, refinement }));
    expect(first).toEqual([expected]);
    first[0]!.cells.length = 0;
    expect(await compute.refine(async () => ({ state: geometry, refinement }))).toEqual([expected]);
    const flooded = { ...geometry, region: { ...state.region, terrainCodes: Array(256).fill(2) } };
    expect(await compute.refine(async () => ({ state: flooded, refinement }))).toEqual([]);
  } finally {
    await compute.close();
  }
});

it('never queues a locked transaction behind another lane loader', async () => {
  const compute = new NavigationCompute(),
    entered = gate(),
    release = gate();
  const jobs: Promise<unknown>[] = [];
  try {
    await compute.start();
    const held = compute.network(async () => {
      entered.release();
      await release.promise;
      return { state };
    });
    jobs.push(held);
    await bounded(entered.promise);
    const load = vi.fn(async () => ({ state }));
    await expect(compute.refine(load)).rejects.toMatchObject({ statusCode: 503, code: 'NAVIGATION_BUSY' });
    expect(load).not.toHaveBeenCalled();
    expect(compute.observation.waiting).toBe(0);
    release.release();
    await held;
    expect(await compute.refine(load)).toEqual(buildTravelNetwork(state));
  } finally {
    release.release();
    await Promise.allSettled(jobs);
    await compute.close();
  }
});

it('runs the same detour in the shared worker and reuses it without leaking result mutations', async () => {
  const compute = new NavigationCompute();
  try {
    const expected = buildTravelNetwork(state);
    expect(expected).toHaveLength(1);
    expect(expected[0]!.cells).not.toContainEqual({ cellX: 3, cellY: 3 });
    const first = await compute.network(async () => ({ state }));
    expect(first).toEqual(expected);
    first[0]!.cells.length = 0;
    expect(await compute.network(async () => ({ state }))).toEqual(expected);
    expect((await compute.run(async () => routeJob)).kind).toBe('found');
  } finally {
    await compute.close();
  }
});

it('bounds waiting projections before loading SQL and shares lanes with expedition calculations', async () => {
  const compute = new NavigationCompute(1, { waiting: 2, waitMs: 15000, computeMs: 30000 }),
    entered = gate(),
    release = gate();
  const jobs: Promise<unknown>[] = [];
  try {
    await compute.start();
    const expedition = compute.run(async () => {
      entered.release();
      await release.promise;
      return routeJob;
    });
    jobs.push(expedition);
    await bounded(entered.promise);
    const load = vi.fn(async () => ({ state }));
    const a = compute.network(load),
      b = compute.network(load);
    jobs.push(a, b);
    await expect(compute.network(load)).rejects.toMatchObject({ statusCode: 503, code: 'NAVIGATION_BUSY' });
    expect(load).not.toHaveBeenCalled();
    expect(compute.observation).toMatchObject({ active: 1, waiting: 2 });
    release.release();
    expect((await expedition).kind).toBe('found');
    expect(await a).toEqual(buildTravelNetwork(state));
    expect(await b).toEqual(buildTravelNetwork(state));
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    release.release();
    await Promise.allSettled(jobs);
    await compute.close();
  }
});

it('expires queued reads without calling their loader and allows a later retry', async () => {
  const compute = new NavigationCompute(1, { waiting: 1, waitMs: 25, computeMs: 30000 }),
    entered = gate(),
    release = gate();
  const jobs: Promise<unknown>[] = [];
  try {
    await compute.start();
    const held = compute.network(async () => {
      entered.release();
      await release.promise;
      return { state };
    });
    jobs.push(held);
    await bounded(entered.promise);
    const load = vi.fn(async () => ({ state }));
    await expect(compute.network(load)).rejects.toMatchObject({ code: 'NAVIGATION_BUSY' });
    expect(load).not.toHaveBeenCalled();
    release.release();
    await held;
    expect(await compute.network(load)).toEqual(buildTravelNetwork(state));
  } finally {
    release.release();
    await Promise.allSettled(jobs);
    await compute.close();
  }
});

it('reports an invalid worker input without an inline fallback, then recovers', async () => {
  const compute = new NavigationCompute();
  try {
    await expect(
      compute.network(async () => ({
        state,
        ground: {
          sourceId: 'invalid',
          artifact: '{}',
          edits: { worldId: 'other-world', width: 16, height: 16, terraces: [], absent: [], groves: [] },
        },
      })),
    ).rejects.toMatchObject({ statusCode: 503, code: 'NAVIGATION_UNAVAILABLE' });
    expect(await compute.network(async () => ({ state }))).toEqual(buildTravelNetwork(state));
  } finally {
    await compute.close();
  }
});

it('bounds queued trade routes before loading SQL and releases timed-out entries', async () => {
  const compute = new NavigationCompute(1, { waiting: 1, waitMs: 500, computeMs: 30000 }),
    entered = gate(),
    release = gate();
  const jobs: Promise<unknown>[] = [];
  try {
    await compute.start();
    const held = compute.network(async () => {
      entered.release();
      await release.promise;
      return { state };
    });
    jobs.push(held);
    await bounded(entered.promise);
    const load = vi.fn(async () => routeJob),
      queued = compute.run(load, { waitForLane: true });
    jobs.push(queued);
    const expired = expect(queued).rejects.toMatchObject({ code: 'NAVIGATION_BUSY' });
    expect(compute.observation.waiting).toBe(1);
    await expect(compute.run(load, { waitForLane: true })).rejects.toMatchObject({ code: 'NAVIGATION_BUSY' });
    await expired;
    expect(load).not.toHaveBeenCalled();
    expect(compute.observation.waiting).toBe(0);
    release.release();
    await held;
    expect((await compute.run(load, { waitForLane: true })).kind).toBe('found');
  } finally {
    release.release();
    await Promise.allSettled(jobs);
    await compute.close();
  }
});

it('lets a queued trade preempt observation and keeps background routes fail-fast', async () => {
  const compute = new NavigationCompute(),
    entered = gate(),
    release = gate();
  const jobs: Promise<unknown>[] = [];
  try {
    await compute.start();
    const diagnostic = compute.observationNetwork(
      async () => {
        entered.release();
        await release.promise;
        return { state };
      },
      async () => false,
    );
    jobs.push(diagnostic);
    const rejected = expect(diagnostic).rejects.toMatchObject({ code: 'OBSERVATION_BUSY' });
    await bounded(entered.promise);
    const background = vi.fn(async () => routeJob);
    await expect(compute.run(background)).rejects.toThrow('Navigation occupée');
    expect(background).not.toHaveBeenCalled();
    const trade = compute.run(async () => routeJob, { waitForLane: true });
    jobs.push(trade);
    expect(compute.observation.waiting).toBe(1);
    release.release();
    await rejected;
    expect((await trade).kind).toBe('found');
    expect(compute.observation.ready).toBe(1);
  } finally {
    release.release();
    await Promise.allSettled(jobs);
    await compute.close();
  }
});

it('terminates a non-answering worker at its deadline and reboots the shared lane', async () => {
  const compute = new NavigationCompute(1, { waiting: 2, waitMs: 15000, computeMs: 100 });
  await compute.start();
  // Deliberately swallow the dispatch after startup. A missing reply must not
  // keep the lane occupied indefinitely or trigger a synchronous calculation.
  const post = vi.spyOn(Worker.prototype, 'postMessage').mockImplementationOnce(() => {});
  try {
    await expect(compute.network(async () => ({ state }))).rejects.toMatchObject({ code: 'NAVIGATION_UNAVAILABLE' });
    expect(compute.observation.lastErrorAt).not.toBeNull();
    post.mockRestore();
    expect((await compute.run(async () => routeJob)).kind).toBe('found');
  } finally {
    post.mockRestore();
    await compute.close();
  }
});

it('rejects queued work at shutdown and never starts its loader', async () => {
  const compute = new NavigationCompute(),
    entered = gate(),
    release = gate();
  await compute.start();
  const held = compute.network(async () => {
    entered.release();
    await release.promise;
    return { state };
  });
  const heldOutcome = Promise.allSettled([held]);
  await bounded(entered.promise);
  const load = vi.fn(async () => ({ state })),
    queued = compute.network(load),
    outcome = Promise.allSettled([queued]);
  try {
    await compute.close();
    release.release();
    expect((await outcome)[0]).toMatchObject({ status: 'rejected' });
    expect((await heldOutcome)[0]).toMatchObject({ status: 'rejected' });
    expect(load).not.toHaveBeenCalled();
  } finally {
    release.release();
    await heldOutcome;
    await outcome;
    await compute.close();
  }
});

it('transfers spatial fields without economic or support data', () => {
  const rich = {
    ...state,
    world: { ...state.world, secret: 'not-spatial' },
    village: { ...state.village, wood: 123, ownerAccountId: 'private' },
    science: { programs: ['private'] },
    region: {
      ...state.region,
      features: [
        {
          id: 'stone',
          type: 'stone_outcrop',
          cellX: 1,
          cellY: 1,
          deposit: { state: 'available', blocksCell: true, cleared: false, remainingAmount: 500 },
        },
      ],
    },
  } as unknown as TravelNetworkState;
  const projected = networkState(rich);
  expect(projected.village).toEqual(state.village);
  expect(projected.world).toEqual(state.world);
  expect(JSON.stringify(projected)).not.toMatch(/private|remainingAmount|wood|science|secret/);
});
