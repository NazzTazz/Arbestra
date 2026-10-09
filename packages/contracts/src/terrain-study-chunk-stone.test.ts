import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {GeneratedLandscape} from './world-generator.js';
import {createTerrainStudy} from './terrain-study.js';
import {surveyChunkStone,inspectChunkStoneCoverage,generateChunkStoneCoverage} from './terrain-study-chunk-stone.js';
import type {WorldGeoSample} from './world-geography.js';
import type {WorldStoneSite} from './world-stone.js';
const world=()=>{const g=createTerrainStudy();g.width=64;g.height=64;delete g.study!.ramp;return g;};
const flat=(x:number,y:number):WorldGeoSample=>{void x;void y;return {base:1,elevation:1,surface:0,depth:0,rock:0};};
const group=(x:number,y:number):WorldStoneSite=>({id:0,x,y,rocks:[{x,y,elevation:1,width:4,depth:4,height:1,rotation:0,shade:1}]});
it('counts one real footprint for two or four chunks, also across the torus seam',()=>{
 const g=world(),survey=surveyChunkStone(g,flat);
 expect(inspectChunkStoneCoverage(g,[group(32,16)],survey).shared[0]!.chunks).toHaveLength(2);
 for(const site of [group(32,32),group(0,0)]){const report=inspectChunkStoneCoverage(g,[site],survey);expect(report.uncovered).toBe(0);expect(report.shared[0]!.chunks).toHaveLength(4);}
});
it('adds no stones where the geological surface already covers the land chunks',()=>{
 const g=world(),sample=(x:number,y:number)=>({...flat(x,y),rock:.8});
 const result=generateChunkStoneCoverage(g,[group(32,32)],sample);
 expect(result.sites).toHaveLength(0);expect(result.report.geologicalRequirements).toBe(4);expect(result.report.uncovered).toBe(0);
});
it('prefers a shared fallback instead of one group per chunk and is deterministic',()=>{
 const g=world(),result=generateChunkStoneCoverage(g,[group(32,32)],flat);
 expect(result.sites).toHaveLength(1);expect(result.report.uncovered).toBe(0);
 expect(generateChunkStoneCoverage(g,[group(32,32)],flat)).toEqual(result);
});
it('does not count underwater geology or geology across an inaccessible bank',()=>{
 const g=world(),sample=(x:number,y:number)=>{x=((x%64)+64)%64;const wet=x<4||(x>=28&&x<36);return {...flat(x,y),elevation:wet?-1:1,rock:x>=28&&x<36?.9:0};};
 const survey=surveyChunkStone(g,sample),report=inspectChunkStoneCoverage(g,[group(24,16)],survey);
 expect(report.geologicalRequirements).toBe(0);expect(report.landComponents).toBe(2);expect(report.uncovered).toBeGreaterThan(0);
 expect(report.shared).toHaveLength(0);
});
it('does not require deposits in an entirely submerged chunk',()=>{
 const g=world(),sample=(x:number,y:number)=>({...flat(x,y),elevation:-1,rock:.9});
 const report=inspectChunkStoneCoverage(g,[],surveyChunkStone(g,sample));expect(report.eligibleChunks).toBe(0);expect(report.uncovered).toBe(0);
});

it('uses a compact fallback when a small habitable island cannot fit a full massif',()=>{
 const g=world(),sample=(x:number,y:number)=>({...flat(x,y),elevation:x>10&&x<16&&y>10&&y<16?1:-1});
 const template=group(32,32);template.rocks[0]!.width=12;template.rocks[0]!.depth=12;
 const result=generateChunkStoneCoverage(g,[template],sample);
 expect(result.report.uncovered).toBe(0);expect(result.sites).toHaveLength(1);expect(result.sites[0]!.rocks).toHaveLength(1);
 expect(result.sites[0]!.rocks[0]!.width).toBeLessThan(2);
});
it('refreshes footprint coverage after two formations are joined',()=>{
 const g=world(),survey=surveyChunkStone(g,flat),site=group(32,16);
 expect(survey.coverage(site).size).toBe(2);site.rocks=[...site.rocks,...group(32,48).rocks];
 expect(survey.coverage(site).size).toBe(4);
});

it('recognizes thin geological ribs between coarse samples before adding a block',()=>{
 const g=world(),sample=(x:number,y:number)=>({...flat(x,y),rock:Math.hypot(x-14.5,y-14.5)<.4?.8:x>12&&x<18&&y>12&&y<18?.15:0});
 const report=inspectChunkStoneCoverage(g,[],surveyChunkStone(g,sample));
 expect(report.geologicalRequirements).toBe(1);expect(report.uncovered).toBe(3);
});

it('covers the actual alpha land chunks with much fewer supplemental formations',()=>{
 const data=JSON.parse(readFileSync(new URL('../../../apps/world-web/public/studies/t1-alpha512.json',import.meta.url),'utf8')) as GeneratedLandscape;
 const survey=surveyChunkStone(data.geography!),report=inspectChunkStoneCoverage(data.geography!,data.stoneSites!,survey);
 expect(report.eligibleChunks).toBe(111);expect(report.geologicalRequirements).toBeGreaterThan(0);
 expect(report.uncovered).toBe(0);expect(report.sites).toBeLessThan(64);
 expect(report.shared.some(s=>s.chunks.length===4)).toBe(true);
 expect(inspectChunkStoneCoverage(data.geography!,[],survey).uncovered).toBeGreaterThan(0);
});
