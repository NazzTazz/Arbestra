import '@babylonjs/core/Materials/Textures/dynamicTexture';
import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {SceneSerializer} from '@babylonjs/core/Misc/sceneSerializer';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {TimberThatch} from './timber-thatch';
import {buildUniversity} from './university-factory';
import {buildingPlan,HOUSE_RECIPE,LOG_HOUSE_RECIPE,BEAM_HOUSE_RECIPE,HALL_RECIPE} from './building-plan';
import {encodeBuildingAsset} from './building-asset-format';

/** Offline compiler entry point. Never imported by the player application. */
export function bakeBuilding(code:string,level:number,phase:'finished'|'works') {
  const canvas=document.createElement('canvas'),engine=new Engine(canvas),scene=new Scene(engine);
  try {
    const kit=new TimberThatch(scene),root=new Mesh('building-asset',scene);
    if(code==='university')buildUniversity(root,kit,level,phase,Math.max(0,level-1),{mathematics:false,astronomy:false});
    else {
      const base=code==='town-hall'?HALL_RECIPE:code==='dwelling-logs'?LOG_HOUSE_RECIPE:code==='dwelling-beams'?BEAM_HOUSE_RECIPE:HOUSE_RECIPE;
      const recipe={...base,levels:code==='town-hall'?1:Math.min(2,level)};
      const cells=code==='town-hall'?[{cellX:0,cellY:0},{cellX:0,cellY:1}]:[{cellX:0,cellY:0}];
      const plan=buildingPlan({id:'asset',anchor:cells[0]!,cells,world:{widthCells:2048,heightCells:1024},recipe,phase,sourceLevels:Math.max(0,level-1)});
      kit.build(root,plan);
    }
    // The runtime scene owns the shared background capture; only pane geometry is baked.
    for(const mesh of root.getChildMeshes())if(mesh.metadata?.buildingAttachment==='glass')mesh.material=null;
    const bytes=encodeBuildingAsset(SceneSerializer.SerializeMesh(root,false,true));
    const parts:string[]=[];
    for(let i=0;i<bytes.length;i+=16384)parts.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
    return btoa(parts.join(''));
  } finally {scene.dispose();engine.dispose();}
}
