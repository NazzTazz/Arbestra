import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { VillageState } from './villages.js';
import {
  applyVillageFrame,
  latestVillageSnapshot,
  reconcileVillageSnapshot,
  synchronizationChanges,
  villageFrame,
  villageSnapshotIsValid,
} from './village-sync.js';
const fixture = () =>
  JSON.parse(
    readFileSync(new URL('../../../tests/fixtures/village-sync-state.json', import.meta.url), 'utf8'),
  ) as VillageState;
function completion(before: VillageState) {
  const after = structuredClone(before);
  after.syncRevision = 2;
  Object.assign(after.cells[1]!.building!, { status: 'completed', completedAt: '2026-10-10T18:00:05.000Z' });
  after.cells[1]!.footprint!.state = 'active';
  return after;
}
it('applies a complete targeted change, preserving unrelated entity and terrain references', () => {
  const before = fixture(),
    after = completion(before);
  expect(villageSnapshotIsValid(before)).toBe(true);
  const frame = villageFrame(before, after),
    result = applyVillageFrame(before, frame);
  expect(result.kind).toBe('applied');
  if (result.kind !== 'applied') throw Error('Not applied');
  expect(result.state).toEqual(after);
  expect(result.state.cells[0]).toBe(before.cells[0]);
  expect(result.state.region).toBe(before.region);
  expect(before.cells[1]!.building!.status).toBe('under-construction');
  expect(frame.changes).toHaveLength(1);
});
it('ignores repeated frames and the same mutation already received by HTTP', () => {
  const before = fixture(),
    after = completion(before),
    frame = villageFrame(before, after);
  expect(applyVillageFrame(after, frame).kind).toBe('ignored');
  const applied = applyVillageFrame(before, frame);
  if (applied.kind !== 'applied') throw Error('Not applied');
  expect(applyVillageFrame(applied.state, frame).kind).toBe('ignored');
});
it('resynchronizes a gap or unusable overlap, but ignores a fully covered older frame', () => {
  const before = fixture(),
    frame = villageFrame(before, completion(before));
  expect(applyVillageFrame(before, { ...frame, fromRevision: 2, toRevision: 3 }).kind).toBe('resync');
  expect(applyVillageFrame({ ...before, syncRevision: 2 }, { ...frame, fromRevision: 1, toRevision: 3 }).kind).toBe(
    'resync',
  );
  expect(applyVillageFrame({ ...before, syncRevision: 4 }, frame).kind).toBe('ignored');
});
it('does not expose partial changes or advance revision when the final state is invalid', () => {
  const before = fixture(),
    original = structuredClone(before),
    frame = villageFrame(before, completion(before));
  frame.changes.push({ kind: 'set', path: ['village', 'wood'], value: -1 });
  expect(applyVillageFrame(before, frame).kind).toBe('resync');
  expect(before).toEqual(original);
  expect(applyVillageFrame(before, { ...frame, changes: [{ kind: 'set', path: ['__proto__'], value: {} }] }).kind).toBe(
    'resync',
  );
});
it('applies additions, removals and entity order, and preserves references on a reset', () => {
  const before = fixture(),
    after = completion(before);
  after.cells = [after.cells[1]!];
  const result = applyVillageFrame(before, villageFrame(before, after));
  expect(result.kind).toBe('applied');
  if (result.kind === 'applied') expect(result.state).toEqual(after);
  const reset = reconcileVillageSnapshot(before, completion(before));
  expect(reset.cells[0]).toBe(before.cells[0]);
  expect(reset.region).toBe(before.region);
  const add = { ...after, syncRevision: 3, cells: [before.cells[0]!, ...after.cells] };
  const added = applyVillageFrame(after, villageFrame(after, add));
  expect(added.kind).toBe('applied');
  if (added.kind === 'applied') expect(added.state).toEqual(add);
});
it('ignores an event belonging to another world or village', () => {
  const before = fixture(),
    frame = villageFrame(before, completion(before));
  expect(applyVillageFrame(before, { ...frame, villageId: before.world.id }).kind).toBe('ignored');
});
it('uses revision rather than response timestamp in both village snapshots', () => {
  const current = fixture(),
    late = { ...current, syncRevision: 0, serverTime: '2026-10-11T18:00:00.000Z' };
  expect(latestVillageSnapshot(current, late)).toBe(current);
  const newer = { ...current, syncRevision: 2, serverTime: '2026-10-09T18:00:00.000Z' };
  expect(latestVillageSnapshot(current, newer)).toBe(newer);
  const projection = { ...current, serverTime: '2026-10-11T18:00:00.000Z' };
  expect(latestVillageSnapshot(current, projection)).toBe(projection);
});
it('reconciles in one pass without serializing, keeping every unchanged reference', () => {
  const before = fixture(),
    after = completion(before);
  const stringify = vi.spyOn(JSON, 'stringify');
  try {
    expect(reconcileVillageSnapshot(before, structuredClone(before))).toBe(before);
    const next = reconcileVillageSnapshot(before, after);
    expect(next).toEqual(after);
    expect(next).not.toBe(before);
    expect(next.cells[0]).toBe(before.cells[0]);
    expect(next.region).toBe(before.region);
    expect(next.cells[1]).not.toBe(before.cells[1]);
    expect(next.cells[1]!.footprint).not.toBe(before.cells[1]!.footprint);
    expect(stringify).not.toHaveBeenCalled();
  } finally {
    stringify.mockRestore();
  }
});
it('compares data like JSON: member order and undefined members are not changes', () => {
  expect(synchronizationChanges({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toEqual([]);
  expect(synchronizationChanges({ a: 1, b: undefined }, { a: 1 })).toEqual([]);
  expect(synchronizationChanges({ a: [1, 2] }, { a: [1, 2, 3] })).toEqual([
    { kind: 'set', path: ['a'], value: [1, 2, 3] },
  ]);
});
function largeVillage(): VillageState {
  const state = fixture();
  const model = state.cells[0]!;
  for (let i = 0; i < 300; i++)
    state.cells.push({ ...structuredClone(model), id: `${100 + i}:7`, cellX: 100 + i, cellY: 7 });
  const routes = Array.from({ length: 40 }, (_, i) => ({
    id: `route-${i}`,
    cells: Array.from({ length: 30 }, (_, j) => ({ x: i + j, y: j, lane: j % 2 })),
  }));
  (state as unknown as { travelRoutes: unknown }).travelRoutes = routes;
  return state;
}
it('reconciles lazily: an unchanged subtree is kept without copying, only the changed branch is rebuilt', () => {
  const before = largeVillage();
  const stats = { copies: 0, indexes: 0 };
  expect(reconcileVillageSnapshot(before, structuredClone(before), stats)).toBe(before);
  // Old eager version: one copy per array/object visited and one index per array.
  expect(stats).toEqual({ copies: 0, indexes: 0 });
  const after = completion(before);
  const next = reconcileVillageSnapshot(before, after, stats);
  expect(next).toEqual(after);
  // root, cells, cells[1], its building and its footprint: nothing else is copied.
  expect(stats).toEqual({ copies: 5, indexes: 0 });
  expect(next.travelRoutes).toBe(before.travelRoutes);
  expect(next.cells[2]).toBe(before.cells[2]);
  expect(next.cells[1]!.building).not.toBe(before.cells[1]!.building);
});
it('reconciles arrays and objects like before: moved, changed, added and removed members', () => {
  const before = JSON.parse(
    '{"keep":{"deep":[1,2,{"x":1}]},"list":[{"id":"a","v":1},{"id":"b","v":2},{"id":"c","v":3}],' +
      '"plain":[1,2,3],"reversed":[1,2,3],"obj":{"p":1,"q":2},"shrink":{"p":1,"q":{"r":1}},"gone":{"z":1},' +
      '"tail":[{"id":"a"},{"id":"b"}],"proto":{"a":1}}',
  );
  const after = JSON.parse(
    '{"list":[{"id":"c","v":3},{"id":"a","v":9},{"id":"d","v":4}],"keep":{"deep":[1,2,{"x":1}]},' +
      '"plain":[1,2],"reversed":[3,2,1],"obj":{"p":1,"q":2,"r":3},"shrink":{"q":{"r":1}},' +
      '"tail":[{"id":"a"},{"id":"b"},{"id":"c"}],"proto":{"__proto__":1,"a":1}}',
  );
  const stats = { copies: 0, indexes: 0 };
  const next = reconcileVillageSnapshot(
    { ...before, world: { id: 'w' }, village: { id: 'v' } } as unknown as VillageState,
    { ...after, world: { id: 'w' }, village: { id: 'v' } } as unknown as VillageState,
    stats,
  ) as unknown as Record<
    'keep' | 'list' | 'plain' | 'reversed' | 'obj' | 'shrink' | 'tail' | 'proto',
    Record<string, unknown> & unknown[]
  >;
  expect(next).toEqual({ ...after, world: { id: 'w' }, village: { id: 'v' } });
  expect(Object.keys(next)).toEqual([...Object.keys(after), 'world', 'village']);
  expect(next.keep).toBe(before.keep);
  // Keyed members follow their identity across moves; a changed one is a new object.
  expect(next.list).not.toBe(before.list);
  expect(next.list[0]).toBe(before.list[2]);
  expect(next.list[1]).not.toBe(before.list[1]);
  expect(next.list[1]).not.toBe(after.list[1]);
  // An unmatched member is reconciled with the member at its position, as before.
  expect(next.list[2]).not.toBe(after.list[2]);
  expect(next.plain).not.toBe(before.plain);
  expect(next.reversed).not.toBe(before.reversed);
  expect(next.obj).not.toBe(before.obj);
  expect(Object.keys(next.obj)).toEqual(['p', 'q', 'r']);
  expect(next.shrink).not.toBe(before.shrink);
  expect(next.shrink.q).toBe(before.shrink.q);
  expect('gone' in next).toBe(false);
  expect(next.tail).not.toBe(before.tail);
  expect(next.tail[0]).toBe(before.tail[0]);
  expect(next.tail[1]).toBe(before.tail[1]);
  expect(Object.hasOwn(next.proto, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(next.proto)).toBe(Object.prototype);
  // Only the reordered list and the grown one needed an index of their entities.
  expect(stats.indexes).toBe(2);
});
