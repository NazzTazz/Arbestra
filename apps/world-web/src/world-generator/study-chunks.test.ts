import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {readFileSync} from 'node:fs';
import type {GeneratedLandscape} from '@arbestra/contracts';
import {createStudyCoordinates} from './study-coordinates';
it('shows 32-cell chunk boundaries without labels or marker, above water, on the enlarged world',()=>{
 const data=JSON.parse(readFileSync(new URL('../../public/studies/t1-alpha512.json',import.meta.url),'utf8')) as GeneratedLandscape;
 expect([data.width,data.height]).toEqual([512,256]);
 data.geography!.study!.waterLevel=0;
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const grid=createStudyCoordinates(scene,data,false,{x:140,y:90},(x,y,z)=>[x,z/4,y],false);
  expect(grid.meshes).toHaveLength(1);expect(scene.textures).toHaveLength(0);
  const positions=grid.meshes[0]!.getVerticesData('position')!;
  expect(positions.length/3).toBe(17*257+9*513);
  for(let i=0;i<positions.length;i+=3){
   expect(positions[i]!%32===0||positions[i+2]!%32===0).toBe(true);
   expect(positions[i+1]).toBeGreaterThan(0);
  }
 }finally{scene.dispose();engine.dispose();}
});
