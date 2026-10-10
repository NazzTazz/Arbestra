import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { VillageState } from './villages.js';
import { applyVillageFrame, latestVillageSnapshot, reconcileVillageSnapshot, villageFrame, villageSnapshotIsValid } from './village-sync.js';
const fixture = () => JSON.parse(readFileSync(new URL('../../../tests/fixtures/village-sync-state.json', import.meta.url), 'utf8')) as VillageState;
function completion(before: VillageState) {
  const after = structuredClone(before); after.syncRevision = 2;
  Object.assign(after.cells[1]!.building!, { status: 'completed', completedAt: '2026-10-10T18:00:05.000Z' });
  after.cells[1]!.footprint!.state = 'active'; return after;
}
it('applies a complete targeted change, preserving unrelated entity and terrain references', () => {
  const before = fixture(), after = completion(before); expect(villageSnapshotIsValid(before)).toBe(true);
  const frame = villageFrame(before, after), result = applyVillageFrame(before, frame);
  expect(result.kind).toBe('applied'); if (result.kind !== 'applied') throw Error('Not applied');
  expect(result.state).toEqual(after); expect(result.state.cells[0]).toBe(before.cells[0]);
  expect(result.state.region).toBe(before.region); expect(before.cells[1]!.building!.status).toBe('under-construction');
  expect(frame.changes).toHaveLength(1);
});
it('ignores repeated frames and the same mutation already received by HTTP', () => {
  const before = fixture(), after = completion(before), frame = villageFrame(before, after);
  expect(applyVillageFrame(after, frame).kind).toBe('ignored');
  const applied = applyVillageFrame(before, frame); if (applied.kind !== 'applied') throw Error('Not applied');
  expect(applyVillageFrame(applied.state, frame).kind).toBe('ignored');
});
it('resynchronizes a gap or unusable overlap, but ignores a fully covered older frame', () => {
  const before = fixture(), frame = villageFrame(before, completion(before));
  expect(applyVillageFrame(before, { ...frame, fromRevision: 2, toRevision: 3 }).kind).toBe('resync');
  expect(applyVillageFrame({ ...before, syncRevision: 2 }, { ...frame, fromRevision: 1, toRevision: 3 }).kind).toBe('resync');
  expect(applyVillageFrame({ ...before, syncRevision: 4 }, frame).kind).toBe('ignored');
});
it('does not expose partial changes or advance revision when the final state is invalid', () => {
  const before = fixture(), original = structuredClone(before), frame = villageFrame(before, completion(before));
  frame.changes.push({ kind: 'set', path: ['village', 'wood'], value: -1 });
  expect(applyVillageFrame(before, frame).kind).toBe('resync'); expect(before).toEqual(original);
  expect(applyVillageFrame(before, { ...frame, changes: [{ kind: 'set', path: ['__proto__'], value: {} }] }).kind).toBe('resync');
});
it('applies additions, removals and entity order, and preserves references on a reset', () => {
  const before = fixture(), after = completion(before); after.cells = [after.cells[1]!];
  const result = applyVillageFrame(before, villageFrame(before, after));
  expect(result.kind).toBe('applied'); if (result.kind === 'applied') expect(result.state).toEqual(after);
  const reset = reconcileVillageSnapshot(before, completion(before));
  expect(reset.cells[0]).toBe(before.cells[0]); expect(reset.region).toBe(before.region);
  const add = { ...after, syncRevision: 3, cells: [before.cells[0]!, ...after.cells] };
  const added = applyVillageFrame(after, villageFrame(after, add));
  expect(added.kind).toBe('applied'); if (added.kind === 'applied') expect(added.state).toEqual(add);
});
it('ignores an event belonging to another world or village', () => {
  const before = fixture(), frame = villageFrame(before, completion(before));
  expect(applyVillageFrame(before, { ...frame, villageId: before.world.id }).kind).toBe('ignored');
});
it('uses revision rather than response timestamp in both village snapshots',()=>{
  const current=fixture(),late={...current,syncRevision:0,serverTime:'2026-10-11T18:00:00.000Z'};
  expect(latestVillageSnapshot(current,late)).toBe(current);
  const newer={...current,syncRevision:2,serverTime:'2026-10-09T18:00:00.000Z'};
  expect(latestVillageSnapshot(current,newer)).toBe(newer);
  const projection={...current,serverTime:'2026-10-11T18:00:00.000Z'};
  expect(latestVillageSnapshot(current,projection)).toBe(projection);
});
