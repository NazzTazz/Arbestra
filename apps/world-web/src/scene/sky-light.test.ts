import { expect, it } from 'vitest';
import { easeIncidence, skyLight } from './sky-light';

it('keeps full day exactly as it was', () => {
  for (const [incidence, cloud] of [
    // Low-sun villages peak around 0.2: their day must stay a full day.
    [0.1, 0],
    [0.3, 0],
    [0.8, 0.5],
    [1, 1],
  ] as const) {
    const light = skyLight(incidence, cloud);
    expect(light.sun).toBe(0.85);
    expect(light.sunColor).toEqual([1, 0.82, 0.58]);
    expect(light.ambient).toBeCloseTo(0.34 + incidence * 0.24 * (1 - cloud * 0.4), 10);
    expect(light.ambientColor.map((c) => +c.toFixed(6))).toEqual([0.92, 0.94, 0.79]);
    expect(light.sky.map((c) => Math.round(c * 255))).toEqual([0x8e, 0xa0, 0xa0]);
  }
});

it('gives a blue, readable night', () => {
  const night = skyLight(-0.6, 0);
  expect(night.sun).toBe(0);
  const [r, g, b] = night.ambientColor;
  expect(b).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(r);
  // Brighter than the former night (0.34 × a near-white sky light).
  expect(night.ambient * (r + g + b)).toBeGreaterThan(0.34 * (0.92 + 0.94 + 0.79) * 1.3);
  expect(night.sky[2]).toBeGreaterThan(night.sky[0]);
});

it('turns warm around the horizon, at dawn as at dusk, without any jump', () => {
  const horizon = skyLight(-0.02, 0),
    day = skyLight(0.5, 0),
    night = skyLight(-0.5, 0);
  // The sun reddens: less green and blue relative to red.
  expect(horizon.sunColor[2]).toBeLessThan(day.sunColor[2] - 0.2);
  expect(horizon.sky[0]).toBeGreaterThan(Math.max(day.sky[0], night.sky[0]));
  // Steps of 0.001 incidence, several real seconds each: no visible jump.
  let previous = skyLight(-1, 0);
  for (let i = -999; i <= 1000; i++) {
    const next = skyLight(i / 1000, 0);
    for (const key of ['sunColor', 'ambientColor', 'groundColor', 'sky'] as const)
      for (let c = 0; c < 3; c++) expect(Math.abs(next[key][c]! - previous[key][c]!)).toBeLessThan(0.02);
    expect(Math.abs(next.sun - previous.sun)).toBeLessThan(0.03);
    expect(Math.abs(next.ambient - previous.ambient)).toBeLessThan(0.02);
    previous = next;
  }
});

it('fades a hidden sun over a few seconds instead of one step', () => {
  let incidence = 0.6;
  incidence = easeIncidence(incidence, -0.3, 200);
  expect(incidence).toBeGreaterThan(0.5);
  for (let t = 0; t < 30000; t += 200) incidence = easeIncidence(incidence, -0.3, 200);
  expect(incidence).toBeCloseTo(-0.3, 2);
});
