import { createGeologySampler, type WorldGeologySample } from './world-geology.js';
import { generateGeologicalStoneSites } from './world-stone.js';
import { generateWorldStoneSites } from './world-stone.js';
import { forestDistanceSquared } from './world-forest.js';
import { generateWorldForest } from './world-forest.js';
import { buildExposureField, climateAt, climateHash, exposureAt, periodicClimateNoise, wrapClimate } from './world-climate.js';
import { DEFAULT_GENERATOR_PARAMETERS, type GeneratedLandscape, type GeneratorParameters } from './world-generator.js';

export const GEOGRAPHY_RECIPE_REVISION = 9;
export const DEFAULT_GEOGRAPHY_PARAMETERS:GeneratorParameters={...DEFAULT_GENERATOR_PARAMETERS,amplitude:16};
export interface WorldRiver { id:number; downstream:number|null; points:[number,number,number,number][] }
/** Coordinates and heights are in cell widths. Analysis lattice is geographic, not occupancy. */
export interface WorldGeography {
  version:1; seed:number; width:number; height:number; spacing:4;
  cutoff:number; scale:number; positiveScale:number; negativeScale:number; floor:number;
  filled:number[]; lakeDepth:number[]; parent:number[]; accumulation:number[];
  rivers:WorldRiver[]; lakes:{x:number;y:number;level:number;area:number}[];
  parameters:GeneratorParameters;
  geology?:{version:1};
  relief?:{halfRange:number;positiveExponent:number;negativeExponent:number};
}
export interface WorldGeoSample { elevation:number; base:number; surface:number; depth:number; rock:number; geology?:WorldGeologySample }
const smooth=(v:number)=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
const delta=(a:number,b:number,size:number)=>wrapClimate(a-b+size/2,size)-size/2;
function noise(g:Pick<WorldGeography,'seed'|'width'|'height'>,x:number,y:number){
  const u=x/g.width,v=y/g.height;
  const du=(periodicClimateNoise(u,v,3,g.seed+1981)-.5)*.11;
  const dv=(periodicClimateNoise(u,v,3,g.seed+8917)-.5)*.11;
  return .57*periodicClimateNoise(u+du,v+dv,3,g.seed)+.29*periodicClimateNoise(u+du,v+dv,7,g.seed+713)+.14*periodicClimateNoise(u,v,17,g.seed+937);
}
export function geographicBase(g:WorldGeography,x:number,y:number){
  const raw=(noise(g,x,y)-g.cutoff)*g.scale; let z=raw*(raw>0?g.positiveScale:g.negativeScale);
  if(g.relief)z=Math.sign(z)*g.relief.halfRange*Math.pow(Math.min(1,Math.abs(z)),z>0?g.relief.positiveExponent:g.relief.negativeExponent);
  if(z<=0)return z;
  // Broad flat interiors joined by smooth shoulders. No cell boundary participates.
  const level=z/.25,whole=Math.floor(level),fraction=level-whole;
  return Math.min(g.relief?.halfRange??Infinity,.25*(whole+smooth((fraction-.22)/.56)));
}
function interpolate(g:WorldGeography,values:number[],x:number,y:number){
  const w=g.width/g.spacing,h=g.height/g.spacing,px=wrapClimate(x,g.width)/g.spacing,py=wrapClimate(y,g.height)/g.spacing;
  const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
  const at=(a:number,b:number)=>values[wrapClimate(b,h)*w+wrapClimate(a,w)]!;
  return (at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;
}
class MinHeap {
  private entries:{id:number;z:number}[]=[];
  get length(){return this.entries.length;}
  push(id:number,z:number){const a=this.entries,e={id,z};let i=a.length;a.push(e);while(i){const p=(i-1)>>1;if(a[p]!.z<z||a[p]!.z===z&&a[p]!.id<id)break;a[i]=a[p]!;i=p;}a[i]=e;}
  pop(){const a=this.entries,result=a[0]!,tail=a.pop()!;if(a.length){let i=0;while(2*i+1<a.length){let j=2*i+1;if(j+1<a.length&&(a[j+1]!.z<a[j]!.z||a[j+1]!.z===a[j]!.z&&a[j+1]!.id<a[j]!.id))j++;if(a[j]!.z>tail.z||a[j]!.z===tail.z&&a[j]!.id>tail.id)break;a[i]=a[j]!;i=j;}a[i]=tail;}return result;}
}
/** Global priority flood: parents always point to an already removed node, so no drainage cycles. */
export function createWorldGeography(seed:number,width:number,height:number,p:GeneratorParameters,recipeRevision=GEOGRAPHY_RECIPE_REVISION):WorldGeography{
  if(!Number.isSafeInteger(seed)||seed<0||seed>2147483647||width<64||height<64||width>512||height>512||width%32||height%32)throw Error('Invalid geography domain');
  const g:WorldGeography={version:1,seed,width,height,spacing:4,cutoff:0,scale:1,positiveScale:1,negativeScale:1,floor:0,filled:[],lakeDepth:[],parent:[],accumulation:[],rivers:[],lakes:[],parameters:{...p}};
  const w=width/4,h=height/4,n=w*h;
  const heights=Array.from({length:n},(_,i)=>noise(g,(i%w)*4,Math.floor(i/w)*4));
  const order=heights.map((z,i)=>({z,i,weight:2.4+Math.cos(Math.floor(i/w)/h*Math.PI*2+Math.PI)})).sort((a,b)=>a.z-b.z||a.i-b.i);
  const total=order.reduce((s,e)=>s+e.weight,0);let sum=0;
  g.cutoff=order[0]!.z-1e-4;
  for(const e of order){if(sum>=total*p.waterPercent/100)break;g.cutoff=e.z;sum+=e.weight;}
  if(p.waterPercent===100)g.cutoff=order[n-1]!.z+1e-4;
  g.scale=Math.max(.02,p.amplitude*.25)/(order[n-1]!.z-order[0]!.z||1);
  const positiveMax=Math.max(0,order[n-1]!.z-g.cutoff),negativeMax=Math.max(0,g.cutoff-order[0]!.z);
  if(positiveMax>1e-6&&negativeMax>1e-6){
    let positiveMean=0,negativeMean=0;
    for(const e of order){const z=e.z-g.cutoff;if(z>0)positiveMean+=z*e.weight/total;else negativeMean-=z*e.weight/total;}
    const range=Math.max(.02,p.amplitude*.25),mean=p.meanElevation*.25;
    const a=Math.max(range*.025/positiveMax,Math.min(range*.975/positiveMax,(mean+range*negativeMean/negativeMax)/(positiveMean+positiveMax*negativeMean/negativeMax)));
    const b=(range-a*positiveMax)/negativeMax;
    g.positiveScale=a/g.scale;g.negativeScale=b/g.scale;
  }
  if(recipeRevision>=8){
    // r8 amplitude is a symmetric bound about sea level, never peak-to-trough.
    g.scale=1;g.positiveScale=1/Math.max(1e-9,positiveMax);g.negativeScale=1/Math.max(1e-9,negativeMax);
    const halfRange=p.amplitude*.25;
    g.relief={halfRange,positiveExponent:1,negativeExponent:1};
    // Adjust the distribution, not the extrema, to approach the requested average.
    let low=-4,high=4;
    for(let pass=0;pass<28;pass++){
      const t=(low+high)/2;g.relief.positiveExponent=Math.exp(-t);g.relief.negativeExponent=Math.exp(t);
      let mean=0;
      for(const e of order){let z=(e.z-g.cutoff)*(e.z>g.cutoff?g.positiveScale:g.negativeScale);
        z=Math.sign(z)*halfRange*Math.pow(Math.min(1,Math.abs(z)),z>0?g.relief.positiveExponent:g.relief.negativeExponent);
        if(z>0){const level=z/.25,whole=Math.floor(level);z=.25*(whole+smooth((level-whole-.22)/.56));}
        mean+=z*e.weight/total;
      }
      if(mean<p.meanElevation*.25)low=t;else high=t;
    }
  }
  const base=heights.map((_,i)=>geographicBase(g,(i%w)*4,Math.floor(i/w)*4));
  g.filled=[...base];g.parent=Array(n).fill(-1) as number[];g.accumulation=Array(n).fill(1) as number[];
  const marine=heights.map(z=>z<=g.cutoff);
  const seen=new Uint8Array(n),heap=new MinHeap(),processed:number[]=[];
  for(let i=0;i<n;i++)if(marine[i]){seen[i]=1;g.filled[i]=0;heap.push(i,0);}
  // A closed torus without sea needs an endorheic outlet, never a fake boundary drain.
  if(!heap.length){const i=base.indexOf(Math.min(...base));seen[i]=1;heap.push(i,base[i]!);g.floor=base[i]!;}
  const adjacent=(i:number)=>{const x=i%w,y=Math.floor(i/w);return [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]].map(([dx,dy])=>wrapClimate(y+dy!,h)*w+wrapClimate(x+dx!,w));};
  while(heap.length){const {id:i,z}=heap.pop();processed.push(i);for(const j of adjacent(i))if(!seen[j]){seen[j]=1;g.parent[j]=i;g.filled[j]=Math.max(base[j]!,z);heap.push(j,g.filled[j]!);}}
  for(let k=processed.length-1;k>=0;k--){const i=processed[k]!,j=g.parent[i]!;if(j>=0)g.accumulation[j]=g.accumulation[j]!+g.accumulation[i]!;}
  g.lakeDepth=g.filled.map((z,i)=>base[i]!>0?Math.max(0,z-base[i]!):0);
  const lakeSeen=new Uint8Array(n);
  for(let i=0;i<n;i++)if(!lakeSeen[i]&&g.filled[i]!>0&&g.filled[i]!-base[i]!>.07){
    const queue=[i];lakeSeen[i]=1;let best=i;
    for(let k=0;k<queue.length;k++)for(const j of adjacent(queue[k]!))if(!lakeSeen[j]&&g.filled[j]===g.filled[i]&&g.filled[j]!-base[j]!>.035){lakeSeen[j]=1;queue.push(j);if(g.filled[j]!-base[j]!>g.filled[best]!-base[best]!)best=j;}
    if(queue.length>=2)g.lakes.push({x:best%w*4,y:Math.floor(best/w)*4,level:g.filled[i]!-.035,area:queue.length*16});
  }
  const threshold=Math.max(20,Math.round(n/80)),channel=(i:number)=>!marine[i]&&g.accumulation[i]!>=threshold;
  const upstream=new Uint16Array(n);for(let i=0;i<n;i++)if(channel(i)&&g.parent[i]!>=0&&channel(g.parent[i]!))upstream[g.parent[i]!]=upstream[g.parent[i]!]!+1;
  const starts=processed.filter(i=>channel(i)&&upstream[i]!==1),owner=new Map<number,number>();
  for(const start of starts){
    const nodes=[start];let i=start;
    while(g.parent[i]!>=0){i=g.parent[i]!;nodes.push(i);if(!channel(i)||upstream[i]!==1)break;}
    if(nodes.length<2)continue;
    const points:WorldRiver['points']=[];
    for(const node of nodes){const prev=points[points.length-1],x=node%w*4,y=Math.floor(node/w)*4;
      points.push([prev?prev[0]+delta(x,prev[0],width):x,prev?prev[1]+delta(y,prev[1],height):y,Math.max(0,g.filled[node]!-.035),Math.min(8,5+Math.log2(g.accumulation[node]!/threshold+1))]);}
    // Two bounded corner-cutting passes preserve endpoints and monotonically descending levels.
    let curved=points;
    for(let pass=0;pass<2;pass++){const next:WorldRiver['points']=[curved[0]!];for(let k=1;k<curved.length;k++){const a=curved[k-1]!,b=curved[k]!;for(const t of [.25,.75])next.push(a.map((v,j)=>v+(b[j]!-v)*t) as [number,number,number,number]);}next.push(curved[curved.length-1]!);curved=next;}
    const id=g.rivers.length;owner.set(start,id);g.rivers.push({id,downstream:null,points:curved});
  }
  for(const river of g.rivers){const end=river.points[river.points.length-1]!,node=wrapClimate(Math.round(end[1]/4),h)*w+wrapClimate(Math.round(end[0]/4),w);river.downstream=owner.get(node)??null;}
  if(p.waterPercent===0||recipeRevision>=8&&p.amplitude===0){g.rivers=[];g.lakes=[];g.lakeDepth.fill(0);}
  if(recipeRevision>=9)g.geology={version:1};
  return g;
}
interface Segment {a:WorldRiver['points'][number];b:WorldRiver['points'][number]}
const indexes=new WeakMap<WorldGeography,Map<number,Segment[]>>();
function riverIndex(g:WorldGeography){
  let index=indexes.get(g);if(index)return index;index=new Map();const w=Math.ceil(g.width/16),h=Math.ceil(g.height/16);
  for(const r of g.rivers)for(let i=1;i<r.points.length;i++){const segment={a:r.points[i-1]!,b:r.points[i]!},ids=new Set<number>();
    for(let y=Math.floor((Math.min(segment.a[1],segment.b[1])-7)/16);y<=Math.floor((Math.max(segment.a[1],segment.b[1])+7)/16);y++)for(let x=Math.floor((Math.min(segment.a[0],segment.b[0])-7)/16);x<=Math.floor((Math.max(segment.a[0],segment.b[0])+7)/16);x++)ids.add(wrapClimate(y,h)*w+wrapClimate(x,w));
    for(const id of ids){if(!index.has(id))index.set(id,[]);index.get(id)!.push(segment);}
  }indexes.set(g,index);return index;
}
export function sampleWorldTopography(g:WorldGeography,x:number,y:number):WorldGeoSample{
  x=wrapClimate(x,g.width);y=wrapClimate(y,g.height);
  const base=geographicBase(g,x,y);let elevation=base,surface=interpolate(g,g.lakeDepth,x,y)>.035?Math.max(0,interpolate(g,g.filled,x,y)-.035):0;
  for(const {a,b} of riverIndex(g).get(Math.floor(y/16)*Math.ceil(g.width/16)+Math.floor(x/16))??[]){
    const px=a[0]+delta(x,a[0],g.width),py=a[1]+delta(y,a[1],g.height),dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
    const t=l?Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/l)):0;
    const distance=Math.hypot(px-a[0]-dx*t,py-a[1]-dy*t),width=a[3]+(b[3]-a[3])*t;
    const radius=width/2*(1+.045*Math.sin(2*Math.PI*(x/g.width*41+y/g.height*23)+g.seed));
    if(distance>radius+1.5)continue;
    const level=a[2]+(b[2]-a[2])*t,blend=1-smooth((distance-radius+1)/2.5);
    elevation=Math.min(elevation,base*(1-blend)+(level-.24)*blend);
    if(distance<radius+.5)surface=Math.max(surface,level);
  }
  if(g.relief)elevation=Math.max(-g.relief.halfRange,elevation);
  // Dry micro-facets only: they cannot open cracks or alter the water's level.
  const rock=g.relief
    ? Math.max(smooth((base-.3)/1.5)*.8,smooth((periodicClimateNoise(x/g.width,y/g.height,11,g.seed+511)-.47)/.24)*.9)
    : smooth((base-.45)/.7)*(.35+.65*periodicClimateNoise(x/g.width,y/g.height,23,g.seed+511));
  return {base,elevation,surface,depth:Math.max(0,surface-elevation),rock};
}
const geologySamplers=new WeakMap<WorldGeography,ReturnType<typeof createGeologySampler>>();
export function sampleWorldGeology(g:WorldGeography,x:number,y:number){
 let sampler=geologySamplers.get(g);
 if(!sampler){sampler=createGeologySampler(g,(x,y)=>sampleWorldTopography(g,x,y));geologySamplers.set(g,sampler);}
 return sampler(x,y);
}
export function sampleWorldGeography(g:WorldGeography,x:number,y:number):WorldGeoSample{
 const s=sampleWorldTopography(g,x,y);if(!g.geology)return s;
 const geology=sampleWorldGeology(g,x,y);
 return {...s,elevation:geology.elevation,depth:Math.max(0,s.surface-geology.elevation),rock:geology.exposure,geology};
}
export function generateGeographicLandscape(seed:number,width:number,height:number,p:GeneratorParameters,recipeRevision=GEOGRAPHY_RECIPE_REVISION):GeneratedLandscape{
  let geography=createWorldGeography(seed,width,height,p,recipeRevision),best=geography,bestError=Infinity,target=p.waterPercent;
  // Include inland water in the area target, measured on the physical torus (not texel count).
  for(let attempt=0;attempt<4;attempt++){
    if(attempt)geography=createWorldGeography(seed,width,height,{...p,waterPercent:target},recipeRevision);
    let total=0,wet=0;
    for(let y=1;y<height;y+=2)for(let x=1;x<width;x+=2){const weight=2.4+Math.cos(y/height*Math.PI*2+Math.PI);total+=weight;if(sampleWorldGeography(geography,x,y).depth>1e-6)wet+=weight;}
    const error=wet/total*100-p.waterPercent;
    if(Math.abs(error)<bestError){best=geography;bestError=Math.abs(error);}
    if(Math.abs(error)<.6||p.waterPercent===0||p.waterPercent===100)break;
    target=Math.max(.1,Math.min(99.9,target-error*.85));
  }
  geography=best;geography.parameters={...p};
  const field=buildExposureField(),n=width*height;
  const data:GeneratedLandscape={version:3,recipeRevision,climateRevision:1,width,height,seed,altitudeCellRatio:.25,geography,
    elevations:[],terrainCodes:[],woodland:[],exposure:[],humidity:[],walkable:Array(n).fill(0) as number[],components:Array(n).fill(-1) as number[],stairs:[],
    metrics:{waterPercent:0,meanElevation:0,minElevation:Infinity,maxElevation:-Infinity,amplitude:0,treePercent:0,landComponents:0,accessibleComponents:0,isolatedZones:0,stairCount:0,warnings:[]}};
  let area=0,wet=0,land=0,trees=0,sum=0;const treeSites:{i:number;score:number;weight:number}[]=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const s=sampleWorldGeography(geography,x+.5,y+.5),exposure=exposureAt(field,(x+.5)/width,(y+.5)/height),humidity=climateAt(x/width,y/height,seed).humidity;
    // Closed-world compatibility projection only; integer DB chunks are NOT the geography.
    data.elevations.push(Math.round(s.elevation*4));data.terrainCodes.push(s.depth>0?2:0);data.woodland.push(0);data.exposure.push(exposure);data.humidity.push(humidity);
    const weight=2.4+Math.cos((y+.5)/height*Math.PI*2+Math.PI);if(recipeRevision===6&&s.depth<=0)treeSites.push({i:y*width+x,weight,score:-Math.log(Math.max(1e-9,climateHash(seed,x,y,8191)))/Math.max(.01,(1-p.solarInfluence/100)+p.solarInfluence/100*Math.min(2,exposure*5))});area+=weight;sum+=s.elevation*4*weight;if(s.depth>0)wet+=weight;else land+=weight;
    data.metrics.minElevation=Math.min(data.metrics.minElevation,s.elevation*4);data.metrics.maxElevation=Math.max(data.metrics.maxElevation,s.elevation*4);
  }
  data.woodland.fill(0);trees=0;treeSites.sort((a,b)=>a.score-b.score||a.i-b.i);
  for(const site of treeSites){if(trees+site.weight/2>land*p.treePercent/100)break;data.woodland[site.i]=1;trees+=site.weight;}
  if(recipeRevision>=7){const result=generateWorldForest(geography,field,(x,y)=>sampleWorldGeography(geography,x,y),data.terrainCodes);data.forest=result.forest;data.woodland=result.woodland;trees=land*result.forest.coverage/100;}
  if(recipeRevision>=8){
    data.stoneSites=recipeRevision>=9
      ? generateGeologicalStoneSites(geography,(x,y)=>sampleWorldGeography(geography,x,y))
      : generateWorldStoneSites(geography,(x,y)=>sampleWorldGeography(geography,x,y));
    // Rocks are visible clearings, not trees intersecting boulders. Preserve r7 unchanged.
    if(data.forest)data.forest.trees=data.forest.trees.filter(t=>recipeRevision>=9
      ? sampleWorldGeography(geography,t.x,t.y).rock<.45 && !data.stoneSites!.some(site=>site.rocks.some(r=>
        forestDistanceSquared(t.x,t.y,r.x,r.y,width,height)<Math.pow(Math.max(r.width,r.depth)*.8,2)))
      : !data.stoneSites!.some(site=>forestDistanceSquared(t.x,t.y,site.x,site.y,width,height)<30));
  }
  Object.assign(data.metrics,{waterPercent:wet/area*100,meanElevation:sum/area,amplitude:data.metrics.maxElevation-data.metrics.minElevation,treePercent:land?trees/land*100:0});
  data.metrics.warnings.push('Geographic preview only: traversal, spawn, tides and waterfalls are not certified for this recipe.');
  if(Math.abs(data.metrics.waterPercent-p.waterPercent)>1)data.metrics.warnings.push('Water area target outside 1 percentage point tolerance.');
  if(Math.abs(data.metrics.amplitude-p.amplitude*(recipeRevision>=8?2:1))>.5)data.metrics.warnings.push('Relief amplitude constrained by plateaus, sea and accessibility.');
  if(Math.abs(data.metrics.meanElevation-p.meanElevation)>.25)data.metrics.warnings.push('Mean altitude target outside 0.25 unit tolerance.');
  return data;
}
