import {climateHash,periodicClimateNoise,wrapClimate} from './world-climate.js';
/** Two lobes on one non-separating marine loop. Its complement can stay connected. */
export interface WorldOceans {version:1;phase:number;channelWidth:number;straitRatio:number;plateaus:{x:number;y:number;elevation:number}[]}
export function createWorldOceans(seed:number,channelWidth:number,height:number):WorldOceans {
 return {version:1,phase:climateHash(seed,0,0,92173),channelWidth,straitRatio:Math.min(.09,channelWidth/height),plateaus:[]};
}
export function oceanCenter(o:WorldOceans,u:number):number {
 const a=(u-o.phase)*Math.PI*2;
 return .25-.25*Math.cos(a)+.018*Math.sin(2*a);
}
export function oceanField(o:WorldOceans,seed:number,u:number,v:number):number {
 const a=(u-o.phase)*Math.PI*2,center=oceanCenter(o,u);
 // A smooth periodic warp changes shore shapes without imposing occupancy edges.
 const bend=(periodicClimateNoise(u,v,5,seed+18013)-.5)*.035;
 const d=Math.abs(wrapClimate(v-center+bend+.5,1)-.5);
 const lobe=.075+o.straitRatio+(.115-o.straitRatio)*Math.pow(Math.cos(a),2);
 const texture=periodicClimateNoise(u,v,9,seed+7187)-.5;
 return .5+(d-lobe)*.9+texture*.07*Math.min(1,d/.08);
}
export interface OceanInspection {
 version:1; highTide:number; minimumDepth:number; corridorWidth:number;
 marineLoop:boolean; minimumLoopDepth:number; landComponents:number; mainLandCells:number;
 plateaus:{x:number;y:number;elevation:number}[]; mainLand:number[];
}
/** Preview qualification, independent of Babylon and of gameplay walk permissions.
 * Cardinal steps, a dry 3x3 footprint and at most one altitude unit per cell.
 * mainLand is a diagnostic mask; it never replaces the authoritative pathfinder. */
export function inspectOceanConnections(width:number,height:number,o:WorldOceans,
 sample:(x:number,y:number)=>{elevation:number;surface:number;depth:number}):OceanInspection {
 const highTide=.0625,minimumDepth=.125,n=width*height,heights=new Float64Array(n),dry=new Uint8Array(n);
 const at=(x:number,y:number)=>wrapClimate(y,height)*width+wrapClimate(x,width);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const s=sample(x+.5,y+.5),i=at(x,y);heights[i]=s.elevation;
  dry[i]=Number(s.elevation>Math.max(highTide,s.surface+.02));
 }
 const usable=new Uint8Array(n);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let ok=true;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(!dry[at(x+dx,y+dy)])ok=false;
  usable[at(x,y)]=Number(ok);
 }
 const seen=new Uint8Array(n);let landComponents=0,best:number[]=[];
 for(let i=0;i<n;i++)if(usable[i]&&!seen[i]){
  const queue=[i];seen[i]=1;landComponents++;
  for(let k=0;k<queue.length;k++){const j=queue[k]!,x=j%width,y=Math.floor(j/width);
   for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const next=at(x+dx!,y+dy!);
    if(!seen[next]&&usable[next]&&Math.abs(heights[next]!-heights[j]!)<=.25){seen[next]=1;queue.push(next);}
   }
  }if(queue.length>best.length)best=queue;
 }
 const mainLand=Array<number>(n).fill(0);for(const i of best)mainLand[i]=1;
 const plateaus:OceanInspection['plateaus']=[];
 // Actual 5x5 level neighbourhoods, all in the same dry traversable component.
 for(const i of [...best].sort((a,b)=>a-b)){
  const x=i%width,y=Math.floor(i/width);let ok=true;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
   const j=at(x+dx,y+dy);if(!mainLand[j]||Math.abs(heights[j]!-heights[i]!)>.025)ok=false;
  }
  if(ok&&plateaus.every(p=>Math.hypot(Math.min(Math.abs(p.x-x),width-Math.abs(p.x-x)),Math.min(Math.abs(p.y-y),height-Math.abs(p.y-y)))>=12))plateaus.push({x:x+.5,y:y+.5,elevation:heights[i]!});
 }
 let minimumLoopDepth=Infinity,atSeaLevel=true;
 // Unwrapped path makes one full longitudinal winding; test both banks of a corridor.
 for(let x=0;x<width;x+=.5){
  const u=x/width,y=oceanCenter(o,u)*height;
  const dy=(oceanCenter(o,u+.0001)-oceanCenter(o,u-.0001))*height/.0002/width;
  const length=Math.hypot(1,dy),nx=-dy/length,ny=1/length;
  for(let offset=-o.channelWidth/2;offset<=o.channelWidth/2;offset+=.5){
   const s=sample(x+nx*offset,y+ny*offset);
   // Ocean route must be at sea level, not merely inside an elevated lake.
   atSeaLevel=atSeaLevel&&Math.abs(s.surface)<1e-5;
   minimumLoopDepth=Math.min(minimumLoopDepth,-s.elevation-highTide);
  }
 }
 return {version:1,highTide,minimumDepth,corridorWidth:o.channelWidth,marineLoop:atSeaLevel&&minimumLoopDepth>=minimumDepth,
  minimumLoopDepth,landComponents,mainLandCells:best.length,plateaus,mainLand};
}
