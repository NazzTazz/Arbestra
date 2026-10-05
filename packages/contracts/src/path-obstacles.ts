import {wrappedDistance} from './infrastructure.js';
import type {TravelCell} from './travel-paths.js';
/** Sweep whole segments, including legacy paths with distant vertices and torus seams. */
export function pathIntersectsBox(path:readonly TravelCell[],centre:TravelCell,halfX:number,halfY:number,world:{widthCells:number;heightCells:number}):boolean {
  const point=(p:TravelCell)=>({x:wrappedDistance(p.cellX,centre.cellX,world.widthCells),y:wrappedDistance(p.cellY,centre.cellY,world.heightCells)});
  if(path.length===1){const p=point(path[0]!);return Math.abs(p.x)<halfX&&Math.abs(p.y)<halfY;}
  for(let i=1;i<path.length;i++){
    const a=point(path[i-1]!),b={x:a.x+wrappedDistance(path[i]!.cellX,path[i-1]!.cellX,world.widthCells),y:a.y+wrappedDistance(path[i]!.cellY,path[i-1]!.cellY,world.heightCells)};
    let low=0,high=1;
    for(const [start,distance,half]of [[a.x,b.x-a.x,halfX],[a.y,b.y-a.y,halfY]]){
      if(Math.abs(distance!)<1e-10){if(Math.abs(start!)>=half!){low=2;break;}}
      else{const t0=(-half!-start!)/distance!,t1=(half!-start!)/distance!;low=Math.max(low,Math.min(t0,t1));high=Math.min(high,Math.max(t0,t1));}
    }
    if(low<=high&&low<=1&&high>=0)return true;
  }return false;
}
