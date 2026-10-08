import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import type { BuildingPlan,Opening } from './building-plan';
import type { TimberThatch } from './timber-thatch';

/** Thick glass wrapping the back facade and rounded ground-floor corner. */
export function buildTownHallStorefront(parent:Mesh,kit:TimberThatch,plan:BuildingPlan,corner:{cx:number;cz:number},opening:Opening){
  const root=new Mesh('market-storefront',kit.scene);root.parent=parent;
  const wallThickness=plan.recipe.module.thickness,thickness=wallThickness*.4;
  const radius=plan.width/2-corner.cx-wallThickness+thickness/2,height=opening.top-opening.bottom;
  const material=new StandardMaterial('market-storefront-reflective-glass',kit.scene);
  material.diffuseColor=Color3.FromHexString('#87b3ce');material.specularColor=Color3.FromHexString('#d8efff');
  material.alpha=.32;material.specularPower=128;material.useSpecularOverAlpha=true;material.useReflectionOverAlpha=true;
  material.reflectionFresnelParameters=new FresnelParameters();material.reflectionFresnelParameters.leftColor=Color3.White();material.reflectionFresnelParameters.rightColor=new Color3(.28,.28,.28);material.reflectionFresnelParameters.power=2;
  // A sky/ground environment, not a scene capture: no six extra village renders.
  const size=16,faces=Array.from({length:6},(_,face)=>{
    const pixels=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const sky=face===2?1:face===3?0:1-y/(size-1);
      const top=[151,190,215],bottom=[65,77,58],offset=(y*size+x)*4;
      for(let channel=0;channel<3;channel++)pixels[offset+channel]=bottom[channel]!+(top[channel]!-bottom[channel]!)*sky;
      pixels[offset+3]=255;
    }
    return pixels;
  });
  const reflection=new RawCubeTexture(kit.scene,faces,size);reflection.name='market-storefront-environment';
  material.reflectionTexture=reflection;
  const straight=MeshBuilder.CreateBox('market-storefront-straight',{width:thickness,height,depth:opening.right-opening.left},kit.scene);
  straight.position.set(corner.cx+radius,(opening.bottom+opening.top)/2,(opening.left+opening.right)/2);straight.parent=root;straight.material=material;straight.isPickable=false;
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],uvs:number[]=[];
  const point=(r:number,a:number,y:number)=>[corner.cx+r*Math.cos(a),y,corner.cz+r*Math.sin(a)];
  const face=(points:number[][],out:number[][])=>{
    const ps=points.flat(),is=[0,1,2,0,2,3],ns:number[]=[];VertexData.ComputeNormals(ps,is,ns);
    if(ns[0]!*out[0]![0]!+ns[1]!*out[0]![1]!+ns[2]!*out[0]![2]!<0){for(let i=0;i<is.length;i+=3)[is[i+1],is[i+2]]=[is[i+2]!,is[i+1]!];}
    const offset=positions.length/3;positions.push(...ps);normals.push(...out.flat());indices.push(...is.map(i=>i+offset));uvs.push(0,0,1,0,1,1,0,1);
  };
  for(let i=0;i<24;i++){
    const a=-Math.PI/2+i*Math.PI/48,b=a+Math.PI/48;
    for(const side of [-1,1]){
      const r=radius+side*thickness/2,na=[side*Math.cos(a),0,side*Math.sin(a)],nb=[side*Math.cos(b),0,side*Math.sin(b)];
      face([point(r,a,opening.bottom),point(r,b,opening.bottom),point(r,b,opening.top),point(r,a,opening.top)],[na,nb,nb,na]);
    }
    for(const side of [-1,1]){
      const y=side===1?opening.top:opening.bottom,n=[0,side,0];
      face([point(radius-thickness/2,a,y),point(radius+thickness/2,a,y),point(radius+thickness/2,b,y),point(radius-thickness/2,b,y)],[n,n,n,n]);
    }
  }
  for(const a of [-Math.PI/2,0]){
    const side=a===0?1:-1,n=[-Math.sin(a)*side,0,Math.cos(a)*side];
    face([point(radius-thickness/2,a,opening.bottom),point(radius+thickness/2,a,opening.bottom),point(radius+thickness/2,a,opening.top),point(radius-thickness/2,a,opening.top)],[n,n,n,n]);
  }
  const curve=new Mesh('market-storefront-curved',kit.scene),data=new VertexData();Object.assign(data,{positions,normals,indices,uvs});data.applyToMesh(curve);curve.parent=root;curve.material=material;curve.isPickable=false;
  const observer=kit.scene.onBeforeRenderObservable.add(()=>{
    if(!root.isEnabled())return;
    const daylight=kit.scene.lights.filter(l=>['DirectionalLight','HemisphericLight'].includes(l.getClassName())).reduce((sum,l)=>sum+l.intensity,0);
    reflection.level=1.5*Math.min(1,Math.max(.03,daylight));
  });
  root.onDisposeObservable.addOnce(()=>{kit.scene.onBeforeRenderObservable.remove(observer);material.dispose();reflection.dispose();});
  return root;
}
