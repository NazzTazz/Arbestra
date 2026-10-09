import type {WorldGeography,WorldGeoSample} from './world-geography.js';
import {sampleWorldGeography} from './world-geography.js';
import {climateHash,wrapClimate} from './world-climate.js';
import {forestDistanceSquared} from './world-forest.js';
import {generateWorldStoneSites,type WorldStoneSite,type WorldStoneRock} from './world-stone.js';
import {clearOfRamp} from './terrain-study-stone.js';
type Sample=(x:number,y:number)=>WorldGeoSample;
const STEP=2,CHUNK=32;
const delta=(a:number,b:number,size:number)=>wrapClimate(a-b+size/2,size)-size/2;
const scaleX=(g:WorldGeography,y:number)=>(2.4+Math.cos(y/g.height*Math.PI*2+Math.PI))*g.height/g.width;
/** Preview access approximation, not server pathfinding: dry gentle land, two-cell sampling. */
export function surveyChunkStone(g:WorldGeography,sample:Sample=(x,y)=>sampleWorldGeography(g,x,y)){
 const nx=g.width/STEP,ny=g.height/STEP,n=nx*ny,columns=g.width/CHUNK;
 const samples=Array.from({length:n},(_,i)=>sample((i%nx)*STEP+1,Math.floor(i/nx)*STEP+1));
 const regions=new Int32Array(n).fill(-1),eligible=samples.map(s=>s.elevation>.08&&(s.geology?.slope??0)<=.35);
 const index=(x:number,y:number)=>wrapClimate(y,ny)*nx+wrapClimate(x,nx);
 let regionCount=0;
 for(let i=0;i<n;i++)if(eligible[i]&&regions[i]===-1){
  const queue=[i];regions[i]=regionCount;
  for(let head=0;head<queue.length;head++){
   const a=queue[head]!,x=a%nx,y=Math.floor(a/nx);
   for(const b of [index(x-1,y),index(x+1,y),index(x,y-1),index(x,y+1)])
    if(eligible[b]&&regions[b]===-1&&Math.abs(samples[a]!.elevation-samples[b]!.elevation)<=.5){regions[b]=regionCount;queue.push(b);}
  }
  regionCount++;
 }
 const chunk=(x:number,y:number)=>Math.floor(wrapClimate(y,g.height)/CHUNK)*columns+Math.floor(wrapClimate(x,g.width)/CHUNK);
 const requirements=new Set<string>(),positions=new Map<string,{x:number;y:number}[]>();
 for(let i=0;i<n;i++)if(regions[i]!>=0){const x=i%nx*STEP+1,y=Math.floor(i/nx)*STEP+1,key=chunk(x,y)+':'+regions[i];requirements.add(key);const points=positions.get(key)??[];points.push({x,y});positions.set(key,points);}
 const access=(x:number,y:number,z:number)=>{
  const result=new Set<string>(),cx=Math.floor(wrapClimate(x,g.width)/STEP),cy=Math.floor(wrapClimate(y,g.height)/STEP),target=chunk(x,y);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const i=index(cx+dx,cy+dy),px=i%nx*STEP+1,py=Math.floor(i/nx)*STEP+1;
   if(regions[i]!>=0&&chunk(px,py)===target&&Math.abs(samples[i]!.elevation-z)<=.5)result.add(target+':'+regions[i]);
  }
  return result;
 };
 const geology=new Set<string>();
 for(let i=0;i<n;i++)if(samples[i]!.elevation>.08&&samples[i]!.rock>=.45)
  for(const key of access(i%nx*STEP+1,Math.floor(i/nx)*STEP+1,samples[i]!.elevation))geology.add(key);
 // Thin exposed ribs can fall between the two-cell samples. Inspect their dry edges before adding a block.
 for(let i=0;i<n;i++)if(regions[i]!>=0&&samples[i]!.rock>=.1){
  const x=i%nx*STEP+1,y=Math.floor(i/nx)*STEP+1,key=chunk(x,y)+':'+regions[i];
  if(geology.has(key))continue;
  refine:for(let dy=-2;dy<=2;dy+=.25)for(let dx=-2;dx<=2;dx+=.25){
   const px=x+dx,py=y+dy,s=sample(px,py);
   if(s.elevation>.08&&s.rock>=.45)for(const covered of access(px,py,s.elevation))geology.add(covered);
   if(geology.has(key))break refine;
  }
 }
 // Use the inner footprint, not bounding boxes: a boundary-crossing rock must actually occupy each side.
 const cachedCoverage=new WeakMap<WorldStoneSite,{rocks:WorldStoneRock[];keys:Set<string>}>();
 const coverage=(site:WorldStoneSite)=>{
  const cached=cachedCoverage.get(site);if(cached?.rocks===site.rocks)return cached.keys;
  const result=new Set<string>();
  for(const rock of site.rocks){
   const r=Math.min(rock.width,rock.depth)*.35,sx=scaleX(g,rock.y);
   for(let i=-1;i<12;i++){
    const x=wrapClimate(rock.x+(i<0?0:Math.cos(i*Math.PI/6)*r/sx),g.width),y=wrapClimate(rock.y+(i<0?0:Math.sin(i*Math.PI/6)*r),g.height),s=sample(x,y);
    if(s.elevation>.08)for(const key of access(x,y,s.elevation))result.add(key);
   }
  }
  cachedCoverage.set(site,{rocks:site.rocks,keys:result});return result;
 };
 return {requirements,geology,coverage,regionCount,sample,chunk,positions};
}
export function inspectChunkStoneCoverage(g:WorldGeography,sites:WorldStoneSite[],survey=surveyChunkStone(g)){
 const supplied=new Set(survey.geology),shared:{id:number;chunks:number[]}[]=[];
 for(const site of sites){const covered=survey.coverage(site);for(const key of covered)supplied.add(key);const chunks=[...new Set([...covered].map(k=>Number(k.split(':')[0])))];if(chunks.length>1)shared.push({id:site.id,chunks});}
 const unmet=[...survey.requirements].filter(k=>!supplied.has(k));
 return {policy:'chunk-geology-first-v1',chunkSize:CHUNK,sampleStep:STEP,eligibleChunks:new Set([...survey.requirements].map(k=>k.split(':')[0])).size,
  landComponents:survey.regionCount,requirements:survey.requirements.size,geologicalRequirements:survey.geology.size,uncovered:unmet.length,unmet,
  sites:sites.length,rocks:sites.reduce((sum,s)=>sum+s.rocks.length,0),shared};
}
export function generateChunkStoneCoverage(g:WorldGeography,templates?:WorldStoneSite[],sample:Sample=(x,y)=>sampleWorldGeography(g,x,y)){
 const survey=surveyChunkStone(g,sample),pool=templates??generateWorldStoneSites(g,sample);
 const valid=(r:WorldStoneRock)=>{
  if(!clearOfRamp(g,r.x,r.y))return false;
  const sx=scaleX(g,r.y);
  return [[0,0],[-r.width/sx,0],[r.width/sx,0],[0,-r.depth],[0,r.depth]].every(([dx,dy])=>sample(r.x+dx!,r.y+dy!).elevation>.08);
 };
 const candidates:WorldStoneSite[]=[];
 // Offset groups around chunk corners and edge middles. One group can serve 2 or 4 chunks.
 const anchor=(x:number,y:number,id:number)=>{
  if(!pool.length)return;
  const source=pool[id%pool.length]!,sx=scaleX(g,y),sourceScale=scaleX(g,source.y);
  const rocks=source.rocks.map(r=>{const px=wrapClimate(x+delta(r.x,source.x,g.width)*sourceScale/sx,g.width),py=wrapClimate(y+delta(r.y,source.y,g.height),g.height);
   return {...r,x:px,y:py,elevation:sample(px,py).elevation,height:r.height*.8};});
  if(rocks.length&&rocks.every(valid))candidates.push({id:candidates.length,x:wrapClimate(x,g.width),y:wrapClimate(y,g.height),rocks});
 };
 let id=0;
 for(let y=0;y<g.height;y+=CHUNK)for(let x=0;x<g.width;x+=CHUNK){
  for(const [dx,dy]of [[0,0],[0,16],[16,0],[16,16]])anchor(x+dx!,y+dy!,id++);
 }
 for(const site of pool)if(site.rocks.every(valid))candidates.push({...site,id:candidates.length});
 const entries=candidates.map(site=>({site,keys:survey.coverage(site),tie:climateHash(g.seed,site.id,0,8701)}));
 const missing=new Set([...survey.requirements].filter(k=>!survey.geology.has(k))),selected:WorldStoneSite[]=[];
 while(missing.size){
  let best:typeof entries[number]|undefined,bestCount=0;
  for(const entry of entries){const count=[...entry.keys].filter(k=>missing.has(k)).length;
   if(count>bestCount||(count===bestCount&&count>0&&entry.tie<(best?.tie??1))){best=entry;bestCount=count;}}
  if(!best){
   // A narrow bank or small island may not fit a full group. Add one compact block there.
   for(const key of missing){
    const points=[...(survey.positions.get(key)??[])].sort((a,b)=>climateHash(g.seed,a.x,a.y,8702)-climateHash(g.seed,b.x,b.y,8702));
    let fallback:WorldStoneSite|undefined;
    search:for(const size of [1.6,1,.6])for(const point of points)for(const dx of [0,.5,-.5,1,-1,1.5,-1.5])for(const dy of [0,.5,-.5,1,-1,1.5,-1.5]){
     const x=wrapClimate(point.x+dx,g.width),y=wrapClimate(point.y+dy,g.height),rock:WorldStoneRock={x,y,elevation:sample(x,y).elevation,width:size,depth:size*.875,height:Math.min(.85,size*.6),rotation:climateHash(g.seed,x,y,8703)*Math.PI,shade:.88};
     const candidate={id:candidates.length+selected.length,x,y,rocks:[rock]};
     if(valid(rock)&&survey.coverage(candidate).has(key)){fallback=candidate;break search;}
    }
    if(fallback){selected.push(fallback);for(const covered of survey.coverage(fallback))missing.delete(covered);}
   }
   break;
  }
  selected.push(best.site);for(const key of best.keys)missing.delete(key);
 }
 // Delete groups made redundant by later shared placements.
 for(let i=selected.length-1;i>=0;i--){const supplied=new Set(survey.geology);for(let j=0;j<selected.length;j++)if(i!==j)for(const key of survey.coverage(selected[j]!))supplied.add(key);
  if([...survey.requirements].every(k=>supplied.has(k)))selected.splice(i,1);
 }
 // A few short, dry links use the existing rock envelope renderer, without new isolated sites.
 let linkedPairs=0;
 const used=new Set<WorldStoneSite>();
 for(let i=0;i<selected.length&&linkedPairs<Math.floor(selected.length*.08);i++){
  const a=selected[i]!;if(used.has(a))continue;
  for(let j=i+1;j<selected.length;j++){
   const b=selected[j]!;if(used.has(b))continue;
   let pair:[WorldStoneRock,WorldStoneRock]|undefined,best=484;
   for(const ra of a.rocks)for(const rb of b.rocks){const d=forestDistanceSquared(ra.x,ra.y,rb.x,rb.y,g.width,g.height);if(d>4&&d<best){best=d;pair=[ra,rb];}}
   if(!pair)continue;
   const [ra,rb]=pair,steps=Math.ceil(Math.sqrt(best)/1.6),bridge:WorldStoneRock[]=[];
   for(let k=1;k<steps;k++){const t=k/steps,dx=delta(rb.x,ra.x,g.width),dy=delta(rb.y,ra.y,g.height),length=Math.hypot(dx,dy),bend=1.5*Math.sin(t*Math.PI),x=wrapClimate(ra.x+dx*t-dy/length*bend,g.width),y=wrapClimate(ra.y+dy*t+dx/length*bend,g.height);
    bridge.push({...ra,x,y,elevation:sample(x,y).elevation,width:2.4,depth:2.4,height:Math.min(ra.height,rb.height)*(.7+.15*Math.sin(t*Math.PI))});}
   if(!bridge.every(valid))continue;
   a.rocks=[...a.rocks,...bridge,...b.rocks];selected.splice(j,1);used.add(a);linkedPairs++;break;
  }
 }
 selected.forEach((s,i)=>{s.id=i;});
 return {sites:selected,report:{...inspectChunkStoneCoverage(g,selected,survey),linkedPairs}};
}
