import { describe,expect,it } from 'vitest';
import { generateLandscape, DEFAULT_GENERATOR_PARAMETERS, naturalStairPairs } from '@arbestra/contracts';
import { STARTER_VILLAGE } from './starter-village.js';
import { placeStarterVillage } from './starter-layout.js';
describe('starter template on exploratory terraces',()=>{
  it('preserves natural flat sites for the existing village footprint without reserving clearings',()=>{
    const width=256,height=128,data=generateLandscape(42,width,height,DEFAULT_GENERATOR_PARAMETERS);
    const placement=placeStarterVillage(STARTER_VILLAGE,{x:64,y:64},{widthCells:width,heightCells:height});
    const offsets=placement.required.map(c=>({x:c.cellX-64,y:c.cellY-64}));
    const stairs=new Set(data.stairs.flatMap(s=>naturalStairPairs(s,width,height).flat()));
    let found=false;
    for(let y=0;y<height&&!found;y++)for(let x=0;x<width&&!found;x++){
      const cells=offsets.map(o=>((y+o.y+height)%height)*width+(x+o.x+width)%width),level=data.elevations[cells[0]!]!;
      found=level>=1&&cells.every(i=>data.terrainCodes[i]===1&&data.elevations[i]===level&&!stairs.has(i));
    }
    expect(found).toBe(true);
  },30000);
});
