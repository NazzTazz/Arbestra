import {describe,it,expect} from 'vitest';
import {buildingPlan,LOG_HOUSE_RECIPE,BEAM_HOUSE_RECIPE} from './building-plan';
import {timberWallMembers} from './timber-wall';

describe('interlocking timber houses',()=>{
  for(const recipe of [LOG_HOUSE_RECIPE,BEAM_HOUSE_RECIPE])for(const levels of [1,2])it(`${recipe.id} level ${levels}: continuous timbers leave the doors and rotated windows open`,()=>{
    const plan=buildingPlan({id:'house',anchor:{cellX:0,cellY:0},cells:[{cellX:0,cellY:0}],world:{widthCells:32,heightCells:32},recipe:{...recipe,levels}});
    const members=timberWallMembers(plan);
    expect(members.length).toBeLessThan(plan.stones.length/2);
    expect(members.some(m=>m.length>plan.width)).toBe(true);
    for(const opening of plan.openings){
      const axis=opening.face.endsWith('x')?'z':'x';
      const fixed=(opening.face[0]==='-'?-1:1)*((axis==='x'?plan.depth:plan.width)/2-recipe.module.thickness/2);
      const walls=members.filter(m=>m.axis===axis&&Math.abs((axis==='x'?m.z:m.x)-fixed)<1e-6);
      expect(walls.some(m=>m.y-m.height/2<opening.top-1e-6&&m.y+m.height/2>opening.bottom+1e-6&&m[axis]-m.length/2<opening.right-1e-6&&m[axis]+m.length/2>opening.left+1e-6)).toBe(false);
    }
    for(const m of members)expect(Math.abs(m[m.axis])+m.length/2).toBeLessThan(1.25);
  });
});
