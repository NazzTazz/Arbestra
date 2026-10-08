import {expect,it} from 'vitest';
import {generateGeographicLandscape,sampleWorldGeography} from './world-geography.js';
import {DEFAULT_GENERATOR_PARAMETERS as defaults} from './world-generator.js';
it('uses amplitude as both maximum height and depth in r8, preserving the zero water datum',()=>{
 const d=generateGeographicLandscape(42,128,64,{...defaults,amplitude:16},8);
 expect(d.metrics.maxElevation).toBeGreaterThan(14);
 expect(d.metrics.minElevation).toBeLessThan(-14);
 expect(d.metrics.maxElevation).toBeLessThanOrEqual(16.000001);
 expect(d.metrics.minElevation).toBeGreaterThanOrEqual(-16.000001);
 for(const [x,y]of [[0,0],[127.8,63.9],[-.1,13.5]]){
  const a=sampleWorldGeography(d.geography!,x!,y!),b=sampleWorldGeography(d.geography!,x!+128,y!-64);
  expect(a.elevation).toBeCloseTo(b.elevation,9);expect(a.surface).toBeCloseTo(b.surface,9);
 }
});
it('keeps ±8 explicit, supports fractional and zero bounds, and leaves r7 semantics intact',()=>{
 for(const amplitude of [0,8,8.8]){
  const d=generateGeographicLandscape(7,64,64,{...defaults,amplitude},8);
  expect(d.metrics.maxElevation).toBeLessThanOrEqual(amplitude+1e-8);
  expect(d.metrics.minElevation).toBeGreaterThanOrEqual(-amplitude-1e-8);
  if(amplitude===8){expect(d.metrics.maxElevation).toBeGreaterThan(7);expect(d.metrics.minElevation).toBeLessThan(-7);}
 }
 const old=generateGeographicLandscape(7,64,64,{...defaults,amplitude:16},7);
 expect(old.geography!.relief).toBeUndefined();expect(old.stoneSites).toBeUndefined();
 expect(old.metrics.amplitude).toBeLessThan(20);
});
