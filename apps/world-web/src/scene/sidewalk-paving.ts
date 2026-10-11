import {infrastructureBorders,wrapCoordinate,type RoadPixel} from '@arbestra/contracts';
export interface PavingPoint{x:number;y:number}
export interface SidewalkStone{axis:'x'|'y';polygon:PavingPoint[]}
/** Convex half-plane clipping, also used by the factory's trimmed masonry. */
function clip(points:PavingPoint[],distance:(p:PavingPoint)=>number):PavingPoint[]{
 const out:PavingPoint[]=[];
 for(let i=0;i<points.length;i++){const a=points[i]!,b=points[(i+1)%points.length]!,da=distance(a),db=distance(b);
  if(da<=1e-8)out.push(a);if((da<0)!==(db<0)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}}
 return out;
}
/** Pierre 1 modules (24 × 2 sixteenths), following exposed sides of the road union.
 * Competing perpendicular sides share a 45° miter, rather than overlapping stones.
 * Fragments keep a single module's boundaries: raster cuts create no extra joints.
 */
export function sidewalkPaving(surface:ReadonlyMap<string,RoadPixel>,sidewalks:ReadonlyMap<string,PavingPoint>,world:{widthCells:number;heightCells:number}):SidewalkStone[]{
 const w=world.widthCells*16,h=world.heightCells*16;
 type Side={wall:number;distance:number;score:number};
 const directions=new Map<string,{x?:Side;y?:Side}>();
 for(const edge of infrastructureBorders(surface,world).values())for(let step=1;step<=4;step++)for(let along=-3;along<=3;along++){
  const ux=edge.x+edge.dx*step+edge.dy*along,uy=edge.y+edge.dy*step+edge.dx*along;
  const x=wrapCoordinate(ux,w),y=wrapCoordinate(uy,h),key=x+':'+y;if(!sidewalks.has(key))continue;
  const axis=edge.dy?'x':'y',wall=axis==='x'?edge.y+(edge.dy>0?1:0)+y-uy:edge.x+(edge.dx>0?1:0)+x-ux;
  const distance=Math.abs((axis==='x'?y:x)+.5-wall),score=Math.max(distance,Math.max(0,Math.abs(along)-.5));
  const sides=directions.get(key)??{},old=sides[axis];
  if(!old||score<old.score||score===old.score&&distance<old.distance)sides[axis]={wall,distance,score};directions.set(key,sides);
 }
 const stones:SidewalkStone[]=[],gap=.035;
 for(const [key,p]of sidewalks){const sides=directions.get(key);if(!sides)continue;
  for(const axis of ['x','y'] as const){const side=sides[axis];if(!side)continue;
   const other=sides[axis==='x'?'y':'x'];
   let polygon=[{x:p.x,y:p.y},{x:p.x+1,y:p.y},{x:p.x+1,y:p.y+1},{x:p.x,y:p.y+1}];
   if(other){const sign=(axis==='x'?p.y:p.x)+.5>=side.wall?1:-1,otherSign=(axis==='x'?p.x:p.y)+.5>=other.wall?1:-1;
    polygon=clip(polygon,q=>sign*((axis==='x'?q.y:q.x)-side.wall)-otherSign*((axis==='x'?q.x:q.y)-other.wall)+gap*Math.SQRT2);}
   const across=axis==='x'?p.y:p.x,along=axis==='x'?p.x:p.y,row=Math.floor(across/2),shift=(row%2)*12;
   const start=Math.floor((along-shift)/24)*24+shift;
   for(const [coordinate,min,max]of (axis==='x'?[['x',start+gap,start+24-gap],['y',row*2+gap,row*2+2-gap]]:[['y',start+gap,start+24-gap],['x',row*2+gap,row*2+2-gap]]) as Array<['x'|'y',number,number]>){
    polygon=clip(polygon,q=>min-q[coordinate]);polygon=clip(polygon,q=>q[coordinate]-max);}
   const area=polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length]!;return sum+a.x*b.y-b.x*a.y;},0);
   if(polygon.length>=3&&Math.abs(area)>1e-8)stones.push({axis,polygon});
  }
 }return stones;
}
