import {studyBasinPaths} from './terrain-study-basins.js';
import {it,expect} from 'vitest';
import {createTerrainStudy,terrainStudyElevation} from './terrain-study.js';
import {sampleWorldGeography} from './world-geography.js';
it('keeps the plain and chain A intact and hollows dry even below zero',()=>{
 const g=createTerrainStudy();
 expect(sampleWorldGeography(g,80,10).elevation).toBe(.25);
 expect(sampleWorldGeography(g,70,45).elevation).toBeGreaterThan(2);
 for(const p of g.study!.hollows){const s=sampleWorldGeography(g,p.x,p.y);expect(s.elevation).toBeLessThan(0);expect(s.depth).toBe(0);}
 expect(g.rivers).toHaveLength(0);expect(g.lakes).toHaveLength(0);
});
it('keeps the same geography across the seams, serialization and query order',()=>{
 const g=createTerrainStudy(),copy=JSON.parse(JSON.stringify(g));
 for(const [x,y]of [[70,45],[171,81],[120,80],[-.1,128.1],[255.99,64]]){
  const a=sampleWorldGeography(g,x!,y!),b=sampleWorldGeography(copy,x!+256,y!-128);
  expect(a.elevation).toBeCloseTo(b.elevation,10);expect(a.depth).toBe(0);expect(a.rock).toBeCloseTo(b.rock,10);
 }
});

it('cuts narrow dry folds down to -6 units with raised strips between them',()=>{
 const g=createTerrainStudy();
 for(const p of g.study!.hollows){
  const {angle,spacing}=p.folds!,c=Math.cos(angle),sn=Math.sin(angle);
  const height=(u:number,v:number)=>sampleWorldGeography(g,p.x+u*c-v*sn,p.y+u*sn+v*c).elevation*4;
  expect(terrainStudyElevation(g,p.x,p.y)*4).toBeCloseTo(-6,8);
  expect(height(0,0)).toBeGreaterThan(-6.25);expect(height(0,0)).toBeLessThanOrEqual(-6);
  expect(height(0,spacing)).toBeLessThan(-3);
  expect(height(0,spacing/2)-height(0,0)).toBeGreaterThan(3);
  if(p.name==='Creux C')expect(height(-p.rx-1,0)).toBe(1); // west edge stays outside the widened E3 bend
 }
});

it('joins both dry basins with a continuous -4 channel across both torus seams',()=>{
 const g=createTerrainStudy();
 expect(terrainStudyElevation(g,5,80)*4).toBeCloseTo(-3,8);
 expect(terrainStudyElevation(g,20,19)*4).toBeCloseTo(-3,8);
 expect(terrainStudyElevation(g,183,83)).toBeGreaterThan(0); // former basin restored
 for(const {path} of studyBasinPaths(g))for(let i=1;i<path.length;i++)for(let k=0;k<=8;k++){
  const a=path[i-1]!,b=path[i]!,x=a[0]+(b[0]-a[0])*k/8,y=a[1]+(b[1]-a[1])*k/8;
  expect(terrainStudyElevation(g,x,y)*4).toBeLessThanOrEqual(-4+1e-8);
  const s=sampleWorldGeography(g,x,y);expect(s.depth).toBe(0);
  expect(sampleWorldGeography(g,x+256,y-128).elevation).toBeCloseTo(s.elevation,9);
 }
 for(const [x,y]of [[0,80],[168,128]] as const){
  const h=(a:number,b:number)=>terrainStudyElevation(g,a,b);
  expect(h(x-1e-5,y)).toBeCloseTo(h(x+1e-5,y),3);
  expect(h(x,y-1e-5)).toBeCloseTo(h(x,y+1e-5),3);
 }
});

it('widens only the outer bank of bends by 60% of the full width, independent of path direction',()=>{
 const g=createTerrainStudy();g.study!.chains=[];g.study!.hollows=[];
 g.study!.basins={bowls:[],path:[[10,10],[30,10],[30,30]],radius:2,floor:-1,outerBendWidening:.6};
 const original=structuredClone(g);original.study!.basins!.outerBendWidening=0;
 const reversed=structuredClone(g);reversed.study!.basins!.path.reverse();
 const h=(a:typeof g,x:number,y:number)=>terrainStudyElevation(a,x,y);
 const nx=Math.SQRT1_2,ny=-Math.SQRT1_2;
 expect(h(g,27.5+nx*4.3,12.5+ny*4.3)).toBeLessThan(.25);
 expect(h(g,27.5+nx*4.5,12.5+ny*4.5)).toBe(.25);
 expect(h(original,27.5+nx*3,12.5+ny*3)).toBe(.25);
 expect(h(g,27.5-nx*3,12.5-ny*3)).toBe(h(original,27.5-nx*3,12.5-ny*3));
 expect(h(g,12,7)).toBe(h(original,12,7));
 for(let d=-4;d<=4;d+=.5)expect(h(g,27.5+nx*d,12.5+ny*d)).toBeCloseTo(h(reversed,27.5+nx*d,12.5+ny*d),10);
});

it('extends the E3 massif with high plateaus capped at +12 and steeper flanks',()=>{
 const g=createTerrainStudy(),before=structuredClone(g);
 before.study!.chains[1]={name:'Chaîne B',points:[[151,91,0,5],[161,85,1.6,7],[171,81,2.7,8],[181,86,2.1,8],[190,92,1.2,7],[198,97,0,5]]};
 for(const [x,y]of [[155,89],[162,85],[171,81]] as const)expect(terrainStudyElevation(g,x,y)*4).toBeCloseTo(12,8);
 let high=0,oldHigh=0,maxSlope=0,oldSlope=0;
 for(let y=75;y<=100;y++)for(let x=148;x<=193;x++){
  const h=terrainStudyElevation(g,x,y),old=terrainStudyElevation(before,x,y);
  expect(h*4).toBeLessThanOrEqual(12+1e-8);
  if(h*4>10)high++;if(old*4>10)oldHigh++;
  maxSlope=Math.max(maxSlope,Math.abs(h-terrainStudyElevation(g,x,y+.25))/.25);
  oldSlope=Math.max(oldSlope,Math.abs(old-terrainStudyElevation(before,x,y+.25))/.25);
 }
 expect(high).toBeGreaterThan(oldHigh*3);expect(maxSlope).toBeGreaterThan(oldSlope*1.3);
 expect(terrainStudyElevation(g,70,45)).toBe(terrainStudyElevation(before,70,45));
});

it('connects F4 to the inner plateau through a broad continuous gentle rise',()=>{
 const g=createTerrainStudy(),before=structuredClone(g);delete before.study!.ramp;
 for(const x of [172,174,176]){
  let previous=sampleWorldGeography(g,x,112).elevation*4;
  expect(previous).toBeCloseTo(1,5);
  for(let y=111.75;y>=87;y-=.25){
   const s=sampleWorldGeography(g,x,y),height=s.elevation*4;
   expect(s.depth).toBe(0);expect(height-previous).toBeGreaterThanOrEqual(-.02);
   expect(Math.abs(height-previous)/.25).toBeLessThan(1);
   previous=height;
  }
  expect(previous).toBeCloseTo(12,5);
 }
 for(const [x,y]of [[155,89],[190,92],[0,80],[213,31],[70,45]] as const)
  expect(terrainStudyElevation(g,x,y)).toBe(terrainStudyElevation(before,x,y));
});
