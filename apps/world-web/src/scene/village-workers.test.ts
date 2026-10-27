import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { TravelCell, VillageState } from '@arbestra/contracts';
import { expect, it, vi } from 'vitest';
import { VillageWorkers, type PathPoint, type WorkerHooks } from './village-workers';
import { gardenHarvestPoint, sampleWorkerPath, type DoorLane, type TrafficActor } from './worker-motion';
import { gardenStride } from './worker-gestures';
import { buildingPlan, doorConnector, HALL_DOUBLE_DOOR_WIDTH, HALL_RECIPE } from './building-plan';

const epoch = Date.parse('2026-10-02T12:00:00Z');
function gardenSnapshot(): VillageState {
  const harvest = {
    id: 'tour',
    startedAt: new Date(epoch).toISOString(),
    completesAt: new Date(epoch + 128000).toISOString(),
    transportMs: 2000,
    path: [
      { cellX: 0, cellY: 0 },
      { cellX: 0, cellY: 2 },
    ],
    stops: [
      {
        cellX: 0,
        cellY: 2,
        path: [
          { cellX: 0, cellY: 0 },
          { cellX: 0, cellY: 2 },
        ],
        arrivesAfterMs: 2000,
        workEndsAfterMs: 62000,
        reservedCarrots: 10,
      },
      {
        cellX: 0,
        cellY: 5,
        path: [
          { cellX: 0, cellY: 2 },
          { cellX: 0, cellY: 5 },
        ],
        arrivesAfterMs: 65000,
        workEndsAfterMs: 125000,
        reservedCarrots: 20,
      },
    ],
    returnPath: [
      { cellX: 0, cellY: 5 },
      { cellX: 0, cellY: 0 },
    ],
  };
  return {
    world: { id: 'world' },
    village: { id: 'village', worksites: [], extractions: [] },
    cells: [{ building: { garden: { plots: harvest.stops.map((s) => ({ ...s, harvest })) } } }],
  } as unknown as VillageState;
}
function snapshot(id = 'lot-1', start = epoch, count = 10): VillageState {
  return {
    world: { id: 'world' },
    village: {
      id: 'village',
      worksites: [{ id: 'site', activeExtraction: { id } }],
      extractions: [
        {
          id,
          resourceCode: 'stone',
          workerCount: count,
          featureId: 'deposit',
          cellX: 0,
          cellY: 8,
          path: [
            { cellX: 0, cellY: 0 },
            { cellX: 0, cellY: 1 },
            { cellX: 0, cellY: 3 },
            { cellX: 0, cellY: 5 },
            { cellX: 0, cellY: 8 },
          ],
          startedAt: new Date(start).toISOString(),
          completesAt: new Date(start + 80_000).toISOString(),
          transportMs: 8000,
        },
      ],
    },
    cells: [],
  } as unknown as VillageState;
}
function fixture(free: WorkerHooks['free'] = () => true, extra: Partial<WorkerHooks> = {}) {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    material = new StandardMaterial('shared', scene);
  let shift = 0,
    ground: number | null = 0;
  const view = new VillageWorkers(
    scene,
    {
      skin: [material, material, material],
      clothes: Array(5).fill(material),
      hair: Array(3).fill(material),
      pants: material,
      white: material,
      timber: material,
      stone: material,
    },
    {
      path: (p) => p.map((c) => new Vector3(c.cellX - shift, 0, c.cellY)),
      project: (p) => ({ x: p.cellX - shift, z: p.cellY }),
      ground: () => ground,
      leisurePath: (_id, p) => p.map((c) => new Vector3(c.cellX - shift, 0, c.cellY)),
      free,
      key: (p) => `${p.x + shift}:${p.z}`,
      detailed: () => true,
      ...extra,
    },
  );
  return {
    scene,
    material,
    view,
    setGround: (value: number | null) => {
      ground = value;
    },
    rebase: (x: number) => {
      shift = x;
      view.shift(x, 0);
    },
    dispose: () => {
      view.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

it('takes three leveling inhabitants through the fine doorstep connector without a permanent queue', () => {
  const f = fixture();
  try {
    const path = [
      [59, 194.584],
      [59, 194.125],
      [59.125, 194.125],
      [59.25, 194.125],
      [59.375, 194.125],
      [59.5, 194.125],
      [60, 194.125],
      [60, 194],
      [60, 195],
      [60, 196],
      [60, 197],
      [59.375, 197],
      [59.25, 197],
      [59.125, 197],
      [59, 197],
    ].map(([cellX, cellY]) => ({ cellX: cellX!, cellY: cellY! }));
    const state = {
      world: { id: 'world' },
      village: {
        id: 'village',
        worksites: [],
        extractions: [],
        levelingJobs: [
          {
            id: 'leveling',
            featureId: 'site',
            buildingType: 'university',
            cells: [{ cellX: 59, cellY: 198 }],
            height: 0.25,
            workerCount: 3,
            path,
            transportMs: 7000,
            startedAt: new Date(epoch).toISOString(),
            completesAt: new Date(epoch + 80000).toISOString(),
          },
        ],
      },
      cells: [],
    } as unknown as VillageState;
    f.view.sync(state, epoch);
    for (let t = 0; t < 50000; t += 33) f.view.animate(epoch + t, true);
    expect(
      f.view.metrics.layouts[0]!.phases,
      JSON.stringify(f.view.figures.map((p) => p.root.position.asArray())),
    ).toEqual(['work', 'work', 'work']);
  } finally {
    f.dispose();
  }
});

it('shows the assigned leveling inhabitants working and removes them on the authoritative completion', () => {
  const f = fixture();
  try {
    const state = {
      world: { id: 'world' },
      village: {
        id: 'village',
        worksites: [],
        extractions: [],
        levelingJobs: [
          {
            id: 'leveling',
            featureId: 'site',
            buildingType: 'university',
            cells: [{ cellX: 0, cellY: 9 }],
            height: 0.25,
            workerCount: 2,
            path: [
              { cellX: 0, cellY: 0 },
              { cellX: 0, cellY: 8 },
            ],
            transportMs: 8000,
            startedAt: new Date(epoch).toISOString(),
            completesAt: new Date(epoch + 80000).toISOString(),
          },
        ],
      },
      cells: [],
    } as unknown as VillageState;
    f.view.sync(state, epoch + 20000);
    f.view.animate(epoch + 20000, true);
    f.view.animate(epoch + 20016, true);
    expect(f.view.figures).toHaveLength(2);
    expect(f.view.figures.every((p) => p.root.isEnabled())).toBe(true);
    expect(f.view.metrics.layouts[0]).toMatchObject({ resource: 'leveling', phases: ['work', 'work'] });
    f.view.sync({ ...state, village: { ...state.village, levelingJobs: [] } }, epoch + 80000);
    for (let t = 80000; t < 92000; t += 33) f.view.animate(epoch + t, true);
    expect(f.view.figures.filter((p) => p.root.isEnabled())).toHaveLength(0);
  } finally {
    f.dispose();
  }
});

it('shows every trade porter on both legs after reload and removes them at the authoritative return', () => {
  const f = fixture();
  try {
    const state = {
      world: { id: 'world' },
      village: {
        id: 'village',
        worksites: [],
        extractions: [],
        market: {
          journeys: [
            {
              id: 'trade',
              villageId: 'village',
              destinationVillageId: 'other',
              workerCount: 2,
              path: [
                { cellX: 0, cellY: 0 },
                { cellX: 0, cellY: 10 },
              ],
              startedAt: new Date(epoch).toISOString(),
              arrivesAt: new Date(epoch + 10000).toISOString(),
              returnsAt: new Date(epoch + 20000).toISOString(),
            },
          ],
        },
      },
      cells: [],
    } as unknown as VillageState;
    f.view.sync(state, epoch + 4000);
    f.view.animate(epoch + 4000, true);
    f.view.animate(epoch + 4016, true);
    expect(f.view.figures).toHaveLength(2);
    expect(f.view.figures.every((p) => p.root.isEnabled())).toBe(true);
    expect(f.view.figures[0]!.root.position.z).toBeGreaterThan(f.view.figures[1]!.root.position.z);
    expect(f.view.figures[0]!.root.position.z).toBeCloseTo(4, 0);
    f.view.dispose();
    f.view.sync(state, epoch + 14000);
    f.view.animate(epoch + 14000, true);
    f.view.animate(epoch + 14016, true);
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['inbound', 'inbound']);
    expect(f.view.figures[0]!.root.position.z).toBeCloseTo(6, 0);
    for (let t = 14032; t <= 20100; t += 32) f.view.animate(epoch + t, true);
    expect(f.view.figures).toHaveLength(0);
  } finally {
    f.dispose();
  }
});

it('keeps the inspected representative moving while its authoritative information stays attached', () => {
  const f = fixture();
  try {
    const state = snapshot('pair', epoch, 2);
    state.village.population = {
      total: 2,
      housingCapacity: 30,
      available: 0,
      working: 2,
      resting: 0,
      energyCounts: [],
      cohorts: [
        {
          id: 'cohort',
          memberCount: 2,
          activity: 'working',
          restBuildingId: null,
          restingSince: null,
          energy: 8,
          assignmentId: 'pair',
          cartographer: true,
        },
      ],
    };
    f.view.sync(state, epoch);
    for (let t = 0; t < 2000; t += 16) f.view.animate(epoch + t, true);
    const id = 'pair:0',
      before = f.view.representativePose(id)!;
    expect(before).not.toBeNull();
    const info = f.view.representativeInfo(id)!;
    expect(info.energy).toBe(8);
    expect(info.qualifications).toEqual(['Cartographe']);
    expect(info.cohortSize).toBe(2);
    f.view.selectRepresentative(id);
    const other = f.view.representativePose('pair:1')!.position.clone();
    for (let t = 2000; t < 5000; t += 16) f.view.animate(epoch + t, true);
    expect(f.view.representativePose(id)!.position.equals(before.position)).toBe(false);
    expect(f.view.representativePose('pair:1')!.position.equals(other)).toBe(false);
    f.view.sync(state, epoch + 5000);
    expect(f.view.representativeInfo(id)!.name).toBe(info.name);
    f.view.selectRepresentative(null);
    f.view.animate(epoch + 5016, true);
    expect(f.view.representativePose(id)!.position.equals(before.position)).toBe(false);
    expect(state.village.extractions[0]!.completesAt).toBe(new Date(epoch + 80_000).toISOString());
  } finally {
    f.dispose();
  }
});

it('reconstructs current work after reload and keeps all ten roles through snapshot and LOD changes', () => {
  const f = fixture();
  try {
    f.view.sync(snapshot(), epoch + 20_000);
    f.view.animate(epoch + 20_000, true);
    const figures = f.view.figures;
    expect(figures).toHaveLength(10);
    expect(f.view.metrics.layouts[0]?.roles).toEqual([
      'pick',
      'pick',
      'pick',
      'pick',
      'pick',
      'break',
      'break',
      'break',
      'carry',
      'carry',
    ]);
    expect(f.view.metrics.layouts[0]?.phases.every((p) => p === 'work')).toBe(true);
    f.view.sync(snapshot(), epoch + 21_000);
    expect(f.view.figures).toEqual(figures);
    f.view.animate(epoch + 21_000, false);
    expect(figures.every((p) => !p.root.isEnabled())).toBe(true);
    f.view.animate(epoch + 22_000, true);
    expect(f.view.figures).toEqual(figures);
    expect(f.view.metrics.layouts[0]?.phases.every((p) => p === 'work')).toBe(true);
  } finally {
    f.dispose();
  }
});

it('deploys an actual snapshot team into a pair after leaving the doorway', () => {
  const f = fixture();
  try {
    f.view.sync(snapshot('pair', epoch, 2), epoch);
    f.view.animate(epoch, true);
    let spread = 0;
    for (let t = 0; t < 7000; t += 16) {
      f.view.animate(epoch + t, true);
      const [a, b] = f.view.figures;
      if (a?.root.isEnabled() && b?.root.isEnabled())
        spread = Math.max(spread, Math.abs(a.root.position.x - b.root.position.x));
    }
    expect(spread).toBeGreaterThan(0.3);
  } finally {
    f.dispose();
  }
});

it('keeps ten participants with rotating compact posts rather than stacking five miners', () => {
  const f = fixture(
    (p) =>
      Math.abs(p.x) > 2.5 ||
      p.z - 8 < -1.5 ||
      p.z - 8 >= 1.1 ||
      (p.z - 8 <= -0.4 && Math.abs(p.x) < 0.75) ||
      (p.x >= 1.2 && p.z - 8 >= 0.2 && p.z - 8 <= 0.6),
  );
  try {
    f.view.sync(snapshot(), epoch + 20_000);
    f.view.animate(epoch + 20_000, true);
    expect(f.view.metrics.layouts[0]?.variant).toBe('compact');
    let miningSeen = false,
      min = Infinity;
    for (let time = 20_000; time < 38_000; time += 33) {
      f.view.animate(epoch + time, true);
      expect(f.view.figures).toHaveLength(10);
      const figures = f.view.figures;
      for (let i = 0; i < figures.length; i++)
        for (let j = i + 1; j < figures.length; j++)
          min = Math.min(
            min,
            Math.hypot(
              figures[i]!.root.position.x - figures[j]!.root.position.x,
              figures[i]!.root.position.z - figures[j]!.root.position.z,
            ),
          );
      miningSeen ||= figures.slice(0, 5).some((p) => Math.abs(p.root.position.z - 7.1) < 0.05);
    }
    expect(min).toBeGreaterThan(0.43);
    expect(miningSeen).toBe(true);
  } finally {
    f.dispose();
  }
});

it('retains a returning team before admitting the next lot and ignores stale snapshots after completion', () => {
  const f = fixture();
  try {
    f.view.sync(snapshot(), epoch + 75_000);
    f.view.animate(epoch + 75_000, true);
    f.view.sync(snapshot('lot-2', epoch + 80_000), epoch + 80_000);
    expect(f.view.figures).toHaveLength(10);
    expect(f.view.metrics.pending).toBe(1);
    for (let t = 80_000; t < 92_000; t += 33) f.view.animate(epoch + t, true);
    expect(f.view.figures).toHaveLength(10);
    expect(f.view.metrics.layouts[0]?.id).toBe('lot-2');
    f.view.animate(epoch + 170_000, true);
    expect(f.view.figures).toHaveLength(0);
    f.view.sync(snapshot('lot-2', epoch + 80_000), epoch + 171_000);
    expect(f.view.figures).toHaveLength(0);
  } finally {
    f.dispose();
  }
});

it('releases meshes and nodes over repeated lots while retaining shared materials', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 12; i++) {
      const t = epoch + i * 100_000;
      f.view.sync(snapshot(`lot-${i}`, t), t + 20_000);
      f.view.animate(t + 20_000, true);
      expect(f.scene.meshes.length).toBeLessThan(150);
      f.view.animate(t + 90_000, true);
      expect(f.scene.meshes.filter((m) => m.isEnabled())).toHaveLength(0);
      // The box source and one shared source per figurine piece used so far.
      const sources = f.scene.meshes.filter((m) => m.name.startsWith('worker-piece-'));
      expect(sources.length).toBeLessThanOrEqual(20);
      expect(f.scene.meshes).toHaveLength(1 + sources.length);
      expect(f.scene.transformNodes).toHaveLength(0);
      expect(f.scene.materials).toEqual([f.material]);
    }
  } finally {
    f.dispose();
  }
});

