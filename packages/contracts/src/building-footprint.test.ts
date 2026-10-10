import {it,expect} from 'vitest';
import {withinBuildReach,fixedBuildingFootprint} from './building-footprint.js';
it('keeps the same completed footprint reach at both RC1 seams and the corner',()=>{
 const world={widthCells:512,heightCells:256},cells=[{cellX:511,cellY:255}];
 for(const target of [{cellX:4,cellY:255},{cellX:511,cellY:4},{cellX:4,cellY:4}])expect(withinBuildReach(target,cells,world)).toBe(true);
 expect(withinBuildReach({cellX:5,cellY:4},cells,world)).toBe(false);
 for(const turn of [0,1,2,3])for(const type of ['university','stonemason'] as const){const result=fixedBuildingFootprint(type,cells[0]!,turn,world);expect(new Set(result.map(c=>c.cellX+':'+c.cellY)).size).toBe(type==='university'?30:4);expect(result.every(c=>c.cellX>=0&&c.cellX<512&&c.cellY>=0&&c.cellY<256)).toBe(true);}
});
