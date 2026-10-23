import { describe, expect, it, vi } from 'vitest';
import { buildingAccesses } from './building-access.js';
import { emptyInfrastructure } from './infrastructure.js';
import { canWalkSpawnSegment } from './spawn-access.js';
import { pathIntersectsBox } from './path-obstacles.js';
import { refineTravelRoute, type TravelGround, type TravelNetworkState, type TravelRoute } from './travel-paths.js';

function fixture(seam = false) {
  const x = (n: number) => (n + (seam ? 210 : 0)) % 256;
  const cells = [{ cellX: x(10), cellY: 90 }];
  for (let n = 11; n <= 90; n++) cells.push({ cellX: x(n), cellY: 90 });
  for (let n = 89; n >= 10; n--) cells.push({ cellX: x(90), cellY: n });
  const state: TravelNetworkState = {
    world: { id: 'guide-' + seam, widthCells: 256, heightCells: 256 },
    village: { anchorCellX: x(10), anchorCellY: 90, townHallBuildingId: 'hall' },
    region: {
      originCellX: 0,
      originCellY: 0,
      width: 256,
      height: 256,
      terrainCodes: Array(256 * 256).fill(1),
      features: [],
    },
    cells: [
      {
        cellX: x(10),
        cellY: 90,
        footprint: { buildingId: 'hall' },
        building: { id: 'hall', type: 'town-hall', quarterTurns: 0 },
      },
    ],
    infrastructure: emptyInfrastructure(),
  };
  const ground: TravelGround = {
    width: 256,
    height: 256,
    revision: 'guide-' + seam,
    woodedCells: Array.from({ length: 256 * 256 }, (_, i) => ({ cellX: i % 256, cellY: Math.floor(i / 256) })),
    sample: () => ({ elevation: 1, dry: true, blocked: false }),
  };
  state.infrastructure!.roads = [
    {
      id: 'distant-road',
      operation: 'paint',
      material: 'stone-1',
      width: 4,
      border: false,
      points: [
        { x: x(30) * 8, y: 30 * 8 },
        { x: x(50) * 8, y: 30 * 8 },
        { x: x(50) * 8, y: 50 * 8 },
        { x: x(30) * 8, y: 50 * 8 },
      ],
    },
  ];
  const route: TravelRoute = { id: 'woodland', kind: 'wood', destination: cells.at(-1)!, cells };
  return { state, ground, route, x };
}

