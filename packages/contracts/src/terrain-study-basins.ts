import type {WorldGeography} from './world-geography.js';
import {wrapClimate,periodicClimateNoise} from './world-climate.js';
export interface StudyBasins {
 bowls:{x:number;y:number;rx:number;ry:number;floor:number;inner?:number;shore?:number}[];
 path:[number,number][];radius:number;floor:number;outerBendWidening?:number;channels?:{path:[number,number][];radius:number}[];
}
type Segment={x:number;y:number;dx:number;dy:number;length2:number;radius:number;turnA:number;turnB:number};
const cache=new WeakMap<WorldGeography,Map<number,Segment[]>>();
const delta=(a:number,b:number,size:number)=>wrapClimate(a-b+size/2,size)-size/2;
/** Two Chaikin corner-cutting passes, preserving mouths and unwrapped seam crossings. */
function roundedPath(input:[number,number][]):[number,number][]{
 let points=input;
 for(let pass=0;pass<2&&points.length>1;pass++){
  const next:[number,number][]=[points[0]!];
  for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!;next.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);}
  next.push(points[points.length-1]!);points=next;
 }
 return points;
}
export function studyBasinPath(g:WorldGeography){return roundedPath(g.study?.basins?.path??[]);}
export function studyBasinPaths(g:WorldGeography){const b=g.study!.basins!;return [{path:roundedPath(b.path),radius:b.radius},...(b.channels??[]).map(c=>({path:roundedPath(c.path),radius:c.radius}))];}
function segments(g:WorldGeography){
 let bins=cache.get(g);if(bins)return bins;
 bins=new Map();const nx=Math.ceil(g.width/16),ny=Math.ceil(g.height/16);
 for(const {path,radius:r} of studyBasinPaths(g)){
 const turns=path.map((p,i)=>{
  if(i===0||i===path.length-1)return 0;
  const a=path[Math.max(0,i-2)]!,b=path[Math.min(path.length-1,i+2)]!,ux=p[0]-a[0],uy=p[1]-a[1],vx=b[0]-p[0],vy=b[1]-p[1];
  const angle=Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy),t=Math.min(1,Math.abs(angle)/.2);
  return Math.sign(angle)*t*t*(3-2*t);
 });
 const extent=r*(1+2*(g.study!.basins!.outerBendWidening??0))+4;
 for(let i=1;i<path.length;i++){
  const a=path[i-1]!,b=path[i]!,dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;if(!length2)continue;
  const segment={x:a[0],y:a[1],dx,dy,length2,radius:r,turnA:turns[i-1]!,turnB:turns[i]!},seen=new Set<number>();
  for(let y=Math.floor((Math.min(a[1],b[1])-extent)/16);y<=Math.floor((Math.max(a[1],b[1])+extent)/16);y++)
   for(let x=Math.floor((Math.min(a[0],b[0])-extent)/16);x<=Math.floor((Math.max(a[0],b[0])+extent)/16);x++){
    const key=wrapClimate(y,ny)*nx+wrapClimate(x,nx);if(seen.has(key))continue;seen.add(key);
    const bucket=bins.get(key)??[];bucket.push(segment);bins.set(key,bucket);
   }
 }
 }
 cache.set(g,bins);return bins;
}
function bowlRadius(g:WorldGeography,bowl:StudyBasins['bowls'][number],x:number,y:number){
 const radius=Math.hypot(delta(x,bowl.x,g.width)/bowl.rx,delta(y,bowl.y,g.height)/bowl.ry);
 const warp=bowl.shore?(periodicClimateNoise(x/g.width,y/g.height,8,g.seed+6803)-.5)*2*bowl.shore:0;
 return radius/(1+warp);
}
export function carveStudyBasins(g:WorldGeography,elevation:number,x:number,y:number):number{
 const b=g.study?.basins;if(!b)return elevation;
 for(const bowl of b.bowls){
  const r=bowlRadius(g,bowl,x,y);
  if(r>=1)continue;
  const inner=bowl.inner??.25,t=Math.max(0,(r-inner)/(1-inner)),weight=1-t*t*(3-2*t);
  elevation=Math.min(elevation,elevation+(bowl.floor-elevation)*weight);
 }
 let weight=0;
 const key=Math.floor(wrapClimate(y,g.height)/16)*Math.ceil(g.width/16)+Math.floor(wrapClimate(x,g.width)/16);
 for(const s of segments(g).get(key)??[]){
  const px=delta(x,s.x,g.width),py=delta(y,s.y,g.height),t=Math.max(0,Math.min(1,(px*s.dx+py*s.dy)/s.length2));
  const distance=Math.hypot(px-s.dx*t,py-s.dy*t);
  const turn=s.turnA+(s.turnB-s.turnA)*t,exterior=(s.dx*py-s.dy*px)*turn<0;
  // +60% of the full width, allocated entirely to the outside bank: r -> 2.2r.
  const radius=s.radius*(1+(exterior?2*(b.outerBendWidening??0)*Math.abs(turn):0));
  if(distance<radius)weight=Math.max(weight,Math.pow(1-(distance/radius)**2,2));
 }
 if(weight>0)elevation=Math.min(elevation,elevation+(b.floor-elevation)*weight);
 return elevation;
}

/** Keep the authored basins and channel banks intact while modifying surrounding plains. */
export function studyBasinClearance(g:WorldGeography,x:number,y:number):number{
 const b=g.study?.basins;if(!b)return Infinity;let clearance=Infinity;
 for(const bowl of b.bowls){const r=bowlRadius(g,bowl,x,y);clearance=Math.min(clearance,(r-1)*Math.min(bowl.rx,bowl.ry));}
 const key=Math.floor(wrapClimate(y,g.height)/16)*Math.ceil(g.width/16)+Math.floor(wrapClimate(x,g.width)/16);
 for(const s of segments(g).get(key)??[]){const px=delta(x,s.x,g.width),py=delta(y,s.y,g.height),t=Math.max(0,Math.min(1,(px*s.dx+py*s.dy)/s.length2));clearance=Math.min(clearance,Math.hypot(px-s.dx*t,py-s.dy*t)-s.radius*(1+2*(b.outerBendWidening??0)));}
 return clearance;
}
