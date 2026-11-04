import { describe, expect, it } from 'vitest';
import type { VillageState } from '@arbestra/contracts';
import {
  acceptableOffers,
  chooseAction,
  flatCells,
  freeCells,
  parseMix,
  planAction,
  regionVertexHeight,
  type BotMemory,
  type PlanContext,
} from './actions.js';
import { candidatePoints, farEnough, rng, torusDistance } from './placement.js';

const VILLAGE = '7b969e10-c2c0-4fb0-be4c-012ccfdc543c';
const level = (n: number, costs: Array<[string, number]>, variantCosts: unknown[] = []) => ({
  level: n,
  constructionDurationSeconds: 60,
  additionalCellsRequired: 0,
  visualVariant: 'x',
  costs: costs.map(([resourceCode, amount]) => ({ resourceCode, amount })),
  variantCosts,
  production: [],
});
/** A village as the bots receive it, reduced to what the planners read. */
function village(
  options: {
    wood?: number;
    carrots?: number;
    available?: number;
    working?: number;
    unlocked?: boolean;
    cartographers?: number;
  } = {},
) {
  const cells: VillageState['cells'] = [];
  for (let y = 120; y < 136; y++)
    for (let x = 250; x < 266; x++)
      cells.push({
        id: `${x}:${y}`,
        cellX: x,
        cellY: y,
        x: 0,
        z: 0,
        building: null,
        footprint: null,
        canBuild: true,
      } as VillageState['cells'][number]);
  const hall = cells.find((c) => c.cellX === 256 && c.cellY === 128)!;
  hall.canBuild = false;
  hall.building = {
    id: 'ed2df340-1335-4555-8060-65d3d4f1a442',
    type: 'town-hall',
    level: 1,
    targetLevel: null,
    status: 'completed',
    garden: null,
  } as never;
  const garden = cells.find((c) => c.cellX === 254 && c.cellY === 127)!;
  garden.canBuild = false;
  garden.building = {
    id: '8f9a4c81-6592-4bbd-bf96-889266791d9c',
    type: 'garden',
    level: 1,
    targetLevel: null,
    status: 'completed',
    garden: { plots: [{ cellX: 254, cellY: 127, storedCarrots: 200, harvest: null }] },
  } as never;
  // Level ground north of vertex row 126, uneven south of it.
  const vertexHeights = Array.from({ length: 65 * 65 }, (_, i) => (i < 30 * 65 ? 0 : (i % 7) * 0.1));
  return {
    world: {
      id: 'w',
      slug: 'charge',
      name: 'C',
      topology: 'torus',
      widthCells: 512,
      heightCells: 256,
      chunkSize: 32,
      seed: '1',
      generationVersion: 3,
    },
    village: {
      id: VILLAGE,
      anchorCellX: 256,
      anchorCellY: 128,
      resources: [
        { code: 'wood', amount: options.wood ?? 2000 },
        { code: 'carrot', amount: options.carrots ?? 50 },
        { code: 'timber', amount: 0 },
        { code: 'cut-stone', amount: 0 },
        { code: 'stone', amount: 0 },
      ],
      carrots: options.carrots ?? 50,
      population: { available: options.available ?? 20, working: options.working ?? 0, resting: 0 },
      extractionPools: [
        { resource: 'wood', siteCount: 1, workerCap: 5, mobilized: 0, activeSites: 0, pendingTargets: 0 },
        { resource: 'stone', siteCount: 3, workerCap: 5, mobilized: 0, activeSites: 0, pendingTargets: 0 },
      ],
      market: {
        unlocked: options.unlocked ?? false,
        offers: [{ id: 'o1', villageId: VILLAGE, villageName: 'Bot 001', status: 'open' }],
      },
    },
    science: { cartographers: options.cartographers ?? 0 },
    buildingTypes: [
      {
        code: 'town-hall',
        buildable: false,
        progressionMode: 'fixed-footprint',
        instanceLimitPerVillage: 1,
        levels: [
          level(1, []),
          level(2, [
            ['timber', 500],
            ['cut-stone', 120],
          ]),
        ],
      },
      {
        code: 'dwelling',
        buildable: true,
        progressionMode: 'fixed-footprint',
        instanceLimitPerVillage: null,
        levels: [
          level(
            1,
            [['timber', 25]],
            [{ variant: 'logs', resourceCode: 'wood', amount: 25, replacesResourceCode: 'timber' }],
          ),
        ],
      },
      {
        code: 'garden',
        buildable: true,
        progressionMode: 'spatial',
        instanceLimitPerVillage: null,
        levels: [level(1, [['wood', 50]])],
      },
      {
        code: 'sawmill',
        buildable: true,
        progressionMode: 'vertical',
        instanceLimitPerVillage: null,
        levels: [level(1, [['wood', 50]])],
      },
    ],
    region: {
      originCellX: 224,
      originCellY: 96,
      width: 64,
      height: 64,
      vertexHeights,
      features: [
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          type: 'woodland',
          cellX: 260,
          cellY: 130,
          deposit: { resourceCode: 'wood', state: 'available', availableAmount: 100 },
        },
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000002',
          type: 'woodland',
          cellX: 300,
          cellY: 130,
          deposit: { resourceCode: 'wood', state: 'depleted', availableAmount: 0 },
        },
      ],
    },
    cells,
    roadCells: [{ cellX: 250, cellY: 120 }],
  } as unknown as VillageState;
}
let ids = 0;
const context = (state: VillageState, memory: BotMemory = { terraformed: [] }, seed = 1): PlanContext => ({
  state,
  memory,
  random: rng(seed),
  uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  now: 100_000,
});

