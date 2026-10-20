import {expect,it} from 'vitest';
import {terraformQuote,type TerraformRequest} from './terraforming.js';
import {vertexSurface} from './terrain-vertices.js';
const world={widthCells:512,heightCells:256};
const request:TerraformRequest={buildingType:'terrain',anchor:{cellX:511,cellY:255},quarterTurns:0,cells:[{cellX:511,cellY:255}],height:.5,workerCount:5};
it('paints a quarter-step plateau across both seams and includes the changed neighbouring triangles',()=>{
  const q=terraformQuote(request,world,()=>.25,1000);
  expect(q.vertices).toHaveLength(4);expect(q.affectedCells).toHaveLength(9);
  expect(q.vertices).toContainEqual({vertexX:0,vertexY:0,height:.5});
  const surface=vertexSurface(world,()=>.25,q.vertices!);
  expect(surface.sample(511,255)).toBe(.5);expect(surface.sample(0,0)).toBeCloseTo(.375);
  expect(q.workMs).toBe(48000);expect(q.durationMs).toBe(50000);
  expect(q.stoneDebit).toBe(0);expect(q.stoneCredit).toBe(0);
});
it('deduplicates repeated swipes, divides the actual volume by 5/20/50 and fingerprints every source corner',()=>{
  const five=terraformQuote(request,world,()=>.25,0);
  expect(terraformQuote({...request,cells:[...request.cells,...request.cells]},world,()=>.25,0)).toEqual(five);
  for(const workerCount of [20,50])expect(terraformQuote({...request,workerCount},world,()=>.25,0).workMs).toBe(five.workMs*5/workerCount);
  const changed=terraformQuote(request,world,(x,y)=>x===510&&y===254?.3:.25,0);
  expect(changed.signature).not.toBe(five.signature);
});
it('rejects unknown heights, noncanonical coordinates, fractional steps and unavailable teams',()=>{
  expect(()=>terraformQuote(request,world,()=>NaN,0)).toThrow();
  for(const value of [{height:.3},{height:1e30},{height:1e14},{workerCount:51},{cells:[{cellX:512,cellY:0}]}])expect(()=>terraformQuote({...request,...value},world,()=>.25,0)).toThrow();
});
