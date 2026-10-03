import { expect, it } from 'vitest';
import { COSMOLOGY, TAU, combinedPeriod, illumination } from './cosmology';
import { SolarClock, SOLAR_CYCLE_MS, solarElapsed } from './solar-clock';

it('uses a twelve-hour solar clock and preserves the different second half of the combined cycle', () => {
  expect(combinedPeriod()).toBe(24 * 3600_000);
  expect(solarElapsed(COSMOLOGY.epochMs + SOLAR_CYCLE_MS - 1)).toBe(SOLAR_CYCLE_MS - 1);
  expect(solarElapsed(COSMOLOGY.epochMs + SOLAR_CYCLE_MS)).toBe(0);
  const clock = new SolarClock(0, 0);
  for (let minute = 0; minute < 1440; minute += 3) {
    const phase = minute / 1440 * TAU;
    const label = clock.label(COSMOLOGY.epochMs + minute * 60_000);
    if (!illumination(0, 0, phase).lit) expect(label).toBe('Nuit');
    else expect(label).toMatch(new RegExp(`${Math.floor((minute % 720) / 60)}:${String(minute % 60).padStart(2, '0')}$`));
  }
});

it('labels the temporal midpoint Midi only where illuminated', () => {
  for (const u of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const clock = new SolarClock(u, 0), time = COSMOLOGY.epochMs + 6 * 3600_000;
    expect(clock.label(time)).toBe(illumination(u, 0, TAU / 4).lit ? 'Midi 6:00' : 'Nuit');
  }
});