describe('bot action choice', () => {
  it('parses a mix over the defaults, or alone', () => {
    expect(parseMix('harvest=5').harvest).toBe(5);
    expect(parseMix('harvest=5').build).toBe(1);
    expect(parseMix('only:terraform=1')).toEqual({ terraform: 1 });
    expect(() => parseMix('fly=1')).toThrow(/Mélange invalide/);
    expect(() => parseMix('build=-1')).toThrow(/Mélange invalide/);
  });

  it('builds only on free cells whose ring is free, with the costs it can pay', () => {
    const state = village();
    const free = freeCells(state);
    const keys = new Set(free.map((c) => `${c.cellX}:${c.cellY}`));
    expect(keys.has('256:128')).toBe(false);
    // Next to the town hall, next to a road or on the edge of the reach: the leveling ring is not free.
    expect(keys.has('257:128')).toBe(false);
    expect(keys.has('251:121')).toBe(false);
    expect(keys.has('250:130')).toBe(false);
    expect(keys.has('260:122')).toBe(true);
    const planned = planAction('build', context(state));
    expect(planned?.kind).toBe('build');
    if (planned?.kind !== 'build') return;
    expect(keys.has(`${planned.body.anchorCellX}:${planned.body.anchorCellY}`)).toBe(true);
    // Level ground only: the uneven south of the village is never offered.
    expect(planned.body.anchorCellY).toBeLessThan(126);
    expect(flatCells(state).every((c) => c.cellY < 126)).toBe(true);
    expect(planned.body.cells).toEqual([{ cellX: planned.body.anchorCellX, cellY: planned.body.anchorCellY }]);
    const costs = {
      dwelling: [{ resourceCode: 'wood', amount: 25 }],
      garden: [{ resourceCode: 'wood', amount: 50 }],
      sawmill: [{ resourceCode: 'wood', amount: 50 }],
    };
    expect(planned.body.expectedCosts).toEqual(costs[planned.body.buildingType as keyof typeof costs]);
    expect(planAction('build', context(village({ wood: 10 })))).toBeNull();
  });

  it('upgrades nothing it cannot pay, and never a garden', () => {
    expect(planAction('upgrade', context(village()))).toBeNull();
    const rich = village();
    rich.village.resources = [
      ...rich.village.resources.filter((r) => r.code !== 'timber' && r.code !== 'cut-stone'),
      { code: 'timber', amount: 600 },
      { code: 'cut-stone', amount: 200 },
    ] as never;
    const planned = planAction('upgrade', context(rich));
    expect(planned).toMatchObject({
      kind: 'upgrade',
      buildingId: 'ed2df340-1335-4555-8060-65d3d4f1a442',
      body: { expectedLevel: 2 },
    });
  });

  it('harvests gardens with carrots and available woods only, with free people', () => {
    for (let seed = 1; seed < 30; seed++) {
      const planned = planAction('harvest', context(village(), { terraformed: [] }, seed));
      expect(planned?.kind).toBe('harvest');
      if (planned?.kind !== 'harvest') continue;
      expect(planned.body.wood.every((id) => id.endsWith('0001'))).toBe(true);
      expect(planned.body.gardens.every((c) => c.cellX === 254 && c.cellY === 127)).toBe(true);
      expect(planned.body.gardens.length + planned.body.wood.length).toBeGreaterThan(0);
    }
    expect(planAction('harvest', context(village({ available: 0 })))).toBeNull();
  });

  it('changes a pool only within the HUD bounds', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      const planned = planAction('hud-pool', context(village(), { terraformed: [] }, seed));
      if (planned?.kind !== 'hud-pool') throw Error('no pool gesture');
      seen.add(`${planned.body.resource}:${planned.body.action}`);
    }
    // The stone pool is at three sites: no further site. Five people on one
    // site go down to one (extractionPoolSettings), never below.
    expect([...seen].sort()).toEqual([
      'stone:people-down',
      'stone:people-up',
      'stone:sites-down',
      'wood:people-down',
      'wood:people-up',
      'wood:sites-down',
      'wood:sites-up',
    ]);
    // Two free people: no new site nor more people.
    for (let seed = 1; seed < 30; seed++) {
      const planned = planAction('hud-pool', context(village({ available: 2 }), { terraformed: [] }, seed));
      expect(planned?.kind === 'hud-pool' && /up$/.test(planned.body.action)).toBe(false);
    }
    const crowded = planAction('hud-population', context(village({ available: 0, working: 0, carrots: 0 })));
    expect(crowded).toBeNull();
    expect(planAction('hud-population', context(village({ available: 0, working: 4, carrots: 0 })))).toMatchObject({
      kind: 'hud-population',
      body: { action: 'release' },
    });
  });

  it('raises a free cell one quarter above its corners, then restores the heights it found', () => {
    const state = village();
    const memory: BotMemory = { terraformed: [] };
    const planned = planAction('terraform', context(state, memory));
    if (planned?.kind !== 'terraform') throw Error('no terraform');
    const gesture = planned.body.gestures[0]!;
    expect(gesture.buildingType).toBe('terrain');
    const { cell, before, height } = planned.record;
    expect(before).toEqual(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([dx, dy]) => regionVertexHeight(state, cell.cellX + dx!, cell.cellY + dy!)),
    );
    expect(height).toBeGreaterThan(Math.max(...before));
    expect(height % 0.25).toBe(0);
    expect(planAction('terrain-restore', context(state, memory))).toBeNull();
    memory.terraformed.push({ ...planned.record, at: 0 });
    expect(planAction('terrain-restore', context(state, memory))).toMatchObject({
      kind: 'terrain-restore',
      body: {
        gestures: [
          {
            buildingType: 'terrain-restore',
            cells: [{ ...cell, corners: before, expected: [height, height, height, height] }],
          },
        ],
      },
    });
  });

  it('reads the region vertex heights row by row, null outside the region', () => {
    const state = village();
    expect(regionVertexHeight(state, 224, 96)).toBe(0);
    expect(regionVertexHeight(state, 224, 126)).toBeCloseTo(0.4);
    expect(regionVertexHeight(state, 225, 126)).toBeCloseTo(0.5);

    expect(regionVertexHeight(state, 224, 127)).toBeCloseTo(0.6);
    expect(regionVertexHeight(state, 300, 96)).toBeNull();
  });

  it('uses the market only once unlocked, and accepts only other bots’ offers', () => {
    expect(planAction('market-publish', context(village()))).toBeNull();
    expect(planAction('market-accept', context(village()))).toBeNull();
    const open = village({ unlocked: true });
    expect(planAction('market-publish', context(open))).toMatchObject({
      kind: 'market-publish',
      body: { action: 'publish', offeredAmount: 50 },
    });
    expect(planAction('market-cancel', context(open))).toMatchObject({ body: { action: 'cancel', offerId: 'o1' } });
    const offer = { status: 'open', requestedResource: 'wood', requestedAmount: 50 };
    expect(
      acceptableOffers(
        [
          { ...offer, id: 'mine', villageId: VILLAGE, villageName: 'Bot 001' },
          { ...offer, id: 'player', villageId: 'p', villageName: 'Catmark' },
          { ...offer, id: 'bot', villageId: 'b', villageName: 'Bot 017' },
          { ...offer, id: 'closed', villageId: 'b', villageName: 'Bot 017', status: 'accepted' },
          { ...offer, id: 'dear', villageId: 'b', villageName: 'Bot 018', requestedAmount: 1_000_000 },
        ],
        open,
      ).map((o) => o.id),
    ).toEqual(['bot']);
  });

  it('draws only what the village allows, by weight', () => {
    const state = village();
    const counts = new Map<string, number>();
    const ctx = context(state, { terraformed: [] }, 7);
    for (let i = 0; i < 400; i++) {
      const planned = chooseAction(parseMix('only:harvest=3,expedition=5,market-publish=5,build=1'), ctx);
      counts.set(planned!.kind, (counts.get(planned!.kind) ?? 0) + 1);
    }
    // No cartographer, locked market: never drawn, whatever their weight.
    expect([...counts.keys()].sort()).toEqual(['build', 'harvest']);
    expect(counts.get('harvest')!).toBeGreaterThan(counts.get('build')! * 2);
    expect(chooseAction({ expedition: 1 }, ctx)).toBeNull();
    expect(chooseAction({ expedition: 1 }, context(village({ cartographers: 1 })))).toMatchObject({
      kind: 'expedition',
    });
  });
});

