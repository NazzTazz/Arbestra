import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import { facePoint, type BuildingPlan } from './building-plan';

/** Opaque satin glass, lit locally. It never captures or redraws the scene. */
export class FrostedGlass {
  readonly material: StandardMaterial;
  constructor(scene: Scene) {
    this.material = new StandardMaterial('campus-frosted-glass', scene);
    this.material.diffuseColor = new Color3(.66, .76, .82);
    this.material.specularColor = new Color3(.72, .84, .92);
    this.material.specularPower = 64;
    this.material.backFaceCulling = false;
    const fresnel = new FresnelParameters();
    fresnel.leftColor = Color3.White();
    fresnel.rightColor = new Color3(.45, .45, .45);
    fresnel.power = 2;
    this.material.reflectionFresnelParameters = fresnel;
    // A blurred static sky/ground gradient: one tiny texture, no capture pass.
    const width=32,height=16,pixels=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const sky=y/(height-1),offset=(y*width+x)*4;
      for(let c=0;c<3;c++)pixels[offset+c]=[65,77,58][c]!+([174,203,223][c]!-[65,77,58][c]!)*sky;
      pixels[offset+3]=255;
    }
    const reflection=RawTexture.CreateRGBATexture(pixels,width,height,scene,false,false,Texture.BILINEAR_SAMPLINGMODE);
    reflection.name='campus-frosted-static-environment';reflection.coordinatesMode=Texture.EQUIRECTANGULAR_MODE;
    this.material.reflectionTexture=reflection;
    const update=()=>{
      const daylight=scene.lights.filter(l=>l.isEnabled()&&['DirectionalLight','HemisphericLight'].includes(l.getClassName())).reduce((sum,l)=>sum+l.intensity,0);
      reflection.level=.7*Math.min(1,Math.max(0,daylight));
    };
    update();const observer=scene.onBeforeRenderObservable.add(update);
    scene.onDisposeObservable.addOnce(()=>{scene.onBeforeRenderObservable.remove(observer);reflection.dispose();});
  }
  attach(mesh: Mesh) {
    mesh.material = this.material; mesh.isPickable = false;
  }
}
const glasses = new WeakMap<Scene, FrostedGlass>();
export function attachFrostedGlass(mesh: Mesh) {
  mesh.metadata={...mesh.metadata,buildingAttachment:'glass'};
  const scene=mesh.getScene();let glass=glasses.get(scene);
  if(!glass){glass=new FrostedGlass(scene);glasses.set(scene,glass);}
  glass.attach(mesh);
}

export function glazeWindows(parent: Mesh, plan: BuildingPlan) {
  const panes: Mesh[] = [];
  const limit=plan.phase==='works'
    ? Math.ceil(Math.max(plan.sourceLevels*plan.recipe.courses*plan.recipe.module.height,plan.height*.65)/plan.recipe.module.height)*plan.recipe.module.height
    : plan.height;
  for(const opening of plan.openings){
    if(opening.door||opening.top>limit)continue;
    const pane=MeshBuilder.CreatePlane('mathematics-window-glass',
      {width:opening.right-opening.left-.09,height:opening.top-opening.bottom-.035},parent.getScene());
    const distance=(opening.face.endsWith('x')?plan.width:plan.depth)/2-plan.recipe.module.thickness/2;
    const position=facePoint(opening.face,(opening.left+opening.right)/2,(opening.bottom+opening.top+.035)/2,distance);
    pane.position.set(position.x,position.y,position.z);
    pane.rotation.y=({'-x':-Math.PI/2,'+x':Math.PI/2,'-z':Math.PI,'+z':0})[opening.face];
    panes.push(pane);
  }
  if(!panes.length)return;
  const merged=Mesh.MergeMeshes(panes,true,true);
  if(!merged)throw new Error('Window glass geometry merge failed');
  merged.name=`${parent.name}-glass`;merged.parent=parent;
  attachFrostedGlass(merged);
}
