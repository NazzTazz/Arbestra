import { landscapeQuality } from './world-landscape-quality.js';
import { createLandscapeStairAccess, isLandscapeStairSide, type GeneratedLandscape, type GeneratorParameters, type NaturalStair } from './world-generator.js';
import { buildExposureField, climateAt, climateHash, exposureAt, periodicClimateNoise, wrapClimate } from './world-climate.js';

export const LANDSCAPE_RECIPE_REVISION = 2;
type Landscape = Omit<GeneratedLandscape,'metrics'>;
type Metrics = (data:Landscape)=>GeneratedLandscape['metrics'];
class Union {
  p:Int32Array;
  constructor(n:number){this.p=Int32Array.from({length:n},(_,i)=>i);}
  find(i:number):number {while(this.p[i]!==i){this.p[i]=this.p[this.p[i]!]!;i=this.p[i]!;}return i;}
  join(a:number,b:number){a=this.find(a);b=this.find(b);if(a===b)return false;this.p[Math.max(a,b)]=Math.min(a,b);return true;}
}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const key=(a:number,b:number)=>Math.min(a,b)+':'+Math.max(a,b);
interface Border {a:number;b:number;cells:Array<{i:number;direction:0|1}>;cost:number}
interface Passage {border:Border;stair:NaturalStair;pad:Array<{i:number;side:0|1}>;guard:number[]}
/** Periodic Voronoi terraces, a local access forest and connectivity-preserving woodland placement. */
export function generateTerracedLandscape(seed:number,w:number,h:number,p:GeneratorParameters,metricsOf:Metrics):GeneratedLandscape {
  const n=w*h,nx=Math.max(4,Math.round(w/18)),ny=Math.max(4,Math.round(h/18)),count=nx*ny;
  const index=(x:number,y:number)=>wrapClimate(y,h)*w+wrapClimate(x,w);
  const neighbors=(i:number)=>[index(i%w+1,Math.floor(i/w)),index(i%w,Math.floor(i/w)+1),index(i%w-1,Math.floor(i/w)),index(i%w,Math.floor(i/w)-1)];
  const weight=(i:number)=>2.4+Math.cos((Math.floor(i/w)+.5)/h*Math.PI*2+Math.PI);
  const sites=Array.from({length:count},(_,i)=>{
    const gx=i%nx,gy=Math.floor(i/nx),x=(gx+.2+.6*climateHash(seed,gx,gy,301))*w/nx,y=(gy+.2+.6*climateHash(seed,gx,gy,302))*h/ny;
    const u=x/w,v=y/h,macro=periodicClimateNoise(u,v,2,seed),meso=periodicClimateNoise(u,v,Math.max(3,Math.round(Math.max(w,h)/64)),seed+17);
    return {x,y,coast:.78*macro+.22*meso,relief:.3*macro+.3*meso+.4*climateHash(seed,gx,gy,303)};
  });
  const owner=new Int32Array(n),areas=new Float64Array(count);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let best=Infinity,id=0;
    const gx=Math.floor(x/w*nx),gy=Math.floor(y/h*ny);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const s=wrapClimate(gy+dy,ny)*nx+wrapClimate(gx+dx,nx),site=sites[s]!;
      const xx=wrapClimate(x+.5-site.x+w/2,w)-w/2,yy=wrapClimate(y+.5-site.y+h/2,h)-h/2,d=xx*xx+yy*yy;
      if(d<best||(d===best&&s<id)){best=d;id=s;}
    }
    const i=y*w+x;owner[i]=id;areas[id]=areas[id]!+weight(i);
  }
  const total=areas.reduce((a,b)=>a+b,0),sea=new Uint8Array(count);
  let wet=0;
  for(const id of sites.map((_,i)=>i).sort((a,b)=>sites[a]!.coast-sites[b]!.coast||a-b)){
    if(wet+areas[id]!/2>total*p.waterPercent/100)break;
    sea[id]=1;wet+=areas[id]!;
  }
  const borders=new Map<string,Border>();
  for(let i=0;i<n;i++)for(const direction of [0,1] as const){
    const j=direction===0?index(i%w+1,Math.floor(i/w)):index(i%w,Math.floor(i/w)+1),a=owner[i]!,b=owner[j]!;
    if(a===b||sea[a]||sea[b])continue;
    const k=key(a,b);let edge=borders.get(k);
    if(!edge){edge={a,b,cells:[],cost:Math.abs(sites[a]!.relief-sites[b]!.relief)};borders.set(k,edge);}
    edge.cells.push({i,direction});
  }
  const connected=new Union(count),equal=new Union(count),reserved=new Uint8Array(n),passages:Passage[]=[],tree:Border[]=[];
  function place(border:Border):Passage|null {
    const choices=[...border.cells].sort((a,b)=>climateHash(seed,a.i,a.direction,311)-climateHash(seed,b.i,b.direction,311)||a.i-b.i);
    for(const {i,direction}of choices){
      const a=owner[i]!,j=neighbors(i)[direction]!,b=owner[j]!;
      const x=i%w-(direction===1?1:0),y=Math.floor(i/w)-(direction===0?1:0);
      const pad:Array<{i:number;side:0|1}>=[],guard:number[]=[];let valid=true;
      for(let lane=-1;lane<5;lane++)for(let along=-2;along<4;along++){
        const k=direction===0?index(x+along,y+lane):index(x+lane,y+along);
        guard.push(k);
        if(reserved[k])valid=false;
        if(lane>=0&&lane<4&&along>=-1&&along<=2){
          if(owner[k]!==a&&owner[k]!==b)valid=false;
          pad.push({i:k,side:along<=0?0:1});
        }
      }
      // The middle approach cells connect the flattened landings to the original regions.
      for(const lane of [1,2]){
        const left=direction===0?index(x-2,y+lane):index(x+lane,y-2);
        const right=direction===0?index(x+3,y+lane):index(x+lane,y+3);
        if(owner[left]!==a||owner[right]!==b)valid=false;
      }
      if(valid)return {border:{...border,a,b},stair:{x:wrapClimate(x,w),y:wrapClimate(y,h),direction,length:2,width:4,from:i,to:j,low:0,high:0},pad,guard};
    }
    return null;
  }
  for(const edge of [...borders.values()].sort((a,b)=>a.cost-b.cost||a.a-b.a||a.b-b.b)){
    if(!connected.join(edge.a,edge.b))continue;
    tree.push(edge);
    const passage=place(edge);
    if(passage){passages.push(passage);for(const i of passage.guard)reserved[i]=1;}
    else equal.join(edge.a,edge.b); // No compact safe footprint: retain a flat natural connection.
  }
  const adjacency:Array<Array<{other:number;flat:boolean}>>=Array.from({length:count},()=>[]);
  for(const edge of tree){const flat=equal.find(edge.a)===equal.find(edge.b);adjacency[edge.a]!.push({other:edge.b,flat});adjacency[edge.b]!.push({other:edge.a,flat});}
  const land=sites.map((_,i)=>i).filter(i=>!sea[i]),ocean=sites.map((_,i)=>i).filter(i=>sea[i]);
  const normalize=(ids:number[])=>{
    const sorted=[...ids].sort((a,b)=>sites[a]!.relief-sites[b]!.relief||a-b),result=new Float64Array(count);
    sorted.forEach((id,i)=>{result[id]=sorted.length>1?i/(sorted.length-1):.5;});return result;
  };
  const lr=normalize(land),sr=normalize(ocean);
  const regionalNeighbors:number[][]=Array.from({length:count},()=>[]);
  for(const e of borders.values()){regionalNeighbors[e.a]!.push(e.b);regionalNeighbors[e.b]!.push(e.a);}
  let levels=new Int16Array(count),bestError=Infinity;
  // Calibrate over quantized physical ranges, not a fixed flattening pass over every border.
  for(let depth=ocean.length?1:0;depth<=(ocean.length?8:0);depth++)for(let top=land.length?1:0;top<=(land.length?8:0);top++)for(const basinShape of [1,2,4,8,16,64]){
    const current=new Int16Array(count),seen=new Uint8Array(count);
    for(const i of ocean)current[i]=-depth+Math.round(Math.pow(sr[i]!,basinShape)*(depth-1));
    for(const root of [...land].sort((a,b)=>lr[b]!-lr[a]!||a-b)){
      if(seen[root])continue;
      current[root]=1+Math.round(lr[root]!*(top-1));seen[root]=1;const queue=[root];
      for(let q=0;q<queue.length;q++){
        const a=queue[q]!;
        for(const {other:b,flat}of adjacency[a]!)if(!seen[b]){
          const desired=1+Math.round(lr[b]!*(top-1));
          if(flat)current[b]=current[a]!;
          else {
            let choice=clamp(desired,Math.max(1,current[a]!-1),Math.min(top,current[a]!+1)),cost=Infinity;
            for(let level=Math.max(1,current[a]!-1);level<=Math.min(top,current[a]!+1);level++){
              const same=regionalNeighbors[b]!.reduce((sum,j)=>sum+(seen[j]&&current[j]===level?1:0),0);
              const candidateCost=.45*Math.abs(level-desired)+same;
              if(candidateCost<cost){choice=level;cost=candidateCost;}
            }
            current[b]=choice;
          }
          seen[b]=1;queue.push(b);
        }
      }
    }
    let mean=0,min=8,max=-8;for(let i=0;i<count;i++){mean+=current[i]!*areas[i]!;min=Math.min(min,current[i]!);max=Math.max(max,current[i]!);}
    const flat=new Union(count),flatAreas=new Float64Array(count);
    for(const e of borders.values())if(current[e.a]===current[e.b])flat.join(e.a,e.b);
    let largest=0;for(const i of land){const root=flat.find(i);flatAreas[root]=flatAreas[root]!+areas[i]!;largest=Math.max(largest,flatAreas[root]!);}
    const meanError=Math.abs(mean/total-p.meanElevation);
    const error=2*Math.max(0,meanError-.25)+.02*meanError+.5*Math.abs(max-min-p.amplitude)+.6*(land.length?largest/(total-wet):0);
    if(error<bestError){bestError=error;levels=current;}
  }
  // Add a second local crossing where the access tree would require a long regional detour.
  const routes:Array<Set<number>>=Array.from({length:count},()=>new Set());
  for(const e of tree){routes[e.a]!.add(e.b);routes[e.b]!.add(e.a);}
  for(const e of borders.values())if(levels[e.a]===levels[e.b]){routes[e.a]!.add(e.b);routes[e.b]!.add(e.a);}
  for(const e of [...borders.values()].sort((a,b)=>a.cost-b.cost||a.a-b.a||a.b-b.b)){
    if(Math.abs(levels[e.a]!-levels[e.b]!)!==1||routes[e.a]!.has(e.b))continue;
    const distances=new Int16Array(count).fill(-1),q=[e.a];distances[e.a]=0;
    for(let k=0;k<q.length;k++){const a=q[k]!;if(distances[a]!>=3)continue;for(const b of routes[a]!)if(distances[b]===-1){distances[b]=distances[a]!+1;q.push(b);}}
    if(distances[e.b]!==-1)continue;
    const passage=place(e);if(!passage)continue;
    passages.push(passage);for(const i of passage.guard)reserved[i]=1;routes[e.a]!.add(e.b);routes[e.b]!.add(e.a);
  }
  const exposureField=buildExposureField();
  const data:Landscape={version:3,recipeRevision:LANDSCAPE_RECIPE_REVISION,climateRevision:1,width:w,height:h,seed,altitudeCellRatio:.25,
    elevations:new Array(n),terrainCodes:new Array(n),woodland:new Array(n).fill(0),walkable:new Array(n).fill(0),
    exposure:new Array(n),humidity:new Array(n),components:new Array(n).fill(-1),stairs:[]};
  for(let i=0;i<n;i++){
    data.elevations[i]=levels[owner[i]!]!;data.terrainCodes[i]=sea[owner[i]!] ?2:1;
    data.exposure[i]=exposureAt(exposureField,(i%w+.5)/w,(Math.floor(i/w)+.5)/h);
    data.humidity[i]=climateAt((i%w+.5)/w,(Math.floor(i/w)+.5)/h,seed).humidity;
  }
  const protectedCells=new Uint8Array(n);
  for(const passage of passages){
    const {a,b}=passage.border,low=Math.min(levels[a]!,levels[b]!),high=Math.max(levels[a]!,levels[b]!);
    if(low===high)continue;
    const s={...passage.stair,low,high};
    for(const cell of passage.pad){data.elevations[cell.i]=levels[cell.side===0?a:b]!;protectedCells[cell.i]=1;}
    data.stairs.push(s);
  }
  const {cells:stairCells,edges}=createLandscapeStairAccess(data);
  const allowed=(i:number,j:number)=>data.terrainCodes[j]===1&&!isLandscapeStairSide(stairCells,i,j,w)&&(data.elevations[i]===data.elevations[j]||edges.has(key(i,j)));
  // A rectangular stair landing can leave a tiny corner of its original terrace cut off.
  // Reattach only small, flat pockets outside every protected landing; never flatten a whole region.
  for(let pass=0;pass<8;pass++){
    const groups=new Union(n),islands=new Union(n);
    for(let i=0;i<n;i++)if(data.terrainCodes[i]===1)for(const j of neighbors(i).slice(0,2))if(data.terrainCodes[j]===1){islands.join(i,j);if(allowed(i,j))groups.join(i,j);}
    const members=new Map<number,number[]>(),largest=new Map<number,number>();
    for(let i=0;i<n;i++)if(data.terrainCodes[i]===1){const root=groups.find(i);if(!members.has(root))members.set(root,[]);members.get(root)!.push(i);}
    for(const [root,list]of members){const island=islands.find(root),old=largest.get(island);if(old===undefined||list.length>members.get(old)!.length)largest.set(island,root);}
    let changed=false;
    for(const [root,list]of members){
      if(largest.get(islands.find(root))===root||list.length>16||list.some(i=>protectedCells[i]||data.elevations[i]!==data.elevations[root]))continue;
      let target=-1,best=Infinity;
      for(const i of list)for(const j of neighbors(i))if(data.terrainCodes[j]===1&&groups.find(j)!==root&&!stairCells.has(j)&&!isLandscapeStairSide(stairCells,i,j,w)){
        const difference=Math.abs(data.elevations[i]!-data.elevations[j]!);if(difference<best){best=difference;target=j;}
      }
      if(target>=0){for(const i of list)data.elevations[i]=data.elevations[target]!;changed=true;}
    }
    if(!changed)break;
  }
  // A spanning forest of the actual cell graph. Removing leaves cannot split a walkable region.
  const parent=new Int32Array(n).fill(-1),children=new Int32Array(n),queue:number[]=[];
  for(let root=0;root<n;root++)if(data.terrainCodes[root]===1&&parent[root]===-1){
    parent[root]=root;protectedCells[root]=1;queue.push(root);
    for(let q=queue.length-1;q<queue.length;q++){
      const i=queue[q]!;
      const adjacent=neighbors(i);
      // Stable local rotation avoids a global row/column corridor pattern.
      const rotation=Math.floor(climateHash(seed,i%w,Math.floor(i/w),319)*4)%4;
      for(let d=0;d<4;d++){const j=adjacent[(d+rotation)%4]!;if(parent[j]===-1&&allowed(i,j)){parent[j]=i;children[i]=children[i]!+1;queue.push(j);}}
    }
  }
  for(let q=queue.length-1;q>=0;q--){const i=queue[q]!;if(protectedCells[i]&&parent[i]!==i)protectedCells[parent[i]!]=1;}
  const score=new Float64Array(n);
  for(const i of queue){
    const u=(i%w+.5)/w,v=(Math.floor(i/w)+.5)/h,favorable=Math.max(0,1-Math.abs(data.exposure[i]!-.25)/.3);
    score[i]=.45*periodicClimateNoise(u,v,Math.max(4,Math.round(Math.max(w,h)/16)),seed+211)+.25*data.humidity[i]!+.25*p.solarInfluence/100*favorable+.05*climateHash(seed,i%w,Math.floor(i/w),211);
  }
  const heap:number[]=[];
  const better=(a:number,b:number)=>score[a]!>score[b]!||(score[a]===score[b]&&a<b);
  const push=(i:number)=>{let k=heap.length;heap.push(i);while(k){const p=(k-1)>>1;if(!better(i,heap[p]!))break;heap[k]=heap[p]!;k=p;}heap[k]=i;};
  const pop=()=>{const first=heap[0]!,last=heap.pop()!;if(heap.length){let k=0;while(k*2+1<heap.length){let c=k*2+1;if(c+1<heap.length&&better(heap[c+1]!,heap[c]!))c++;if(!better(heap[c]!,last))break;heap[k]=heap[c]!;k=c;}heap[k]=last;}return first;};
  for(const i of queue)if(!children[i]&&!protectedCells[i])push(i);
  const landArea=total-wet,target=landArea*p.treePercent/100;let treeArea=0;
  while(heap.length){
    const i=pop(),area=weight(i);if(treeArea+area/2>target)break;
    data.woodland[i]=1;treeArea+=area;const par=parent[i]!;
    children[par]=children[par]!-1;if(!children[par]&&!protectedCells[par])push(par);
  }
  for(const i of queue)data.walkable[i]=data.woodland[i]?0:1;
  const metrics=metricsOf(data);
  if(Math.abs(metrics.waterPercent-p.waterPercent)>1)metrics.warnings.push('Water area target outside 1 percentage point tolerance.');
  if(Math.abs(metrics.meanElevation-p.meanElevation)>.25)metrics.warnings.push('Mean altitude target outside 0.25 unit tolerance.');
  if(Math.abs(metrics.amplitude-p.amplitude)>.5)metrics.warnings.push('Relief amplitude constrained by plateaus, sea and accessibility.');
  if(Math.abs(metrics.treePercent-p.treePercent)>1)metrics.warnings.push('Tree coverage limited by preserved natural passages.');
  if(metrics.isolatedZones)metrics.warnings.push('Isolated walkable zones: candidate cannot open.');
  metrics.warnings.push('Hydrology and local spawn are not implemented: v3 remains closed.');
  const result={...data,metrics};metrics.quality=landscapeQuality(result);
  return result;
}