it('cleans old incarnations and queues on changing world', () => {
  const f = fixture();
  try {
    f.view.sync(snapshot(), epoch + 20_000);
    const old = f.view.figures;
    const next = snapshot();
    next.world.id = 'other-world';
    f.view.sync(next, epoch + 20_000);
    expect(old.every((p) => p.root.isDisposed())).toBe(true);
    expect(f.view.figures).toHaveLength(10);
    expect(f.view.figures.every((p) => !old.includes(p))).toBe(true);
    expect(f.view.metrics.pending).toBe(0);
    expect(f.scene.materials).toEqual([f.material]);
  } finally {
    f.dispose();
  }
});

it('rebases once without moving workers relative to their posts', () => {
  const f = fixture(),
    reference = fixture();
  try {
    for (const v of [f.view, reference.view]) {
      v.sync(snapshot(), epoch + 20_000);
      v.animate(epoch + 20_000, true);
    }
    f.rebase(100);
    for (const time of [20_033, 20_066, 20_099]) {
      f.view.reproject();
      f.view.animate(epoch + time, true);
      reference.view.animate(epoch + time, true);
      for (let i = 0; i < 10; i++)
        expect(f.view.figures[i]!.root.position.x + 100).toBeCloseTo(reference.view.figures[i]!.root.position.x, 8);
    }
  } finally {
    f.dispose();
    reference.dispose();
  }
});

