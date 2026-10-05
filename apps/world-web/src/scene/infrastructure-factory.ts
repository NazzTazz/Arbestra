import {emptyInfrastructure,type RoadMaterial,type RoadStroke} from '@arbestra/contracts';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import {InfrastructureRenderer} from './infrastructure-renderer';
import {WorldSpace} from './world-space';
import {VillageBraziers} from './village-braziers';
import {TimberThatch} from './timber-thatch';
import {buildingPlan,HOUSE_RECIPE,withBuildingAccesses} from './building-plan';
export interface InfrastructureRecipe {fixture:'straight'|'elbow'|'t'|'crossing'|'door'|'brazier';material:RoadMaterial;width:number;border:boolean;quarterTurns:number;length:number;pavementHeight?:number;curbHeight?:number;brazierScale?:number;preview?:boolean}
export function infrastructureFixture(recipe:InfrastructureRecipe):RoadStroke[]{
  const {fixture,length,width,material,border}=recipe,n=Math.round(length*8),p=(x:number,y:number)=>({x:128+x,y:128+y});
  const paths=fixture==='brazier'?[]:fixture==='door'?[[p(-n,0),p(0,0)]]:fixture==='straight'?[[p(-n,0),p(n,0)]]:fixture==='elbow'?[[p(-n,0),p(0,0),p(0,n)]]:fixture==='t'?[[p(-n,0),p(n,0)],[p(0,0),p(0,n)]]:[[p(-n,0),p(n,0)],[p(0,-n),p(0,n)]];
  return paths.map((points,i)=>({id:`fixture-${i}`,points,width,material,border,operation:'paint'}));
}
/** The map generator renders atelier fixtures, cached thumbnails and ghosts too. */
export function buildInfrastructurePresentation(scene:Scene,recipe:InfrastructureRecipe):Mesh{
  const root=new Mesh('infrastructure-presentation',scene),renderer=new InfrastructureRenderer(scene);
  renderer.update({...emptyInfrastructure(),roads:infrastructureFixture(recipe)},new WorldSpace(32,32,{cellX:16,cellY:16}),()=>0,recipe.preview??false,0,undefined,false,[],recipe);
  for(const mesh of renderer.meshes)mesh.parent=root;
  root.rotation.y=recipe.quarterTurns*Math.PI/2;
  if(recipe.fixture==='brazier')root.scaling.setAll(recipe.brazierScale??1);
  let fires:VillageBraziers|undefined;
  if(recipe.fixture==='brazier') {fires=new VillageBraziers(scene);fires.updatePoints([{x:0,y:0,z:0,seed:.4}],root);}
  let kit:TimberThatch|undefined;
  if(recipe.fixture==='door'){
    kit=new TimberThatch(scene);const building=new Mesh('door-fixture',scene);building.parent=root;
    const plan=buildingPlan({id:'door',recipe:withBuildingAccesses(HOUSE_RECIPE,'-x'),anchor:{cellX:16,cellY:16},cells:[{cellX:16,cellY:16}],world:{widthCells:32,heightCells:32}});
    building.position.x=plan.width/2;building.position.y=plan.origin.y;kit.build(building,plan);
  }
  root.onDisposeObservable.addOnce(()=>{renderer.dispose();fires?.dispose();if(kit)for(const m of [kit.wood,kit.boards,kit.nails,kit.hay,kit.stone])m.dispose(false,true);});
  return root;
}
