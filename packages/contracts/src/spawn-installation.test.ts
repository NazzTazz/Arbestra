import {describe,it,expect} from 'vitest';
import {poseStarterElement,starterElementSurfaces,terraceHeight,type StarterElement} from './spawn-installation.js';
const hall:StarterElement={key:'hall',type:'town-hall',level:1,quarterTurns:0,visualLayout:{recipe:'town-hall',version:1,quarterTurns:0,entranceFace:'+x',offset:[0,0]},cells:[{x:0,y:0,role:'anchor'},{x:0,y:1,role:'extension'}]};
describe('persistent starter placement geometry',()=>{
 it('rotates the hall footprint and entrance together across a seam without changing the recipe',()=>{
  const before=JSON.stringify(hall),p=poseStarterElement(hall,{x:0,y:255},1);
  expect(p.cells).toEqual([{cellX:0,cellY:255,role:'anchor'},{cellX:1,cellY:255,role:'extension'}]);
  expect(p.quarterTurns).toBe(1);expect(p.visualLayout?.quarterTurns).toBe(1);expect(JSON.stringify(hall)).toBe(before);
 });
 it('allows an individual element to leave the initial reference plan',()=>{
  const home:StarterElement={...hall,key:'home',type:'dwelling',cells:[{x:-2,y:2,role:'anchor'}]};
  expect(poseStarterElement(home,{x:510,y:0},0,false).cells[0]).toMatchObject({cellX:510,cellY:0});
  expect(starterElementSurfaces(home,false)).toEqual([{x:0,y:0,halfWidth:.5,halfHeight:.5}]);
 });
 it('does not flatten outside the saved footprint, including at the torus seam',()=>{
  const edits=[{cellX:0,cellY:0,height:.125}];
  expect(terraceHeight(edits,511.75,255.75)).toBe(.125);
  expect(terraceHeight(edits,.51,0)).toBeUndefined();
 });
});