it('animates one gardener across two plots without returning home between them', () => {
  const f = fixture();
  try {
    f.view.sync(gardenSnapshot(), epoch);
    f.view.animate(epoch, true);
    const gardener = f.view.figures[0]!;
    for (let t = 0; t < 68000; t += 33) f.view.animate(epoch + t, true);
    expect(f.view.figures).toEqual([gardener]);
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['work']);
    expect(gardener.root.position.z).toBeGreaterThan(4);
    for (let t = 68000; t < 132000; t += 33) f.view.animate(epoch + t, true);
    expect(f.view.figures).toHaveLength(0);
  } finally {
    f.dispose();
  }
});
it('reconstructs a tour at its second plot and final return after reload or LOD changes', () => {
  const f = fixture();
  try {
    f.view.sync(gardenSnapshot(), epoch + 70000);
    f.view.animate(epoch + 70000, true);
    expect(f.view.figures).toHaveLength(1);
    expect(f.view.figures[0]!.root.position.z).toBeGreaterThan(4);
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['work']);
    f.view.animate(epoch + 125000, false);
    f.view.animate(epoch + 126000, true);
    f.view.animate(epoch + 126034, true);
    expect(f.view.figures).toHaveLength(1);
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['inbound']);
    expect(f.view.figures[0]!.root.position.z).toBeLessThan(5);
    expect(f.view.figures[0]!.root.position.z).toBeGreaterThan(0);
  } finally {
    f.dispose();
  }
});

it('restores initial crop progress and preserves the row through short suspension and rebasing', () => {
  const f = fixture();
  try {
    const now = epoch + 35000;
    f.view.sync(gardenSnapshot(), now);
    f.view.animate(now, true);
    const expected = gardenHarvestPoint({ x: 0, z: 2 }, gardenStride(33 / 60, 60)),
      gardener = f.view.figures[0]!;
    expect(gardener.root.position.x).toBeCloseTo(expected.x, 8);
    expect(gardener.root.position.z).toBeCloseTo(expected.z, 8);
    f.view.animate(now + 10, false);
    f.view.animate(now + 1000, true);
    const resumed = gardener.root.position.clone();
    expect(Math.hypot(resumed.x - expected.x, resumed.z - expected.z)).toBeLessThan(0.05);
    f.rebase(100);
    f.view.reproject();
    f.view.animate(now + 1034, true);
    expect(Math.hypot(gardener.root.position.x + 100 - resumed.x, gardener.root.position.z - resumed.z)).toBeLessThan(
      0.05,
    );
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['work']);
    expect(f.view.figures).toEqual([gardener]);
  } finally {
    f.dispose();
  }
});

function idleSnapshot(available = 120): VillageState {
  const state = snapshot();
  state.village.extractions = [];
  state.village.worksites = [];
  state.village.population = {
    total: 120,
    housingCapacity: 130,
    available,
    working: 120 - available,
    resting: 0,
    energyCounts: [],
    cohorts: [
      { id: 'idle-cohort', memberCount: available, activity: 'idle', restBuildingId: null, restingSince: null },
    ],
  };
  state.cells = [
    { cellX: 0, cellY: 0, building: { id: 'hall', type: 'town-hall', status: 'completed' } },
    { cellX: 0, cellY: 4, building: { id: 'house', type: 'dwelling', status: 'completed' } },
  ] as unknown as VillageState['cells'];
  state.travelRoutes = [
    {
      id: 'house',
      kind: 'building',
      destination: { cellX: 0, cellY: 4 },
      cells: [
        { cellX: 0, cellY: 0 },
        { cellX: 0, cellY: 1 },
        { cellX: 0, cellY: 4 },
      ],
    },
  ];
  return state;
}
it('bounds idle representatives, lets them enter houses and withdraws them when no residents remain available', () => {
  const f = fixture();
  try {
    f.view.sync(idleSnapshot(), epoch);
    f.view.animate(epoch, true);
    expect(f.view.figures).toHaveLength(8);
    let inside = false,
      walking = false;
    for (let t = 0; t < 60000; t += 33) {
      f.view.animate(epoch + t, true);
      inside ||= f.view.metrics.layouts.some((g) => g.phases.includes('inside'));
      walking ||= f.view.figures.some((p) => p.root.isEnabled());
    }
    expect(inside && walking).toBe(true);
    const old = f.view.figures;
    f.view.sync(idleSnapshot(0), epoch + 60000);
    expect(f.view.figures).toHaveLength(0);
    expect(old.every((p) => p.root.isDisposed())).toBe(true);
  } finally {
    f.dispose();
  }
});
it('preserves idle representatives through LOD and recentring and still renders the whole observed working team', () => {
  const f = fixture();
  try {
    const state = idleSnapshot();
    state.village.extractions = snapshot().village.extractions;
    f.view.sync(state, epoch + 20000);
    f.view.animate(epoch + 20000, true);
    expect(f.view.figures).toHaveLength(18);
    const figures = f.view.figures;
    f.view.animate(epoch + 21000, false);
    f.rebase(100);
    f.view.reproject();
    f.view.animate(epoch + 22000, true);
    expect(f.view.figures).toEqual(figures);
    expect(f.view.figures.every((p) => p.root.position.x < 10)).toBe(true);
    expect(f.view.metrics.layouts.find((g) => g.id === 'lot-1')?.roles).toHaveLength(10);
    f.view.sync(state, epoch + 23000);
    expect(f.view.figures).toEqual(figures);
  } finally {
    f.dispose();
  }
});

const actorOf = (figure: VillageWorkers['figures'][number]) =>
  (figure as VillageWorkers['figures'][number] & { actor: TrafficActor }).actor;
