import { describe, it, expect } from 'vitest';
import { woodlandTrees, woodlandPassage } from './woodland-layout.js';
import { woodlandTreeIndices } from './woodland-trees.js';
import { buildTravelNetwork, refineTravelRoute, type TravelGround } from './travel-paths.js';
import { emptyInfrastructure } from './infrastructure.js';
import { spawnDelta } from './spawn-map.js';
import { canWalkSpawnSegment } from './spawn-access.js';
import type { NaturalFeature, VillageState } from './villages.js';
const world = { id: 'trunk-walking', widthCells: 512, heightCells: 256 };
const wood = (cellX = 10, cellY = 8) =>
  ({
    id: 'wood',
    type: 'woodland',
    cellX,
    cellY,
    variantSeed: 3,
    rc1: { trees: [], rocks: [] },
    deposit: { state: 'available', initialAmount: 1500, remainingAmount: 1500, blocksCell: true, cleared: false },
  }) as unknown as NaturalFeature;
describe('woodland pedestrian geometry', () => {
  it('retains existing synthetic positions, count and stock scaling for both rendering and navigation', () => {
    const f = wood(),
      full = woodlandTrees(f);
    expect(full).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const hash = (x: number, y: number) => {
          const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
          return v - Math.floor(v);
        },
        angle = ((i + hash(3, 401)) / 3) * Math.PI * 2,
        radius = 0.42 + hash(3, i + 419) * 0.48;
      expect(full[i]!.x).toBeCloseTo(10 + (Math.cos(angle) * radius) / 2.5);
      expect(full[i]!.y).toBeCloseTo(8 + (Math.sin(angle) * radius) / 2.5);
      expect(full[i]!.scale).toBeCloseTo(0.76 + hash(3, i + 431) * 0.26);
    }
    f.deposit!.remainingAmount = 150;
    expect(woodlandTrees(f)[0]!.scale).toBeCloseTo(full[0]!.scale * 0.28);
    f.deposit!.cleared = true;
    expect(woodlandTrees(f)).toEqual([]);
  });
  it('draws as many trees as the economy counts in a cell of a world without RC1 forest', () => {
    for (let variantSeed = -6; variantSeed < 14; variantSeed++) {
      const f = { ...wood(), variantSeed, rc1: undefined, deposit: null } as unknown as NaturalFeature;
      expect(woodlandTrees(f)).toHaveLength(woodlandTreeIndices({ rc1: null, variantSeed }).length);
      // Once it holds wood, 500 per tree: a case kept at two trees beside a building.
      const kept = { ...wood(), variantSeed, rc1: undefined } as unknown as NaturalFeature;
      kept.deposit!.initialAmount = 1000;
      expect(woodlandTrees(kept)).toHaveLength(2);
      expect(woodlandTreeIndices({ rc1: null, variantSeed, initialAmount: 1000 })).toEqual([0, 1]);
    }
    const starter = woodlandTreeIndices({
      rc1: { sourceKey: 'starter:v:0', treeIndices: [], removedIndices: [] },
      variantSeed: 3,
    });
    expect(woodlandTrees(wood())).toHaveLength(starter.length);
  });
  it('uses the dimensions and stock scale of the natural tree instances', () => {
    const f = wood();
    f.rc1!.trees = [{ x: 20, y: 30, elevation: 2, size: 1.5, crown: 0.8 }];
    f.deposit!.remainingAmount = 750;
    expect(woodlandTrees(f)[0]).toMatchObject({ x: 20, y: 30, heightScale: 0.75, rotation: 0, elevation: 2 });
    expect(woodlandTrees(f)[0]!.scale).toBeCloseTo(0.6);
  });
  it('protects a trunk across both seams and cannot step over a thin trunk between sampling points', () => {
    const tree = { x: 511.99, y: 255.99, scale: 0.1, heightScale: 0.1, rotation: 0 },
      p = woodlandPassage([tree], world);
    expect(p.blocked(0.01, 0.01)).toBe(true);
    expect(p.cells).toContainEqual({ cellX: 0, cellY: 0 });
    const ground = {
      width: 512,
      height: 256,
      sample: (x: number, y: number) => ({ dry: true, elevation: 1, blocked: p.blocked(x, y) }),
    };
    expect(canWalkSpawnSegment(ground, { x: 511.875, y: 255.99 }, { x: 0.125, y: 255.99 })).toBe(false);
    expect(canWalkSpawnSegment(ground, { x: 511.875, y: 255.5 }, { x: 0.125, y: 255.5 })).toBe(true);
  });
  for (const turns of [0, 1, 2, 3])
    for (const anchor of [
      { x: 10, y: 10 },
      { x: 511, y: 255 },
    ])
      it(
        'routes around actual trunks without freeing construction occupancy, rotation ' +
          turns +
          ' anchor ' +
          anchor.x +
          ',' +
          anchor.y,
        () => {
          const rotate = (x: number, y: number) =>
            turns === 0 ? [x, y] : turns === 1 ? [-y, x] : turns === 2 ? [-x, -y] : [y, -x];
          const at = (x: number, y: number) => {
            const [dx, dy] = rotate(x, y);
            return { cellX: (anchor.x + dx! + 512) % 512, cellY: (anchor.y + dy! + 256) % 256 };
          };
          const local = (x: number, y: number) => {
            const dx = spawnDelta(x, anchor.x, 512),
              dy = spawnDelta(y, anchor.y, 256);
            return turns === 0 ? [dx, dy] : turns === 1 ? [dy, -dx] : turns === 2 ? [-dx, -dy] : [-dy, dx];
          };
          const w = wood(at(0, -2).cellX, at(0, -2).cellY),
            goal = at(0, -4);
          const region = {
            originCellX: 0,
            originCellY: 0,
            width: 512,
            height: 256,
            terrainCodes: Array.from({ length: 512 * 256 }, (_, i) => {
              const [x, y] = local(i % 512, Math.floor(i / 512));
              return Math.abs(x!) <= 1 && y! >= -5 && y! <= 1 ? 1 : 2;
            }),
            features: [w, { id: 'stone', type: 'stone_outcrop', ...goal, deposit: { state: 'available' } }],
          };
          const s = {
            world: { ...world, id: 'tree-' + turns + '-' + anchor.x },
            village: { anchorCellX: anchor.x, anchorCellY: anchor.y, townHallBuildingId: 'hall' },
            region,
            cells: [
              {
                ...at(0, 0),
                footprint: { buildingId: 'hall', state: 'active' },
                building: { id: 'hall', type: 'town-hall', quarterTurns: turns },
              },
              ...[-1, 1].map((x) => ({ ...at(x, -2), footprint: { buildingId: 'wall' + x, state: 'active' } })),
            ],
            infrastructure: emptyInfrastructure(),
          } as unknown as VillageState;
          const tree = { x: w.cellX, y: w.cellY, scale: 1, heightScale: 1, rotation: 0 },
            p = woodlandPassage([tree], world);
          const ground: TravelGround = {
            width: 512,
            height: 256,
            revision: 'trunks',
            woodedCells: p.cells,
            sample: (x, y) => ({ elevation: 1, dry: true, blocked: p.blocked(x, y) }),
          };
          expect(
            buildTravelNetwork(s, [], {
              width: ground.width,
              height: ground.height,
              revision: ground.revision,
              sample: ground.sample,
            }).find((r) => r.id === 'stone'),
          ).toBeUndefined();
          const route = buildTravelNetwork(s, [], ground).find((r) => r.id === 'stone');
          expect(route).toBeDefined();
          expect(w.deposit!.blocksCell).toBe(true);
          for (let i = 1; i < route!.cells.length; i++)
            expect(
              canWalkSpawnSegment(
                ground,
                { x: route!.cells[i - 1]!.cellX, y: route!.cells[i - 1]!.cellY },
                { x: route!.cells[i]!.cellX, y: route!.cells[i]!.cellY },
              ),
            ).toBe(true);
          const closed = {
            ...ground,
            revision: 'closed',
            sample: (x: number, y: number) => {
              const [, yLocal] = local(x, y);
              return { elevation: 1, dry: true, blocked: Math.abs(yLocal! + 2) < 0.5 };
            },
          };
          expect(buildTravelNetwork(s, [], closed).find((r) => r.id === 'stone')).toBeUndefined();
          expect(
            refineTravelRoute(
              s,
              { id: 'stone', kind: 'stone', destination: goal, cells: [at(0, 0), goal] },
              undefined,
              undefined,
              closed,
            ),
          ).toBeNull();
        },
      );
});
