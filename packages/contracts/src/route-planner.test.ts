import { describe, it, expect } from 'vitest';
import {
  planRoute,
  ROUTE_POLICY_VERSION,
  routeLength,
  travelledCells,
  type RouteField,
  type RouteQuery,
} from './route-planner.js';
import { refineTravelRoute, type TravelNetworkState } from './travel-paths.js';
import { emptyInfrastructure } from './infrastructure.js';
import { canWalkSpawnSegment } from './spawn-access.js';
const field = (blocked: (x: number, y: number) => boolean = () => false): RouteField => ({
  worldId: 'w',
  contextId: 'r',
  traversalConstraintsId: 'none',
  width: 96,
  height: 32,
  accesses: [],
  connector: () => true,
  sample: (x, y) => ({ elevation: 1, dry: true, blocked: blocked(x, y) }),
});
const query = (a = { cellX: 1, cellY: 8 }, b = { cellX: 60, cellY: 8 }): RouteQuery => ({
  worldId: 'w',
  contextId: 'r',
  policyVersion: ROUTE_POLICY_VERSION,
  movementProfileId: 'pedestrian-v1',
  traversalConstraintsId: 'none',
  starts: [{ kind: 'point', ...a }],
  goals: [{ kind: 'point', ...b }],
  limits: { maxNodes: 262144, maxDurationMs: 5000 },
});
describe('pure full-route navigation', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('joins a distant hall through a fine doorway near the endpoint, reverse=%s, seam=%s', (reverse, seam) => {
    const shift = seam ? 262 : 0,
      wrap = (x: number) => ((x % 512) + 512) % 512;
    const f = {
      ...field((px, y) => {
        const x = wrap(px - shift);
        return (
          (x > 248.9 && x < 249.1 && y > 99 && y < 102 && !(y > 100.18 && y < 100.58)) ||
          (x > 251.9 && x < 252.1 && y > 99 && y < 102) ||
          (((y > 98.9 && y < 99.1) || (y > 101.9 && y < 102.1)) && x > 248.9 && x < 252.1)
        );
      }),
      width: 512,
      height: 256,
    };
    const a = { cellX: wrap(10 + shift), cellY: 100 },
      b = { cellX: wrap(250.5 + shift), cellY: 100.375 };
    const q = query(reverse ? b : a, reverse ? a : b);
    q.coarseFirst = true;
    q.limits.maxNodes = 1024;
    const result = planRoute(f, q, () => 0);
    expect(result.kind).toBe('found');
    expect(result.visited).toBeLessThanOrEqual(q.limits.maxNodes);
    if (result.kind !== 'found') return;
    expect(result.path[0]).toEqual(reverse ? b : a);
    expect(result.path.at(-1)).toEqual(reverse ? a : b);
    for (let i = 1; i < result.path.length; i++)
      expect(
        canWalkSpawnSegment(
          f,
          { x: result.path[i - 1]!.cellX, y: result.path[i - 1]!.cellY },
          { x: result.path[i]!.cellX, y: result.path[i]!.cellY },
        ),
      ).toBe(true);
  });
  it('finds a long hall-to-hall detour within a bounded search instead of exhausting the fine lattice', () => {
    const f = { ...field((x, y) => x > 190 && x < 210 && y > 60 && y < 140), width: 512, height: 256 };
    const q = query({ cellX: 150, cellY: 100 }, { cellX: 250, cellY: 100 });
    q.coarseFirst = true;
    q.limits.maxNodes = 20000;
    const r = planRoute(f, q, () => 0);
    expect(r.kind).toBe('found');
    if (r.kind === 'found') {
      expect(r.path[0]).toEqual({ cellX: 150, cellY: 100 });
      expect(r.path.at(-1)).toEqual({ cellX: 250, cellY: 100 });
      for (let i = 1; i < r.path.length; i++)
        expect(
          canWalkSpawnSegment(
            f,
            { x: r.path[i - 1]!.cellX, y: r.path[i - 1]!.cellY },
            { x: r.path[i]!.cellX, y: r.path[i]!.cellY },
          ),
        ).toBe(true);
    }
  });
  it('retains fine passages and shares the commercial node budget across both searches', () => {
    const q = query({ cellX: 15, cellY: 8 }, { cellX: 25, cellY: 8 });
    q.coarseFirst = true;
    const f = field((x, y) => x > 19.8 && x < 20.2 && !(y > 8.18 && y < 8.58));
    const r = planRoute(f, q, () => 0);
    expect(r.kind).toBe('found');
    if (r.kind === 'found')
      for (let i = 1; i < r.path.length; i++)
        expect(
          canWalkSpawnSegment(
            f,
            { x: r.path[i - 1]!.cellX, y: r.path[i - 1]!.cellY },
            { x: r.path[i]!.cellX, y: r.path[i]!.cellY },
          ),
        ).toBe(true);
    const bounded = { ...q, limits: { ...q.limits, maxNodes: 1024 } };
    const limited = planRoute(f, bounded, () => 0);
    expect(limited.visited).toBeLessThanOrEqual(1024);
  });
  it('reaches a distant goal by detouring around a rock beyond the local refinement', () => {
    const f = field((x, y) => x > 39.5 && x < 40.5 && y > 6 && y < 10),
      q = query({ cellX: 10, cellY: 8 }, { cellX: 55, cellY: 8 }),
      r = planRoute(f, q);
    expect(canWalkSpawnSegment(f, { x: 10, y: 8 }, { x: 55, y: 8 })).toBe(false);
    expect(r.kind).toBe('found');
    if (r.kind !== 'found') return;
    expect(r.path.at(-1)).toEqual(q.goals[0] && { cellX: 55, cellY: 8 });
    for (let i = 1; i < r.path.length; i++)
      expect(
        canWalkSpawnSegment(
          f,
          { x: r.path[i - 1]!.cellX, y: r.path[i - 1]!.cellY },
          { x: r.path[i]!.cellX, y: r.path[i]!.cellY },
        ),
      ).toBe(true);
  });
  it('certifies distant obstacles in both village refinement and full-route navigation', () => {
    const f = field((x, y) => x > 47.4 && x < 47.6 && y > 6 && y < 10),
      start = { cellX: 10, cellY: 8 },
      destination = { cellX: 55, cellY: 8 };
    const state: TravelNetworkState = {
      world: { id: 'w', widthCells: 96, heightCells: 32 },
      village: { anchorCellX: 10, anchorCellY: 8, townHallBuildingId: 'hall' },
      region: {
        originCellX: 0,
        originCellY: 0,
        width: 96,
        height: 32,
        terrainCodes: Array(96 * 32).fill(1),
        features: [],
      },
      cells: [
        {
          ...start,
          footprint: { buildingId: 'hall' },
          building: { id: 'hall', type: 'town-hall', quarterTurns: 0, visualLayout: null },
        },
      ],
      infrastructure: emptyInfrastructure(),
    };
    const cells = Array.from({ length: 46 }, (_, i) => ({ cellX: 10 + i, cellY: 8 }));
    const refined = refineTravelRoute(
      state,
      { id: 'destination', kind: 'stone', destination, cells },
      new Set(),
      undefined,
      { ...f, revision: 'obstacle-distant' },
    );
    expect(refined).not.toBeNull();
    expect(refined!.cells.at(-1)).toEqual(destination);
    expect(
      refined!.cells.every(
        (p, i, a) =>
          i === 0 || canWalkSpawnSegment(f, { x: a[i - 1]!.cellX, y: a[i - 1]!.cellY }, { x: p.cellX, y: p.cellY }),
      ),
    ).toBe(true);
    const current = planRoute(f, query(start, destination));
    expect(current.kind).toBe('found');
    if (current.kind === 'found')
      for (let i = 1; i < current.path.length; i++)
        expect(
          canWalkSpawnSegment(
            f,
            { x: current.path[i - 1]!.cellX, y: current.path[i - 1]!.cellY },
            { x: current.path[i]!.cellX, y: current.path[i]!.cellY },
          ),
        ).toBe(true);
  });
  it('connects arbitrary fractional points and access endpoints without adding a return', () => {
    const f = field();
    f.accesses = [
      {
        id: 'a',
        path: [
          { cellX: 3.2, cellY: 2 },
          { cellX: 3.625, cellY: 2 },
        ],
      },
      {
        id: 'b',
        path: [
          { cellX: 6.2, cellY: 2 },
          { cellX: 5.625, cellY: 2 },
        ],
      },
    ];
    const q = query();
    q.starts = [{ kind: 'access', accessId: 'a' }];
    q.goals = [{ kind: 'access', accessId: 'b' }];
    const r = planRoute(f, q);
    expect(r.kind).toBe('found');
    if (r.kind === 'found') {
      expect(r.path[0]).toEqual(f.accesses[0]!.path[0]);
      expect(r.path.at(-1)).toEqual(f.accesses[1]!.path[0]);
    }
  });
  it('reaches a fractional point from an integer centre on open ground', () => {
    const q = query({ cellX: 3, cellY: 2 }, { cellX: 6.2, cellY: 2 });
    q.limits.maxNodes = 1000;
    const r = planRoute(field(), q);
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.path.at(-1)).toEqual({ cellX: 6.2, cellY: 2 });
  });
  it('takes both torus seams continuously', () => {
    const f = field(),
      r = planRoute(f, query({ cellX: 95, cellY: 31 }, { cellX: 1, cellY: 1 }));
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(routeLength(r.path, f)).toBe(4);
  });
  it('finds a fine passage missed by the centre lattice', () => {
    const f = field((x, y) => x > 19.8 && x < 20.2 && !(y > 8.18 && y < 8.58)),
      r = planRoute(f, query({ cellX: 15, cellY: 8 }, { cellX: 25, cellY: 8 }));
    expect(r.kind).toBe('found');
  });
  it('keeps incomplete search distinct from inaccessible endpoints', () => {
    const f = field(),
      q = query();
    q.limits.maxNodes = 1;
    expect(planRoute(f, q).kind).toBe('budget-exceeded');
    expect(
      planRoute(
        field(() => true),
        query(),
      ).kind,
    ).toBe('unreachable');
  });
  it('does not turn an exhausted preparation budget into an inaccessible endpoint', () => {
    const q = query();
    q.limits.maxDurationMs = 0;
    expect(
      planRoute(
        field(() => true),
        q,
      ),
    ).toEqual({ kind: 'budget-exceeded', visited: 0 });
  });
  it('refuses another context, constraints or unknown movement profile', () => {
    const q = query();
    expect(planRoute(field(), { ...q, traversalConstraintsId: 'other' }).kind).toBe('context-unavailable');
    expect(planRoute(field(), { ...q, movementProfileId: 'cart' }).kind).toBe('context-unavailable');
  });
  it('records travelled cells on long and fractional segments, including seams', () => {
    expect(
      travelledCells(
        [
          { cellX: 95.125, cellY: 2 },
          { cellX: 1, cellY: 2 },
        ],
        { widthCells: 96, heightCells: 32 },
      ),
    ).toEqual([
      { cellX: 95, cellY: 2 },
      { cellX: 0, cellY: 2 },
      { cellX: 1, cellY: 2 },
    ]);
  });
});
