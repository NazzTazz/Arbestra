import { expect, it } from 'vitest';
import { workingTeam } from './work.js';
import type { Selectable } from 'kysely';
import type { PopulationCohortsTable } from '../../database/schema.js';

function cohort(id: string, count: number, minutes: number): Selectable<PopulationCohortsTable> {
  return { id, memberCount: count, energy: 0, energyProgress: 22 * minutes * 60000,
    activity: 'idle', harvestId: null, extractionId: null, scienceActivityId: null,
    restingSince: null, foodUsedSinceRest: 0, energyUpdatedAt: new Date(0),
    createdAt: new Date(0) as unknown as Selectable<PopulationCohortsTable>['createdAt'],
    worldId: 'world', villageId: 'village', originVillageId: 'village', cartographer: false, restBuildingId: null };
}
it('does not assign workers eligible for a short shared lot to an unfinishable garden tour', () => {
  const people = [cohort('tired', 5, 3)];
  expect(workingTeam(people, 1, () => 8 * 60000).count).toBe(0);
  expect(workingTeam(people, 5, n => 600000 / n + 10000).count).toBe(5);
  expect(people[0]!.memberCount).toBe(5);
});
it('respects assignments, selected cohort, and the energy for the full return trip', () => {
  const people = [cohort('short', 4, 3), { ...cohort('busy', 10, 100), extractionId: 'lot' }];
  expect(workingTeam(people, 10, n => 600000 / n + 120000).count).toBe(0);
  people.push(cohort('fresh', 2, 20));
  expect(workingTeam(people, 10, () => 600000, 'short').count).toBe(0);
  expect(workingTeam(people, 10, () => 600000, 'fresh').count).toBe(2);
});
