import { createLandscapeStairAccess, isLandscapeStairSide, naturalStairPairs, type GeneratedLandscape } from './world-generator.js';
export interface LandscapeQuality {
  plateauCount:number;largestPlateauCells:number;offGridBoundaryPercent:number;
  detourSamples:number;unreachableDetours:number;medianDetourCells:number;maxDetourCells:number;
  stairSamples:number;stairsWithoutAlternative:number;
}
/** Bounded samples of actual shortest cell paths, not distances in the coarser region graph. */
export function landscapeQuality(data:GeneratedLandscape):LandscapeQuality {
  const {width:w,height:h}=data,n=w*h,seen=new Uint8Array(n),{cells,edges}=createLandscapeStairAccess(data);
  const pair=(a:number,b:number)=>Math.min(a,b)+':'+Math.max(a,b);
  const neighbors=(i:number)=>{const x=i%w,y=Math.floor(i/w);return [y*w+(x+1)%w,((y+1)%h)*w+x,y*w+(x+w-1)%w,((y+h-1)%h)*w+x];};
  const allowed=(i:number,j:number)=>Boolean(data.walkable[j]&&!isLandscapeStairSide(cells,i,j,w)&&(data.elevations[i]===data.elevations[j]||edges.has(pair(i,j))));
  let plateauCount=0,largestPlateauCells=0,boundaries=0,offGrid=0;
  const detours:Array<[number,number]>=[];
  for(let i=0;i<n;i++){
    const adjacent=neighbors(i);
    for(let axis=0;axis<2;axis++){
      const j=adjacent[axis]!;
      if(data.elevations[i]!==data.elevations[j]){
        boundaries++;if((axis===0?i%w+1:Math.floor(i/w)+1)%8)offGrid++;
        if(data.walkable[i]&&data.walkable[j]&&!allowed(i,j))detours.push([i,j]);
      }
    }
    if(seen[i]||data.terrainCodes[i]!==1)continue;
    const queue=[i];seen[i]=1;
    for(let q=0;q<queue.length;q++)for(const j of neighbors(queue[q]!))if(!seen[j]&&data.terrainCodes[j]===1&&data.elevations[j]===data.elevations[i]){seen[j]=1;queue.push(j);}
    plateauCount++;largestPlateauCells=Math.max(largestPlateauCells,queue.length);
  }
  const visited=new Int32Array(n),distance=new Int32Array(n),queue=new Int32Array(n);let stamp=0;
  const shortest=(from:number,to:number,blocked?:Set<string>)=>{
    stamp++;let head=0,tail=1;queue[0]=from;visited[from]=stamp;distance[from]=0;
    while(head<tail){
      const i=queue[head++]!;if(i===to)return distance[i]!;
      for(const j of neighbors(i))if(visited[j]!==stamp&&allowed(i,j)&&!blocked?.has(pair(i,j))){
        visited[j]=stamp;distance[j]=distance[i]!+1;queue[tail++]=j;
      }
    }
    return -1;
  };
  const samples=Math.min(16,detours.length),lengths:number[]=[];let unreachableDetours=0;
  for(let s=0;s<samples;s++){const [a,b]=detours[Math.floor(s*detours.length/samples)]!,d=shortest(a,b);if(d<0)unreachableDetours++;else lengths.push(d);}
  lengths.sort((a,b)=>a-b);
  const stairSamples=Math.min(8,data.stairs.length);let stairsWithoutAlternative=0;
  for(let s=0;s<stairSamples;s++){
    const stair=data.stairs[Math.floor(s*data.stairs.length/stairSamples)]!;
    if(shortest(stair.from,stair.to,new Set(naturalStairPairs(stair,w,h).map(([a,b])=>pair(a,b))))<0)stairsWithoutAlternative++;
  }
  return {plateauCount,largestPlateauCells,offGridBoundaryPercent:boundaries?offGrid/boundaries*100:0,
    detourSamples:samples,unreachableDetours,medianDetourCells:lengths[Math.floor(lengths.length/2)]??0,maxDetourCells:lengths.at(-1)??0,
    stairSamples,stairsWithoutAlternative};
}
