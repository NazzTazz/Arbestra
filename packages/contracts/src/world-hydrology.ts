import { carveMeanderingRivers } from './world-hydrology-meanders.js';
import { carveBroadRivers } from './world-hydrology-rivers.js';
import { climateHash } from './world-climate.js';
import { cyclePhases, sunPosition, torusFrame } from './cosmology.js';
import type { GeneratedLandscape, GeneratorParameters } from './world-generator.js';
import { createLandscapeStairAccess, isLandscapeStairSide } from './world-generator.js';
import { landscapeMetrics, landscapeNeighbors } from './world-landscape.js';
import { landscapeQuality } from './world-landscape-quality.js';

export const HYDROLOGY_RECIPE_REVISION=5;
export const TIDE_AMPLITUDE=.25;
export const DRY_MARGIN=.25;
export interface WaterReach {
  id:number;kind:'sea'|'lake'|'river';cells:number[];surface:number;bedMin:number;width:number;
  downstream:number|null;outlets?:number[];upstream:number[];anchor:number;tideAnchor?:number;flowTo?:number[];
}
export interface Waterfall {
  from:number;to:number;cell:number;nextCell:number;top:number;bottom:number;width:number;drop:1|2;lanes?:Array<{cell:number;nextCell:number}>;
}
export interface Hydrology {
  revision:1;tideAmplitude:number;dryMargin:number;
  reachByCell:number[];surface:Array<number|null>;highWater:Array<number|null>;
  reaches:WaterReach[];waterfalls:Waterfall[];
  channels:Array<{cells:number[];width:number}>;
  metrics:{waterLowPercent:number;waterHighPercent:number;marineBasins:number;lakeBasins:number;
    riverCells:number;sources:number;falls1:number;falls2:number;rejectedChannels:number;rejectedRivers:number};
}
/** One level for a connected marine basin, bounded and periodic in the shared solar cycle. */
export function basinTide(data:GeneratedLandscape,reach:WaterReach,phase:number):number {
  if(reach.kind!=='sea'&&reach.tideAnchor===undefined)return 0;
  const phases=cyclePhases(phase),i=reach.tideAnchor??reach.anchor;
  const frame=torusFrame((i%data.width+.5)/data.width*Math.PI*2,(Math.floor(i/data.width)+.5)/data.height*Math.PI*2+Math.PI,phases.torus);
  const sun=sunPosition(phases.sun),v=sun.map((p,k)=>p-frame.point[k]!);
  const length=Math.hypot(...v),dot=v.reduce((s,p,k)=>s+p/length*frame.normal[k]!,0);
  return (data.hydrology?.tideAmplitude??TIDE_AMPLITUDE)*(2*dot*dot-1);
}
export function waterLevel(data:GeneratedLandscape,cell:number,phase:number):number|null {
  const hydro=data.hydrology;if(!hydro)return data.terrainCodes[cell]===2?0:null;
  const id=hydro.reachByCell[cell]!,reach=hydro.reaches[id];
  return reach?reach.surface+basinTide(data,reach,phase):null;
}
/** Reference drainage is independent of solar phase. */
export function drainageDirection(data:GeneratedLandscape,cell:number):readonly[number,number]{
  const h=data.hydrology,r=h?.reaches[h.reachByCell[cell]!];
  if(!r||r.kind!=='river'||r.downstream===null)return [0,0];
  const j=r.flowTo?.[r.cells.indexOf(cell)]??h!.reaches[r.downstream]!.cells.find(i=>landscapeNeighbors(cell,data.width,data.height).includes(i));
  if(j===undefined)return [0,0];
  const wrap=(d:number,size:number)=>((d+size*1.5)%size)-size/2;
  return [wrap(j%data.width-cell%data.width,data.width),wrap(Math.floor(j/data.width)-Math.floor(cell/data.width),data.height)];
}
/** Permanent drainage never reverses; only marine reaches add a solar component. */
export function waterCurrent(data:GeneratedLandscape,cell:number,phase:number):readonly[number,number] {
  const h=data.hydrology,r=h?.reaches[h.reachByCell[cell]!];if(!r)return [0,0];
  const drainage=drainageDirection(data,cell);
  if(r.kind!=='sea'&&r.tideAnchor===undefined)return drainage;
  const phases=cyclePhases(phase),f=torusFrame((cell%data.width+.5)/data.width*Math.PI*2,(Math.floor(cell/data.width)+.5)/data.height*Math.PI*2+Math.PI,phases.torus),s=sunPosition(phases.sun);
  const v=s.map((p,k)=>p-f.point[k]!),length=Math.hypot(...v);
  const current=[v.reduce((sum,p,k)=>sum+p/length*f.east[k]!,0),v.reduce((sum,p,k)=>sum+p/length*f.north[k]!,0)];
  return r.kind==='river'?[.25*drainage[0]+.75*current[0]!, .25*drainage[1]+.75*current[1]!]:[current[0]!,current[1]!];
}

