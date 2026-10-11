import {expect,it} from 'vitest';
import {infrastructureSurface,infrastructureSidewalkSurface,type RoadStroke} from '@arbestra/contracts';
import {sidewalkPaving} from './sidewalk-paving';
it('aligns Pierre 1 modules with sidewalks and cuts perpendicular joins at 45 degrees, including seams',()=>{
 const world={widthCells:512,heightCells:256};
 for(const points of [[{x:80,y:80},{x:96,y:80}],[{x:80,y:80},{x:80,y:96}],[{x:80,y:80},{x:96,y:80},{x:96,y:96}],[{x:4088,y:8},{x:0,y:8},{x:0,y:2040}],[{x:96,y:96},{x:80,y:96},{x:80,y:80}]]){
  const road:RoadStroke={id:'test',points,width:4,material:'stone-2',border:true,operation:'paint'};
  const surface=infrastructureSurface([road],world),sidewalks=infrastructureSidewalkSurface(surface,world),before=JSON.stringify([...surface]);
  const stones=sidewalkPaving(surface,sidewalks,world);expect(stones.length).toBeGreaterThan(0);
  if(points.length===2)expect(new Set(stones.map(s=>s.axis))).toEqual(new Set([points[0]!.x===points[1]!.x?'y':'x']));
  let diagonals=0;
  for(const stone of stones)for(let i=0;i<stone.polygon.length;i++){
   const a=stone.polygon[i]!,b=stone.polygon[(i+1)%stone.polygon.length]!,dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y);
   if(dx>1e-6&&dy>1e-6){expect(dx).toBeCloseTo(dy,6);diagonals++;}
  }
  if(points.length>2)expect(diagonals).toBeGreaterThan(0);
  expect(JSON.stringify([...surface])).toBe(before);
 }
});
