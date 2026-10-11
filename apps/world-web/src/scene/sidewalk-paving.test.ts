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

it('keeps the full diagonal through the last pixel of a corner without a stepped strip',()=>{
 const world={widthCells:512,heightCells:256};
 const contains=(polygon:readonly {x:number;y:number}[],x:number,y:number)=>polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length]!;return (b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x)>=-1e-7;});
 for(let turn=0;turn<4;turn++){
  const rotate=(x:number,y:number)=>{for(let i=0;i<turn;i++)[x,y]=[192-(y-160),160+(x-192)];return {x,y};};
  const points=[{x:80,y:80},{x:96,y:80},{x:96,y:96}].map(p=>{const r=rotate(p.x*2,p.y*2);return {x:r.x/2,y:r.y/2};});
  const surface=infrastructureSurface([{id:'L',points,width:4,material:'stone-1',border:true,operation:'paint'}],world),sidewalks=infrastructureSidewalkSurface(surface,world);
  const missing=rotate(199.5,152.5);expect(sidewalks.has(Math.floor(missing.x)+':'+Math.floor(missing.y))).toBe(true);
  const stones=sidewalkPaving(surface,sidewalks,world);
  for(const t of [.5,1.5,2.5,3.5])for(const [axis,offset]of [['x',.15],['y',-.15]] as const){
   const p=rotate(196+t,156-t+offset),expectedAxis=turn%2?(axis==='x'?'y':'x'):axis;
   expect(stones.some(s=>s.axis===expectedAxis&&contains(s.polygon,p.x,p.y))).toBe(true);
  }
 }
});
