import type {GeneratedLandscape} from '@arbestra/contracts';
import {sampleWorldTopography,geographicWaterCurrent} from '@arbestra/contracts/world-geography';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import type {Scene} from '@babylonjs/core/scene';
/** Bounded native updatable line batch. Diagnostic only; never grants navigation. */
export function createGeographicFlowView(scene:Scene,data:GeneratedLandscape,local:boolean,center:{x:number;y:number},point:(x:number,y:number,z:number)=>number[]){
 const g=data.geography!,step=local?4:Math.max(4,Math.ceil(Math.max(g.width,g.height)/32));
 const x0=local?Math.floor((center.x-16)/32)*32:0,y0=local?Math.floor((center.y-16)/32)*32:0;
 const sites:Array<{x:number;y:number;z:number}>=[],lines:Vector3[][]=[];
 for(let y=y0+step/2;y<(local?y0+64:g.height);y+=step)for(let x=x0+step/2;x<(local?x0+64:g.width);x+=step){
  const sample=sampleWorldTopography(g,x,y);if(sample.depth<.02)continue;
  sites.push({x,y,z:sample.surface});for(let i=0;i<3;i++)lines.push([Vector3.Zero(),Vector3.Zero()]);
 }
 if(!sites.length)return null;
 const mesh=MeshBuilder.CreateLineSystem('solar-water-currents',{lines,updatable:true},scene);mesh.color=new Color3(.80,.94,.88);mesh.isPickable=false;
 let lastPhase=NaN;
 return {count:sites.length,mesh,update(phase:number){
  if(phase===lastPhase)return;lastPhase=phase;
  sites.forEach(({x,y,z},i)=>{
   const [dx,dy]=geographicWaterCurrent(g,x,y,phase),length=Math.hypot(dx,dy)||1;
   let scale=Math.min(1.7,step*.3)/Math.max(1,length);
   for(let k=0;k<4&&sampleWorldTopography(g,x+dx*scale,y+dy*scale).depth<.001;k++)scale*=.5;
   const tx=x+dx*scale,ty=y+dy*scale,wing=.22*scale;
   const points=[[x,y],[tx,ty],[tx-dx*wing-dy*wing,ty-dy*wing+dx*wing],[tx-dx*wing+dy*wing,ty-dy*wing-dx*wing]];
   const pairs=[[0,1],[1,2],[1,3]];
   for(let edge=0;edge<3;edge++)for(let end=0;end<2;end++){
    const [px,py]=points[pairs[edge]![end]!]!,position=point(px!,py!,(z+.025)*4);
    lines[i*3+edge]![end]!.set(position[0]!,position[1]!,position[2]!);
   }
  });
  MeshBuilder.CreateLineSystem('solar-water-currents',{lines,instance:mesh},scene);mesh.refreshBoundingInfo();
 },dispose(){mesh.dispose();}};
}
