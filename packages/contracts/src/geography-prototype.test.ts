import { describe, expect, it } from 'vitest';
import { createGeographyFixture, DEFAULT_GEOGRAPHY, sampleGeography, projectGeographyCell, waterProfile, type GeoPoint } from './geography-prototype.js';

describe('independent prototype geography',()=>{
  it('is reproducible, serializable and seed sensitive',()=>{
    const a=createGeographyFixture(DEFAULT_GEOGRAPHY),b=createGeographyFixture({...DEFAULT_GEOGRAPHY});
    expect(a).toEqual(b);expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(createGeographyFixture({...DEFAULT_GEOGRAPHY,seed:43}).water).not.toEqual(a.water);
  });
  it('queries fractional positions periodically on both torus seams',()=>{
    const d=createGeographyFixture(DEFAULT_GEOGRAPHY);
    for(const [x,y] of [[-.125,15.5],[.125,15.5],[20.125,-.125],[20.125,.125],[32.125,21.375]] as GeoPoint[]){
      const s=sampleGeography(d,x,y);
      expect(sampleGeography(d,x+128,y+64)).toEqual(s);
      expect(sampleGeography(d,x-128,y-64)).toEqual(s);
    }
  });
  it('carves a connected wet bed and retains downstream height continuity',()=>{
    const d=createGeographyFixture(DEFAULT_GEOGRAPHY);
    for(const reach of d.reaches){
      let previous=Infinity;
      for(const p of reach.axis){
        const s=sampleGeography(d,...p);
        expect(s.waterLevel).not.toBeNull();expect(s.depth).toBeGreaterThan(.014);
        expect(s.elevation).toBeLessThan(s.waterLevel!);
        expect(s.waterLevel!).toBeLessThanOrEqual(previous+1e-8);previous=s.waterLevel!;
      }
    }
    const mouth=d.reaches[1]!.axis.at(-1)!;
    expect(sampleGeography(d,...mouth).waterLevel).toBeCloseTo(waterProfile(mouth[0]),10);
    expect(d.water).toHaveLength(1);
    const river=d.reaches[0]!.axis[55]!;
    expect(sampleGeography(d,...river).elevation).toBeLessThan(sampleGeography(d,...river).uncarvedElevation);
  });
  it('keeps actual flat installation areas and a continuous rising passage',()=>{
    const d=createGeographyFixture(DEFAULT_GEOGRAPHY);
    expect(sampleGeography(d,10,27).elevation).toBeCloseTo(sampleGeography(d,11,28).elevation,8);
    expect(sampleGeography(d,42,27).elevation).toBeCloseTo(sampleGeography(d,43,28).elevation,8);
    const heights=Array.from({length:101},(_,i)=>sampleGeography(d,14+i*.25,28).elevation);
    for(let i=1;i<heights.length;i++)expect(Math.abs(heights[i]!-heights[i-1]!)).toBeLessThan(.1);
    expect(heights.at(-1)!).toBeGreaterThan(heights[0]!);
  });
  it('projects partial flooding without assigning a gameplay authorization',()=>{
    const d=createGeographyFixture(DEFAULT_GEOGRAPHY);
    const bank=d.water[0]![0]![20]!,x=Math.floor(bank[0]),y=Math.floor(bank[1]);
    const facts=projectGeographyCell(d,x,y);
    expect(facts.wetFraction).toBeGreaterThan(0);expect(facts.wetFraction).toBeLessThan(1);
    expect(facts).not.toHaveProperty('walkable');expect(facts).not.toHaveProperty('buildable');
    expect(projectGeographyCell(d,x+128,y+64)).toEqual(facts);
  });
  it('rejects invalid parameters before generating',()=>{
    expect(()=>createGeographyFixture({...DEFAULT_GEOGRAPHY,riverWidth:NaN})).toThrow('Invalid');
    expect(()=>createGeographyFixture({...DEFAULT_GEOGRAPHY,seed:Infinity})).toThrow('Invalid');
  });
});
