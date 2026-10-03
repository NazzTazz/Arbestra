import {pathLength,type WorkerPoint} from './worker-motion';
export interface IdleVisit {buildingId:string;path:WorkerPoint[]}
export interface IdleLeg {from:string;to:string;path:WorkerPoint[];walkMs:number;insideMs:number}
const same=(a:WorkerPoint,b:WorkerPoint)=>Math.hypot(a.x-b.x,a.z-b.z)<.01;
/** Each spoke starts at the town-hall doorway. Join at the common road/porch,
 * avoiding an artificial passage through the hall between two houses. */
export function idleTour(visits:IdleVisit[],key:string):IdleLeg[]{
  if(visits.length<2)return [];
  let hash=2166136261;for(const c of key)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  const offset=(hash>>>0)%visits.length,ordered=[...visits.slice(offset),...visits.slice(0,offset)],legs:IdleLeg[]=[];
  for(let i=0;i<ordered.length;i++){
    const a=ordered[i]!,b=ordered[(i+1)%ordered.length]!;let common=0;
    while(common<Math.min(a.path.length,b.path.length)&&same(a.path[common]!,b.path[common]!))common++;
    if(!common||common===1&&a.path.length>1&&b.path.length>1)return [];
    const path=[...a.path.slice(common-1).reverse(),...b.path.slice(common)];
    if(path.length<2)return [];
    legs.push({from:a.buildingId,to:b.buildingId,path,walkMs:Math.max(1000,pathLength(path)/.75*1000),insideMs:18000+((hash>>>0)+i*7919)%12000});
  }return legs;
}
export function idleTourPhase(legs:IdleLeg[],now:number,key:string){
  let seed=0;for(const c of key)seed=(seed*31+c.charCodeAt(0))>>>0;
  const period=legs.reduce((n,l)=>n+l.walkMs+l.insideMs,0);
  let elapsed=((now+seed)%period+period)%period;
  for(let i=0;i<legs.length;i++){
    const leg=legs[i]!,duration=leg.walkMs+leg.insideMs;
    if(elapsed<duration)return {leg:i,inside:elapsed>=leg.walkMs,progress:Math.min(1,elapsed/leg.walkMs),nextAt:now+duration-elapsed};
    elapsed-=duration;
  }throw new Error('Empty idle itinerary');
}
