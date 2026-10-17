import type {ObservationPose} from './observation.js';
/** Presentation only. Canonical cells cross a toroidal seam by the short arc. */
export function interpolateObservationPose(from:ObservationPose,to:ObservationPose,world:{widthCells:number;heightCells:number},amount:number):ObservationPose {
 const t=Math.max(0,Math.min(1,amount)),lerp=(a:number,b:number)=>a+(b-a)*t;
 const circular=(a:number,b:number,size:number)=>{const d=((b-a+size/2)%size+size)%size-size/2;return((a+d*t)%size+size)%size;};
 if(from.mode!==to.mode)return to;
 if((from.mode==='village'||from.mode==='region')&&(to.mode==='village'||to.mode==='region'))return{...to,cellX:circular(from.cellX,to.cellX,world.widthCells),cellY:circular(from.cellY,to.cellY,world.heightCells),alpha:circular(from.alpha,to.alpha,2*Math.PI),beta:lerp(from.beta,to.beta),radius:lerp(from.radius,to.radius),altitude:lerp(from.altitude,to.altitude),fov:lerp(from.fov,to.fov)};
 if(from.mode==='world'&&to.mode==='world'){const vector=(a:[number,number,number],b:[number,number,number])=>a.map((v,i)=>lerp(v,b[i]!)) as [number,number,number];const up=vector(from.up,to.up),length=Math.hypot(...up);return{...to,eye:vector(from.eye,to.eye),target:vector(from.target,to.target),up:length>1e-6?up.map(v=>v/length) as [number,number,number]:to.up,fov:lerp(from.fov,to.fov)};}
 return to;
}