it('deploys a compact wood team from the doorway through empty waiting places and starts the shared work posts', () => {
  const physical = (p: { x: number; z: number }, r: number) =>
    [
      [0, 0],
      [-r, -r],
      [r, r],
      [-r, r],
      [r, -r],
    ].every(([dx, dz]) => {
      const x = p.x + dx!,
        z = p.z + dz!;
      return (Math.abs(x) <= 1.15 && Math.abs(z) <= 1.15) || (x >= 0.8 && Math.abs(z) <= 1.2);
    }) && Math.hypot(p.x, p.z) >= 0.42 + r * 0.3;
  const f = fixture((p, r, _feature, allowRoads) => allowRoads === true && physical(p, r));
  try {
    const state = snapshot('narrow-wood', epoch, 10),
      e = state.village.extractions[0]!;
    e.resourceCode = 'wood';
    e.cellX = 0;
    e.cellY = 0;
    e.transportMs = 2802;
    e.path = [
      { cellX: 3.75, cellY: 1.38 },
      { cellX: 3.75, cellY: 0.9375 },
      { cellX: 3.4375, cellY: 0.9375 },
      { cellX: 2.5, cellY: 0.9375 },
      { cellX: 2.5, cellY: 0 },
      { cellX: 2.5, cellY: 0.9375 },
      { cellX: 0.9375, cellY: 0.9375 },
      { cellX: 0.625, cellY: 0.9375 },
      { cellX: 0.3125, cellY: 0.9375 },
      { cellX: 0, cellY: 0.9375 },
      { cellX: 0, cellY: 0.625 },
      { cellX: 0, cellY: 0.3125 },
      { cellX: 0, cellY: 0 },
    ];
    f.view.sync(state, epoch);
    let saw = false,
      chopping = false;
    for (let t = 0; t < 50000; t += 33) {
      f.view.animate(epoch + t, true);
      saw ||= f.scene.meshes.some((m) => m.name.startsWith('saw-') && m.isEnabled());
      chopping ||= f.view.figures
        .slice(6)
        .some((p) =>
          p.root
            .getChildTransformNodes()
            .some(
              (n) =>
                n.name.endsWith('-tool') && n.isEnabled() && Math.hypot(p.root.position.x, p.root.position.z) < 1.5,
            ),
        );
    }
    expect(f.view.metrics.layouts[0]?.variant).toBe('compact');
    expect(
      saw,
      JSON.stringify(
        f.view.figures.map((p) => ({
          p: actorOf(p).position,
          path: actorOf(p).path,
          waiting: actorOf(p).waitingSince,
        })),
      ),
    ).toBe(true);
    expect(chopping).toBe(true);
    expect(f.view.figures).toHaveLength(10);
  } finally {
    f.dispose();
  }
});
it.each([false, true])(
  'uses physically free road posts only when traffic reservations prevent the wood layout (physical clearance: %s)',
  (physical) => {
    const f = fixture((_point, _radius, _feature, allowRoads) => physical && allowRoads === true);
    try {
      const state = snapshot('wood-road', epoch, 10);
      state.village.extractions[0]!.resourceCode = 'wood';
      f.view.sync(state, epoch + 20000);
      f.view.animate(epoch + 20000, true);
      expect(f.view.metrics.layouts[0]?.variant === 'blocked').toBe(!physical);
      expect(f.view.figures).toHaveLength(10);
      expect(f.scene.meshes.some((m) => m.name.startsWith('saw-') && m.isEnabled())).toBe(physical);
    } finally {
      f.dispose();
    }
  },
);
it('gets a ten-person wood team past a retraced access spur and into chopping work without changing the server route', () => {
  const f = fixture();
  try {
    const state = snapshot('wood-spur', epoch, 10),
      mission = state.village.extractions[0]!;
    mission.resourceCode = 'wood';
    mission.transportMs = 2802;
    mission.path = [
      { cellX: 0, cellY: 0 },
      { cellX: 0, cellY: -0.4425 },
      { cellX: -0.3125, cellY: -0.4425 },
      { cellX: -1.25, cellY: -0.4425 },
      { cellX: -1.25, cellY: -1.38 },
      { cellX: -1.25, cellY: -0.4425 },
      { cellX: -2.8125, cellY: -0.4425 },
      { cellX: -3.125, cellY: -0.4425 },
      { cellX: -3.4375, cellY: -0.4425 },
      { cellX: -3.75, cellY: -0.4425 },
      { cellX: -3.75, cellY: -0.755 },
      { cellX: -3.75, cellY: -1.0675 },
      { cellX: -3.75, cellY: -1.38 },
    ];
    mission.cellX = -3.75;
    mission.cellY = -1.38;
    const before = JSON.stringify(mission);
    f.view.sync(state, epoch);
    let separation = Infinity;
    for (let t = 0; t < 40000; t += 33) {
      f.view.animate(epoch + t, true);
      const visible = f.view.figures.filter((p) => p.root.isEnabled());
      for (let i = 0; i < visible.length; i++)
        for (let j = i + 1; j < visible.length; j++)
          separation = Math.min(
            separation,
            Math.hypot(
              visible[i]!.root.position.x - visible[j]!.root.position.x,
              visible[i]!.root.position.z - visible[j]!.root.position.z,
            ),
          );
    }
    expect(f.view.figures).toHaveLength(10);
    expect(
      f.view.metrics.layouts[0]?.phases.every((p) => p === 'work'),
      JSON.stringify({
        layout: f.view.metrics.layouts[0],
        actors: f.view.figures.map((p) => ({
          distance: actorOf(p).distance,
          position: actorOf(p).position,
          done: actorOf(p).done,
        })),
      }),
    ).toBe(true);
    expect(f.view.figures.every((p) => Math.hypot(p.root.position.x, p.root.position.z) > 1)).toBe(true);
    expect(f.scene.meshes.some((m) => m.name.startsWith('saw-') && m.isEnabled())).toBe(true);
    expect(separation).toBeGreaterThan(0.43);
    expect(JSON.stringify(mission)).toBe(before);
  } finally {
    f.dispose();
  }
});
it('keeps a valid actor and pose through ordinary sync, terrain reprojection and a two second frame stall', () => {
  const f = fixture();
  try {
    f.view.sync(snapshot('one', epoch, 1), epoch);
    for (let t = 0; t < 2000; t += 16) f.view.animate(epoch + t, true);
    const figure = f.view.figures[0]!,
      a = actorOf(figure),
      position = figure.root.position.clone(),
      distance = a.distance;
    f.view.sync(snapshot('one', epoch, 1), epoch + 2000);
    f.view.reproject();
    expect(f.view.figures[0]).toBe(figure);
    expect(a.distance).toBe(distance);
    expect(figure.root.position.equals(position)).toBe(true);
    f.view.animate(epoch + 4000, true);
    expect(figure.root.isEnabled()).toBe(true);
    expect(figure.root.position.subtract(position).length()).toBeLessThan(0.2);
  } finally {
    f.dispose();
  }
});
it('does not reconstruct an active waiting member or its moving colleague after eight seconds', () => {
  const f = fixture();
  try {
    f.view.sync(snapshot('pair', epoch, 2), epoch);
    for (let t = 0; t < 1500; t += 16) f.view.animate(epoch + t, true);
    const figures = f.view.figures,
      a = actorOf(figures[1]!);
    a.speed = 0;
    a.waitingSince = epoch - 9000;
    const distance = a.distance;
    for (let t = 1500; t < 2500; t += 16) f.view.animate(epoch + t, true);
    expect(a.distance).toBe(distance);
    expect(figures[1]!.root.isEnabled()).toBe(true);
    expect(figures[1]!.root.getChildMeshes()[0]!.visibility).toBeGreaterThan(0.95);
    expect(actorOf(figures[0]!).distance).toBeGreaterThan(distance);
  } finally {
    f.dispose();
  }
});
it('leaves the actually reached door after a delayed idle arrival and keeps its info indoors', () => {
  const f = fixture();
  try {
    const key = 'world:village:idle:idle-cohort:0',
      state = idleSnapshot(1);
    // Find an initial walking phase without coupling the assertion to the seed.
    let now = epoch;
    for (; now < epoch + 120000; now += 1000) {
      f.view.sync(state, now);
      f.view.animate(now, true);
      if (f.view.metrics.layouts[0]?.phases[0] === 'outbound') break;
      f.view.dispose();
    }
    const figure = f.view.figures[0]!,
      a = actorOf(figure);
    a.speed = 0;
    for (let t = 33; t < 15000; t += 33) f.view.animate(now + t, true);
    a.distance = a.path.reduce(
      (n, p, i) => (i ? n + Math.hypot(p.x - a.path[i - 1]!.x, p.z - a.path[i - 1]!.z) : 0),
      0,
    );
    a.position = { ...a.path.at(-1)! };
    a.done = true;
    f.view.animate(now + 15033, true);
    expect(f.view.metrics.layouts[0]?.phases[0]).toBe('inside');
    expect(f.view.representativeInfo(key + ':0')).not.toBeNull();
    const door = { ...a.position };
    for (let t = 15066; t < 55000; t += 33) {
      f.view.animate(now + t, true);
      if (f.view.metrics.layouts[0]?.phases[0] === 'outbound') {
        expect(Math.hypot(a.position.x - door.x, a.position.z - door.z)).toBeLessThan(0.05);
        return;
      }
    }
    throw new Error('No departure after the indoor dwell');
  } finally {
    f.dispose();
  }
});

