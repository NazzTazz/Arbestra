export type PopulationActivity = 'idle' | 'working' | 'resting';

export interface EnergyState {
  energy: number;
/** Signed energy points retained at a scale divisible by every current rate. */
  progress: number;
  activity: PopulationActivity;
  restingSince: Date | null;
  foodUsedSinceRest: number;
  updatedAt: Date;
}

/** 22 idle hours are exactly ten points at millisecond precision. */
const UNITS = 79_200_000;
const RATE_PER_MILLISECOND: Record<PopulationActivity, number> = {
  idle: -10,
  working: -22,
  resting: 44,
};
const REST_RESET_MS = 5 * 60 * 60 * 1_000;

function clampEnergy(value: number) { return Math.max(0, Math.min(10, value)); }

/** Advances energy lazily. `progress` carries sub-point work across actions. */
export function advanceEnergy(state: EnergyState, through: Date): EnergyState {
  let remaining = Math.max(0, through.getTime() - state.updatedAt.getTime());
  let cursor = state.updatedAt.getTime();
  let exact = state.energy * UNITS + state.progress;
  let activity = state.activity;
  let restingSince = state.restingSince;
  let foodUsedSinceRest = state.foodUsedSinceRest;
  if (activity === 'resting' && exact === 10 * UNITS) {
    if (restingSince && cursor - restingSince.getTime() >= REST_RESET_MS) foodUsedSinceRest = 0;
    activity = 'idle';
    restingSince = null;
  }
  while (remaining > 0) {
    const rate = RATE_PER_MILLISECOND[activity];
    const boundary = rate < 0 ? 0 : 10 * UNITS;
    const distance = Math.abs(boundary - exact);
    const untilBoundary = Math.ceil(distance / Math.abs(rate));
    if (untilBoundary > remaining) {
      exact += rate * remaining;
      cursor += remaining;
      remaining = 0;
      break;
    }
    exact = boundary;
    cursor += untilBoundary;
    remaining -= untilBoundary;
    if (activity === 'idle' || activity === 'working') {
      activity = 'resting';
      restingSince = new Date(cursor);
      continue;
    }
    // Waking at full energy and qualifying for more food are separate rules.
    if (restingSince && cursor - restingSince.getTime() >= REST_RESET_MS) foodUsedSinceRest = 0;
    activity = 'idle';
    restingSince = null;
  }
  return {
    energy: clampEnergy(Math.floor(exact / UNITS)),
    progress: exact % UNITS,
    activity,
    restingSince,
    foodUsedSinceRest,
    updatedAt: new Date(cursor),
  };
}

export function canWorkFor(state: EnergyState, milliseconds: number): boolean {
  const exact = state.energy * UNITS + state.progress + RATE_PER_MILLISECOND.working * milliseconds;
  return exact >= 0;
}

/** The displayed bar only loses a point after the full point was spent. */
export function displayedEnergy(state: EnergyState): number {
  return (state.activity === 'idle' || state.activity === 'working') && state.progress > 0
    ? state.energy + 1
    : state.energy;
}

export function feedEnergy(state: EnergyState): EnergyState | null {
  if (state.foodUsedSinceRest >= 2) return null;
  const exact = Math.min(10 * UNITS, state.energy * UNITS + state.progress + UNITS);
  if (exact === state.energy * UNITS + state.progress) return null;
  return { ...state, energy: Math.floor(exact / UNITS), progress: exact % UNITS,
    foodUsedSinceRest: state.foodUsedSinceRest + 1 };
}

export function beginRest(state: EnergyState): EnergyState | null {
  if (state.activity !== 'idle' || state.energy * UNITS + state.progress >= 10 * UNITS) return null;
  return { ...state, activity: 'resting', restingSince: state.updatedAt };
}
