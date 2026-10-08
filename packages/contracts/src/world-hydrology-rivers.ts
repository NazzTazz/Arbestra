import type { GeneratedLandscape } from './world-generator.js';
import type { Hydrology, WaterReach } from './world-hydrology.js';
import { climateHash } from './world-climate.js';
import { landscapeNeighbors } from './world-landscape.js';

/** r4: route full cross-sections, never enlarge a cosmetic sheet over dry ground.
 * Short straight corridors are deliberately bounded; rejected routes leave the terrain intact.
 */
export function carveBroadRivers(data:GeneratedLandscape,hydro:Hydrology,protectedCells:Uint8Array,
 carve:(beds:Map<number,number>)=>boolean){
 const w=data.width,h=data.height,n=w*h;
 const index=(x:number,y:number)=>((y%h+h)%h)*w+(x%w+w)%w;
 const adj=(i:number)=>landscapeNeighbors(i,w,h);
 type Section={cells:number[];surface:number};
 type Route={sections:Section[];mouth:number[];width:number;score:number};
 const routes:Route[]=[];
 for(let anchor=0;anchor<n;anchor++){
  if(data.terrainCodes[anchor]!==2||!adj(anchor).some(i=>data.terrainCodes[i]===1))continue;
  const width=5+Math.floor(climateHash(data.seed,anchor%w,Math.floor(anchor/w),503)*4);
  for(const [dx,dy]of [[1,0],[0,1],[-1,0],[0,-1]] as const){
   const section=(step:number)=>Array.from({length:width},(_,lane)=>index(anchor%w+dx*step+(dy?lane:0),Math.floor(anchor/w)+dy*step+(dx?lane:0)));
   const mouth=section(0);
   if(!mouth.every(i=>data.terrainCodes[i]===2))continue;
   const sections:Section[]=[];let surface=0;
   for(let step=1;step<=64;step++){
    const cells=section(step);
    if(cells.some(i=>data.terrainCodes[i]!==1||protectedCells[i]))break;
    const available=Math.min(...cells.map(i=>data.elevations[i]!-1));
    if(available<surface||available-surface>2)break;
    surface=available;
    // Banks alongside the strip remain dry. Caps are checked on the complete candidate.
    const banks=[index(cells[0]!%w-(dy?1:0),Math.floor(cells[0]!/w)-(dx?1:0)),
     index(cells.at(-1)!%w+(dy?1:0),Math.floor(cells.at(-1)!/w)+(dx?1:0))];
    if(banks.some(i=>data.terrainCodes[i]===2?surface!==0:data.elevations[i]!<surface+.25))break;
    sections.push({cells,surface});
   }
   if(sections.length<8||sections.at(-1)!.surface<1)continue;
   routes.push({sections,mouth,width,score:surface*8+Math.min(sections.length,48)*.2+data.humidity[sections.at(-1)!.cells[0]!]!});
  }
 }
 routes.sort((a,b)=>b.score-a.score||a.mouth[0]!-b.mouth[0]!);
 const sources:number[]=[],next=new Map<number,number>(),attempted:number[]=[];
 const periodic=(a:number,b:number,size:number)=>Math.min(Math.abs(a-b),size-Math.abs(a-b));
 const maxSources=Math.max(2,Math.min(16,Math.floor(n/8192)));
 for(const route of routes){
  if(sources.length>=maxSources||attempted.length>=96)break;
  const source=route.sections.at(-1)!.cells[0]!;
  if(attempted.some(i=>periodic(i%w,source%w,w)+periodic(Math.floor(i/w),Math.floor(source/w),h)<8))continue;
  attempted.push(source);
  const beds=new Map<number,number>();
  for(const section of route.sections)for(const i of section.cells)beds.set(i,section.surface-1);
  // No overlap or lateral partial fall into a pre-existing reach.
  if([...beds].some(([i,bed])=>hydro.reachByCell[i]!==-1||adj(i).some(j=>!beds.has(j)&&hydro.surface[j]!==null&&hydro.surface[j]!==bed+1&&!(route.sections[0]!.cells.includes(i)&&route.mouth.includes(j))))||!carve(beds)){
   hydro.metrics.rejectedRivers++;continue;
  }
  let previous=route.mouth;
  for(let k=0;k<route.sections.length;k++){
   const section=route.sections[k]!,id=hydro.reaches.length;
   const downstream=hydro.reachByCell[previous[0]!]!,receiver=hydro.reaches[downstream]!;
   const reach:WaterReach={id,kind:k===route.sections.length-1?'lake':'river',cells:section.cells,
    surface:section.surface,bedMin:section.surface-1,width:route.width,downstream,upstream:[],anchor:section.cells[0]!};
   hydro.reaches.push(reach);receiver.upstream.push(id);
   for(let lane=0;lane<route.width;lane++){
    const i=section.cells[lane]!;hydro.reachByCell[i]=id;hydro.surface[i]=section.surface;hydro.highWater[i]=section.surface;next.set(i,previous[lane]!);
   }
   const drop=section.surface-receiver.surface;
   if(drop===1||drop===2)hydro.waterfalls.push({from:id,to:downstream,cell:section.cells[0]!,nextCell:previous[0]!,
    top:section.surface,bottom:receiver.surface,width:route.width,drop,
    lanes:section.cells.map((cell,lane)=>({cell,nextCell:previous[lane]!}))});
   previous=section.cells;
  }
  sources.push(source);
 }
 return {sources,next};
}