it('holds an unavailable ground position and resumes there when height data returns', () => {
  const f = fixture();
  try {
    f.view.sync(snapshot('one', epoch, 1), epoch);
    for (let t = 0; t < 2000; t += 16) f.view.animate(epoch + t, true);
    const figure = f.view.figures[0]!,
      a = actorOf(figure),
      position = { ...a.position },
      distance = a.distance;
    f.view.selectRepresentative('one:0');
    f.setGround(null);
    for (let t = 2000; t < 5000; t += 16) f.view.animate(epoch + t, true);
    expect(figure.root.isEnabled()).toBe(false);
    expect(a.distance).toBe(distance);
    expect(a.position).toEqual(position);
    expect(f.view.representativeInfo('one:0')?.presence).toBe('ground-unavailable');
    expect(f.view.selectedRepresentative).toBe('one:0');
    f.setGround(2);
    f.view.reproject();
    f.view.animate(epoch + 5016, true);
    expect(figure.root.isEnabled()).toBe(true);
    expect(figure.root.position.y).toBeCloseTo(2.215);
    expect(Math.hypot(a.position.x - position.x, a.position.z - position.z)).toBeLessThan(0.05);
  } finally {
    f.dispose();
  }
});
it('invalidates cohort replacement without silently selecting the equivalent visual index', () => {
  const f = fixture();
  try {
    const state = idleSnapshot(1);
    f.view.sync(state, epoch);
    f.view.animate(epoch, true);
    const id = 'world:village:idle:idle-cohort:0:0';
    f.view.selectRepresentative(id);
    expect(f.view.selectedRepresentative).toBe(id);
    const next = idleSnapshot(1);
    next.village.population!.cohorts![0]!.id = 'split-cohort';
    f.view.sync(next, epoch + 100);
    expect(f.view.selectedRepresentative).toBeNull();
    expect(f.view.representativeInfo(id)).toBeNull();
    expect(f.view.representativeInfo('world:village:idle:split-cohort:0:0')?.cohortId).toBe('split-cohort');
  } finally {
    f.dispose();
  }
});
it('cancels an obsolete-tail fade if the lot is current again and bounds a necessary retirement', () => {
  for (const cancel of [true, false]) {
    const f = fixture();
    try {
      const now = epoch + 87000;
      f.view.sync(snapshot('old', epoch, 2), now);
      f.view.animate(now, true);
      const figures = f.view.figures;
      for (const figure of figures) {
        const a = actorOf(figure);
        a.speed = 0;
        a.distance = 2;
        a.position = sampleWorkerPath(a.path, 2);
        a.visible = true;
      }
      f.view.sync(snapshot('next', epoch + 80000, 2), now);
      for (let t = 33; t <= 1200; t += 33) f.view.animate(now + t, true);
      if (cancel) f.view.sync(snapshot('old', epoch, 2), now + 1200);
      for (let t = 1233; t < 1600; t += 33) f.view.animate(now + t, true);
      if (cancel) {
        expect(f.view.figures).toEqual(figures);
        expect(figures[0]!.root.isEnabled()).toBe(true);
        expect(figures[0]!.root.getChildMeshes()[0]!.visibility).toBeGreaterThan(0.95);
      } else {
        expect(figures.every((p) => p.root.isDisposed())).toBe(true);
        expect(f.view.metrics.layouts[0]?.id).toBe('next');
        expect(f.view.figures).toHaveLength(2);
      }
    } finally {
      f.dispose();
    }
  }
});
it('defers a changed leisure itinerary until the reached door without moving on sync', () => {
  const f = fixture();
  try {
    const state = idleSnapshot(1);
    f.view.sync(state, epoch);
    f.view.animate(epoch, true);
    const figure = f.view.figures[0]!,
      a = actorOf(figure),
      position = { ...a.position },
      path = a.path;
    const next = idleSnapshot(1);
    next.travelRoutes[0]!.cells = [
      { cellX: 0, cellY: 0 },
      { cellX: 0, cellY: 1 },
      { cellX: 2, cellY: 1 },
      { cellX: 2, cellY: 4 },
    ];
    next.cells[1]!.cellX = 2;
    next.travelRoutes[0]!.destination.cellX = 2;
    f.view.sync(next, epoch + 100);
    expect(f.view.figures[0]).toBe(figure);
    expect(a.position).toEqual(position);
    expect(a.path).toBe(path);
  } finally {
    f.dispose();
  }
});

it('reconnects a changed survey route from the current actor through a shared road junction', () => {
  const f = fixture();
  try {
    const state = snapshot();
    state.village.extractions = [];
    state.village.worksites = [];
    state.world.widthCells = 2048;
    state.world.heightCells = 1024;
    const path = [
      { cellX: 0, cellY: 0 },
      { cellX: 0, cellY: 1 },
      { cellX: 0, cellY: 3 },
      { cellX: 0, cellY: 8 },
    ];
    state.science = {
      activities: [
        {
          id: 'survey',
          villageId: 'village',
          kind: 'survey',
          path: [...path, ...path.slice().reverse()],
          startedAt: new Date(epoch).toISOString(),
          completesAt: new Date(epoch + 80000).toISOString(),
        },
      ],
    } as unknown as NonNullable<VillageState['science']>;
    f.view.sync(state, epoch);
    for (let t = 0; t < 2000; t += 16) f.view.animate(epoch + t, true);
    const figure = f.view.figures[0]!,
      a = actorOf(figure),
      position = { ...a.position };
    const next = structuredClone(state),
      changed = [
        { cellX: 0, cellY: 0 },
        { cellX: 0, cellY: 1 },
        { cellX: 0, cellY: 3 },
        { cellX: 4, cellY: 3 },
      ];
    next.science!.activities[0]!.path = [...changed, ...changed.slice().reverse()];
    f.view.sync(next, epoch + 2000);
    expect(a.position).toEqual(position);
    expect(a.path[0]).toEqual(position);
    expect(a.path).toContainEqual(expect.objectContaining({ x: 0, z: 3 }));
    expect(a.path.at(-1)).toEqual(expect.objectContaining({ x: 4, z: 3 }));
    let before = figure.root.position.clone();
    for (let t = 2000; t < 14000; t += 16) {
      f.view.animate(epoch + t, true);
      expect(figure.root.position.subtract(before).length()).toBeLessThan(0.1);
      before = figure.root.position.clone();
    }
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['work']);
  } finally {
    f.dispose();
  }
});

it('installs both actual teammates without a working post blocking the shared route endpoint', () => {
  const f = fixture();
  try {
    f.view.sync(snapshot('pair', epoch, 2), epoch);
    for (let t = 0; t < 20000; t += 16) f.view.animate(epoch + t, true);
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['work', 'work']);
    const [a, b] = f.view.figures;
    expect(a!.root.isEnabled() && b!.root.isEnabled()).toBe(true);
    expect(a!.root.position.subtract(b!.root.position).length()).toBeGreaterThan(0.43);
  } finally {
    f.dispose();
  }
});

it('keeps a gardener on its row across missing ground instead of advancing its absolute work clock', () => {
  const f = fixture();
  try {
    f.view.sync(gardenSnapshot(), epoch + 35000);
    f.view.animate(epoch + 35000, true);
    const figure = f.view.figures[0]!,
      a = actorOf(figure),
      position = { ...a.position };
    f.setGround(null);
    for (let t = 33; t < 10000; t += 33) f.view.animate(epoch + 35000 + t, true);
    expect(a.position).toEqual(position);
    f.setGround(0);
    f.view.animate(epoch + 45000, true);
    expect(Math.hypot(a.position.x - position.x, a.position.z - position.z)).toBeLessThan(0.05);
  } finally {
    f.dispose();
  }
});

it('starts figures created behind a long loading screen at their current phase', () => {
  for (const [shownAfter, phase] of [
    [18_000, 'outbound'],
    [38_000, 'work'],
  ] as const) {
    const f = fixture();
    try {
      f.view.sync(snapshot('lot-1', epoch, 1), epoch + 2000);
      f.view.animate(epoch + 2000 + shownAfter, true);
      expect(f.view.metrics.layouts[0]?.phases).toEqual([phase]);
    } finally {
      f.dispose();
    }
  }
});

it('reaches both work posts after the actual corner even if the leader occupies the end gate first', () => {
  const f = fixture();
  try {
    const state = snapshot('pair', epoch, 2),
      m = state.village.extractions[0]!;
    m.cellX = 3;
    m.cellY = 6;
    m.path = [
      { cellX: 0, cellY: 0 },
      { cellX: 1, cellY: 0 },
      { cellX: 3, cellY: 0 },
      { cellX: 3, cellY: 6 },
    ];
    m.transportMs = 14000;
    f.view.sync(state, epoch);
    for (let t = 0; t < 25000; t += 16) f.view.animate(epoch + t, true);
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['work', 'work']);
    expect(f.view.figures.every((f) => f.root.isEnabled())).toBe(true);
  } finally {
    f.dispose();
  }
});
it('recomputes a home itinerary only when its cell, the routes or the scene geometry change', () => {
  let geometry = 'g1';
  const leisurePath = vi.fn((_id: string, p: TravelCell[], lane?: DoorLane) => {
    void lane;
    return p.map((c) => new Vector3(c.cellX, 0, c.cellY));
  });
  const f = fixture(() => true, { leisurePath, leisureVersion: () => geometry });
  try {
    const state = idleSnapshot();
    f.view.sync(state, epoch);
    // Each home costs two spokes: walked out of the hall and walked back in.
    expect(leisurePath).toHaveBeenCalledTimes(4);
    expect(leisurePath.mock.calls.map((c) => c[2])).toEqual(['out', 'in', 'out', 'in']);
    // A harvest or any unrelated update keeps the home cells and the routes.
    f.view.sync({ ...state, village: { ...state.village } }, epoch + 1000);
    expect(leisurePath).toHaveBeenCalledTimes(4);
    const house = { ...state.cells[1]!, building: { ...state.cells[1]!.building! } };
    f.view.sync({ ...state, cells: [state.cells[0]!, house] }, epoch + 2000);
    expect(leisurePath).toHaveBeenCalledTimes(6);
    expect(leisurePath.mock.calls.slice(4).map((c) => c[0])).toEqual(['house', 'house']);
    geometry = 'g2';
    f.view.sync({ ...state, cells: [state.cells[0]!, house] }, epoch + 3000);
    expect(leisurePath).toHaveBeenCalledTimes(10);
    f.view.sync({ ...state, cells: [state.cells[0]!, house], travelRoutes: [...state.travelRoutes] }, epoch + 4000);
    expect(leisurePath).toHaveBeenCalledTimes(14);
  } finally {
    f.dispose();
  }
});
/**
 * A narrow forest track ending at a tree, with small waiting pockets on both
 * sides of the road before the trunk: only the compact layout fits, the road
 * itself is free to walk, and the work posts sit around the trunk.
 */
