import { describe, expect, it } from 'vitest';
import type { AdminJourneyEvent } from '@arbestra/contracts';
import { emptyJourneyFilter, filterJourney, journeyTypeLabel, sinceSessionStart } from './journey-data';

const event = (overrides: Partial<AdminJourneyEvent>): AdminJourneyEvent => ({
  id: crypto.randomUUID(),
  at: '2026-10-30T10:00:00.000Z',
  source: 'action',
  type: 'buildings',
  subject: null,
  outcome: 'accepted',
  code: null,
  attempts: 1,
  commandId: null,
  worldId: crypto.randomUUID(),
  villageId: crypto.randomUUID(),
  session: 1,
  ...overrides,
});

describe('player journey presentation', () => {
  const events = [
    event({ type: 'buildings' }),
    event({ outcome: 'rejected', code: 'NO_PLACE', session: 2 }),
    event({ outcome: 'interrupted', session: 2 }),
    event({ source: 'deferred', type: 'building.complete', outcome: 'completed', session: null }),
  ];
  it('filters by session, outside sessions, source, type and problems', () => {
    expect(filterJourney(events, emptyJourneyFilter)).toHaveLength(4);
    expect(filterJourney(events, { ...emptyJourneyFilter, session: '2' })).toHaveLength(2);
    expect(filterJourney(events, { ...emptyJourneyFilter, session: 'none' })).toEqual([events[3]]);
    expect(filterJourney(events, { ...emptyJourneyFilter, source: 'deferred' })).toEqual([events[3]]);
    expect(filterJourney(events, { ...emptyJourneyFilter, outcome: 'problems' })).toEqual([events[1], events[2]]);
    expect(filterJourney(events, { ...emptyJourneyFilter, type: 'building.complete' })).toEqual([events[3]]);
  });
  it('names known activities and keeps unknown types readable', () => {
    expect(journeyTypeLabel('population.gestures')).toBe('Geste de population');
    expect(journeyTypeLabel('future.kind')).toBe('future.kind');
  });
  it('shows the time elapsed since the session start', () => {
    const start = '2026-10-30T10:00:00.000Z';
    expect(sinceSessionStart('2026-10-30T10:00:42.000Z', start)).toBe('+42 s');
    expect(sinceSessionStart('2026-10-30T10:12:05.000Z', start)).toBe('+12 min 05 s');
    expect(sinceSessionStart('2026-10-30T11:03:00.000Z', start)).toBe('+1 h 03 min');
    expect(sinceSessionStart(start, undefined)).toBeNull();
  });
});
