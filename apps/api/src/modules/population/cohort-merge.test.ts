import { expect, it } from 'vitest';
import { mergeCohorts } from './work.js';

const at = new Date('2026-10-24T10:00:00Z');
type Cohort = Parameters<typeof mergeCohorts>[0][number];
const cohort = (id: string, overrides: object = {}): Cohort =>
  ({
    id,
    worldId: 'w',
    villageId: 'v',
    originVillageId: 'v',
    memberCount: 1,
    activity: 'idle' as const,
    energy: 7,
    energyProgress: 100,
    energyUpdatedAt: at,
    restingSince: null,
    foodUsedSinceRest: 0,
    harvestId: null,
    extractionId: null,
    scienceActivityId: null,
    processingLotId: null,
    levelingJobId: null,
    tradeJourneyId: null,
    cartographer: false,
    restBuildingId: null,
    pendingRelease: null,
    avoidWorksiteId: null,
    createdAt: new Date(at.getTime() - Number(id.slice(1)) * 1000),
    ...overrides,
  }) as unknown as Cohort;

it('merges idle unskilled inhabitants per energy point into the oldest cohort, conserving members', () => {
  const result = mergeCohorts([
    cohort('c1', { energyProgress: 0 }),
    cohort('c2', { energyProgress: 300, memberCount: 2 }),
    cohort('c3', { energy: 6 }),
    cohort('c4', { cartographer: true }),
    cohort('c5', { activity: 'working', extractionId: 'x' }),
    cohort('c6', { foodUsedSinceRest: 1 }),
    cohort('c7'),
  ]);
  // c7 is the oldest of {c1, c2, c7}: it survives with the weighted progress.
  expect(result.absorbed.sort()).toEqual(['c1', 'c2']);
  const survivor = result.cohorts.find((c) => c.id === 'c7')!;
  expect(survivor).toMatchObject({ memberCount: 4, energy: 7, energyProgress: Math.floor((0 + 600 + 100) / 4) });
  expect(result.cohorts.map((c) => c.id).sort()).toEqual(['c3', 'c4', 'c5', 'c6', 'c7']);
  expect(result.cohorts.reduce((n, c) => n + c.memberCount, 0)).toBe(8);
});

it('keeps a cohort named by a pending initial departure and cohorts on another clock apart', () => {
  const result = mergeCohorts(
    [cohort('c1'), cohort('c2'), cohort('c3', { energyUpdatedAt: new Date(at.getTime() + 1) })],
    new Set(['c1']),
  );
  expect(result.absorbed).toEqual([]);
  expect(result.cohorts).toHaveLength(3);
});