function gladeTeam(completesAfterMs: number) {
  const inside = (x: number, z: number, roads: boolean) =>
    (x >= -1.7 && x <= 1.4 && Math.abs(z) <= 1.3) ||
    (x >= 1.2 && x <= 4.4 && Math.abs(z) >= 0.6 && Math.abs(z) <= 2.8) ||
    (roads && x >= 0.8 && Math.abs(z) <= 0.6);
  const f = fixture(
    (p, r, _feature, allowRoads) =>
      [
        [0, 0],
        [-r, -r],
        [r, r],
        [-r, r],
        [r, -r],
      ].every(([dx, dz]) => inside(p.x + dx!, p.z + dz!, allowRoads === true)) &&
      Math.hypot(p.x, p.z) >= 0.42 + r * 0.3,
  );
  const state = snapshot('glade-wood', epoch, 10),
    e = state.village.extractions[0]!;
  e.resourceCode = 'wood';
  e.cellX = 0;
  e.cellY = 0;
  e.transportMs = 17302;
  e.completesAt = new Date(epoch + completesAfterMs).toISOString();
  e.path = [
    { cellX: 14, cellY: 0 },
    { cellX: 3.75, cellY: 0 },
    { cellX: 1.5, cellY: 0 },
    { cellX: 0, cellY: 0 },
  ];
  return {
    f,
    state,
    transportMs: e.transportMs,
    returnAt: completesAfterMs - e.transportMs,
    completesAt: completesAfterMs,
  };
}
/** Walk the clock and record, per person, what the mission showed. */
function observeTeam(f: ReturnType<typeof fixture>, untilMs: number, returnAt: number) {
  const seenAt: number[] = [],
    workedAt: number[] = [],
    lateWork: number[] = [],
    loadedWithoutWork: number[] = [],
    outboundAfterReturn: number[] = [];
  let variant: string | undefined,
    allDone = -1;
  for (let t = 0; t <= untilMs; t += 33) {
    f.view.animate(epoch + t, true);
    const layout = f.view.metrics.layouts[0];
    variant ??= layout?.variant;
    if (!layout) {
      allDone = allDone < 0 ? t : allDone;
      break;
    }
    f.view.figures.forEach((p, i) => {
      const phase = layout.phases[i];
      if (seenAt[i] === undefined && p.root.isEnabled()) seenAt[i] = t;
      if (phase === 'work') {
        if (workedAt[i] === undefined) {
          workedAt[i] = t;
          if (t >= returnAt) lateWork.push(i);
        }
      }
      const loaded = p.root.getChildTransformNodes().some((n) => n.name.endsWith('-cargo') && n.isEnabled());
      if (loaded && (workedAt[i] === undefined || workedAt[i]! >= returnAt) && !loadedWithoutWork.includes(i))
        loadedWithoutWork.push(i);
      if (phase === 'outbound' && t >= returnAt + 100 && !outboundAfterReturn.includes(i)) outboundAfterReturn.push(i);
    });
  }
  return { variant, seenAt, workedAt, lateWork, loadedWithoutWork, outboundAfterReturn, allDone };
}
it('sends a ten-person compact wood team down a long road in convoy, keeps everyone and brings them all home', () => {
  const { f, state, transportMs, returnAt, completesAt } = gladeTeam(94_000);
  try {
    f.view.sync(state, epoch);
    const o = observeTeam(f, completesAt + 40_000, returnAt);
    expect(o.variant).toBe('compact');
    // The whole team leaves the door within seconds instead of one per road trip.
    expect(o.seenAt).toHaveLength(10);
    expect(Math.max(...o.seenAt)).toBeLessThan(10_000);
    // Everyone reaches a post or a waiting place well inside the work window.
    expect(o.workedAt.filter((t) => t !== undefined)).toHaveLength(10);
    expect(Math.max(...o.workedAt)).toBeLessThan(transportMs + 30_000);
    expect(o.lateWork).toEqual([]);
    expect(o.loadedWithoutWork).toEqual([]);
    expect(o.outboundAfterReturn).toEqual([]);
    // The exit never jams: the team is home before the stale-mission cleanup.
    expect(o.allDone).toBeGreaterThan(completesAt);
    expect(o.allDone).toBeLessThan(completesAt + 25_000);
  } finally {
    f.dispose();
  }
});
it('turns compact latecomers back empty-handed when the team leaves before they reach a post', () => {
  const { f, state, transportMs, returnAt, completesAt } = gladeTeam(2 * 17302 + 15_000);
  try {
    f.view.sync(state, epoch);
    const o = observeTeam(f, completesAt + 40_000, returnAt);
    expect(o.variant).toBe('compact');
    expect(o.seenAt).toHaveLength(10);
    const stragglers = Array.from({ length: 10 }, (_, i) => i).filter(
      (i) => o.workedAt[i] === undefined || o.workedAt[i]! >= returnAt,
    );
    expect(stragglers.length).toBeGreaterThan(0);
    expect(stragglers.length).toBeLessThan(10);
    expect(o.loadedWithoutWork).toEqual([]);
    expect(o.outboundAfterReturn).toEqual([]);
    expect(o.allDone).toBeGreaterThan(returnAt + transportMs / 2);
    expect(o.allDone).toBeLessThan(completesAt + 25_000);
  } finally {
    f.dispose();
  }
});
/** Walk the clock and record, per person of one lot, the return as shown. */
function observeReturn(f: ReturnType<typeof fixture>, id: string, untilMs: number, onTick?: (t: number) => void) {
  const inboundAt: number[] = [],
    roadAt: number[] = [],
    doneAt: number[] = [],
    stall: number[] = [],
    lastMove: number[] = [],
    lastPos: string[] = [],
    hidden: number[] = [],
    unloaded: number[] = [],
    faded: number[] = [];
  let gone = -1,
    count = 0;
  for (let t = 0; t <= untilMs; t += 33) {
    onTick?.(t);
    f.view.animate(epoch + t, true);
    const people = f.view.figures.filter((p) => p.root.name.startsWith(`worker-${id}-`));
    if (!people.length) {
      // The lot is disposed in the step that finishes its last person.
      gone = t;
      for (let i = 0; i < count; i++) doneAt[i] ??= t;
      break;
    }
    count = people.length;
    people.forEach((p, i) => {
      const a = actorOf(p),
        person = p as unknown as { exit: number; phase: string };
      if (person.phase === 'inbound' && inboundAt[i] === undefined) inboundAt[i] = t;
      if (person.phase === 'inbound' && person.exit === 0 && roadAt[i] === undefined) roadAt[i] = t;
      if (person.phase === 'done' && doneAt[i] === undefined) doneAt[i] = t;
      if (person.phase !== 'inbound') return;
      const pos = `${a.position.x.toFixed(3)}:${a.position.z.toFixed(3)}`;
      if (pos !== lastPos[i]) {
        lastPos[i] = pos;
        lastMove[i] = t;
      } else stall[i] = Math.max(stall[i] ?? 0, t - (lastMove[i] ?? t));
      if (!p.root.isEnabled() && !hidden.includes(i)) hidden.push(i);
      const loaded = p.root.getChildTransformNodes().some((n) => n.name.endsWith('-cargo') && n.isEnabled());
      if (p.root.isEnabled() && !loaded && !unloaded.includes(i)) unloaded.push(i);
      if (t - inboundAt[i]! > 1000 && p.root.getChildMeshes()[0]!.visibility < 0.9 && !faded.includes(i)) faded.push(i);
    });
  }
  return { count, inboundAt, roadAt, doneAt, stall, hidden, unloaded, faded, gone };
}
/** A wood lot at the end of the straight default road: posts around the tree, open layout. */
function openTeam(id: string, completesAfterMs: number, start = epoch) {
  const state = snapshot(id, start, 10),
    e = state.village.extractions[0]!;
  e.resourceCode = 'wood';
  e.transportMs = 17302;
  e.completesAt = new Date(start + completesAfterMs).toISOString();
  return state;
}
const expectHomeInConvoy = (o: ReturnType<typeof observeReturn>, completesAt: number, lateMs: number) => {
  const detail = JSON.stringify(o);
  expect(o.count, detail).toBe(10);
  // Everyone leaves loaded and in sight, reaches the road and walks it home.
  expect(
    o.inboundAt.filter((t) => t !== undefined),
    detail,
  ).toHaveLength(10);
  expect(
    o.roadAt.filter((t) => t !== undefined),
    detail,
  ).toHaveLength(10);
  expect(
    o.doneAt.filter((t) => t !== undefined),
    detail,
  ).toHaveLength(10);
  expect(o.hidden, detail).toEqual([]);
  expect(o.unloaded, detail).toEqual([]);
  expect(o.faded, detail).toEqual([]);
  expect(Math.max(...o.doneAt), detail).toBeLessThan(completesAt + lateMs);
  expect(o.gone, detail).toBeLessThan(completesAt + lateMs);
  // Nobody stands frozen on an exit: every exit either proceeds or steps back.
  expect(Math.max(...o.stall), detail).toBeLessThan(2000);
};
it('brings a ten-person open-layout wood team home loaded, in convoy, without a frozen exit', () => {
  const f = fixture();
  try {
    f.view.sync(openTeam('open-wood', 94_000), epoch);
    f.view.animate(epoch, true);
    expect(f.view.metrics.layouts[0]?.variant).toBe('front');
    expectHomeInConvoy(observeReturn(f, 'open-wood', 140_000), 94_000, 6_000);
  } finally {
    f.dispose();
  }
});
it('brings an open-layout team home when the next lot starts exactly at its completion', () => {
  const f = fixture();
  try {
    f.view.sync(openTeam('open-wood', 94_000), epoch);
    const o = observeReturn(f, 'open-wood', 140_000, (t) => {
      if (t === 94_017) f.view.sync(openTeam('open-next', 94_000, epoch + 94_000), epoch + t);
    });
    expectHomeInConvoy(o, 94_000, 6_000);
    f.view.animate(epoch + o.gone + 33, true);
    expect(f.view.metrics.layouts[0]?.id).toBe('open-next');
  } finally {
    f.dispose();
  }
});
it('brings a compact team home when the next lot starts exactly at its completion', () => {
  const { f, state, completesAt } = gladeTeam(94_000);
  try {
    f.view.sync(state, epoch);
    const o = observeReturn(f, 'glade-wood', 140_000, (t) => {
      if (t !== 94_017) return;
      const next = structuredClone(state),
        e = next.village.extractions[0]!;
      e.id = 'glade-next';
      next.village.worksites[0]!.activeExtraction = { id: 'glade-next' } as never;
      e.startedAt = new Date(epoch + completesAt).toISOString();
      e.completesAt = new Date(epoch + completesAt * 2).toISOString();
      f.view.sync(next, epoch + t);
    });
    expectHomeInConvoy(o, completesAt, 12_000);
  } finally {
    f.dispose();
  }
});
const woodTeam = (id: string, count: number) => {
  const state = snapshot(id, epoch, count);
  state.village.extractions[0]!.resourceCode = 'wood';
  return state;
};
const tilt = (f: ReturnType<typeof fixture>, id: string) =>
  f.scene.getTransformNodeByName(`wood-tree-tilt-${id}`)?.rotation.x ?? NaN;
