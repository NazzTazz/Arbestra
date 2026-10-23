import { expect, it } from 'vitest';
import type { VillageState } from '@arbestra/contracts';
import { villageTransitionDue } from './sync.js';
const at = (n: number) => new Date(1700000000000 + n);
function snapshot(id = 'author'): VillageState {
  return {
    serverTime: at(0).toISOString(),
    cells: [],
    village: { id, extractions: [], worksites: [], market: { exchanges: [], offers: [], journeys: [] } },
  } as unknown as VillageState;
}
it('wakes Oracle eligibility at its exact local deadline', () => {
  const s = snapshot();
  s.village.market!.offers = [
    { status: 'open', oracleEligible: true, oracleAt: at(600000).toISOString() },
  ] as NonNullable<NonNullable<VillageState['village']['market']>['offers']>;
  expect(villageTransitionDue(s, at(599999))).toBe(false);
  expect(villageTransitionDue(s, at(600000))).toBe(true);
});
it('wakes arrival only at the receiving village and return only at the porters home', () => {
  const s = snapshot();
  s.village.market!.journeys = [
    {
      villageId: 'home',
      destinationVillageId: 'author',
      arrivesAt: at(10000).toISOString(),
      returnsAt: at(20000).toISOString(),
    },
  ] as NonNullable<NonNullable<VillageState['village']['market']>['journeys']>;
  expect(villageTransitionDue(s, at(9999))).toBe(false);
  expect(villageTransitionDue(s, at(10000))).toBe(true);
  s.serverTime = at(10001).toISOString();
  expect(villageTransitionDue(s, at(15000))).toBe(false);
  s.village.id = 'home';
  expect(villageTransitionDue(s, at(15000))).toBe(false);
  expect(villageTransitionDue(s, at(20000))).toBe(true);
});
