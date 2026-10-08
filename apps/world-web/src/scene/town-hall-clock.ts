import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TimberThatch } from './timber-thatch';
import { mathematicsCrownPlan } from './mathematics-factory';
import { facePoint } from './building-plan';
import { buildResourceDisplay } from './town-hall-resource-display';

/** The Mathematics glazed pavilion, fitted to the hall, with a local-time clock. */
export function buildTownHallClock(parent:Mesh,kit:TimberThatch,phase:'finished'|'works',floor:number,width:number){
  const plan=mathematicsCrownPlan(phase),scale=(width-.04)/plan.depth;
  const crown=new Mesh('hall-market-clock-pavilion',kit.scene);crown.parent=parent;crown.position.y=floor;crown.rotation.y=-Math.PI/2;crown.scaling.setAll(scale);
  kit.build(crown,plan);
  const frameWood=new StandardMaterial('market-clock-frame-wood',kit.scene);frameWood.diffuseTexture=kit.wood.diffuseTexture;frameWood.diffuseColor=Color3.FromHexString('#765239');frameWood.specularColor=Color3.Black();
  for(const mesh of crown.getChildMeshes())if(mesh.material===kit.wood)mesh.material=frameWood;
  parent.onDisposeObservable.addOnce(()=>frameWood.dispose());
  if(phase==='works')return;
  const opening=plan.openings.find(o=>o.face==='+z'&&!o.door)!;
  const glassMaterial=new StandardMaterial('market-display-glass',kit.scene);
  glassMaterial.diffuseColor=Color3.FromHexString('#a9cde6');glassMaterial.specularColor=Color3.FromHexString('#b8ddf4');
  glassMaterial.alpha=.12;glassMaterial.specularPower=96;glassMaterial.useSpecularOverAlpha=true;glassMaterial.backFaceCulling=false;
  const glass=MeshBuilder.CreatePlane('market-resource-window',{width:opening.right-opening.left-.09,height:opening.top-opening.bottom-.035},kit.scene);
  const point=facePoint(opening.face,(opening.left+opening.right)/2,(opening.bottom+opening.top+.035)/2,plan.depth/2-plan.recipe.module.thickness/2);
  glass.position.set(point.x,point.y,point.z);glass.parent=crown;glass.material=glassMaterial;glass.isPickable=false;
  glass.onDisposeObservable.addOnce(()=>glassMaterial.dispose());
  buildResourceDisplay(crown,kit,plan.base);
  const clock=new Mesh('hall-market-wooden-clock',kit.scene);clock.parent=parent;
  const eave=(plan.base+plan.height)*scale,rise=plan.width/2*Math.tan(plan.recipe.roof.slope*Math.PI/180)*scale;
  clock.position.set(-width/2-.06,floor+eave+rise/2,0);
  const face=MeshBuilder.CreateCylinder('market-clock-face',{diameter:.40,height:.035,tessellation:32},kit.scene);face.rotation.z=Math.PI/2;face.material=kit.wood;face.parent=clock;
  const dark=new StandardMaterial('market-clock-dark-wood',kit.scene);dark.diffuseColor=Color3.FromHexString('#2b2118');dark.specularColor=Color3.Black();
  for(let i=0;i<(kit.lod===2?0:12);i++){const angle=i*Math.PI/6;
    const tick=MeshBuilder.CreateBox('market-clock-hour-mark',{width:.012,height:.03,depth:.012},kit.scene);
    tick.position.set(-.025,Math.cos(angle)*.163,Math.sin(angle)*.163);tick.rotation.x=angle;tick.material=dark;tick.parent=clock;
  }
  const hands=[.10,.14].map(length=>{
    const pivot=new Mesh('market-clock-hand-pivot',kit.scene);pivot.parent=clock;
    const hand=MeshBuilder.CreateBox('market-clock-hand',{width:.012,height:length,depth:.017},kit.scene);
    hand.position.set(-.03,length/2,0);hand.material=dark;hand.parent=pivot;return pivot;
  });
  let lastSecond=-1;
  const update=()=>{if(!clock.isEnabled())return;const now=new Date(),second=Math.floor(now.getTime()/1000);if(second===lastSecond)return;lastSecond=second;
    const minute=now.getMinutes()+now.getSeconds()/60;
    hands[0]!.rotation.x=(now.getHours()%12+minute/60)*Math.PI/6;
    hands[1]!.rotation.x=minute*Math.PI/30;
  };
  update();const observer=kit.scene.onBeforeRenderObservable.add(update);
  clock.onDisposeObservable.addOnce(()=>{kit.scene.onBeforeRenderObservable.remove(observer);dark.dispose();});
}