describe('certified coarse guide refinement', () => {
  it('finds a long route without a coarse witness when the target needs a subcell approach', () => {
    const { state, ground, route } = fixture();
    state.world.id = 'missing-guide';
    ground.revision = 'missing-guide';
    route.cells = [route.cells[0]!, route.destination];
    ground.sample = (x, y) => ({
      elevation: 1,
      dry: true,
      blocked: Math.abs(x - 89) < 0.15 && Math.abs(y - 10) < 0.15,
    });
    const result = refineTravelRoute(state, route, undefined, undefined, ground, undefined, {
      maxVisited: 2048,
      onLimit: () => {
        throw Error('search exhausted');
      },
    })!;
    expect(result).not.toBeNull();
    expect(result.cells.at(-1)).toEqual(route.destination);
    for (let i = 1; i < result.cells.length; i++) {
      const a = result.cells[i - 1]!,
        b = result.cells[i]!;
      expect(canWalkSpawnSegment(ground, { x: a.cellX, y: a.cellY }, { x: b.cellX, y: b.cellY })).toBe(true);
    }
  });
  it.each([false, true])(
    'reaches a distant woodland within a bounded search, including the real door (seam %s)',
    (seam) => {
      const { state, ground, route } = fixture(seam);
      const result = refineTravelRoute(state, route, undefined, undefined, ground, undefined, {
        maxVisited: 2048,
        onLimit: () => {
          throw Error('search exhausted');
        },
      });
      expect(result).not.toBeNull();
      expect(result!.cells[0]).toEqual(buildingAccesses(state, 'hall')[0]!.position);
      expect(result!.cells.at(-1)).toEqual(route.destination);
      for (let i = 1; i < result!.cells.length; i++) {
        const a = result!.cells[i - 1]!,
          b = result!.cells[i]!;
        expect(canWalkSpawnSegment(ground, { x: a.cellX, y: a.cellY }, { x: b.cellX, y: b.cellY })).toBe(true);
      }
    },
  );
  it.each(['building', 'equipment', 'trunk', 'water', 'slope'] as const)(
    'repairs a guide made stale by %s, with physically valid segments',
    (obstacle) => {
      const { state, ground, route } = fixture();
      state.world.id = 'stale-' + obstacle;
      state.infrastructure!.roads = [];
      route.cells = route.cells.slice(0, 19);
      route.destination = route.cells.at(-1)!;
      const centre = { cellX: 22, cellY: 90 };
      if (obstacle === 'building')
        state.cells = [...state.cells, { ...centre, footprint: { buildingId: 'new-house' }, building: null }];
      if (obstacle === 'equipment')
        state.infrastructure!.equipment.push({
          id: 'new-equipment',
          x: 22 * 8,
          y: 90 * 8,
          quarterTurns: 0,
          version: 1,
        });
      const altered = {
        ...ground,
        revision: 'stale-' + obstacle,
        sample: (x: number, y: number) => {
          const inside = Math.abs(x - 22) < 0.2 && Math.abs(y - 90) < 0.2;
          return {
            elevation: inside && obstacle === 'slope' ? 2 : 1,
            dry: !(inside && obstacle === 'water'),
            blocked: inside && obstacle === 'trunk',
          };
        },
      };
      const result = refineTravelRoute(state, route, undefined, undefined, altered)!;
      expect(result).not.toBeNull();
      expect(result.cells.at(-1)).toEqual(route.destination);
      expect(
        pathIntersectsBox(
          result.cells,
          centre,
          obstacle === 'building' ? 0.49 : 0.12,
          obstacle === 'building' ? 0.49 : 0.12,
          state.world,
        ),
      ).toBe(false);
      for (let i = 1; i < result.cells.length; i++) {
        const a = result.cells[i - 1]!,
          b = result.cells[i]!;
        expect(canWalkSpawnSegment(altered, { x: a.cellX, y: a.cellY }, { x: b.cellX, y: b.cellY })).toBe(true);
      }
    },
  );
  it('never certifies a blocked destination or turns a search limit into unreachability', () => {
    const { state, ground, route } = fixture();
    ground.revision = 'blocked-destination';
    ground.sample = (x, y) => ({ elevation: 1, dry: true, blocked: Math.abs(x - 90) < 0.2 && Math.abs(y - 10) < 0.2 });
    const onLimit = vi.fn();
    expect(
      refineTravelRoute(state, route, undefined, undefined, ground, undefined, { maxVisited: 2048, onLimit }),
    ).toBeNull();
    expect(onLimit).toHaveBeenCalledOnce();
  });
  it('does not reuse a certified guide after an obstacle changes, or expose mutable cached cells', () => {
    const { state, ground, route } = fixture();
    state.world.id = 'guide-cache';
    ground.woodedCells = ground.woodedCells!.filter((p) => p.cellX < 100 && p.cellY >= 80 && p.cellY <= 100);
    const first = refineTravelRoute(state, route, undefined, undefined, ground)!;
    expect(first).not.toBeNull();
    const saved = structuredClone(first);
    first.cells[0]!.cellX = 0;
    const checkpoint = vi.fn();
    expect(refineTravelRoute(state, route, undefined, undefined, ground, checkpoint)).toEqual(saved);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    state.infrastructure!.equipment.push({ id: 'closed-goal', x: 90 * 8, y: 10 * 8, quarterTurns: 0, version: 1 });
    expect(refineTravelRoute(state, route, undefined, undefined, ground)).toBeNull();
  });
});
