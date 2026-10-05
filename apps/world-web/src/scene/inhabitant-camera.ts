import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CELL_UNITS } from './world-space';

export type InhabitantCameraMode = 'village' | 'follow' | 'pov' | 'free';
export interface InhabitantPose { position:Vector3; heading:number }
// The stylised inhabitants are approximately .63 scene units tall (1.8 m).
export const INHABITANT_EYE_HEIGHT = 1.7 * .35;

/** Small swept steps prevent tunnelling; sliding keeps walking along a wall natural. */
export function walkOnPlane(from:Vector3, dx:number, dz:number, free:(x:number,z:number)=>boolean) {
  const p=from.clone(),steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.08));
  for(let i=0;i<steps;i++){
    const x=p.x+dx/steps,z=p.z+dz/steps;
    if(free(x,z)){p.x=x;p.z=z;}
    else {if(free(x,p.z))p.x=x;if(free(p.x,z))p.z=z;}
  }
  return p;
}

/** Presentation only: no movement command is sent to the simulation. */
export class InhabitantCamera {
  mode:InhabitantCameraMode='village';
  representativeId:string|null=null;
  noclip=false;
  readonly #eye:FreeCamera;
  readonly #keys=new Set<string>();
  #lastAt:number|null=null;
  #saved:{alpha:number;beta:number;radius:number;fov:number;target:Vector3}|null=null;
  constructor(readonly scene:Scene,readonly orbit:ArcRotateCamera,readonly canvas:HTMLCanvasElement,
    readonly pose:(id:string)=>InhabitantPose|null,readonly ground:(x:number,z:number)=>number|null,
    readonly free:(x:number,z:number)=>boolean,readonly visible:(id:string|null)=>void) {
    this.#eye=new FreeCamera('inhabitant-eyes',Vector3.Zero(),scene);
    this.#eye.inputs.removeByType('FreeCameraKeyboardMoveInput');
    this.#eye.minZ=.025;this.#eye.maxZ=orbit.maxZ;this.#eye.fov=1.05;
    this.#eye.inertia=0;
    window.addEventListener('keydown',this.#down,true);
    window.addEventListener('keyup',this.#up,true);
    window.addEventListener('blur',this.#blur);
    document.addEventListener('visibilitychange',this.#blur);
  }
  get active(){return this.mode!=='village';}
  readonly #down=(event:KeyboardEvent)=>{
    if(!this.active||event.ctrlKey||event.metaKey||event.altKey)return;
    const target=event.target as HTMLElement|null;
    if(target?.isContentEditable||target?.closest('input,textarea,select,button'))return;
    if(event.key==='Escape'){this.stop();event.preventDefault();event.stopImmediatePropagation();return;}
    const key=event.key.toLowerCase();
    if(!['z','q','s','d','w','a'].includes(key)||this.mode==='follow')return;
    this.#keys.add(key);this.mode='free';this.representativeId=null;this.visible(null);
    event.preventDefault();event.stopImmediatePropagation();
  };
  readonly #up=(event:KeyboardEvent)=>{this.#keys.delete(event.key.toLowerCase());};
  readonly #blur=()=>{this.#keys.clear();this.#lastAt=null;};
  start(id:string,mode:'follow'|'pov') {
    const pose=this.pose(id);if(!pose)return false;
    if(!this.active)this.#saved={alpha:this.orbit.alpha,beta:this.orbit.beta,radius:this.orbit.radius,fov:this.orbit.fov,target:this.orbit.target.clone()};
    this.orbit.detachControl();this.#eye.detachControl();this.#keys.clear();
    this.orbit.inertialAlphaOffset=this.orbit.inertialBetaOffset=this.orbit.inertialRadiusOffset=0;
    this.orbit.inertialPanningX=this.orbit.inertialPanningY=0;
    this.mode=mode;this.representativeId=id;this.#lastAt=null;
    this.scene.activeCamera=mode==='pov'?this.#eye:this.orbit;
    if(mode==='pov')this.#eye.attachControl(this.canvas,true);
    this.visible(mode==='pov'?id:null);
    this.update(performance.now());this.canvas.focus();return true;
  }
  update(now:number) {
    if(!this.active)return;
    const dt=this.#lastAt===null?0:Math.max(0,Math.min(.1,(now-this.#lastAt)/1000));this.#lastAt=now;
    const pose=this.representativeId?this.pose(this.representativeId):null;
    if(this.representativeId&&!pose){
      if(this.mode==='follow'){this.stop();return;}
      this.mode='free';this.representativeId=null;this.visible(null);
    }
    if(this.mode==='follow'&&pose){
      this.orbit.target.copyFrom(pose.position);this.orbit.target.y+=.12;
      this.orbit.alpha=-Math.PI/2-pose.heading;this.orbit.beta=Math.PI/4;this.orbit.radius=8;this.orbit.fov=.65;
      return;
    }
    if(this.mode==='pov'&&pose){
      const height=this.ground(pose.position.x,pose.position.z);
      this.#eye.position.set(pose.position.x,(height??pose.position.y-.215)+INHABITANT_EYE_HEIGHT,pose.position.z);
      this.#eye.rotation.set(0,pose.heading,0);
    }else if(this.mode==='free'){
      const forward=Number(this.#keys.has('z')||this.#keys.has('w'))-Number(this.#keys.has('s'));
      const right=Number(this.#keys.has('d'))-Number(this.#keys.has('q')||this.#keys.has('a'));
      const length=Math.hypot(forward,right),speed=length?CELL_UNITS*dt/length:0,yaw=this.#eye.rotation.y;
      const p=walkOnPlane(this.#eye.position,(Math.sin(yaw)*forward+Math.cos(yaw)*right)*speed,
        (Math.cos(yaw)*forward-Math.sin(yaw)*right)*speed,(x,z)=>this.ground(x,z)!==null&&(this.noclip||this.free(x,z)));
      const height=this.ground(p.x,p.z);
      if(height!==null){p.y=height+INHABITANT_EYE_HEIGHT;this.#eye.position.copyFrom(p);}
      this.#eye.rotation.x=Math.max(-1.35,Math.min(1.35,this.#eye.rotation.x));
    }
    // Orbit remains the terrain streamer's local focus while the eye camera renders.
    this.orbit.target.copyFrom(this.#eye.position);this.orbit.radius=18;
  }
  shift(x:number,z:number){
    this.#eye.position.x-=x;this.#eye.position.z-=z;
    if(this.#saved){this.#saved.target.x-=x;this.#saved.target.z-=z;}
  }
  stop() {
    if(!this.active)return;
    const at=this.orbit.target.clone();
    this.#eye.detachControl();this.scene.activeCamera=this.orbit;
    if(this.#saved){this.orbit.alpha=this.#saved.alpha;this.orbit.beta=this.#saved.beta;this.orbit.radius=this.#saved.radius;this.orbit.fov=this.#saved.fov;}
    this.orbit.target.copyFrom(at);this.orbit.attachControl(this.canvas,true);
    this.mode='village';this.representativeId=null;this.#saved=null;this.#blur();this.visible(null);
  }
  dispose(){
    this.stop();window.removeEventListener('keydown',this.#down,true);window.removeEventListener('keyup',this.#up,true);
    window.removeEventListener('blur',this.#blur);document.removeEventListener('visibilitychange',this.#blur);this.#eye.dispose();
  }
}
