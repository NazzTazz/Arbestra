import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTerrainStudy,createTerrainStudyVariation} from './terrain-study.js';
import {studyPlateauHeight} from './terrain-study-plateaus.js';
import {sampleWorldGeography,sampleWorldTopography} from './world-geography.js';
import {inspectStudyStoneCoverage} from './terrain-study-stone.js';
import type {GeneratedLandscape} from './world-generator.js';
const read=(name:string)=>readFileSync(new URL('../../../apps/world-web/public/studies/'+name,import.meta.url));
it('keeps the saved base immutable and its trees on the original surface',()=>{
 const bytes=read('t1-base.json'),base=JSON.parse(bytes.toString()) as GeneratedLandscape;
 expect(createHash('sha256').update(bytes).digest('hex')).toBe('02b9b3b749a45797524c35bd824d891889cc69e2fcd12cd90eda3cd616fb3493');
 expect(base.geography!.study!.plateaus).toBeUndefined();
 for(const tree of base.forest!.trees)expect(sampleWorldGeography(base.geography!,tree.x,tree.y).elevation).toBeCloseTo(tree.elevation,10);
});
it('creates flat irregular height regions with periodic continuous joins and preserves authored features',()=>{
 const g=createTerrainStudyVariation(),base=createTerrainStudy();let flat=0;const levels=new Set<string>();
 for(let y=4;y<128;y+=8)for(let x=4;x<256;x+=8){
  const z=studyPlateauHeight(g,x,y);expect(z).toBeGreaterThanOrEqual(.125-1e-10);expect(z).toBeLessThanOrEqual(.75+1e-10);
  expect(studyPlateauHeight(g,x+256,y-128)).toBeCloseTo(z,9);
  if(Math.abs(z-studyPlateauHeight(g,x+.1,y+.1))<1e-10){flat++;levels.add(z.toFixed(3));}
 }
 expect(flat).toBeGreaterThan(128);expect(levels.size).toBeGreaterThanOrEqual(4);
 for(const [x,y]of [[0,80],[16,16],[155,89],[174,100],[213,31]] as const)
  expect(sampleWorldGeography(g,x,y).elevation).toBeCloseTo(sampleWorldGeography(base,x,y).elevation,10);
 for(const [x,y]of [[0,54],[90,0],[256,128]] as const){
  expect(studyPlateauHeight(g,x-1e-5,y)).toBeCloseTo(studyPlateauHeight(g,x+1e-5,y),4);
  expect(studyPlateauHeight(g,x,y-1e-5)).toBeCloseTo(studyPlateauHeight(g,x,y+1e-5),4);
 }
});
it('covers sampled gentle land away from massifs with saved stone groups, without granting resources',()=>{
 const data=JSON.parse(read('t1.json').toString()) as GeneratedLandscape;
 expect(data.geography!.study!.plateaus).toBeDefined();expect(data.stoneSites!.length).toBeGreaterThan(0);
 const report=inspectStudyStoneCoverage(data.geography!,data.stoneSites!);
 expect(report.uncovered).toBe(0);expect(report.maxDistance).toBeLessThanOrEqual(24);
 expect(inspectStudyStoneCoverage(data.geography!,[]).uncovered).toBeGreaterThan(0);
 for(const site of data.stoneSites!)for(const rock of site.rocks){expect(rock.elevation).toBeGreaterThan(0);expect(rock.height).toBeGreaterThan(0);}
 expect(data.walkable.every(v=>v===0)).toBe(true);
});

it('extends the western basin through H/A/B/C sectors and connects it to A1 without changing the saved base',()=>{
 const g=createTerrainStudyVariation(),base=createTerrainStudy();
 for(const [x,y]of [[240,80],[16,80],[48,80],[80,80],[240,48],[16,48],[48,48],[84,46]] as const)
  expect(sampleWorldGeography(g,x,y).elevation).toBeLessThan(sampleWorldGeography(base,x,y).elevation);
 for(let y=16;y<=80;y+=2)expect(sampleWorldGeography(g,16,y).elevation).toBeLessThan(0);
 expect(sampleWorldGeography(g,70,45).elevation).toBeGreaterThan(0);
});

it('doubles the authored horizontal layout while preserving heights and periodicity',()=>{
 const base=createTerrainStudyVariation(),large={...base,width:512,height:256,study:{...base.study!,layoutScale:2}};
 for(const [x,y]of [[0,80],[16,16],[70,45],[155,89],[174,100],[213,31],[80,10]]){
  const z=sampleWorldTopography(base,x!,y!).elevation;
  expect(sampleWorldTopography(large,x!*2,y!*2).elevation).toBe(z);
  expect(sampleWorldTopography(large,x!*2+512,y!*2-256).elevation).toBeCloseTo(z,10);
 }
});
