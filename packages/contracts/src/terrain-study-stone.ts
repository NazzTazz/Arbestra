import type {WorldGeography,WorldGeoSample} from './world-geography.js';
import {sampleWorldGeography} from './world-geography.js';
import {climateHash,wrapClimate} from './world-climate.js';
import {forestDistanceSquared} from './world-forest.js';
import {generateWorldStoneSites,type WorldStoneSite} from './world-stone.js';
const RADIUS=24;
function survey(g:WorldGeography,sample:(x:number,y:number)=>WorldGeoSample){
 const targets:{x:number;y:number}[]=[],massifs:{x:number;y:number}[]=[];
 for(let y=2;y<g.height;y+=4)for(let x=2;x<g.width;x+=4){
  const s=sample(x,y);
  if(s.elevation>=1.25&&s.rock>=.5)massifs.push({x,y});
  if(s.elevation>=.125&&s.depth===0&&(s.geology?.slope??0)<=.18)targets.push({x,y});
 }
 const distance=(x:number,y:number,a:number,b:number)=>forestDistanceSquared(x,y,a,b,g.width,g.height);
 const poor=targets.filter(p=>!massifs.some(m=>distance(p.x,p.y,m.x,m.y)<=RADIUS*RADIUS));
 return {poor,massifs,distance};
}
export function clearOfRamp(g:WorldGeography,x:number,y:number){
 const original=g.study?.ramp;if(!original)return true;const scale=g.study?.layoutScale??1;
 const r={start:[original.start[0]*scale,original.start[1]*scale],end:[original.end[0]*scale,original.end[1]*scale],halfWidth:original.halfWidth*scale,shoulder:original.shoulder*scale};
 const delta=(a:number,b:number,size:number)=>wrapClimate(a-b+size/2,size)-size/2;
 const dx=delta(r.end[0]!,r.start[0]!,g.width),dy=delta(r.end[1]!,r.start[1]!,g.height),px=delta(x,r.start[0]!,g.width),py=delta(y,r.start[1]!,g.height);
 const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy)));
 return Math.hypot(px-dx*t,py-dy*t)>r.halfWidth+r.shoulder+3;
}
/** Distance coverage only: neither walking connectivity nor available economic stock. */
export function inspectStudyStoneCoverage(g:WorldGeography,sites:WorldStoneSite[]){
 const {poor,massifs,distance}=survey(g,(x,y)=>sampleWorldGeography(g,x,y));let uncovered=0,maxDistance=0;
 const rocks=sites.flatMap(s=>s.rocks);
 for(const p of poor){let d=Infinity;for(const rock of rocks)d=Math.min(d,distance(p.x,p.y,rock.x,rock.y));if(d>RADIUS*RADIUS)uncovered++;maxDistance=Math.max(maxDistance,Math.sqrt(d));}
 return {sampleStep:4,radius:RADIUS,eligiblePoorSamples:poor.length,massifSamples:massifs.length,uncovered,maxDistance:Number.isFinite(maxDistance)?maxDistance:null,sites:sites.length,rocks:rocks.length};
}
/** Reuse the existing rock-group generator, filling gaps away from major exposed massifs. */
export function generateStudyStoneCoverage(g:WorldGeography){
 const sample=(x:number,y:number)=>sampleWorldGeography(g,x,y),{poor,massifs,distance}=survey(g,sample),selected:WorldStoneSite[]=[];
 const targets=[...poor].sort((a,b)=>climateHash(g.seed,a.x,a.y,6031)-climateHash(g.seed,b.x,b.y,6031));
 const covered=(p:{x:number;y:number})=>selected.some(s=>s.rocks.some(r=>distance(p.x,p.y,r.x,r.y)<=RADIUS*RADIUS));
 for(let pass=0;pass<8&&targets.some(p=>!covered(p));pass++){
  const candidates=generateWorldStoneSites({...g,seed:g.seed+pass*104729},sample).filter(site=>
   !massifs.some(m=>distance(site.x,site.y,m.x,m.y)<20*20)&&site.rocks.every(r=>{
    if(!clearOfRamp(g,r.x,r.y))return false;
    const sx=(2.4+Math.cos(r.y/g.height*Math.PI*2+Math.PI))*g.height/g.width;
    return [[r.x,r.y],[r.x-r.width/sx,r.y],[r.x+r.width/sx,r.y],[r.x,r.y-r.depth],[r.x,r.y+r.depth]].every(([x,y])=>sample(x!,y!).elevation>.08);
   }));
  for(const target of targets){
   if(covered(target))continue;let best:WorldStoneSite|undefined,score=RADIUS*RADIUS;
   for(const site of candidates){if(selected.includes(site))continue;const d=Math.min(...site.rocks.map(r=>distance(target.x,target.y,r.x,r.y)));if(d<score){score=d;best=site;}}
   if(best){best.id=selected.length;selected.push(best);}
  }
 }
 return {sites:selected,report:inspectStudyStoneCoverage(g,selected)};
}
