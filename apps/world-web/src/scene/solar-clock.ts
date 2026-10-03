import { COSMOLOGY, TAU, combinedPeriod, cyclePhase, illumination, measureRegime, type DayRegime } from './cosmology';

export const SOLAR_CYCLE_MS = 12 * 60 * 60 * 1000;
const ordinal = (n: number) => n === 1 ? '1er' : n === 2 ? '2nd' : `${n}e`;

/** One regional graph over the combined day, not one graph repeated every solar eight. */
export class SolarClock {
  readonly regime: DayRegime;
  constructor(readonly u: number, readonly v: number) { this.regime = measureRegime(u, v, undefined, 2048); }
  label(serverMs: number, phase = cyclePhase(serverMs)): string {
    if (!illumination(this.u, this.v, phase).lit) return 'Nuit';
    const fraction = ((phase / TAU % 1) + 1) % 1;
    const solarFraction = (fraction * COSMOLOGY.solarTurns) % 1;
    const elapsed = solarFraction * SOLAR_CYCLE_MS;
    const minute = Math.floor(elapsed / 60_000 + 1e-7);
    const time = `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
    // A five-minute reading window, centered on the product's temporal midpoint.
    if (Math.abs(elapsed - SOLAR_CYCLE_MS / 2) <= 150_000) return `Midi ${time}`;
    const windowStart = Math.floor(fraction * 2) / 2;
    const passages = this.regime.intervals.flatMap(([a, b]) => [[a - 1, b - 1], [a, b]] as Array<[number, number]>)
      .filter(([a, b]) => b > windowStart && a < windowStart + .5).sort((a, b) => a[0] - b[0]);
    const index = passages.findIndex(([a, b]) => fraction >= a && fraction < b);
    const passage = passages[index];
    if (!passage) return `Jour ${time}`;
    const progress = (fraction - passage[0]) / (passage[1] - passage[0]);
    const moment = progress >= .75 ? 'crépuscule' : progress < .4 ? 'matin' : 'jour';
    return `${ordinal(index + 1)} ${moment} ${time}`;
  }
}

export function solarElapsed(serverMs: number): number {
  return ((serverMs - COSMOLOGY.epochMs) % SOLAR_CYCLE_MS + SOLAR_CYCLE_MS) % SOLAR_CYCLE_MS;
}
export const PRODUCTION_COMBINED_MS = combinedPeriod();
