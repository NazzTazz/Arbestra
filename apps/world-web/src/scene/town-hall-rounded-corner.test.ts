import { expect,it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import { buildingPlan,HALL_RECIPE } from './building-plan';
import type { TimberThatch } from './timber-thatch';
import { prepareRoundedCorner,finishRoundedCorner } from './town-hall-rounded-corner';

it.each([undefined,{segments:3,radiusRatio:.12}])('closes curved masonry joints with recessed mortar, profile %j',(stoneProfile)=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const plan=buildingPlan({id:'hall',anchor:{cellX:0,cellY:0},cells:[{cellX:0,cellY:0},{cellX:0,cellY:1}],world:{widthCells:32,heightCells:32},recipe:{...HALL_RECIPE,windows:{},entrance:{...HALL_RECIPE.entrance,enabled:false}}});
    const root=new Mesh('floor',scene),stone=new StandardMaterial('stone',scene);
    const kit={scene,stone,wood:stone,stoneProfile} as TimberThatch,corner=prepareRoundedCorner(plan);
    finishRoundedCorner(root,kit,plan,corner,false,false);
    const mortar=scene.getMeshByName('market-wall-mortar')!;
    const hit=(theta:number)=>{
      const normal=new Vector3(Math.cos(theta),0,Math.sin(theta));
      const origin=new Vector3(corner.cx,.07,corner.cz).add(normal.scale(.82));
      for(const mesh of scene.meshes)mesh.computeWorldMatrix(true);
      return scene.pickWithRay(new Ray(origin,normal.negate(),.24),m=>m.isEnabled()&&m.getTotalVertices()>0)?.pickedMesh;
    };
    // Retrospective reproduction of the former open horizontal joints.
    mortar.setEnabled(false);
    for(let i=1;i<12;i++)expect(hit(-Math.PI/2+i*Math.PI/24)).toBeNull();
    mortar.setEnabled(true);
    for(let i=1;i<12;i++)expect(hit(-Math.PI/2+i*Math.PI/24)).toBe(mortar);
  }finally{scene.dispose();engine.dispose();}
});
