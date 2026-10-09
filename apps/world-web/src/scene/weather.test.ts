import {createSolarCirculation} from '@arbestra/contracts';
import { describe, expect, it } from 'vitest';
import { groundWetness, weatherAt, weatherSeed } from './weather';

describe('shared visual weather', () => {
  const seed = weatherSeed('aube'), time = Date.UTC(2026, 9, 1, 15);
  it('wraps both torus seams and restores the same weather without view history', () => {
    const local = weatherAt(.23, .45, time, seed);
    const wrapped = weatherAt(1.23, -.55, time, seed);
    expect(wrapped.cloud).toBeCloseTo(local.cloud, 10);
    expect(wrapped.rain).toBeCloseTo(local.rain, 10);
    expect(groundWetness(.23, .45, time, seed)).toBeCloseTo(groundWetness(1.23, -.55, time, seed), 10);
    expect(weatherAt(.23, .45, time + 900_000, seed)).not.toEqual(local);
  });
  it('contains clearings, clouds and rain without leaving bounded intensities', () => {
    const samples = Array.from({ length: 256 }, (_, i) => weatherAt(i % 16 / 16, Math.floor(i / 16) / 16, time, seed));
    expect(samples.some(s => s.cloud < .2)).toBe(true);
    expect(samples.some(s => s.rain > .6)).toBe(true);
    for (const sample of samples) {
      expect(sample.rain).toBeGreaterThanOrEqual(0); expect(sample.rain).toBeLessThanOrEqual(1);
      expect(sample.cloud).toBeGreaterThanOrEqual(0); expect(sample.cloud).toBeLessThanOrEqual(1);
      if (sample.rain > 0) expect(sample.cloud).toBeGreaterThan(.68);
    }
  });
});

it('uses the saved solar circulation for r10 clouds, periodic in space and the complete cycle',()=>{
 const c=createSolarCirculation(),time=c.epochMs+c.periodMs*.71;
 const a=weatherAt(.23,.45,time,42,true,c),b=weatherAt(1.23,-.55,time+c.periodMs*c.torusTurns,42,true,JSON.parse(JSON.stringify(c)));
 expect(a.cloud).toBeCloseTo(b.cloud,9);expect(a.rain).toBeCloseTo(b.rain,9);
 expect(weatherAt(.23,.45,time+c.periodMs*.13,42,true,c)).not.toEqual(a);
 expect(weatherAt(.23,.45,time,42,true)).not.toEqual(a);
});
