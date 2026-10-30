import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyInfrastructure, reconcileVillageSnapshot, type VillageState } from '@arbestra/contracts';
import { TravelDerivationInputs } from './travel-derivation';

const fixture = () =>
  JSON.parse(
    readFileSync(new URL('../../../../tests/fixtures/village-sync-state.json', import.meta.url), 'utf8'),
  ) as VillageState;
/** A village with many long routes, read through a counter. */
function village() {
  const state = fixture();
  state.cells.push({
    ...structuredClone(state.cells[0]!),
    id: '70:70',
    cellX: 70,
    cellY: 70,
    footprint: null,
    building: null,
  });
  state.travelRoutes = Array.from({ length: 60 }, (_, i) => ({
    id: `route-${i}`,
    kind: 'building' as const,
    destination: { cellX: i, cellY: 3 },
    cells: Array.from({ length: 40 }, (_, j) => ({ cellX: i + j, cellY: j })),
  }));
  state.infrastructure = { ...emptyInfrastructure(), revision: 4 };
  state.region.features = [
    { cellX: 65, cellY: 65, deposit: { blocksCell: true, cleared: false, state: 'available' } },
  ] as unknown as VillageState['region']['features'];
  let reads = 0;
  state.travelRoutes = new Proxy(state.travelRoutes, {
    get(target, key, receiver) {
      reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { state, reads: () => reads };
}
afterEach(() => vi.restoreAllMocks());

it('keeps the derivation of a publication that does not touch its inputs without reading the routes', () => {
  const { state: before, reads } = village();
  const previous = new TravelDerivationInputs(before);
  const after = structuredClone({ ...before, travelRoutes: [...before.travelRoutes] });
  after.serverTime = '2026-10-10T18:00:09.000Z';
  after.cells[2]!.canBuild = true;
  const next = reconcileVillageSnapshot(before, after);
  expect(next.travelRoutes).toBe(before.travelRoutes);
  expect(next.cells).not.toBe(before.cells);
  const stringify = vi.spyOn(JSON, 'stringify');
  const start = reads();
  // A non-building cell changed: the comparison projects the building cells only.
  expect(new TravelDerivationInputs(next).sameAs(previous)).toBe(true);
  expect(reads() - start).toBe(0);
  expect(stringify).not.toHaveBeenCalled();
});
it('falls back to a content comparison when an identity changes without its content', () => {
  const { state: before } = village();
  const previous = new TravelDerivationInputs(before);
  const copy = {
    ...before,
    travelRoutes: structuredClone([...before.travelRoutes]),
    infrastructure: structuredClone(before.infrastructure),
    region: structuredClone(before.region),
    cells: structuredClone(before.cells),
  } as VillageState;
  expect(new TravelDerivationInputs(copy).sameAs(previous)).toBe(true);
});
it('sees every input of the derivation change', () => {
  const { state } = village();
  const previous = new TravelDerivationInputs(state);
  const changed = (edit: (s: VillageState) => void) => {
    const next = structuredClone({ ...state, travelRoutes: [...state.travelRoutes] });
    edit(next);
    return new TravelDerivationInputs(reconcileVillageSnapshot(state, next)).sameAs(previous);
  };
  expect(changed(() => {})).toBe(true);
  expect(changed((s) => (s.travelRoutes[3]!.cells[5]!.cellY = 99))).toBe(false);
  expect(changed((s) => s.travelRoutes.pop())).toBe(false);
  expect(changed((s) => (s.cells[1]!.building!.quarterTurns = 1))).toBe(false);
  expect(changed((s) => (s.cells[2]!.footprint = { ...s.cells[0]!.footprint! }))).toBe(false);
  expect(changed((s) => (s.region.terrainCodes[0] = 2))).toBe(false);
  expect(changed((s) => (s.region.originCellX += 1))).toBe(false);
  expect(changed((s) => ((s.region.features[0] as { deposit: { cleared: boolean } }).deposit.cleared = true))).toBe(
    false,
  );
  expect(changed((s) => (s.infrastructure!.revision = 9))).toBe(false);
  expect(new TravelDerivationInputs({ ...state, world: { ...state.world, id: 'other' } }).sameAs(previous)).toBe(false);
  expect(new TravelDerivationInputs(state).sameAs(null)).toBe(false);
});