export function addHydrology(data:GeneratedLandscape,p:GeneratorParameters,recipeRevision=HYDROLOGY_RECIPE_REVISION):GeneratedLandscape {
  const w=data.width,h=data.height,n=w*h,adj=(i:number)=>landscapeNeighbors(i,w,h);
  const protectedCells=new Uint8Array(n),stairCells=createLandscapeStairAccess(data).cells;
  for(const i of stairCells.keys()){
    const x=i%w,y=Math.floor(i/w);
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)protectedCells[((y+dy+h)%h)*w+(x+dx+w)%w]=1;
  }
  const hydro:Hydrology={revision:1,tideAmplitude:TIDE_AMPLITUDE,dryMargin:DRY_MARGIN,
    reachByCell:new Array(n).fill(-1),surface:new Array(n).fill(null),highWater:new Array(n).fill(null),
    reaches:[],waterfalls:[],channels:[],metrics:{waterLowPercent:0,waterHighPercent:0,marineBasins:0,lakeBasins:0,riverCells:0,sources:0,falls1:0,falls2:0,rejectedChannels:0,rejectedRivers:0}};
  const labels=()=>{const ids=new Int32Array(n).fill(-1),groups:number[][]=[];
    for(let i=0;i<n;i++)if(data.terrainCodes[i]===2&&ids[i]===-1){const id=groups.length,q=[i];ids[i]=id;
      for(let k=0;k<q.length;k++)for(const j of adj(q[k]!))if(data.terrainCodes[j]===2&&ids[j]===-1){ids[j]=id;q.push(j);}groups.push(q);}
    return {ids,groups};
  };
  // Mutations are accepted only if each remaining land stays connected with its stairs.
  const carve=(levels:Map<number,number>)=>{
    if([...levels.keys()].some(i=>protectedCells[i]))return false;
    for(const [i,bed]of levels)for(const j of adj(i))if(!levels.has(j)&&data.terrainCodes[j]===1&&data.elevations[j]!<bed+1+DRY_MARGIN)return false;
    const touched=new Set<number>(levels.keys());
    for(const i of levels.keys())for(const j of adj(i))if(data.terrainCodes[j]===1)touched.add(j);
    const old=[...touched].map(i=>[i,data.elevations[i]!,data.terrainCodes[i]!,data.woodland[i]!,data.walkable[i]!] as const);
    for(const i of touched){data.woodland[i]=0;data.walkable[i]=data.terrainCodes[i]===1?1:0;}
    for(const [i,bed]of levels){data.elevations[i]=bed;data.terrainCodes[i]=2;data.walkable[i]=0;}
    const component=new Int32Array(n).fill(-1),queue=new Int32Array(n);let group=0;
    for(let root=0;root<n;root++)if(data.terrainCodes[root]===1&&component[root]===-1){
      let head=0,tail=1;queue[0]=root;component[root]=group;
      while(head<tail){const i=queue[head++]!;for(const j of adj(i))if(data.terrainCodes[j]===1&&component[j]===-1&&!isLandscapeStairSide(stairCells,i,j,w)&&(data.elevations[i]===data.elevations[j]||stairCells.has(i)&&stairCells.get(i)===stairCells.get(j))){component[j]=group;queue[tail++]=j;}}
      group++;
    }
    let disconnected=false;
    for(let i=0;i<n&&!disconnected;i++)if(data.terrainCodes[i]===1)for(const j of adj(i))if(data.terrainCodes[j]===1&&component[i]!==component[j]){disconnected=true;break;}
    if(disconnected){
      for(const [i,z,t,trees,walk]of old){data.elevations[i]=z;data.terrainCodes[i]=t;data.woodland[i]=trees;data.walkable[i]=walk;}
      return false;
    }
    return true;
  };
  // Join nearby sea-level basins through low natural saddles. Width is the actual square swept footprint.
  for(let attempt=0;attempt<6;attempt++){
    const {ids,groups}=labels();if(groups.length<2)break;
    const owner=Int32Array.from(ids),parent=new Int32Array(n).fill(-1),distance=new Int16Array(n).fill(-1),q:number[]=[];
    for(let i=0;i<n;i++)if(ids[i]!==-1){q.push(i);distance[i]=0;}
    const bridges:Array<[number,number]>=[];
    for(let k=0;k<q.length&&bridges.length<48;k++){
      const i=q[k]!;if(distance[i]!>=24)continue;
      for(const j of adj(i)){
        if(protectedCells[j]||data.elevations[j]!>2)continue;
        if(owner[j]===-1){owner[j]=owner[i]!;parent[j]=i;distance[j]=distance[i]!+1;q.push(j);}
        else if(owner[j]!==owner[i]&&distance[i]!+distance[j]!>0)bridges.push([i,j]);
      }
    }
    let accepted=false;
    for(const [a,b]of bridges){
      const left:number[]=[],right:number[]=[];for(let i=a;i!==-1;i=parent[i]!)left.push(i);for(let i=b;i!==-1;i=parent[i]!)right.push(i);
      const path=[...left.reverse(),...right],cells=new Map<number,number>(),half=Math.floor(p.channelWidth/2);
      let valid=true;
      for(const i of path)for(let dy=-half;dy<p.channelWidth-half;dy++)for(let dx=-half;dx<p.channelWidth-half;dx++){
        const j=((Math.floor(i/w)+dy+h)%h)*w+(i%w+dx+w)%w;
        if(protectedCells[j]||data.elevations[j]!>2){valid=false;break;}if(data.terrainCodes[j]!==2)cells.set(j,-1);
      }
      if(!valid||!cells.size||!carve(cells)){hydro.metrics.rejectedChannels++;continue;}
      hydro.channels.push({cells:path,width:p.channelWidth});accepted=true;break;
    }
    if(!accepted)break;
  }
  const {groups}=labels();let largest=-1;
  for(let i=0;i<groups.length;i++)if(largest<0||groups[i]!.length>groups[largest]!.length)largest=i;
  for(let id=0;id<groups.length;id++){
    const cells=groups[id]!,marine=id===largest;
    const reach:WaterReach={id,kind:marine?'sea':'lake',cells,surface:0,bedMin:cells.reduce((min,i)=>Math.min(min,data.elevations[i]!),8),width:0,downstream:null,upstream:[],anchor:cells[0]!};
    hydro.reaches.push(reach);for(const i of cells){hydro.reachByCell[i]=id;hydro.surface[i]=0;hydro.highWater[i]=marine?TIDE_AMPLITUDE:0;}
  }
  const chosen:number[]=[],riverNext=new Map<number,number>();
  if(recipeRevision>=4){
    const result=(recipeRevision===4?carveBroadRivers:carveMeanderingRivers)(data,hydro,protectedCells,carve);
    chosen.push(...result.sources);for(const [a,b]of result.next)riverNext.set(a,b);
  }else{
  // Reverse breadth-first drainage: same-level links strictly decrease distance, so no toroidal cycle.
  const next=new Int32Array(n).fill(-1),distance=new Int32Array(n).fill(-1),q:number[]=[];
  const level=(i:number)=>data.terrainCodes[i]===2?0:Math.max(0,data.elevations[i]!-1);
  for(let i=0;i<n;i++)if(data.terrainCodes[i]===2){q.push(i);distance[i]=0;}
  for(let k=0;k<q.length;k++){
    const i=q[k]!;
    for(const j of adj(i))if(distance[j]===-1&&!protectedCells[j]&&level(j)>=level(i)&&level(j)-level(i)<=2&&adj(j).every(k=>k===i||data.terrainCodes[k]===2||data.elevations[k]!>=level(j)+DRY_MARGIN)){
      distance[j]=distance[i]!+1;next[j]=i;q.push(j);
    }
  }
  const sources=q.filter(i=>distance[i]!>=8&&distance[i]!<=160&&level(i)>=1)
    .sort((a,b)=>(level(b)*8+Math.min(distance[b]!,48)*.2+data.humidity[b]!)-(level(a)*8+Math.min(distance[a]!,48)*.2+data.humidity[a]!)||a-b);
  const attempted:number[]=[],maxSources=Math.max(2,Math.min(16,Math.floor(n/8192)));
  let trials=0;
  for(const source of sources){
    if(chosen.length>=maxSources||trials>=48)break;
    const periodic=(a:number,b:number,size:number)=>Math.min(Math.abs(a-b),size-Math.abs(a-b));
    if(attempted.some(i=>periodic(i%w,source%w,w)+periodic(Math.floor(i/w),Math.floor(source/w),h)<12))continue;
    const path:number[]=[];let i=source;
    while(i>=0&&hydro.reachByCell[i]===-1&&path.length<=160){path.push(i);i=next[i]!;}
    if(i<0||!path.length||path.length>160)continue;trials++;attempted.push(source);
    const surface=level(source),pool=adj(source).filter(j=>!path.includes(j)&&data.terrainCodes[j]===1&&!protectedCells[j]&&level(j)===surface&&adj(j).every(k=>path.includes(k)||data.terrainCodes[k]===2||data.elevations[k]!>=surface+DRY_MARGIN));
    const cells=new Map(path.map(j=>[j,level(j)-1]));for(const j of pool)cells.set(j,surface-1);
    let contained=true;
    for(const [cell,bed]of cells)for(const j of adj(cell)){
      const other=cells.has(j)?cells.get(j)!+1:hydro.surface[j];if(other===null||other===undefined||other===bed+1)continue;
      if(Math.abs(bed+1-other)>2)contained=false;
    }
    if(!contained||!carve(cells)){hydro.metrics.rejectedRivers++;continue;}
    for(const cell of [...path].reverse()){
      const downstream=hydro.reachByCell[next[cell]!]!,surface=cells.get(cell)!+1,id=hydro.reaches.length;
      hydro.reaches.push({id,kind:'river',cells:[cell],surface,bedMin:cells.get(cell)!,width:1,downstream,upstream:[],anchor:cell});
      hydro.reaches[downstream]!.upstream.push(id);hydro.reachByCell[cell]=id;hydro.surface[cell]=surface;hydro.highWater[cell]=surface;
      riverNext.set(cell,next[cell]!);
    }
    const sourceReach=hydro.reaches[hydro.reachByCell[source]!]!;
    if(pool.length>=2){sourceReach.kind='lake';sourceReach.cells.push(...pool);sourceReach.width=3;for(const j of pool){hydro.reachByCell[j]=sourceReach.id;hydro.surface[j]=surface;hydro.highWater[j]=surface;}}
    else for(const j of pool){hydro.reachByCell[j]=sourceReach.id;sourceReach.cells.push(j);hydro.surface[j]=surface;hydro.highWater[j]=surface;}
    chosen.push(source);
  }
  }
  // Flood the connected sea-level network after all carving, including newly linked lagoons.
  const sea=hydro.reaches.find(r=>r.kind==='sea');
  if(sea){const seen=new Uint8Array(n),queue=[...sea.cells];for(const i of queue)seen[i]=1;
    for(let q=0;q<queue.length;q++){const i=queue[q]!,r=hydro.reaches[hydro.reachByCell[i]!]!;r.tideAnchor=sea.anchor;hydro.highWater[i]=TIDE_AMPLITUDE;
      for(const j of adj(i))if(!seen[j]&&hydro.surface[j]===0){seen[j]=1;queue.push(j);}
    }
  }
  // Stable basin levels and permanent river surfaces; estuary feet follow their marine receiver.
  if(recipeRevision===3)for(const reach of hydro.reaches)if(reach.surface>0)for(const cell of reach.cells)for(const nextCell of adj(cell)){
    const to=hydro.reachByCell[nextCell]!,receiver=hydro.reaches[to];if(!receiver)continue;
    const top=reach.surface,bottom=receiver.surface,drop=top-bottom;
    if(drop===1||drop===2){
      hydro.waterfalls.push({from:reach.id,to,cell,nextCell,top,bottom,width:1,drop});
      if(reach.downstream!==to){reach.outlets??=[];if(!reach.outlets.includes(to))reach.outlets.push(to);}
      if(!receiver.upstream.includes(reach.id))receiver.upstream.push(reach.id);
    }
  }
  // Recalibrate vegetation on the final dry graph, pruning only leaves of its spanning forest.
  data.woodland.fill(0);
  const access=createLandscapeStairAccess(data),parents=new Int32Array(n).fill(-1),children=new Int32Array(n),keep=new Uint8Array(n),order:number[]=[];
  for(let root=0;root<n;root++)if(data.terrainCodes[root]===1&&parents[root]===-1){
    parents[root]=root;keep[root]=1;order.push(root);
    for(let q=order.length-1;q<order.length;q++){const i=order[q]!;
      const neighbors=adj(i),rotate=Math.floor(climateHash(data.seed,i%w,Math.floor(i/w),419)*4);
      for(let k=0;k<4;k++){const j=neighbors[(k+rotate)%4]!;
        if(data.terrainCodes[j]===1&&parents[j]===-1&&!isLandscapeStairSide(access.cells,i,j,w)&&(data.elevations[i]===data.elevations[j]||access.edges.has(Math.min(i,j)+':'+Math.max(i,j)))){parents[j]=i;children[i]=children[i]!+1;order.push(j);}
      }
    }
  }
  for(const i of access.cells.keys())keep[i]=1;
  for(let q=order.length-1;q>=0;q--){const i=order[q]!;if(keep[i])keep[parents[i]!]=1;}
  const weight=(i:number)=>2.4+Math.cos((Math.floor(i/w)+.5)/h*Math.PI*2+Math.PI);
  const score=(i:number)=>data.humidity[i]!*.4+p.solarInfluence/100*.3*Math.max(0,1-Math.abs(data.exposure[i]!-.25)/.3)+climateHash(data.seed,i%w,Math.floor(i/w),421)*.3;
  const heap:number[]=[],scores=Float64Array.from({length:n},(_,i)=>score(i));
  const better=(a:number,b:number)=>scores[a]!>scores[b]!||scores[a]===scores[b]&&a<b;
  const push=(i:number)=>{let k=heap.length;heap.push(i);while(k){const parent=(k-1)>>1;if(!better(i,heap[parent]!))break;heap[k]=heap[parent]!;k=parent;}heap[k]=i;};
  const pop=()=>{const value=heap[0]!,last=heap.pop()!;if(heap.length){let k=0;while(k*2+1<heap.length){let c=k*2+1;if(c+1<heap.length&&better(heap[c+1]!,heap[c]!))c++;if(!better(heap[c]!,last))break;heap[k]=heap[c]!;k=c;}heap[k]=last;}return value;};
  let dryArea=0,treeArea=0;
  for(const i of order){dryArea+=weight(i);if(!children[i]&&!keep[i])push(i);}
  while(heap.length){const i=pop(),area=weight(i);if(treeArea+area/2>dryArea*p.treePercent/100)break;
    data.woodland[i]=1;treeArea+=area;const parent=parents[i]!;children[parent]=children[parent]!-1;if(!children[parent]&&!keep[parent])push(parent);
  }
  for(const i of order)data.walkable[i]=data.woodland[i]?0:1;

  data.recipeRevision=recipeRevision;data.hydrology=hydro;
  // Exclude every cell inside the stable high-water envelope, regardless of animated tide.
  for(let i=0;i<n;i++)if(hydro.highWater[i]!==null||data.terrainCodes[i]===2){data.walkable[i]=0;data.woodland[i]=0;}
  data.metrics=landscapeMetrics(data);data.metrics.quality=landscapeQuality(data);
  let total=0,low=0,high=0;
  for(let i=0;i<n;i++){
    const area=2.4+Math.cos((Math.floor(i/w)+.5)/h*Math.PI*2+Math.PI);total+=area;
    const r=hydro.reaches[hydro.reachByCell[i]!];if(!r)continue;
    if(r.surface-(r.kind==='sea'||r.tideAnchor!==undefined?TIDE_AMPLITUDE:0)>data.elevations[i]!)low+=area;
    if(r.surface+(r.kind==='sea'||r.tideAnchor!==undefined?TIDE_AMPLITUDE:0)>data.elevations[i]!)high+=area;
  }
  Object.assign(hydro.metrics,{waterLowPercent:low/total*100,waterHighPercent:high/total*100,
    marineBasins:hydro.reaches.filter(r=>r.kind==='sea').length,lakeBasins:hydro.reaches.filter(r=>r.kind==='lake'&&r.tideAnchor===undefined).length,
    riverCells:riverNext.size,sources:chosen.length,falls1:hydro.waterfalls.filter(f=>f.drop===1).length,falls2:hydro.waterfalls.filter(f=>f.drop===2).length});
  const warnings=data.metrics.warnings;
  if(Math.abs(data.metrics.waterPercent-p.waterPercent)>1)warnings.push('Water area target outside 1 percentage point tolerance.');
  if(Math.abs(data.metrics.meanElevation-p.meanElevation)>.25)warnings.push('Mean altitude target outside 0.25 unit tolerance.');
  if(Math.abs(data.metrics.amplitude-p.amplitude)>.5)warnings.push('Relief amplitude constrained by plateaus, sea and accessibility.');
  if(Math.abs(data.metrics.treePercent-p.treePercent)>1)warnings.push('Tree coverage limited by preserved natural passages.');
  if(!hydro.channels.length)warnings.push('No feasible maritime channel at requested width.');
  if(!chosen.length)warnings.push('No descending river fits the relief and dry access constraints.');
  warnings.push('Local spawn is not implemented: v3 remains closed.');
  return data;
}
