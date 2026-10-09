import { describe,expect,it } from 'vitest';
import { createWorldGeography,generateGeographicLandscape,sampleWorldGeography } from './world-geography.js';
import { DEFAULT_GENERATOR_PARAMETERS as p } from './world-generator.js';
describe('global independent geography',()=>{
 it('reproduces the complete descriptor and periodic queries after serialization',()=>{
  const a=createWorldGeography(42,128,64,p),b=createWorldGeography(42,128,64,{...p});expect(a).toEqual(b);
  for(let y=0;y<64;y+=.75)expect(Math.abs(sampleWorldGeography(a,-1e-6,y).elevation-sampleWorldGeography(a,1e-6,y).elevation)).toBeLessThan(1e-4);
  const copy=JSON.parse(JSON.stringify(a)) as typeof a;
  for(const [x,y]of [[0,0],[.125,63.75],[127.8,5.1],[32,32],[-1.25,78.5]]){
   const s=sampleWorldGeography(a,x!,y!);expect(sampleWorldGeography(copy,x!,y!)).toEqual(s);
   const t=sampleWorldGeography(a,x!+128,y!-64);expect(t.elevation).toBeCloseTo(s.elevation,11);expect(t.surface).toBeCloseTo(s.surface,11);
  }
 });
 it('drains without cycles and river profiles descend through shared confluences',()=>{
  const g=createWorldGeography(42,256,128,p,10);expect(g.rivers.length).toBeGreaterThan(0);expect(g.lakes.length).toBeGreaterThan(0);
  for(let i=0;i<g.parent.length;i++){let j=i,count=0;while(g.parent[j]!>=0){const next=g.parent[j]!;expect(g.filled[next]!).toBeLessThanOrEqual(g.filled[j]!);j=next;if(++count>g.parent.length)throw Error('drainage cycle');}}
  for(const river of g.rivers){for(let i=1;i<river.points.length;i++)expect(river.points[i]![2]).toBeLessThanOrEqual(river.points[i-1]![2]+1e-12);
   if(river.downstream!==null){const end=river.points.at(-1)!,start=g.rivers[river.downstream]!.points[0]!;expect(((end[0]-start[0])%g.width+g.width)%g.width).toBe(0);expect(end[2]).toBe(start[2]);}
  }
 });
 it('carves real beds, varies seeds and does not grant gameplay permissions',()=>{
  const d=generateGeographicLandscape(7,64,64,p),g=d.geography!;
  expect(g).not.toEqual(createWorldGeography(8,64,64,p));expect(d.walkable.every(v=>v===0)).toBe(true);
  expect(g.rivers.some(r=>r.points.some(([x,y])=>{const s=sampleWorldGeography(g,x,y);return s.depth>.1&&s.elevation<s.base-.05;}))).toBe(true);
  expect(d.elevations.every(Number.isInteger)).toBe(true);expect(d.metrics.waterPercent).toBeGreaterThan(0);
 });
 it('bounds zero/all sea cases and rejects invalid domains',()=>{
  for(const waterPercent of [0,100]){const g=createWorldGeography(1,64,64,{...p,waterPercent});expect(g.filled.every(Number.isFinite)).toBe(true);}
  expect(()=>createWorldGeography(1,65,64,p)).toThrow();
 });
});
