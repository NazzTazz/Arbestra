import type { GeneratedLandscape } from './world-generator.js';
import type { Hydrology, WaterReach } from './world-hydrology.js';
import { climateHash } from './world-climate.js';
import { landscapeNeighbors } from './world-landscape.js';

type Section={cells:number[];surface:number;start:number;width:number;step:number};
type Node=Section&{parent:Node|null;cost:number;velocity:number;age:number;min:number;max:number};
type Route={sections:Section[];cap:number[];mouth:number[];score:number};

/** r5: bounded terrain-aware beam routing. Slowly varying guides establish broad bends;
 * complete wet cross-sections, rather than noisy banks, are routed around dry obstacles.
 * Progress toward the source is monotonic on one unwrapped axis, preventing drainage loops.
 */
export function carveMeanderingRivers(data:GeneratedLandscape,hydro:Hydrology,protectedCells:Uint8Array,
 carve:(beds:Map<number,number>)=>boolean){
 const w=data.width,h=data.height,n=w*h,index=(x:number,y:number)=>((y%h+h)%h)*w+(x%w+w)%w;
 const adj=(i:number)=>landscapeNeighbors(i,w,h),routes:Route[]=[];
 for(let anchor=0;anchor<n;anchor++){
  if(data.terrainCodes[anchor]!==2||!adj(anchor).some(i=>data.terrainCodes[i]===1))continue;
  // Distribute mouth candidates without an axis-aligned sampling grid.
  if(climateHash(data.seed,anchor%w,Math.floor(anchor/w),601)>.3)continue;
  const initialWidth=6+Math.floor(climateHash(data.seed,anchor%w,Math.floor(anchor/w),603)*3);
  const phase=climateHash(data.seed,anchor%w,Math.floor(anchor/w),607)*Math.PI*2;
  for(const [dx,dy]of [[1,0],[0,1],[-1,0],[0,-1]] as const){
   const cell=(step:number,lane:number)=>index(anchor%w+dx*step+(dy?lane:0),Math.floor(anchor/w)+dy*step+(dx?lane:0));
   const section=(step:number,start:number,width:number)=>Array.from({length:width},(_,i)=>cell(step,start+i));
   const mouth=section(0,0,initialWidth);
   if(!mouth.every(i=>data.terrainCodes[i]===2))continue;
   let beam:Node[]=[{cells:mouth,surface:0,start:0,width:initialWidth,step:0,parent:null,cost:0,velocity:0,age:0,min:0,max:0}];
   let best:Route|undefined;
   const limit=Math.min(96,Math.floor((dx?w:h)*.4));
   for(let step=1;step<=limit&&beam.length;step++){
    const desired=7*(Math.sin(step/13+phase)-Math.sin(phase))+2*(Math.sin(step/29+phase*2)-Math.sin(phase*2));
    const desiredWidth=Math.max(6,Math.min(8,Math.round(7+1.2*Math.sin(step/17+phase))));
    const states=new Map<string,Node>();
    for(const previous of beam)for(const shift of [-1,0,1])for(const width of new Set([previous.width,Math.max(5,previous.width-1),Math.min(8,previous.width+1)])){
     if(step===1&&(shift!==0||width!==initialWidth)||Math.abs(width-previous.width)>1)continue;
     const start=previous.start+shift;
     const overlap=Math.min(start+width,previous.start+previous.width)-Math.max(start,previous.start);
     if(overlap<5)continue;
     const cells=section(step,start,width);
     if(cells.some(i=>data.terrainCodes[i]!==1||protectedCells[i]))continue;
     const surface=Math.min(...cells.map(i=>data.elevations[i]!-1));
     const drop=surface-previous.surface;
     if(drop<0||drop>2)continue;
     // Keep the entire lip fed; bends and width changes belong on the adjoining flats.
     if((drop>0||previous.age<2)&&(shift!==0||width!==previous.width))continue;
     const banks=[cell(step,start-1),cell(step,start+width)];
     if(banks.some(i=>data.terrainCodes[i]===2?surface!==0:data.elevations[i]!<surface+.25))continue;
     const center=start+(width-initialWidth)/2,velocity=center-(previous.start+(previous.width-initialWidth)/2);
     const excavation=cells.reduce((sum,i)=>sum+data.elevations[i]!-surface-1,0)/width;
     if(Math.abs(velocity)>1||Math.abs(velocity-previous.velocity)>1||Math.min(width,previous.width)/Math.hypot(1,velocity)<5)continue;
     const cost=previous.cost+.18*(center-desired)**2+.8*(velocity-previous.velocity)**2+.3*(width-desiredWidth)**2+.2*excavation;
     const node:Node={cells,surface,start,width,step,parent:previous,cost,velocity,age:drop?0:previous.age+1,
      min:Math.min(previous.min,center),max:Math.max(previous.max,center)};
     const key=start+':'+width,old=states.get(key);if(!old||cost<old.cost)states.set(key,node);
    }
    beam=[...states.values()].sort((a,b)=>a.cost-b.cost||a.start-b.start||a.width-b.width).slice(0,6);
    for(const end of beam){
     if(step<14||end.surface<1||end.max-end.min<3||end.age<3)continue;
     // Rounded spring head, wider than a single-cell source, no rectangular dead end.
     const cap:number[]=[],radius=end.width/2;
     for(let t=1;t<=Math.ceil(radius);t++){
      const width=Math.max(1,Math.round(2*Math.sqrt(Math.max(0,radius*radius-(t-.5)**2))));
      const start=end.start+Math.floor((end.width-width)/2);
      cap.push(...section(step+t,start,width));
     }
     if(cap.some(i=>data.terrainCodes[i]!==1||protectedCells[i]||data.elevations[i]!<end.surface+1))continue;
     const score=end.surface*8+step*.3+(end.max-end.min)*.6-end.cost/step*.12+data.humidity[end.cells[0]!]!;
     if(best&&score<=best.score)continue;
     const sections:Section[]=[];for(let node:Node|null=end;node?.parent;node=node.parent)sections.push(node);
     sections.reverse();
     const first=sections[0]!,a=first.start+(first.width-initialWidth)/2,b=end.start+(end.width-initialWidth)/2;
     const length=end.step-first.step,delta=b-a;
     const deviation=Math.max(...sections.map(s=>Math.abs(length*(s.start+(s.width-initialWidth)/2-a)-delta*(s.step-first.step))/Math.hypot(length,delta)));
     if(deviation<1.5)continue;
     best={sections,cap,mouth,score};
    }
   }
   if(best)routes.push(best);
  }
 }
 routes.sort((a,b)=>b.score-a.score||a.mouth[0]!-b.mouth[0]!);
 const sources:number[]=[],next=new Map<number,number>(),attempted:number[]=[];
 const periodic=(a:number,b:number,size:number)=>Math.min(Math.abs(a-b),size-Math.abs(a-b));
 const maxSources=Math.max(2,Math.min(16,Math.floor(n/8192)));
 for(const route of routes){
  if(sources.length>=maxSources||attempted.length>=96)break;
  const end=route.sections.at(-1)!,source=end.cells[0]!;
  if(attempted.some(i=>periodic(i%w,source%w,w)+periodic(Math.floor(i/w),Math.floor(source/w),h)<8))continue;
  attempted.push(source);
  const beds=new Map<number,number>();for(const s of route.sections)for(const i of s.cells)beds.set(i,s.surface-1);
  for(const i of route.cap)beds.set(i,end.surface-1);
  if([...beds].some(([i,bed])=>hydro.reachByCell[i]!==-1||adj(i).some(j=>!beds.has(j)&&hydro.surface[j]!==null&&hydro.surface[j]!==bed+1&&!(route.sections[0]!.cells.includes(i)&&route.mouth.includes(j))))||!carve(beds)){
   hydro.metrics.rejectedRivers++;continue;
  }
  let previous=route.mouth;
  for(let k=0;k<route.sections.length;k++){
   const s=route.sections[k]!,id=hydro.reaches.length,downstream=hydro.reachByCell[previous[0]!]!,receiver=hydro.reaches[downstream]!;
   const flowTo=s.cells.map((i,lane)=>{
    const direct=adj(i).find(j=>previous.includes(j));if(direct!==undefined)return direct;
    // The one-cell shoulder of a bend drains inward before joining the downstream section.
    const neighbor=lane===0?s.cells[1]!:s.cells[lane-1]!;return neighbor;
   });
   const reach:WaterReach={id,kind:k===route.sections.length-1?'lake':'river',cells:[...s.cells],surface:s.surface,
    bedMin:s.surface-1,width:s.width,downstream,upstream:[],anchor:s.cells[0]!,flowTo};
   hydro.reaches.push(reach);receiver.upstream.push(id);
   for(let lane=0;lane<s.width;lane++){
    const i=s.cells[lane]!;hydro.reachByCell[i]=id;hydro.surface[i]=s.surface;hydro.highWater[i]=s.surface;next.set(i,flowTo[lane]!);
   }
   const drop=s.surface-receiver.surface;
   if(drop===1||drop===2){
    const lanes=s.cells.map((cell,lane)=>({cell,nextCell:flowTo[lane]!}));
    hydro.waterfalls.push({from:id,to:downstream,cell:lanes[0]!.cell,nextCell:lanes[0]!.nextCell,
     top:s.surface,bottom:receiver.surface,width:s.width,drop,lanes});
   }
   previous=s.cells;
  }
  const sourceReach=hydro.reaches[hydro.reachByCell[source]!]!;
  sourceReach.cells.push(...route.cap);delete sourceReach.flowTo;
  for(const i of route.cap){hydro.reachByCell[i]=sourceReach.id;hydro.surface[i]=end.surface;hydro.highWater[i]=end.surface;}
  sources.push(source);
 }
 return {sources,next};
}
