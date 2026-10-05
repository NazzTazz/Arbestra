import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import { facePoint, type BuildingPlan } from './building-plan';

const vertexSource = `precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec4 screenPosition;
varying vec2 glassUV;
void main(){screenPosition=worldViewProjection*vec4(position,1.0);glassUV=uv;gl_Position=screenPosition;}`;
const fragmentSource = `precision highp float;
uniform sampler2D background;
varying vec4 screenPosition;
varying vec2 glassUV;
void main(){
  vec2 p=screenPosition.xy/screenPosition.w*.5+.5;
  vec2 d=vec2(2.5/512.0);
  vec3 c=texture2D(background,p).rgb*.25;
  c+=(texture2D(background,p+vec2(d.x,0.0)).rgb+texture2D(background,p-vec2(d.x,0.0)).rgb
    +texture2D(background,p+vec2(0.0,d.y)).rgb+texture2D(background,p-vec2(0.0,d.y)).rgb)*.125;
  c+=(texture2D(background,p+d).rgb+texture2D(background,p-d).rgb
    +texture2D(background,p+vec2(d.x,-d.y)).rgb+texture2D(background,p+vec2(-d.x,d.y)).rgb)*.0625;
  float grain=fract(sin(dot(floor(glassUV*192.0),vec2(12.9898,78.233)))*43758.5453)-.5;
  gl_FragColor=vec4(mix(c,vec3(.69,.80,.84),.18)+grain*.008,1.0);
}`;

/** One scene capture shared by all panes; glass is excluded from its own image. */
export class FrostedGlass {
  readonly material: ShaderMaterial;
  readonly capture: RenderTargetTexture;
  private panes = 0;
  private listDirty = true;
  constructor(private readonly scene: Scene) {
    this.capture = new RenderTargetTexture('campus-glass-background', 512, scene, false, true);
    this.capture.wrapU = this.capture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.material = new ShaderMaterial('campus-frosted-glass', scene, { vertexSource, fragmentSource },
      { attributes: ['position', 'uv'], uniforms: ['worldViewProjection'], samplers: ['background'] });
    this.material.backFaceCulling = false;
    this.material.setTexture('background', this.capture);
    // Babylon observes renderList mutations. Clearing and pushing every mesh via
    // renderListPredicate invalidates light defines for the whole scene each frame.
    // Visibility remains the object renderer's responsibility, not list membership.
    this.capture.renderList=[];
    scene.onNewMeshAddedObservable.add(()=>{this.listDirty=true;});
    scene.onMeshRemovedObservable.add(()=>{this.listDirty=true;});
    scene.onBeforeRenderTargetsRenderObservable.add(()=>{
      if(!this.panes||!this.listDirty)return;
      this.listDirty=false;
      this.capture.renderList=scene.meshes.filter(mesh=>mesh.material!==this.material&&mesh.getTotalVertices()>0);
    });
  }
  attach(mesh: Mesh) {
    mesh.material = this.material; mesh.isPickable = false;
    this.listDirty=true;
    if(this.panes++ === 0)this.scene.customRenderTargets.push(this.capture);
    mesh.onDisposeObservable.addOnce(() => {
      if(--this.panes === 0){
        this.capture.renderList=[];this.listDirty=true;
        const index=this.scene.customRenderTargets.indexOf(this.capture);
        if(index>=0)this.scene.customRenderTargets.splice(index,1);
      }
    });
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
