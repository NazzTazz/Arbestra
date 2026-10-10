import {describe,it,expect} from 'vitest';
import {buildingAccesses,poseStarterElement} from '@arbestra/contracts';
import {STARTER_KIT} from './starter-kit.js';
import {starterTownHallExits} from './spawn-resource-calculation.js';
describe('starter access matches the confirmed building',()=>{
 for(const point of [{x:140,y:20},{x:511,y:255},{x:0,y:0}])for(const turn of [0,1,2,3])it(JSON.stringify({point,turn}),()=>{
  const hall=poseStarterElement(STARTER_KIT.elements.find(e=>e.type==='town-hall')!,point,turn);
  const accesses=buildingAccesses({world:{widthCells:512,heightCells:256},cells:hall.cells.map(c=>({...c,footprint:{buildingId:'hall'},building:c.role==='anchor'?{...hall,id:'hall'}:null}))},'hall');
  expect(starterTownHallExits(point,turn).map(p=>p.at(-1))).toEqual(accesses.map(a=>({x:a.outside.cellX,y:a.outside.cellY})));
 });
 it('rejects a terrassable lip between the real hall door and its outside node',()=>{
  const point={x:140,y:20},flat={width:512,height:256,sample:()=>({elevation:1,dry:true,blocked:false})};
  expect(starterTownHallExits(point,0,flat)).toHaveLength(1);
  const door=buildingAccesses({world:{widthCells:512,heightCells:256},cells:poseStarterElement(STARTER_KIT.elements.find(e=>e.type==='town-hall')!,point,0).cells.map(c=>({...c,footprint:{buildingId:'hall'},building:c.role==='anchor'?{...poseStarterElement(STARTER_KIT.elements.find(e=>e.type==='town-hall')!,point,0),id:'hall'}:null}))},'hall')[0]!;
  const cut=(door.position.cellX+door.outside.cellX)/2;
  expect(starterTownHallExits(point,0,{...flat,sample:x=>({elevation:x<cut?1:1.2,dry:true,blocked:false})})).toEqual([]);
 });
});