describe('placement candidates', () => {
  const world = { widthCells: 512, heightCells: 256 };
  it('measures distances on the torus', () => {
    expect(torusDistance({ x: 2, y: 3 }, { x: 510, y: 250 }, world)).toBe(9);
    expect(farEnough({ x: 0, y: 0 }, [{ x: 60, y: 0 }], 51, world)).toBe(true);
    expect(farEnough({ x: 0, y: 0 }, [{ x: 500, y: 0 }], 51, world)).toBe(false);
  });
  it('spirals out of the cluster centre and scatters a reproducible spread', () => {
    const cluster = [...candidatePoints('cluster', world, { spacing: 8, center: { x: 100, y: 100 } })];
    expect(cluster.slice(0, 2)).toEqual([
      { x: 100, y: 100 },
      { x: 92, y: 92 },
    ]);
    expect(new Set(cluster.map((p) => `${p.x}:${p.y}`)).size).toBe(cluster.length);
    expect(cluster.length).toBe((512 / 8) * (256 / 8));
    const spread = [...candidatePoints('spread', world, { spacing: 64, seed: 3 })];
    expect(spread).toEqual([...candidatePoints('spread', world, { spacing: 64, seed: 3 })]);
    expect(spread.length).toBe(8 * 4);
    expect(new Set(spread.slice(0, 8).map((p) => p.x)).size).toBeGreaterThan(3);
  });
});
