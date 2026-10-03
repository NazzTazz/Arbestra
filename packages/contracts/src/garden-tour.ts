import type {TravelCell,TravelRoute} from './travel-paths.js';
const key=(p:TravelCell)=>`${p.cellX}:${p.cellY}`;

/** Reuses the already-authorized cardinal road graph, without new world navigation. */
export function planGardenTour(routes:readonly TravelRoute[],home:TravelCell,cells:readonly TravelCell[],world?:{widthCells:number;heightCells:number}){
  const graph=new Map<string,Map<string,TravelCell>>();
  const link=(a:TravelCell,b:TravelCell)=>{const neighbours=graph.get(key(a))??new Map<string,TravelCell>();neighbours.set(key(b),b);graph.set(key(a),neighbours);};
  // Validated selected plots can be crossed directly along a shared side.
  // Do not add shortcuts through unselected buildings, features or empty land.
  for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++){
    const a=cells[i]!,b=cells[j]!,dx=Math.abs(a.cellX-b.cellX),dy=Math.abs(a.cellY-b.cellY);
    const x=world?Math.min(dx,world.widthCells-dx):dx,y=world?Math.min(dy,world.heightCells-dy):dy;
    if(x+y===1){link(a,b);link(b,a);}
  }
  for(const route of routes)for(let i=1;i<route.cells.length;i++)for(const [a,b]of [[route.cells[i-1]!,route.cells[i]!],[route.cells[i]!,route.cells[i-1]!]]){
    link(a!,b!);
  }
  const path=(from:TravelCell,to:TravelCell):TravelCell[]|null=>{
    const queue=[from],parents=new Map<string,TravelCell|null>([[key(from),null]]);
    for(let i=0;i<queue.length;i++){
      const current=queue[i]!;
      if(key(current)===key(to)){const result:TravelCell[]=[];for(let p:TravelCell|null=current;p;p=parents.get(key(p))??null)result.push(p);return result.reverse();}
      for(const next of graph.get(key(current))?.values()??[])if(!parents.has(key(next))){parents.set(key(next),current);queue.push(next);}
    }return null;
  };
  let previous=home,elapsed=0;
  const stops=[];
  for(const cell of cells){const leg=path(previous,cell);if(!leg)return null;
    elapsed+=(leg.length-1)*1000;const arrivesAfterMs=elapsed;elapsed+=60_000;
    stops.push({...cell,path:leg,arrivesAfterMs,workEndsAfterMs:elapsed});previous=cell;
  }
  const returnPath=path(previous,home);if(!returnPath)return null;
  return {stops,returnPath,durationMs:elapsed+(returnPath.length-1)*1000};
}
