import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {expect,it} from 'vitest';
import {footprintVertices,terraformQuote} from '@arbestra/contracts';
import {TerraformPreview} from './terraform-preview';
import {WorldSpace} from './world-space';

it('draws the future triangular plateau at the exact shared height and reuses unchanged geometry',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),space=new WorldSpace(512,256,{cellX:510,cellY:254});
  const quote=terraformQuote({buildingType:'terrain',anchor:{cellX:511,cellY:255},quarterTurns:0,cells:[{cellX:511,cellY:255}],height:.5,workerCount:5},{widthCells:512,heightCells:256},()=>.25,0);
  const value={quote,origin:quote.cells[0]!,invalidCells:[],sourceHeights:footprintVertices(quote.affectedCells!,{widthCells:512,heightCells:256}).map(v=>({...v,height:.25}))};
  const renderer=new TerraformPreview(scene);
  try{
    renderer.update(value,space);
    const plateau=scene.meshes.find(m=>m.name==='terraform-future-ground'&&m.getTotalVertices()===6)!;
    expect(plateau).toBeDefined();expect(plateau.isPickable).toBe(false);
    for(const height of plateau.getVerticesData('position')!.filter((_,i)=>i%3===1))expect(height).toBeCloseTo(.5*2.5+.035,6);
    const ids=scene.meshes.map(m=>m.uniqueId);renderer.update(structuredClone(value),space);expect(scene.meshes.map(m=>m.uniqueId)).toEqual(ids);
    space.rebase({cellX:1,cellY:1},32);renderer.update(value,space);
    expect(scene.meshes.length).toBe(ids.length);
    renderer.update(null,space);expect(scene.meshes).toHaveLength(0);
  }finally{renderer.dispose();scene.dispose();engine.dispose();}
});
