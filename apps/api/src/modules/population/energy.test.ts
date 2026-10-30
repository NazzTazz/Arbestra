import { describe, expect, it } from 'vitest';
import { advanceEnergy, beginRest, nextActivityChangeAt, type EnergyState } from './energy.js';

const at = new Date('2026-09-05T00:00:00.000Z');
const idle = (): EnergyState => ({
  energy: 10,
  progress: 0,
  activity: 'idle',
  restingSince: null,
  foodUsedSinceRest: 2,
  updatedAt: at,
});

describe('population energy', () => {
  it('reaches zero after 22 idle hours and begins resting', () => {
    expect(advanceEnergy(idle(), new Date(at.getTime() + 22 * 3_600_000))).toMatchObject({
      energy: 0,
      activity: 'resting',
    });
  });
  it('retains fractional work across sixty one-minute actions', () => {
    let state: EnergyState = { ...idle(), activity: 'working' };
    for (let minute = 1; minute <= 60; minute += 1)
      state = advanceEnergy(state, new Date(at.getTime() + minute * 60_000));
    expect(state.energy).toBe(9);
    expect(state.progress).toBe(0);
  });
  it('resets the food quota only after five continuous resting hours', () => {
    const resting: EnergyState = {
      energy: 0,
      progress: 0,
      activity: 'resting',
      restingSince: at,
      foodUsedSinceRest: 2,
      updatedAt: at,
    };
    expect(advanceEnergy(resting, new Date(at.getTime() + 4 * 3_600_000 + 59 * 60_000)).foodUsedSinceRest).toBe(2);
    expect(advanceEnergy(resting, new Date(at.getTime() + 5 * 3_600_000)).foodUsedSinceRest).toBe(0);
  });
  it('crosses repeated idle and automatic-rest cycles during a long absence', () => {
    const afterCycle = advanceEnergy(idle(), new Date(at.getTime() + 27 * 3_600_000));
    expect(afterCycle).toMatchObject({ energy: 10, progress: 0, activity: 'idle', foodUsedSinceRest: 0 });
    const afterTwoCycles = advanceEnergy(idle(), new Date(at.getTime() + 54 * 3_600_000));
    expect(afterTwoCycles).toMatchObject({ energy: 10, progress: 0, activity: 'idle' });
  });
  it('leaves a full-energy resident available and wakes a legacy full-energy rest immediately', () => {
    expect(beginRest(idle())).toBeNull();
    const resting: EnergyState = { ...idle(), activity: 'resting', restingSince: at, foodUsedSinceRest: 2 };
    expect(advanceEnergy(resting, at)).toMatchObject({ activity: 'idle', restingSince: null, foodUsedSinceRest: 2 });
  });
  it('wakes at full energy after a short rest without resetting food quota', () => {
    const resting = beginRest({ ...idle(), energy: 9 })!;
    expect(advanceEnergy(resting, new Date(at.getTime() + 1_800_000 - 1)).activity).toBe('resting');
    const awake = advanceEnergy(resting, new Date(at.getTime() + 1_800_000));
    expect(awake).toMatchObject({
      energy: 10,
      progress: 0,
      activity: 'idle',
      restingSince: null,
      foodUsedSinceRest: 2,
    });
    const later = new Date(at.getTime() + 5 * 3_600_000);
    expect(advanceEnergy(resting, later)).toEqual(advanceEnergy(awake, later));
    expect(advanceEnergy(resting, later).foodUsedSinceRest).toBe(2);
  });
  it('dates the next activity change at the exact millisecond advanceEnergy switches', () => {
    const UNITS = 79_200_000;
    // Deterministic pseudo-random states, including both boundaries.
    let seed = 7;
    const random = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % n) / 1;
    const states: EnergyState[] = [
      { ...idle(), energy: 0, progress: 0 },
      { ...idle(), activity: 'working', energy: 0, progress: 1 },
      { ...idle(), activity: 'resting', restingSince: at, energy: 9, progress: UNITS - 1 },
      { ...idle(), activity: 'resting', restingSince: at, energy: 0, progress: 0 },
    ];
    for (let i = 0; i < 300; i++) {
      const exact = random(10 * UNITS + 1);
      states.push({
        ...idle(),
        activity: (['idle', 'working', 'resting'] as const)[i % 3]!,
        restingSince: i % 3 === 2 ? new Date(at.getTime() - random(6 * 3_600_000)) : null,
        energy: Math.floor(exact / UNITS),
        progress: exact % UNITS,
      });
    }
    for (const state of states) {
      const change = nextActivityChangeAt(state);
      if (state.activity === 'resting' && state.energy === 10 && state.progress === 0) {
        expect(change).toEqual(at);
        continue;
      }
      expect(change.getTime()).toBeGreaterThan(at.getTime());
      expect(advanceEnergy(state, new Date(change.getTime() - 1)).activity).toBe(state.activity);
      expect(advanceEnergy(state, change).activity).not.toBe(state.activity);
    }
    // A full-energy rest not yet woken changes at its own cursor.
    expect(nextActivityChangeAt({ ...idle(), activity: 'resting', restingSince: at })).toEqual(at);
    // Exhaustion and full rest: 22 idle hours, 10 working hours, 5 resting hours.
    expect(nextActivityChangeAt(idle()).getTime() - at.getTime()).toBe(22 * 3_600_000);
    expect(nextActivityChangeAt({ ...idle(), activity: 'working' }).getTime() - at.getTime()).toBe(36_000_000);
    expect(
      nextActivityChangeAt({ ...idle(), activity: 'resting', restingSince: at, energy: 0 }).getTime() - at.getTime(),
    ).toBe(5 * 3_600_000);
  });
});
