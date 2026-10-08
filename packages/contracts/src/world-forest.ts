import { climateAt, climateHash, exposureAt, periodicClimateNoise, wrapClimate } from './world-climate.js';
import type { WorldGeography, WorldGeoSample } from './world-geography.js';

/** Decorative population, persisted once. Coordinates are independent of occupancy cells. */
export interface ForestTree { x:number; y:number; elevation:number; size:number; crown:number; shade:number }
export interface WorldForest { version:1; trees:ForestTree[]; coverage:number; threshold:number }
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const delta=(a:number,b:number,size:number)=>wrapClimate(a-b+size/2,size)-size/2;
/** Local surface metric, in minor-circle cell widths; continuous across both seams. */
export function forestDistanceSquared(ax:number,ay:number,bx:number,by:number,w:number,h:number){
  const dx=delta(ax,bx,w),dy=delta(ay,by,h);
  const sx=(2.4+Math.cos((by+dy/2)/h*Math.PI*2+Math.PI))*h/w;
  return (dx*sx)**2+dy*dy;
}
export function forestPotential(g:WorldGeography,field:readonly number[],x:number,y:number){
  const u=x/g.width,v=y/g.height;
  const patch=.72*periodicClimateNoise(u,v,5,g.seed+17011)+.28*periodicClimateNoise(u,v,13,g.seed+71023);
  const moisture=climateAt(u,v,g.seed).humidity;
  const light=clamp(exposureAt(field,u,v)*4);
  return .7*patch+.22*moisture+.08*(g.parameters.solarInfluence/100)*light;
}

/** Founders -> seven dispersal cohorts -> competition. Habitat area is not tree count.
 * No runtime growth or resource grants. */
export function generateWorldForest(g:WorldGeography,field:readonly number[],sample:(x:number,y:number)=>WorldGeoSample,terrain?:readonly number[]){
  const {width:w,height:h,seed}=g,woodland=Array(w*h).fill(0) as number[];
  const sites:{i:number;score:number;weight:number}[]=[];
  let land=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(terrain?terrain[y*w+x]!==2:sample(x+.5,y+.5).depth<=0){
    const weight=2.4+Math.cos((y+.5)/h*Math.PI*2+Math.PI);
    land+=weight;sites.push({i:y*w+x,score:forestPotential(g,field,x+.5,y+.5),weight});
  }
  sites.sort((a,b)=>b.score-a.score||a.i-b.i);
  let area=0,threshold=2;
  for(const site of sites){if(area+site.weight/2>land*g.parameters.treePercent/100)break;area+=site.weight;threshold=site.score;woodland[site.i]=1;}
  if(g.parameters.treePercent===100)threshold=-1;
  const forest:WorldForest={version:1,trees:[],threshold,coverage:land?area/land*100:0};
  if(!area)return {forest,woodland};
  const bin=4,bw=w/bin,bh=h/bin,bins=new Map<number,ForestTree[]>();
  const rx=Math.ceil(1.5/(1.4*h/w)/bin)+1,ry=2;
  let serial=0;
  const random=(salt:number)=>climateHash(seed,serial,salt,93017);
  const plant=(x:number,y:number,cohort:number)=>{
    serial++;x=wrapClimate(x,w);y=wrapClimate(y,h);
    const potential=forestPotential(g,field,x,y);
    if(potential<threshold)return null;
    const s=sample(x,y);if(s.depth>0||s.elevation<s.surface+.035)return null;
    const sx=(2.4+Math.cos(y/h*Math.PI*2+Math.PI))*h/w;
    const slope=Math.hypot((sample(x+.4/sx,y).elevation-sample(x-.4/sx,y).elevation)/.8,
      (sample(x,y+.4).elevation-sample(x,y-.4).elevation)/.8);
    const edge=.15+.85*clamp((potential-threshold)/.09);
    const suitability=edge*clamp(1-slope/1.1)*(.55+.45*climateAt(x/w,y/h,seed).humidity);
    if(random(11)>suitability)return null;
    const size=.65+random(12)*.65+(7-cohort)*.035,crown=.85+random(13)*.4;
    const tree:ForestTree={x,y,elevation:s.elevation,size,crown,shade:.78+random(14)*.32};
    const bx=Math.floor(x/bin),by=Math.floor(y/bin);
    for(let dy=-ry;dy<=ry;dy++)for(let dx=-rx;dx<=rx;dx++){
      for(const other of bins.get(wrapClimate(by+dy,bh)*bw+wrapClimate(bx+dx,bw))??[]){
        const d=forestDistanceSquared(x,y,other.x,other.y,w,h);
        const collision=.28*(size*crown+other.size*other.crown);
        // Older canopies suppress most seedlings but allow a sparse understorey.
        if(d<collision**2||d<(.7*other.size*other.crown)**2&&random(15)>.18)return null;
      }
    }
    const key=by*bw+bx;if(!bins.has(key))bins.set(key,[]);bins.get(key)!.push(tree);forest.trees.push(tree);return tree;
  };
  // Uniform proposals in physical area: UV density alone overloads the inner face.
  const founders=Math.ceil(h*h*2.4/32);
  let frontier:ForestTree[]=[];
  for(let i=0;i<founders;i++){
    const x=climateHash(seed,i,0,32003)*w,y=climateHash(seed,i,1,32003)*h;
    if(climateHash(seed,i,2,32003)>(2.4+Math.cos(y/h*Math.PI*2+Math.PI))/3.4)continue;
    const tree=plant(x,y,0);if(tree)frontier.push(tree);
  }
  const limit=Math.ceil(h*h*2.4);
  for(let cohort=1;cohort<=7&&frontier.length;cohort++){
    const next:ForestTree[]=[];
    for(const parent of frontier)for(let j=0;j<5&&forest.trees.length<limit;j++){
      const angle=random(21+j)*Math.PI*2,radius=1.2+random(41+j)*3.2;
      const y=parent.y+Math.sin(angle)*radius;
      const sx=(2.4+Math.cos((parent.y+y)/2/h*Math.PI*2+Math.PI))*h/w;
      const tree=plant(parent.x+Math.cos(angle)*radius/sx,y,cohort);if(tree)next.push(tree);
    }
    frontier=next;
  }
  return {forest,woodland};
}
