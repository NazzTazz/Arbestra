import { climateHash, wrapClimate } from './world-climate.js';
import { forestDistanceSquared } from './world-forest.js';
import type { WorldGeography,WorldGeoSample } from './world-geography.js';
export interface WorldStoneRock {x:number;y:number;elevation:number;width:number;depth:number;height:number;rotation:number;shade:number;kind?:'block'|'talus';sourceX?:number;sourceY?:number;sourceElevation?:number}
/** Geological preview sites, not spendable deposits or occupancy permissions. */
export interface WorldStoneSite {id:number;x:number;y:number;rocks:WorldStoneRock[];kind?:'formation'}
export function generateWorldStoneSites(g:WorldGeography,sample:(x:number,y:number)=>WorldGeoSample):WorldStoneSite[]{
 const {width:w,height:h,seed}=g,sites:WorldStoneSite[]=[];
 const proposals=Math.ceil(h*h*2.4/64);
 for(let i=0;i<proposals;i++){
  const hash=(salt:number)=>climateHash(seed,i,salt,48539);
  const x=hash(1)*w,y=hash(2)*h,weight=2.4+Math.cos(y/h*Math.PI*2+Math.PI);
  if(hash(3)>weight/3.4)continue;
  const s=sample(x,y);
  if(s.depth>0||s.elevation-s.surface<.12||hash(4)>.12+s.rock*.65)continue;
  if(sites.some(t=>forestDistanceSquared(x,y,t.x,t.y,w,h)<100))continue;
  const rocks:WorldStoneRock[]=[];
  const sx=weight*h/w;
  for(let j=0;j<4+Math.floor(hash(5)*5);j++){
   const random=(salt:number)=>climateHash(seed,i,j*37+salt,77317);
   const angle=random(1)*Math.PI*2,radius=Math.sqrt(random(2))*3;
   const px=wrapClimate(x+Math.cos(angle)*radius/sx,w),py=wrapClimate(y+Math.sin(angle)*radius,h);
   const samples=[sample(px,py),sample(px-.7/sx,py),sample(px+.7/sx,py),sample(px,py-.7),sample(px,py+.7)];
   const low=Math.min(...samples.map(v=>v.elevation)),high=Math.max(...samples.map(v=>v.elevation));
   if(samples.some(v=>v.depth>0||v.elevation-v.surface<.06)||high-low>.7)continue;
   rocks.push({x:px,y:py,elevation:low,width:1.6+random(3)*1.8,depth:1.3+random(4)*1.7,
    height:.8+random(5)*1.2+(high-low),rotation:random(6)*Math.PI*2,shade:.78+random(7)*.3});
  }
  if(rocks.length>=3)sites.push({id:sites.length,x,y,rocks});
 }
 return sites;
}

/** Detached material is secondary to the continuous substrate exposed by the terrain.
 * Source coordinates record provenance; transport follows sampled downhill directions.
 */
export function generateGeologicalStoneSites(g:WorldGeography,sample:(x:number,y:number)=>WorldGeoSample):WorldStoneSite[]{
 const {width:w,height:h,seed}=g,sites:WorldStoneSite[]=[];
 for(let i=0;i<Math.ceil(h*h*2.4/36);i++){
  const hash=(salt:number)=>climateHash(seed,i,salt,99139),x=hash(1)*w,y=hash(2)*h;
  const source=sample(x,y),geo=source.geology;
  if(!geo||source.depth>0||geo.exposure<.6||geo.slope<.08||hash(3)>(2.4+Math.cos(y/h*Math.PI*2+Math.PI))/3.4)continue;
  if(sites.some(s=>forestDistanceSquared(x,y,s.x,s.y,w,h)<64))continue;
  const rocks:WorldStoneRock[]=[];
  for(let j=0;j<9;j++){
   const random=(salt:number)=>climateHash(seed,i,j*31+salt,71879);
   let px=x,py=y,previous=source;
   const distance=2+random(1)*7,spread=(random(2)-.5)*.8;
   for(let k=0;k<Math.ceil(distance);k++){
    const slope=previous.geology!,sx=(2.4+Math.cos(py/h*Math.PI*2+Math.PI))*h/w;
    const dx=slope.downhillX*Math.cos(spread)-slope.downhillY*Math.sin(spread),dy=slope.downhillX*Math.sin(spread)+slope.downhillY*Math.cos(spread);
    const nx=wrapClimate(px+dx/sx,w),ny=wrapClimate(py+dy,h),next=sample(nx,ny);
    if(next.depth>0||next.elevation-next.surface<.1||next.elevation>previous.elevation+.005)break;
    px=nx;py=ny;previous=next;if(next.geology!.slope<.04)break;
   }
   if(forestDistanceSquared(px,py,x,y,w,h)<1||previous.elevation>=source.elevation-.025)continue;
   const kind=j<2?'block':'talus',size=kind==='block'?.65+random(3)*.65:.18+random(3)*.42;
   if(rocks.some(r=>forestDistanceSquared(px,py,r.x,r.y,w,h)<Math.pow((r.width+size)*.4,2)))continue;
   rocks.push({x:px,y:py,elevation:previous.elevation,width:size,depth:size*(.6+random(4)*.4),height:size*(.45+random(5)*.3),
    rotation:Math.atan2(geo.downhillY,geo.downhillX)+(random(6)-.5),shade:.78+random(7)*.3,kind,sourceX:x,sourceY:y,sourceElevation:source.elevation});
  }
  sites.push({id:sites.length,x,y,kind:'formation',rocks});
 }
 const score=(s:WorldStoneSite)=>{const g=sample(s.x,s.y).geology!;return g.slope+g.ridge;};
 return sites.sort((a,b)=>score(b)-score(a)||a.id-b.id);
}
