import { generateGeographicLandscape } from './world-geography.js';
import { addHydrology } from './world-hydrology.js';
import { generateTerracedLandscape } from './world-landscape-recipe.js';
import { createLandscapeStairAccess, isLandscapeStairSide, naturalStairPairs, type GeneratedLandscape, type GeneratorParameters, type NaturalStair } from './world-generator.js';
import { buildExposureField, climateAt, climateHash, exposureAt, periodicClimateNoise } from './world-climate.js';
const BLOCK=8;
export const ALTITUDE_CELL_RATIO=.25;
class Sets {
  readonly parent:Int32Array;
  constructor(size:number){this.parent=Int32Array.from({length:size},(_,i)=>i);}
  find(i:number):number {while(this.parent[i]!==i){this.parent[i]=this.parent[this.parent[i]!]!;i=this.parent[i]!;}return i;}
  join(a:number,b:number){a=this.find(a);b=this.find(b);if(a!==b)this.parent[Math.max(a,b)]=Math.min(a,b);}
}
export function landscapeNeighbors(i:number,w:number,h:number):number[] {
  const x=i%w,y=Math.floor(i/w);
  return [y*w+(x+1)%w,((y+1)%h)*w+x,y*w+(x+w-1)%w,((y+h-1)%h)*w+x];
}
export function landscapeMetrics(data:Omit<GeneratedLandscape,'metrics'>):GeneratedLandscape['metrics'] {
  const {width:w,height:h}=data, n=w*h, accessible=new Sets(n), lands=new Sets(n);
  const {cells:stairCells,edges:stairEdges}=createLandscapeStairAccess(data);
  let area=0,wet=0,altitude=0,landArea=0,trees=0,min=Infinity,max=-Infinity;
  for(let i=0;i<n;i++){
    const weight=2.4+Math.cos((Math.floor(i/w)+.5)/h*Math.PI*2+Math.PI);
    area+=weight;altitude+=data.elevations[i]!*weight;
    min=Math.min(min,data.elevations[i]!);max=Math.max(max,data.elevations[i]!);
    if(data.terrainCodes[i]===2)wet+=weight;else{landArea+=weight;if(data.woodland[i])trees+=weight;}
    for(const j of landscapeNeighbors(i,w,h).slice(0,2)){
      if(data.terrainCodes[i]!==2&&data.terrainCodes[j]!==2)lands.join(i,j);
      const side=isLandscapeStairSide(stairCells,i,j,w);
      if(!side&&data.walkable[i]&&data.walkable[j]&&(data.elevations[i]===data.elevations[j]||stairEdges.has([i,j].sort((a,b)=>a-b).join(':'))))accessible.join(i,j);
    }
  }
  const components=new Map<number,number>(), terrestrial=new Set<number>(), perLand=new Map<number,Set<number>>();
  for(let i=0;i<n;i++){
    if(data.terrainCodes[i]!==2)terrestrial.add(lands.find(i));
    if(data.walkable[i]){
      const root=accessible.find(i),land=lands.find(i);
      if(!perLand.has(land))perLand.set(land,new Set());perLand.get(land)!.add(root);
      if(!components.has(root))components.set(root,components.size);
      data.components[i]=components.get(root)!;
    }else data.components[i]=-1;
  }
  return {waterPercent:wet/area*100,meanElevation:altitude/area,minElevation:min,maxElevation:max,
    amplitude:max-min,treePercent:landArea?trees/landArea*100:0,landComponents:terrestrial.size,
    accessibleComponents:components.size,isolatedZones:[...perLand.values()].reduce((sum,regions)=>sum+Math.max(0,regions.size-1),0),
    landsWithoutAccess:terrestrial.size-perLand.size,stairCount:data.stairs.length,warnings:[]};
}
/** Exploratory v3: periodic flat terraces, compact explicit stairs, no reserved spawn clearing. */
export function generateLandscape(seed:number,w:number,h:number,p:GeneratorParameters,recipeRevision=5):GeneratedLandscape {
  if(w<64||h<64||w%32||h%32||w*h>262144)throw new Error('Invalid bounded landscape dimensions');
  if(recipeRevision===6||recipeRevision===7||recipeRevision===8||recipeRevision===9||recipeRevision===10||recipeRevision===11)return generateGeographicLandscape(seed,w,h,p,recipeRevision);
  if(recipeRevision===3||recipeRevision===4||recipeRevision===5){
    let target=p.waterPercent,best:GeneratedLandscape|undefined,bestError=Infinity;
    for(let attempt=0;attempt<3;attempt++){
      const candidate=addHydrology(generateTerracedLandscape(seed,w,h,{...p,waterPercent:target},landscapeMetrics),p,recipeRevision);
      const error=Math.abs(candidate.metrics.waterPercent-p.waterPercent);
      if(error<bestError){best=candidate;bestError=error;}
      if(error<=1||p.waterPercent===0||p.waterPercent===100)break;
      target=Math.max(0,Math.min(100,target+p.waterPercent-candidate.metrics.waterPercent));
    }
    return best!;
  }
  if(recipeRevision===2)return generateTerracedLandscape(seed,w,h,p,landscapeMetrics);
  if(recipeRevision!==0)throw new Error('Unsupported landscape recipe revision');
  return generateLegacyLandscape(seed,w,h,p);
}
export function generateLegacyLandscape(seed:number,w:number,h:number,p:GeneratorParameters):GeneratedLandscape {
  if(w<64||h<64||w%32||h%32||w*h>262144)throw new Error('Invalid bounded landscape dimensions');
  const bw=w/BLOCK,bh=h/BLOCK,bn=bw*bh,noise:number[]=[],weights:number[]=[];
  for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){
    noise.push(.7*periodicClimateNoise((x+.5)/bw,(y+.5)/bh,2,seed)+.3*periodicClimateNoise((x+.5)/bw,(y+.5)/bh,4,seed+1));
    weights.push(2.4+Math.cos((y+.5)/bh*Math.PI*2+Math.PI));
  }
  const order=Array.from({length:bn},(_,i)=>i).sort((a,b)=>noise[a]!-noise[b]!||a-b);
  const sea=new Uint8Array(bn),total=weights.reduce((a,b)=>a+b,0);let water=0;
  for(const i of order){if(water+weights[i]!/2>total*p.waterPercent/100)break;sea[i]=1;water+=weights[i]!;}
  const low=Math.min(...noise),high=Math.max(...noise),amplitude=Math.round(p.amplitude);
  const raw=noise.map(v=>(v-low)/(high-low||1)*amplitude-amplitude/2);
  let best:number[]=[],bestError=Infinity;
  // Bounded calibration. Impossible combinations remain explicit target/result discrepancies.
  for(let k=-32;k<=32;k++){
    const offset=k/4;
    const levels=raw.map((v,i)=>sea[i]?Math.max(-8,Math.min(-1,Math.round(v+offset))):Math.max(1,Math.min(8,Math.round(v+offset))));
    // Keep neighboring land plateaus within one unit. Each transition gets its own short staircase.
    for(let pass=0;pass<16;pass++){
      let changed=false;
      for(let i=0;i<bn;i++)if(!sea[i])for(const j of landscapeNeighbors(i,bw,bh))if(!sea[j]&&levels[i]!>levels[j]!+1){levels[i]=levels[j]!+1;changed=true;}
      if(!changed)break;
    }
    const mean=levels.reduce((a,v,i)=>a+v*weights[i]!,0)/total;
    const error=Math.abs(mean-p.meanElevation)+.03*Math.abs(Math.max(...levels)-Math.min(...levels)-p.amplitude);
    if(error<bestError){bestError=error;best=levels;}
  }
  const exposureField=buildExposureField(),n=w*h;
  const data:Omit<GeneratedLandscape,'metrics'>={version:3,width:w,height:h,seed,altitudeCellRatio:ALTITUDE_CELL_RATIO,
    elevations:new Array(n),terrainCodes:new Array(n),woodland:new Array(n).fill(0),
    exposure:new Array(n),humidity:new Array(n),walkable:new Array(n).fill(0),components:new Array(n).fill(-1),stairs:[]};
  const corridors=new Uint8Array(n);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,b=Math.floor(y/BLOCK)*bw+Math.floor(x/BLOCK);
    data.elevations[i]=best[b]!;data.terrainCodes[i]=sea[b]?2:1;
    data.exposure[i]=exposureAt(exposureField,(x+.5)/w,(y+.5)/h);
    data.humidity[i]=climateAt((x+.5)/w,(y+.5)/h,seed).humidity;
    // Connected natural corridors, not roads or player clearing reservations.
    if(x%BLOCK===4||y%BLOCK===4)corridors[i]=1;
  }
  const addStair=(a:number,b:number,direction:0|1)=>{
    if(data.terrainCodes[a]!==1||data.terrainCodes[b]!==1||data.elevations[a]===data.elevations[b])return;
    if(Math.abs(data.elevations[a]!-data.elevations[b]!)>1)return;
    const stair:NaturalStair={x:a%w-(direction===1?2:0),y:Math.floor(a/w)-(direction===0?2:0),direction,length:2,width:4,
      low:Math.min(data.elevations[a]!,data.elevations[b]!),high:Math.max(data.elevations[a]!,data.elevations[b]!),from:a,to:b};
    data.stairs.push(stair);for(const pair of naturalStairPairs(stair,w,h))for(const cell of pair)corridors[cell]=1;
  };
  for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){
    addStair((y*BLOCK+4)*w+x*BLOCK+7,(y*BLOCK+4)*w+((x+1)%bw)*BLOCK,0);
    addStair((y*BLOCK+7)*w+x*BLOCK+4,(((y+1)%bh)*BLOCK)*w+x*BLOCK+4,1);
  }
  const candidates:Array<{i:number;score:number;weight:number}>=[];
  let eligibleArea=0;
  for(let i=0;i<n;i++)if(data.terrainCodes[i]===1){
    const weight=2.4+Math.cos((Math.floor(i/w)+.5)/h*Math.PI*2+Math.PI);eligibleArea+=weight;
    if(!corridors[i]){
      // Exploratory ecological curve favors moderate exposure, not monotonically more sunlight.
      const favorable=Math.max(0,1-Math.abs(data.exposure[i]!-.25)/.3);
      const influence=p.solarInfluence/100;
      candidates.push({i,weight,score:climateHash(seed,i%w,Math.floor(i/w),211)*.55+data.humidity[i]!*.25+favorable*influence*.2});
    }
  }
  candidates.sort((a,b)=>b.score-a.score||a.i-b.i);
  let treeArea=0;
  for(const c of candidates){if(treeArea+c.weight/2>eligibleArea*p.treePercent/100)break;data.woodland[c.i]=1;treeArea+=c.weight;}
  // Every unoccupied cell in each flat block must reach its preserved central passage.
  // Repair trapped pockets with bounded strips leading to the central passage, avoiding stair sides.
  const {cells:stairCells}=createLandscapeStairAccess(data);
  for(let by=0;by<bh;by++)for(let bx=0;bx<bw;bx++){
    if(sea[by*bw+bx])continue;
    const originX=bx*BLOCK,originY=by*BLOCK,seen=new Uint8Array(BLOCK*BLOCK),queue:number[]=[4*BLOCK+4];seen[queue[0]!]=1;
    for(let q=0;q<queue.length;q++){
      const cell=queue[q]!,x=cell%BLOCK,y=Math.floor(cell/BLOCK);
      for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const xx=x+dx!,yy=y+dy!;
        if(xx<0||xx>=BLOCK||yy<0||yy>=BLOCK)continue;
        const j=yy*BLOCK+xx,i=(originY+yy)*w+originX+xx;
        const current=(originY+y)*w+originX+x;
        const side=isLandscapeStairSide(stairCells,current,i,w);
        if(!side&&!seen[j]&&!data.woodland[i]){seen[j]=1;queue.push(j);}
      }
    }
    // Shortest bounded detours through vegetation, respecting the complete stair sides.
    const parents=new Int16Array(BLOCK*BLOCK).fill(-1),paths=[4*BLOCK+4];parents[paths[0]!]=paths[0]!;
    for(let q=0;q<paths.length;q++){
      const cell=paths[q]!,x=cell%BLOCK,y=Math.floor(cell/BLOCK);
      for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const xx=x+dx!,yy=y+dy!;if(xx<0||xx>=BLOCK||yy<0||yy>=BLOCK)continue;
        const next=yy*BLOCK+xx,current=(originY+y)*w+originX+x,target=(originY+yy)*w+originX+xx;
        if(parents[next]===-1&&!isLandscapeStairSide(stairCells,current,target,w)){parents[next]=cell;paths.push(next);}
      }
    }
    for(let cell=0;cell<BLOCK*BLOCK;cell++){
      const i=(originY+Math.floor(cell/BLOCK))*w+originX+cell%BLOCK;
      if(!seen[cell]&&!data.woodland[i]){
        let step=cell;
        for(let n=0;n<BLOCK*BLOCK;n++){
          if(parents[step]===-1)throw new Error('Stair footprint isolates a plateau cell');
          data.woodland[(originY+Math.floor(step/BLOCK))*w+originX+step%BLOCK]=0;
          if(seen[step]||parents[step]===step)break;
          step=parents[step]!;
        }
      }
    }
  }
  for(let i=0;i<n;i++)data.walkable[i]=data.terrainCodes[i]===1&&!data.woodland[i]?1:0;
  const metrics=landscapeMetrics(data);
  if(Math.abs(metrics.waterPercent-p.waterPercent)>1)metrics.warnings.push('Water area target outside 1 percentage point tolerance.');
  if(Math.abs(metrics.meanElevation-p.meanElevation)>.25)metrics.warnings.push('Mean altitude target outside 0.25 unit tolerance.');
  if(Math.abs(metrics.amplitude-p.amplitude)>.5)metrics.warnings.push('Relief amplitude constrained by plateaus, sea and accessibility.');
  if(Math.abs(metrics.treePercent-p.treePercent)>1)metrics.warnings.push('Tree coverage limited by preserved natural passages.');
  if(metrics.isolatedZones)metrics.warnings.push('Isolated walkable zones: candidate cannot open.');
  metrics.warnings.push('Hydrology and local spawn are not implemented: v3 remains closed.');
  return {...data,metrics};
}
