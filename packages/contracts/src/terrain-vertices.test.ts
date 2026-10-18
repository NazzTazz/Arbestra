import {describe,it,expect} from 'vitest';
import {absoluteTriangleVolume,cellVertices,convertTerraces,vertexLeveling,vertexSurface} from './terrain-vertices.js';
const world={widthCells:512,heightCells:256};
describe('shared terrain vertices',()=>{
 it('uses identical corners on both torus seams and one diagonal',()=>{
  expect(cellVertices({cellX:511,cellY:255},world)).toContainEqual({vertexX:0,vertexY:0});
  const s=vertexSurface(world,()=>0,[{vertexX:0,vertexY:0,height:2}]);
  expect(s.sample(-.5,-.5)).toBe(2);
  expect(s.sample(511.5,255.5)).toBe(2);
  expect(s.sample(0,0)).toBe(1);
  expect(s.sample(511.25,255.25)).toBe(s.sample(-.75,-.75));
 });
 it('integrates positive and mixed cut/fill exactly',()=>{
  expect(absoluteTriangleVolume([3,3,3])).toBe(1.5);
  expect(absoluteTriangleVolume([-1,1,1])).toBeCloseTo(.25);
  expect(absoluteTriangleVolume([-1,-1,-1])).toBe(.5);
 });
 it('levels interior vertices too and reserves the neighbour ring',()=>{
  const cells=Array.from({length:30},(_,i)=>({cellX:10+i%5,cellY:10+Math.floor(i/5)}));
  const p=vertexLeveling(cells,world,(x,y)=>x===12&&y===12?1:0,3);
  expect(p.vertices).toHaveLength(42);expect(p.affectedCells).toHaveLength(56);
  expect(p.height).toBeCloseTo(1/42,6);
  const s=vertexSurface(world,()=>0,p.vertices);
  expect(s.sample(12,12)).toBe(p.height);
  expect(s.sample(9.5,12)).toBe(p.height);
  expect(s.sample(8.5,12)).toBe(0);
  expect(p.workMs).toBeGreaterThan(0);
 });
 it('refuses to silently average incompatible adjacent platforms',()=>{
  const r=convertTerraces([{cellX:511,cellY:0,height:1},{cellX:0,cellY:0,height:2}],world);
  expect(r.conflicts).toEqual(['0:0','0:1']);
 });
});