const logs = (f: ReturnType<typeof fixture>, id: string) =>
  f.scene.meshes.filter((m) => m.name.startsWith(`wood-pile-${id}-`) && m.isEnabled()).length;

it.each([1, 4])(
  'wood site: fells the tree live, empties the trunk and fills the pile by W1 (%i woodcutters)',
  (count) => {
    const f = fixture();
    try {
      // Window: 8 s to 72 s, so the planned fall is 7.68 s after W0.
      f.view.sync(woodTeam(`felling-${count}`, count), epoch);
      let standing = 0,
        falling = false,
        lying = 0,
        pileAtEnd = 0;
      for (let t = 0; t <= 73_000; t += 33) {
        f.view.animate(epoch + t, true);
        const angle = tilt(f, `felling-${count}`);
        if (t > 9_000 && t < 15_000 && Math.abs(angle) < 0.03) standing++;
        if (angle > 0.2 && angle < 1.3) falling = true;
        if (t > 40_000 && t < 70_000 && angle > 1.4) lying++;
        if (t === 71_973) pileAtEnd = logs(f, `felling-${count}`);
      }
      expect(standing, 'the tree waits for its feller at the post').toBeGreaterThan(0);
      expect(falling, 'the fall is played, not skipped').toBe(true);
      expect(lying).toBeGreaterThan(0);
      expect(pileAtEnd).toBeGreaterThanOrEqual(8);
    } finally {
      f.dispose();
    }
  },
);

it('wood site: shows the tree already down after a reload past its fall, and the pile gone once loaded', () => {
  const f = fixture();
  try {
    f.view.sync(woodTeam('reloaded', 4), epoch + 40_000);
    f.view.animate(epoch + 40_000, true);
    expect(tilt(f, 'reloaded')).toBeCloseTo(Math.PI / 2);
    expect(logs(f, 'reloaded')).toBeGreaterThan(0);
    for (let t = 40_033; t <= 73_000; t += 33) f.view.animate(epoch + t, true);
    expect(logs(f, 'reloaded')).toBe(0);
  } finally {
    f.dispose();
  }
});

/**
 * The market hall as the scene plans it, facing +x with its double door, in
 * the plan's own metres: mission paths start inside the body, reach the road
 * in front of the door (2.5, 0) and go on. The wood road runs north; garden
 * plots sit on both sides of a westward road branching off it, one junction
 * each, so gardeners and woodcutters share the hall door and its road only.
 */
const MARKET_HALL = buildingPlan({
  id: 'hall',
  anchor: { cellX: 0, cellY: 0 },
  cells: [
    { cellX: 0, cellY: 0 },
    { cellX: 0, cellY: 1 },
  ],
  world: { widthCells: 32, heightCells: 32 },
  recipe: { ...HALL_RECIPE, entrance: { ...HALL_RECIPE.entrance, face: '+x', width: HALL_DOUBLE_DOOR_WIDTH } },
});
/** The scene's doorstep route: one lane of the double door, or the single connector when `lanes` is off. */
function hallPath(lanes: boolean): WorkerHooks['path'] {
  return (path, lane) => {
    const points = path.map((c) => ({ x: c.cellX, y: 0, z: c.cellY }));
    const toVector = (p: { x: number; z: number }) => new Vector3(p.x, 0, p.z);
    const door = doorConnector(MARKET_HALL, points, lanes ? lane : undefined);
    if (!door) return points.map(toVector);
    const route: PathPoint[] = door.route.map((p) =>
      Object.assign(toVector(p), { ...(p.lane ? { lane: p.lane } : {}), ...(p.width ? { width: p.width } : {}) }),
    );
    return [...route, ...points.slice(door.resume).map(toVector)];
  };
}
const HALL_ROAD: TravelCell[] = [
  { cellX: 0, cellY: 0 },
  { cellX: 2.5, cellY: 0 },
  { cellX: 2.5, cellY: 2.5 },
];
function marketPlots(branchAt: number): TravelCell[][] {
  const junctions = Array.from({ length: 9 }, (_, i) => ({ cellX: -1.5 - i * 2.5, cellY: branchAt }));
  return junctions.flatMap((junction, i) =>
    [1, -1].map((side) => [
      ...HALL_ROAD,
      { cellX: 2.5, cellY: branchAt },
      ...junctions.slice(0, i),
      junction,
      { cellX: junction.cellX, cellY: branchAt + side * 3.4 },
    ]),
  );
}
/**
 * A wood lot of ten leaving the hall at `epoch` while `gardeners` harvests,
 * started long before, walk back in through the same door from `firstBackMs`
 * on, one every `everyMs`, at one metre per second. The garden road branches
 * off the wood road at `branchAt`, north of the hall's road merge (2.5, 2.5).
 */
