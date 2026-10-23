import { expect, it, vi } from 'vitest';
import type { NaturalFeature, VillageCell, VillageState } from '@arbestra/contracts';
import { WorkerObstacles } from './worker-obstacles';
import { worksiteConnector } from './worksite-layout';
import { WorldSpace } from './world-space';

it('queries only nearby equipment and preserves exact clearance across negative bins and the toric seam', () => {
  const index = new WorkerObstacles(),
    space = new WorldSpace(64, 32, { cellX: 0, cellY: 0 });
  const equipment = [
    { x: 63.9 * 8, y: 0 },
    { x: 0.2 * 8, y: 0 },
    { x: 10 * 8, y: 5 * 8 },
  ];
  index.updateEquipment(equipment, space);
  const legacy = (p: { x: number; z: number }, radius: number) =>
    equipment.some((e) => {
      const q = space.project({ cellX: e.x / 8, cellY: e.y / 8 });
      return Math.hypot(p.x - q.x, p.z - q.z) < radius + 0.23;
    });
  for (const radius of [0.2, 0.27, 0.4])
    for (let x = -2; x < 2; x += 0.125)
      for (const z of [-1, -0.43, 0, 0.43, 1])
        expect(index.equipmentBlocked({ x, z }, radius)).toBe(legacy({ x, z }, radius));
  expect(index.equipmentBlocked({ x: -0.25, z: 0 }, 0.2)).toBe(true);
  expect(index.equipmentBlocked({ x: 5, z: 0 }, 0.2)).toBe(false);
});

it('projects equipment once per layout and rebase, not for every connector probe', () => {
  const index = new WorkerObstacles(),
    space = new WorldSpace(4096, 4096, { cellX: 0, cellY: 0 });
  const equipment = Array.from({ length: 4096 }, (_, i) => ({ x: (i % 64) * 8, y: Math.floor(i / 64) * 8 }));
  const project = vi.spyOn(space, 'project');
  index.updateEquipment(equipment, space);
  expect(project).toHaveBeenCalledTimes(equipment.length);
  project.mockClear();
  for (let n = 0; n < 100; n++) {
    index.updateEquipment(equipment, space);
    expect(index.equipmentBlocked({ x: -10, z: -10 }, 0.2)).toBe(false);
  }
  expect(project).not.toHaveBeenCalled();
  space.rebase({ cellX: 32, cellY: 32 }, 32);
  project.mockClear();
  index.updateEquipment(equipment, space);
  expect(project).toHaveBeenCalledTimes(equipment.length);
  expect(index.equipmentBlocked(space.project({ cellX: 0, cellY: 0 }), 0.2)).toBe(true);
  index.updateEquipment([], space);
  expect(index.equipmentBlocked(space.project({ cellX: 0, cellY: 0 }), 0.2)).toBe(false);
  const nextSpace = new WorldSpace(4096, 4096, { cellX: 1, cellY: 0 });
  index.updateEquipment([{ x: 8, y: 0 }], nextSpace);
  expect(index.equipmentBlocked({ x: 0, z: 0 }, 0.2)).toBe(true);
});

function snapshot(cells: Partial<VillageCell>[] = [], features: Partial<NaturalFeature>[] = []) {
  return { cells, region: { features } } as unknown as VillageState;
}
const feature = (id: string, x: number, y: number, deposit?: Partial<NonNullable<NaturalFeature['deposit']>>) =>
  ({ id, cellX: x, cellY: y, ...(deposit ? { deposit } : {}) }) as NaturalFeature;

it('preserves building and footprint obstacles while allowing unoccupied known cells', () => {
  const index = new WorkerObstacles();
  index.update(
    snapshot([
      { cellX: 0, cellY: 0, building: { id: 'house' } as VillageCell['building'] },
      { cellX: 1, cellY: 0, footprint: { buildingId: 'house' } as VillageCell['footprint'] },
      { cellX: 2, cellY: 0 },
    ]),
  );
  expect(index.blocked(0, 0, null)).toBe(true);
  expect(index.blocked(1, 0, null)).toBe(true);
  expect(index.blocked(2, 0, null)).toBe(false);
  expect(index.blocked(3, 0, null)).toBe(false);
});

it('excludes only the current feature, preserving multiple obstacles and cleared resource rules', () => {
  const own = feature('own', 5, 5, { blocksCell: true, cleared: false }),
    other = feature('other', 5, 5, { blocksCell: true });
  const index = new WorkerObstacles();
  index.update(
    snapshot(
      [],
      [
        own,
        other,
        feature('cut', 6, 5, { blocksCell: false }),
        feature('cleared', 7, 5, { blocksCell: true, cleared: true }),
        feature('decor', 8, 5),
      ],
    ),
  );
  expect(index.feature('own')).toBe(own);
  expect(index.feature(null)).toBeUndefined();
  expect(index.blocked(5, 5, 'own')).toBe(true);
  expect(index.blocked(6, 5, null)).toBe(false);
  expect(index.blocked(7, 5, null)).toBe(false);
  expect(index.blocked(8, 5, null)).toBe(true);
  index.update(snapshot([], [own]));
  expect(index.blocked(5, 5, 'own')).toBe(false);
  expect(index.blocked(5, 5, null)).toBe(true);
});

it('does not rescan village entities for every connector probe or an unchanged snapshot', () => {
  let reads = 0;
  const cells = Array.from({ length: 4096 }, (_, i) => ({
    get cellX() {
      reads++;
      return i;
    },
    cellY: 1,
  }));
  const features = Array.from({ length: 1024 }, (_, i) => ({
    id: `f-${i}`,
    get cellX() {
      reads++;
      return i;
    },
    cellY: 2,
  }));
  const state = snapshot(cells, features),
    index = new WorkerObstacles();
  index.update(state);
  reads = 0;
  for (let n = 0; n < 100; n++) {
    index.update(state);
    expect(index.blocked(5000, 5000, null)).toBe(false);
    expect(index.feature('missing')).toBeUndefined();
  }
  expect(reads).toBe(0);
});

it('takes new snapshot obstacles into account and removes stale ones', () => {
  const index = new WorkerObstacles();
  index.update(snapshot([], [feature('a', 0, 0)]));
  expect(index.blocked(0, 0, null)).toBe(true);
  index.update(snapshot([], [feature('b', 63, 31)]));
  expect(index.blocked(0, 0, null)).toBe(false);
  expect(index.blocked(63, 31, null)).toBe(true);
  expect(index.feature('a')).toBeUndefined();
});

it('keeps the same physically free connector as the previous snapshot scans', () => {
  const state = snapshot([], [feature('wall', 2, 0), feature('own', 6, 0)]),
    index = new WorkerObstacles();
  index.update(state);
  const legacy = (x: number, y: number) =>
    state.region.features.some(
      (f) =>
        f.cellX === x &&
        f.cellY === y &&
        f.id !== 'own' &&
        f.deposit?.blocksCell !== false &&
        f.deposit?.cleared !== true,
    );
  const route = (blocked: (x: number, y: number) => boolean) =>
    worksiteConnector(
      { x: 0, z: 0 },
      { x: 6, z: 0 },
      { x: 6, z: 0 },
      (p) => !blocked(Math.round(p.x), Math.round(p.z)),
    );
  const path = route((x, y) => index.blocked(x, y, 'own'));
  expect(path).not.toBeNull();
  expect(path).toEqual(route(legacy));
  expect(path!.at(-1)).toEqual({ x: 6, z: 0 });
});
