import {it,expect} from 'vitest';
import {withinBuildReach,fixedBuildingFootprint} from './building-footprint.js';
it('keeps the same completed footprint reach at both RC1 seams and the corner',()=>{
 const world={widthCells:512,heightCells:256},cells=[{cellX:511,cellY:255}];
 for(const target of [{cellX:7,cellY:255},{cellX:511,cellY:7},{cellX:7,cellY:7}])expect(withinBuildReach(target,cells,world)).toBe(true);
 expect(withinBuildReach({cellX:8,cellY:7},cells,world)).toBe(false);
 for(const turn of [0,1,2,3])for(const type of ['university','stonemason'] as const){const result=fixedBuildingFootprint(type,cells[0]!,turn,world);expect(new Set(result.map(c=>c.cellX+':'+c.cellY)).size).toBe(type==='university'?30:4);expect(result.every(c=>c.cellX>=0&&c.cellX<512&&c.cellY>=0&&c.cellY<256)).toBe(true);}
});
it('allows a campus beside the village and extends reach from its completed footprint',()=>{
 const world={widthCells:512,heightCells:256},village=[{cellX:100,cellY:100}];
 const campus=fixedBuildingFootprint('university',{cellX:105,cellY:100},0,world);
 expect(campus.every(cell=>withinBuildReach(cell,village,world))).toBe(true);
 const next={cellX:115,cellY:100};
 expect(withinBuildReach(next,village,world)).toBe(false);
 expect(withinBuildReach(next,[...village,...campus],world)).toBe(true);
 expect(withinBuildReach({cellX:116,cellY:100},[...village,...campus],world)).toBe(false);
});