function marketTraffic(gardeners: number, branchAt: number, firstBackMs = 2000, everyMs = 1500) {
  const state = openTeam('open-wood', 94_000),
    e = state.village.extractions[0]!;
  e.cellX = 2.5;
  e.cellY = 16;
  e.path = [...HALL_ROAD, { cellX: 2.5, cellY: 5 }, { cellX: 2.5, cellY: 9 }, { cellX: 2.5, cellY: 16 }];
  const plots = marketPlots(branchAt);
  expect(plots.length).toBeGreaterThanOrEqual(gardeners);
  state.cells = plots.slice(0, gardeners).map((path, i) => {
    let length = 0;
    for (let k = 1; k < path.length; k++)
      length += Math.hypot(path[k]!.cellX - path[k - 1]!.cellX, path[k]!.cellY - path[k - 1]!.cellY);
    const walkMs = Math.round(length * 1000),
      backAt = epoch + firstBackMs + i * everyMs - walkMs,
      startedAt = epoch - 120_000 + i * 1500;
    const plot = path[path.length - 1]!;
    const harvest = {
      id: `garden-${i}`,
      startedAt: new Date(startedAt).toISOString(),
      completesAt: new Date(backAt + walkMs).toISOString(),
      transportMs: walkMs,
      path,
      stops: [{ ...plot, path, arrivesAfterMs: walkMs, workEndsAfterMs: backAt - startedAt, reservedCarrots: 10 }],
      returnPath: [...path].reverse(),
    };
    return { building: { garden: { plots: [{ ...plot, harvest }] } } };
  }) as unknown as VillageState['cells'];
  return state;
}
/** Within the opening and the porch: from the indoor point to the lanes' end, before the road merge. */
const atDoor = (p: { x: number; z: number }) => p.x < 2.1 && Math.abs(p.z) < 1.2;
/**
 * Walk the clock; record when each woodcutter works, how late each gardener
 * gets home after its authoritative completion, the longest wait of anyone
 * in sight, the longest wait at the door, and the mean animation cost.
 */
function observeMarketDoor(f: ReturnType<typeof fixture>, state: VillageState, id: string, untilMs: number) {
  const workedAt: number[] = [],
    waits = new Map<string, { since: number; longest: number; doorSince: number; doorLongest: number }>(),
    completesAt = new Map<string, number>(),
    goneAt = new Map<string, number>(),
    seen = new Set<string>(),
    lanes = new Set<DoorLane>();
  for (const cell of state.cells)
    for (const plot of cell.building?.garden?.plots ?? [])
      if (plot.harvest) completesAt.set(plot.harvest.id, Date.parse(plot.harvest.completesAt) - epoch);
  let frames = 0,
    cost = 0;
  for (let t = 0; t <= untilMs; t += 33) {
    const started = performance.now();
    f.view.animate(epoch + t, true);
    cost += performance.now() - started;
    frames++;
    const layouts = f.view.metrics.layouts;
    layouts
      .find((l) => l.id === id)
      ?.phases.forEach((phase, i) => {
        if (phase === 'work' && workedAt[i] === undefined) workedAt[i] = t;
      });
    for (const l of layouts) if (l.resource === 'garden') seen.add(l.id);
    for (const gardenId of seen)
      if (!goneAt.has(gardenId) && !layouts.some((l) => l.id === gardenId)) goneAt.set(gardenId, t);
    for (const p of f.view.figures) {
      const a = actorOf(p);
      if (a.visible && atDoor(a.position)) {
        const here = sampleWorkerPath(a.path, a.distance);
        // Every walker at the door is on the lane of its own direction.
        const segment = a.path.find((q) => Math.hypot(q.x - here.x, q.z - here.z) < 0.9);
        if (segment?.lane) {
          lanes.add(segment.lane);
          expect(segment.lane, `${a.id} ${JSON.stringify(a.position)}`).toBe(a.direction === 1 ? 'out' : 'in');
        }
      }
      const w = waits.get(a.id) ?? { since: -1, longest: 0, doorSince: -1, doorLongest: 0 };
      if (a.waitingSince === null || !a.visible) w.since = w.doorSince = -1;
      else {
        if (w.since < 0) w.since = t;
        w.longest = Math.max(w.longest, t - w.since);
        if (atDoor(a.position)) {
          if (w.doorSince < 0) w.doorSince = t;
          w.doorLongest = Math.max(w.doorLongest, t - w.doorSince);
        } else w.doorSince = -1;
      }
      waits.set(a.id, w);
    }
  }
  const homeLate = [...completesAt].map(([gardenId, at]) => (goneAt.get(gardenId) ?? Infinity) - at);
  return {
    workedAt,
    longestWait: Math.max(0, ...[...waits.values()].map((w) => w.longest)),
    doorWait: Math.max(0, ...[...waits.values()].map((w) => w.doorLongest)),
    homeLate,
    lanes: [...lanes].sort(),
    updateMs: cost / frames,
  };
}
function expectDoorFlows(o: ReturnType<typeof observeMarketDoor>) {
  const detail = JSON.stringify(o);
  expect(o.lanes, detail).toEqual(['in', 'out']);
  // The team's road trip is 17.3 s: everyone has a post well before the
  // 76.7 s return, instead of half the team held at the door until then.
  expect(
    o.workedAt.filter((t) => t !== undefined),
    detail,
  ).toHaveLength(10);
  expect(Math.max(...o.workedAt), detail).toBeLessThan(35_000);
  // Every gardener gets home before its 30 s cleanup; waits happen on the
  // road at the merge, never for more than two seconds at the door.
  expect(Math.max(...o.homeLate), detail).toBeLessThan(28_000);
  expect(o.doorWait, detail).toBeLessThan(2000);
  expect(o.longestWait, detail).toBeLessThan(20_000);
}
it('takes ten woodcutters out through the exit lane while twelve gardeners come in through the entry lane, nobody held at the door', () => {
  const f = fixture(() => true, { path: hallPath(true) });
  try {
    const state = marketTraffic(12, 11);
    f.view.sync(state, epoch);
    f.view.animate(epoch, true);
    expect(f.view.metrics.layouts.find((l) => l.id === 'open-wood')?.variant).toBe('front');
    expectDoorFlows(observeMarketDoor(f, state, 'open-wood', 110_000));
  } finally {
    f.dispose();
  }
});
/**
 * The garden road branching three metres up the road from the hall's merge:
 * with the merge a plain road point (each lane joins at a shallow angle on its
 * own side), no file stops inside a passage's hold zone there, so the junction
 * does not lock against the door's flows.
 */
it('takes both flows through a garden junction three metres past the road merge', () => {
  const f = fixture(() => true, { path: hallPath(true) });
  try {
    const state = marketTraffic(12, 5.5);
    f.view.sync(state, epoch);
    expectDoorFlows(observeMarketDoor(f, state, 'open-wood', 110_000));
  } finally {
    f.dispose();
  }
});
it('costs no more per frame with the double door than with the single door it replaces', () => {
  const measure = (lanes: boolean) => {
    const f = fixture(() => true, { path: hallPath(lanes) });
    try {
      const state = marketTraffic(12, 11);
      f.view.sync(state, epoch);
      return observeMarketDoor(f, state, 'open-wood', 60_000).updateMs;
    } finally {
      f.dispose();
    }
  };
  // Warm up the JIT on the first variant, then compare the same scenario.
  measure(false);
  const single = measure(false),
    double = measure(true);
  console.log(`hall door animate cost: single door ${single.toFixed(3)} ms, double door ${double.toFixed(3)} ms`);
  // Reported in the handoff; the bound only guards against a regression of the order of the passage chain.
  expect(double, `single door ${single.toFixed(3)} ms, double door ${double.toFixed(3)} ms`).toBeLessThan(
    single * 1.5 + 0.2,
  );
});
