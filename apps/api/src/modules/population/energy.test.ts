import { describe, expect, it } from 'vitest';
import { advanceEnergy, beginRest, type EnergyState } from './energy.js';

const at = new Date('2026-09-05T00:00:00.000Z');
const idle = (): EnergyState => ({ energy: 10, progress: 0, activity: 'idle', restingSince: null, foodUsedSinceRest: 2, updatedAt: at });

describe('population energy', () => {
  it('reaches zero after 22 idle hours and begins resting', () => {
    expect(advanceEnergy(idle(), new Date(at.getTime() + 22 * 3_600_000)))
      .toMatchObject({ energy: 0, activity: 'resting' });
  });
  it('retains fractional work across sixty one-minute actions', () => {
    let state: EnergyState = { ...idle(), activity: 'working' };
    for (let minute = 1; minute <= 60; minute += 1)
      state = advanceEnergy(state, new Date(at.getTime() + minute * 60_000));
    expect(state.energy).toBe(9);
    expect(state.progress).toBe(0);
  });
  it('resets the food quota only after five continuous resting hours', () => {
    const resting: EnergyState = { energy: 0, progress: 0, activity: 'resting', restingSince: at, foodUsedSinceRest: 2, updatedAt: at };
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
    expect(awake).toMatchObject({ energy: 10, progress: 0, activity: 'idle', restingSince: null, foodUsedSinceRest: 2 });
    const later = new Date(at.getTime() + 5 * 3_600_000);
    expect(advanceEnergy(resting, later)).toEqual(advanceEnergy(awake, later));
    expect(advanceEnergy(resting, later).foodUsedSinceRest).toBe(2);
  });
});
